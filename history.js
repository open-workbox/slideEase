// 修改记录的本地存储（主进程）：每个文档一个目录，追加写入，快照压缩去重
// 位置：<用户数据目录>/history/<文档编号>/
//   meta.json    文档信息（上次路径、上次内容哈希）
//   log.jsonl    追加写入的修改记录（同 id 的后一行覆盖前一行，用于合并连续操作）
//   snaps/<h>.gz 保存点快照（大块 base64 图片单独存放并去重）
//   blobs/<h>.gz 被抽出的大块 base64 数据
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { app } = require('electron');

const META_RE = /<meta\s[^>]*name=["']slideease-doc["'][^>]*>/i;
const BIG_DATA_RE = /data:([\w+.\/-]+);base64,([A-Za-z0-9+\/=]{2000,})/g;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const root = () => path.join(app.getPath('userData'), 'history');

let cur = null; // { id, dir, meta }

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }

/* ---------- HTML 里的文档编号 ---------- */
function readDocId(html) {
  const m = html.match(META_RE);
  if (!m) return null;
  const c = m[0].match(/content=["']([^"']+)["']/i);
  return c && /^[\w-]{6,64}$/.test(c[1]) ? c[1] : null;
}
function setDocId(html, id) {
  const tag = `<meta name="slideease-doc" content="${id}">`;
  if (META_RE.test(html)) return html.replace(META_RE, tag);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + tag + '</head>');
  return tag + html;
}

/* ---------- 快照 / 数据块 ---------- */
function putBlobs(text, dir) {
  return text.replace(BIG_DATA_RE, (m, _mime, b64) => {
    const h = sha(b64);
    const f = path.join(dir, 'blobs', h + '.gz');
    if (!fs.existsSync(f)) { ensure(path.dirname(f)); fs.writeFileSync(f, zlib.gzipSync(m)); }
    return 'sdb://' + h;
  });
}
function restoreBlobs(text, dir) {
  return text.replace(/sdb:\/\/([0-9a-f]{40})/g, (m, h) => {
    try { return zlib.gunzipSync(fs.readFileSync(path.join(dir, 'blobs', h + '.gz'))).toString('utf8'); } catch { return m; }
  });
}
function putSnap(text) {
  const h = sha(text);
  const f = path.join(cur.dir, 'snaps', h + '.gz');
  if (!fs.existsSync(f)) { ensure(path.dirname(f)); fs.writeFileSync(f, zlib.gzipSync(putBlobs(text, cur.dir))); }
  return h;
}
function getSnap(h) {
  if (!cur || !/^[0-9a-f]{40}$/.test(h)) return null;
  try { return restoreBlobs(zlib.gunzipSync(fs.readFileSync(path.join(cur.dir, 'snaps', h + '.gz'))).toString('utf8'), cur.dir); } catch { return null; }
}
function getBlob(h) {
  if (!cur || !/^[0-9a-f]{40}$/.test(h)) return null;
  try { return zlib.gunzipSync(fs.readFileSync(path.join(cur.dir, 'blobs', h + '.gz'))).toString('utf8'); } catch { return null; }
}

/* ---------- 记录 ---------- */
function writeMeta() { fs.writeFileSync(path.join(cur.dir, 'meta.json'), JSON.stringify(cur.meta)); }

function append(rec) {
  if (!cur || !rec || typeof rec !== 'object') return;
  const line = putBlobs(JSON.stringify(rec), cur.dir);
  fs.appendFileSync(path.join(cur.dir, 'log.jsonl'), line + '\n');
}

function logSize(dir) {
  try { return fs.statSync(path.join(dir, 'log.jsonl')).size; } catch { return 0; }
}
// 记下日志当前的大小；放弃未保存的修改时，把日志截回这个位置
function setMark() {
  cur.meta.sessionMark = logSize(cur.dir);
  writeMeta();
}

function list(dir) {
  dir = dir || (cur && cur.dir);
  if (!dir) return [];
  let raw = '';
  try { raw = fs.readFileSync(path.join(dir, 'log.jsonl'), 'utf8'); } catch { return []; }
  const map = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r && r.id) map.set(r.id, r); } catch { /* 跳过损坏的行 */ }
  }
  return [...map.values()];
}

/* ---------- 打开文档 ---------- */
function open(filePath, content) {
  const hash = sha(content);
  let id = readDocId(content);
  const fromMeta = !!id;
  if (!id) id = 'p-' + sha(path.resolve(filePath).toLowerCase()).slice(0, 16);
  let dir = path.join(root(), id);
  let meta = readJson(path.join(dir, 'meta.json'), null);

  // 副本检测：编号相同但原文件仍在别处，说明这是复制出来的文件，给它分叉出独立的历史
  if (meta && fromMeta && meta.lastPath && path.resolve(meta.lastPath) !== path.resolve(filePath) && fs.existsSync(meta.lastPath)) {
    const newId = 'd-' + uid();
    const newDir = path.join(root(), newId);
    fs.cpSync(dir, newDir, { recursive: true });
    id = newId; dir = newDir;
    meta = readJson(path.join(dir, 'meta.json'), meta);
    meta.id = id;
  }

  ensure(dir);
  cur = { id, dir, meta: meta || { id, created: Date.now(), lastHash: null } };
  cur.meta.lastPath = filePath;

  if (!meta || !cur.meta.lastHash) {
    append({ id: uid(), t: Date.now(), kind: 'baseline', hash: putSnap(content) });
    cur.meta.lastHash = hash;
  } else if (cur.meta.lastHash !== hash) {
    // 文件在软件之外被改过：补一个新的起点，保证历史真实
    append({ id: uid(), t: Date.now(), kind: 'external', hash: putSnap(content) });
    cur.meta.lastHash = hash;
  }
  setMark();
  return { id, records: list() };
}

// 保存：写入文档编号，生成保存点
function prepareSave(html) {
  return cur ? setDocId(html, cur.id) : html;
}
function saved(html, filePath) {
  if (!cur) return null;
  const rec = { id: uid(), t: Date.now(), kind: 'save', hash: putSnap(html) };
  append(rec);
  cur.meta.lastHash = sha(html);
  cur.meta.lastPath = filePath;
  setMark();
  return rec;
}

// 用户选择“不保存”：把这次打开以来（上次保存之后）产生的修改记录一并清掉
function discard(id) {
  id = id || (cur && cur.id);
  if (!id || !/^[\w-]{3,64}$/.test(id)) return [];
  const dir = path.join(root(), id);
  const meta = readJson(path.join(dir, 'meta.json'), null);
  if (meta && typeof meta.sessionMark === 'number') {
    try { fs.truncateSync(path.join(dir, 'log.jsonl'), Math.min(meta.sessionMark, logSize(dir))); } catch { /* 忽略 */ }
  }
  return list(dir);
}

function clear() {
  if (!cur) return [];
  const last = cur.meta.lastHash ? getSnap(cur.meta.lastHash) : null;
  fs.rmSync(cur.dir, { recursive: true, force: true });
  ensure(cur.dir);
  if (last) append({ id: uid(), t: Date.now(), kind: 'baseline', hash: putSnap(last) });
  writeMeta();
  return list();
}

module.exports = { open, append, list, prepareSave, saved, getSnap, getBlob, clear, discard };

