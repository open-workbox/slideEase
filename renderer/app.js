import { t, getLang, setLang, applyStatic } from './i18n.js';
import { matches, matchIndex, held } from './shortcuts.js';
import { prepare, applyOps, fingerprint } from './source.js';
import { inlineResources } from './inline.js';
import * as H from './historyui.js';
import * as F from './find.js';
import * as N from './notes.js';
import * as SM from './selmenu.js';
import * as X from './exporter.js';
import * as G from './guides.js';
import { buildTutorial } from './tutorial.js';
import { detectSlides, analyze, showSlide, clearMarks, slideTitle, STYLE_CSS } from './slides.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ID = 'data-pe-id';

const S = {
  name: null, tagged: '', frame: null, doc: null, win: null,
  slides: [], info: { kind: 'single' }, cur: 0,
  sel: null, editing: null, editFrom: null,
  history: [], redo: [], version: 0, savedVersion: 0,
  notes: [], scale: 1, zoom: null, busy: false, idCounter: 0, warnedDyn: false,
};
// 调试记录（只在 SLIDEEASE_DEBUG=1 启动时有效，平时什么都不做）
let DBG = false;
window.api.debugEnabled().then((v) => { DBG = !!v; });
const dbg = (s) => { if (DBG) window.api.debugLog(s); };
const thumbMap = new WeakMap();
const frame = $('#frame');
const wrap = $('#frame-wrap');
const selBox = $('#sel-box');
const hoverBox = $('#hover-box');

/* ---------------- 通用小工具 ---------------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

const isDirty = () => S.version !== S.savedVersion;
const hasDoc = () => !!S.doc;
const idOf = (el) => el && el.getAttribute && el.getAttribute(ID);

function setStyle(el, prop, v) {
  if (v) el.style.setProperty(prop, v, 'important');
  else el.style.removeProperty(prop);
}

const colorCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function toHex(css) {
  // 借助 canvas 把任意 CSS 颜色（rgb/oklch/命名色…）统一转成 #rrggbb；返回 alpha 以判断是否透明
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = '#000';
  colorCtx.fillStyle = css;
  colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = colorCtx.getImageData(0, 0, 1, 1).data;
  const h = (n) => n.toString(16).padStart(2, '0');
  return { hex: `#${h(r)}${h(g)}${h(b)}`, alpha: a / 255 };
}

/* ---------------- 修改历史（撤销/重做） ---------------- */
function applyChange(c, dir) {
  const fwd = dir === 'do';
  switch (c.type) {
    case 'style': setStyle(c.el, c.prop, fwd ? c.to : c.from); break;
    case 'html': c.el.innerHTML = fwd ? c.to : c.from; break;
    case 'notes': S.notes = fwd ? c.to : c.from; break; // 批注整体替换（撤销 / 重做）
    case 'attr': {
      const v = fwd ? c.to : c.from;
      if (v == null) c.el.removeAttribute(c.name); else c.el.setAttribute(c.name, v);
      break;
    }
    case 'remove':
      if (fwd) c.el.remove();
      else if (c.next && c.next.parentNode === c.parent) c.parent.insertBefore(c.el, c.next);
      else c.parent.appendChild(c.el);
      break;
    case 'clone':
      if (fwd) c.srcEl.after(c.node); else c.node.remove();
      break;
    case 'insert':
      if (fwd) c.parent.insertBefore(c.el, c.next && c.next.parentNode === c.parent ? c.next : null);
      else c.el.remove();
      break;
    case 'move':
      if (fwd) { if (c.pos === 'after') c.refEl.after(c.el); else c.refEl.before(c.el); }
      else if (c.next && c.next.parentNode === c.parent) c.parent.insertBefore(c.el, c.next);
      else c.parent.appendChild(c.el);
      break;
  }
}

const STRUCTURAL = new Set(['remove', 'clone', 'move', 'insert']);

function commit(changes, { applied = false, revertOf = null } = {}) {
  changes = changes.filter((c) => !(c.type === 'style' && c.from === c.to));
  if (!changes.length) return;
  const rec = H.logChanges(changes, { revertOf }); // 必须在应用修改前记录（删除等操作之后就取不到原位置了）
  if (!applied) changes.forEach((c) => applyChange(c, 'do'));
  changes.recId = rec ? rec.id : null;
  S.history.push(changes);
  S.redo = [];
  afterChange(changes);
  if (changes.some((c) => c.el && !idOf(c.el) && c.type !== 'clone') && !S.warnedDyn) {
    S.warnedDyn = true;
    toast(t('dynWarn'));
  }
}

function undo() {
  if (S.editing) endEdit();
  const e = S.history.pop();
  if (!e) return;
  [...e].reverse().forEach((c) => applyChange(c, 'undo'));
  S.redo.push(e);
  H.logEvent('undo', e.recId);
  afterChange(e);
}
function redo() {
  if (S.editing) endEdit();
  const e = S.redo.pop();
  if (!e) return;
  e.forEach((c) => applyChange(c, 'do'));
  S.history.push(e);
  H.logEvent('redo', e.recId);
  afterChange(e);
}

function afterChange(changes) {
  S.version++;
  if (changes.some((c) => STRUCTURAL.has(c.type))) refreshSlides(true);
  if (S.sel && !S.sel.isConnected) select(null);
  updateOverlay();
  updatePanel();
  updateChrome();
  scheduleThumb();
  F.refresh();
  N.render();
}

function collectOps() {
  const ops = [];
  let skipped = 0;
  for (const c of S.history.flat()) {
    const id = idOf(c.el);
    switch (c.type) {
      case 'style': id ? ops.push({ type: 'style', id, prop: c.prop, value: c.to }) : skipped++; break;
      case 'html': id ? ops.push({ type: 'html', id, value: c.to }) : skipped++; break;
      case 'attr': id ? ops.push({ type: 'attr', id, name: c.name, value: c.to }) : skipped++; break;
      case 'remove': id ? ops.push({ type: 'remove', id }) : skipped++; break;
      case 'move': id && idOf(c.refEl) ? ops.push({ type: 'move', id, refId: idOf(c.refEl), pos: c.pos }) : skipped++; break;
      case 'insert': idOf(c.parent) ? ops.push({ type: 'insert', parentId: idOf(c.parent), nextId: idOf(c.next), html: c.html }) : skipped++; break;
      case 'clone': idOf(c.srcEl) ? ops.push({ type: 'clone', srcId: idOf(c.srcEl), map: c.map }) : skipped++; break;
    }
  }
  return { ops, skipped };
}

/* ---------------- 文件 ---------------- */
async function openDoc(f) {
  if (!f) return false;
  let kept = null; // 放弃未保存修改后，当前文档剩余的记录
  if (hasDoc() && isDirty()) {
    if (!confirm(t('confirmDiscard'))) return false;
    if (S.historyId) kept = await window.api.historyDiscard(S.historyId); // 选择不保存：同时清掉这次的修改记录
  }
  if (f.tutorial) window.api.detachDoc(); // 教程不对应用户的文件：之后“保存”会改为另存为
  stopBackgroundThumbs(); // 上一个文档的后台缩略图任务不再需要
  const { tagged, live, notes, issues } = prepare(f.content, f.baseHref);
  S.historyId = f.history ? f.history.id : f.restored ? S.historyId : null;
  H.setRecords(f.history ? f.history.records : f.restored ? kept : []); // null 表示沿用当前记录
  Object.assign(S, {
    name: f.name, isTutorial: !!f.tutorial, baseHref: f.baseHref, tagged, notes, history: [], redo: [], version: 0, savedVersion: 0,
    sel: null, editing: null, doc: null, win: null, slides: [], cur: 0, warnedDyn: false, busy: true, zoom: null,
  });
  setLoading('full', t('loading'));
  $('#shortcuts').open = false; // 打开文件后默认折叠快捷键
  try {
    $('#empty').hidden = true;
    wrap.hidden = false;
    layoutStage();
    const loaded = new Promise((r) => frame.addEventListener('load', r, { once: true }));
    frame.srcdoc = live;
    await loaded;
    await sleep(600); // 等页面自己的脚本/字体跑完
    setupFrame();
    refreshSlides(false);
    updateChrome();
  } finally {
    S.busy = false;
    S.cur = 0;
    navigate(0);
    select(null);
    F.reset();
    N.reset();
    refreshRecent();
    window.api.track('doc_opened'); // 仅事件，无文件名/路径/内容
    updateChrome();
    setLoading(null);
    N.showWarn(issues); // 批注被改动或丢失时提醒用户
  }
  startBackgroundThumbs(live); // 缩略图在后台生成，不耽误用户开始编辑
  return true;
}

// 加载浮层：full 为整屏遮罩；block 为透明遮罩（仅阻断操作，进度显示在顶部）
function setLoading(mode, text) {
  window.api.setLoading(mode || null, text || '');
}

async function openDialog() {
  const f = await window.api.openFile();
  if (f) await openDoc(f);
}

/* ---------------- 启动页：最近打开的文件 ---------------- */
let recentManaging = false;
async function refreshRecent() {
  const list = await window.api.recentList();
  renderRecent(list);
}
function renderRecent(list) {
  const box = $('#recent');
  const ul = $('#recent-list');
  box.hidden = !list.length;
  if (!list.length) { recentManaging = false; $('#recent-manage').classList.remove('on'); }
  ul.innerHTML = '';
  for (const r of list) {
    const li = document.createElement('li');
    li.className = 'recent-item' + (r.exists ? '' : ' missing');
    li.title = r.path;
    const ico = document.createElement('span');
    ico.className = 'recent-ico';
    ico.textContent = '▤';
    const txt = document.createElement('div');
    txt.className = 'recent-text';
    const nm = document.createElement('div');
    nm.className = 'recent-name';
    nm.textContent = r.name;
    const pt = document.createElement('div');
    pt.className = 'recent-path';
    pt.textContent = r.path;
    txt.append(nm, pt);
    const del = document.createElement('button');
    del.className = 'recent-del';
    del.textContent = '✕';
    del.title = t('recentRemove');
    del.hidden = !recentManaging;
    del.onclick = async (e) => {
      e.stopPropagation(); // 仅删除打开记录，不动文件本身
      renderRecent(await window.api.recentRemove(r.path));
    };
    li.append(ico, txt, del);
    li.onclick = () => { if (!recentManaging) openRecent(r.path); };
    ul.appendChild(li);
  }
}
async function openRecent(p) {
  const res = await window.api.recentOpen(p);
  if (res && res.doc) await openDoc(res.doc);
  else { toast(t('recentMissing')); renderRecent(res.records || []); }
}
function setRecentManaging(on) {
  recentManaging = on;
  $('#recent-manage').classList.toggle('on', on);
  $('#recent-list').querySelectorAll('.recent-del').forEach((b) => (b.hidden = !on));
}
$('#recent-manage').onclick = (e) => { e.stopPropagation(); setRecentManaging(!recentManaging); };
// 点其他区域退出管理状态（隐藏 X）
document.addEventListener('mousedown', (e) => {
  if (recentManaging && !$('#recent').contains(e.target)) setRecentManaging(false);
});

async function save(as) {
  if (!hasDoc()) return false;
  if (S.editing) endEdit();
  const { ops, skipped } = collectOps();
  const applied = applyOps(S.tagged, ops, S.notes);
  const failed = applied.failed;
  let html = applied.html;
  let stat = { inlined: 0, missing: 0 };
  try {
    ({ html, stat } = await inlineResources(html, S.baseHref)); // 外部资源合并进单个文件
  } catch { /* 合并失败时仍保存原结构 */ }
  let r;
  try { r = as ? await window.api.saveAs(html) : await window.api.save(html); } catch { r = null; }
  if (!r) return false;
  S.name = r.name;
  S.savedVersion = S.version;
  // 保存后以当前内容为准，已确认过的
  if (r.rec) H.addRecord(r.rec);
  window.api.track(as ? 'save_as' : 'save'); // 仅功能事件，无文件内容
  updateChrome();
  const bad = skipped + failed;
  let msg = bad ? t('skipWarn', { n: bad }) : t('saved');
  if (stat.inlined) msg += ' · ' + t('inlined', { n: stat.inlined });
  if (stat.missing) msg += ' · ' + t('missingRes', { n: stat.missing });
  toast(msg);
  return true;
}

// 生成“当前编辑结果”的完整 HTML（回放修改 + 合并资源），供预览和保存共用
async function buildHtml() {
  if (S.editing) endEdit();
  const { ops } = collectOps();
  let { html } = applyOps(S.tagged, ops);
  try { ({ html } = await inlineResources(html, S.baseHref)); } catch { /* 合并失败仍返回原结构 */ }
  return html;
}

// 预览（放映）：用当前编辑结果，从当前页开始全屏播放，不改动文件
async function preview() {
  if (!hasDoc() || S.previewing) return;
  S.previewing = true;
  window.api.track('preview');
  setLoading('full', t('previewOpening'));
  try {
    const html = await buildHtml();
    await window.api.openPreview(html, { lang: getLang(), index: S.cur });
  } finally {
    setLoading(null);
    S.previewing = false;
  }
}

/* ---------------- iframe 准备 ---------------- */
function setupFrame() {
  S.win = frame.contentWindow;
  S.doc = frame.contentDocument;
  layoutStage(); // 文档就绪后刷新（显示右下角缩放控件）
  const style = S.doc.createElement('style');
  style.textContent = STYLE_CSS;
  (S.doc.head || S.doc.documentElement).appendChild(style);

  const d = S.doc;
  // __se 标记：编辑画面里页面自己注册 contextmenu / selectstart / dragstart / copy / cut 监听会被忽略，软件自己的带标记，不受影响
  const on = (type, fn) => d.addEventListener(type, fn, { capture: true, __se: true });
  on('mousedown', onDown);
  on('mousemove', onHover);
  on('mouseleave', () => (hoverBox.style.display = 'none'));
  on('dblclick', onDbl);
  on('keydown', onKey);
  on('keyup', (e) => e.stopPropagation());
  on('keypress', (e) => e.stopPropagation());
  // 调试：记录页面实际收到的鼠标事件（放在最后注册，所以能看到前面的处理有没有 preventDefault）
  ['pointerdown', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'].forEach((type) =>
    d.addEventListener(type, (ev) => dbg(`${type} btn=${ev.button} target=${ev.target.tagName} at=${Math.round(ev.clientX)},${Math.round(ev.clientY)} prevented=${ev.defaultPrevented}`), { capture: true, __se: true }));
  d.addEventListener('selectionchange', () => { dbg(`selectionchange text="${S.win.getSelection().toString().slice(0, 30)}"`); SM.updateHint(); });
  on('click', blockIfIdle);
  for (const ev of ['mouseup', 'pointerdown', 'pointerup', 'auxclick', 'touchstart', 'submit', 'dragstart'])
    on(ev, blockIfIdle);
  on('contextmenu', onContext); // 右键：显示 复制 / 剪切 / 批注 菜单
  // 网页里的
  d.addEventListener('wheel', (e) => onWheel(e, true), { capture: true, passive: false });
  S.win.addEventListener('scroll', () => { updateOverlay(); syncCurFromScroll(); }, true);
}

function blockIfIdle(e) {
  if (S.editing && S.editing.contains(e.target)) return;
  // 注意：pointerdown / pointerup 只能拦截传播，不能 preventDefault。
  // 取消 pointerdown 会让浏览器不再派发后续的 mousedown / mouseup / mousemove，软件就收不到真实鼠标操作了。
  if (e.type !== 'pointerdown' && e.type !== 'pointerup') e.preventDefault();
  e.stopPropagation();
}

/* ---------------- 画布尺寸 ---------------- */
function layoutStage() {
  const stage = $('#stage');
  const aw = stage.clientWidth - 48;
  const ah = stage.clientHeight - 48;
  // 页面按固定的 16:9 逻辑尺寸渲染，窗口大小只影响显示比例，不影响页面内部排版
  const W = 1920;
  const H = 1080;
  S.scale = S.zoom || Math.min(aw / W, ah / H, 2); // 未手动缩放时自动适应窗口
  $('#zoombar').hidden = !hasDoc();
  $('#z-pct').textContent = Math.round(S.scale * 100) + '%';
  frame.style.width = W + 'px';
  frame.style.height = H + 'px';
  frame.style.transform = `scale(${S.scale})`;
  wrap.style.width = W * S.scale + 'px';
  wrap.style.height = H * S.scale + 'px';
  updateOverlay();
}

/* ---------------- 缩放（触摸板双指捏合 / Ctrl+滚轮 / 右下角控件） ---------------- */
const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];

// 以屏幕上的某一点为中心缩放，保持该点下的内容位置不变
function zoomAt(ns, px, py) {
  if (!hasDoc()) return;
  const stageEl = $('#stage');
  const sr = stageEl.getBoundingClientRect();
  if (px == null) { px = sr.left + sr.width / 2; py = sr.top + sr.height / 2; }
  const wr = wrap.getBoundingClientRect();
  const cx = (px - wr.left) / S.scale;
  const cy = (py - wr.top) / S.scale;
  S.zoom = Math.min(4, Math.max(0.1, ns));
  layoutStage();
  const wr2 = wrap.getBoundingClientRect();
  stageEl.scrollLeft += wr2.left + cx * S.scale - px;
  stageEl.scrollTop += wr2.top + cy * S.scale - py;
  scheduleThumb();
}

function zoomStep(dir) {
  const cur = S.scale;
  const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.005) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.005);
  if (next) zoomAt(next);
}

function zoomFit() {
  S.zoom = null;
  layoutStage();
  $('#stage').scrollTo(0, 0);
  scheduleThumb();
}

function onWheel(e, fromFrame) {
  if (!e.ctrlKey && !e.metaKey) return; // 触摸板捏合在 Chromium 中表现为 ctrl+wheel
  e.preventDefault();
  e.stopPropagation();
  let px = e.clientX, py = e.clientY;
  if (fromFrame) {
    const r = frame.getBoundingClientRect();
    px = r.left + e.clientX * S.scale;
    py = r.top + e.clientY * S.scale;
  }
  zoomAt(S.scale * Math.exp(-e.deltaY * 0.01), px, py);
}
$('#stage').addEventListener('wheel', (e) => onWheel(e, false), { passive: false });
$('#z-out').onclick = () => zoomStep(-1);
$('#z-in').onclick = () => zoomStep(1);
$('#z-pct').onclick = zoomFit;
$('#z-fit').onclick = zoomFit;

/* ---------------- 幻灯片列表 ---------------- */
function refreshSlides(keep) {
  if (!S.doc) return;
  if (S.info.kind === 'exclusive') clearMarks(S.slides);
  S.slides = detectSlides(S.doc, S.win);
  S.info = analyze(S.slides, S.win);
  if (S.win.Reveal && S.win.Reveal.sync) { try { S.win.Reveal.sync(); } catch { /* 忽略 */ } }
  if (S.cur >= S.slides.length) S.cur = S.slides.length - 1;
  if (!keep) S.cur = 0;
  renderThumbs();
  if (keep) showSlide(S.slides, S.info, S.win, S.cur);
}

// 缩略图多选（用于批量导出）：存页面元素本身，页序变化后仍然对得上
const picks = new Set();
let pickAnchor = null;
function paintPicks() {
  for (const p of [...picks]) if (!S.slides.includes(p)) picks.delete(p);
  [...$('#thumb-list').children].forEach((d, k) => d.classList.toggle('picked', picks.has(S.slides[k])));
}

function renderThumbs() {
  const list = $('#thumb-list');
  list.innerHTML = '';
  S.slides.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (i === S.cur ? ' active' : '');
    d.draggable = true;
    const url = thumbMap.get(s);
    d.innerHTML = `<div class="pic">${url ? `<img src="${url}" alt="">` : i + 1}</div>
      <div class="cap"><b>${i + 1}</b><span></span></div>`;
    d.querySelector('.cap span').textContent = slideTitle(s);
    if (picks.has(s)) d.classList.add('picked');
    // 单击切页；按住 Ctrl（macOS ⌘）点击多选，按住 Shift 点击连续选择
    d.addEventListener('click', (e) => {
      if (S.busy) return;
      if (held(e, 'multi', 0)) {
        if (!picks.size && S.slides[S.cur]) picks.add(S.slides[S.cur]); // 当前页默认算在选择里
        if (picks.has(s)) picks.delete(s); else picks.add(s);
        pickAnchor = i;
        paintPicks();
        return;
      }
      if (held(e, 'multi', 1)) {
        const a = pickAnchor != null ? pickAnchor : S.cur;
        picks.clear();
        for (let k = Math.min(a, i); k <= Math.max(a, i); k++) picks.add(S.slides[k]);
        paintPicks();
        return;
      }
      picks.clear();
      pickAnchor = i;
      paintPicks();
      navigate(i);
    });
    // 右键：导出为图片 / 单页 HTML（点在未选中的页上时，只针对这一页）
    d.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (S.busy) return;
      if (!picks.has(s)) { picks.clear(); paintPicks(); }
      const idxs = picks.size ? S.slides.map((x, k) => (picks.has(x) ? k : -1)).filter((k) => k >= 0) : [i];
      const n = idxs.length;
      SM.openCustomMenu(e.clientX, e.clientY, [
        { label: n > 1 ? t('exp_png_n', { n }) : t('exp_png'), fn: () => X.exportImages(idxs) },
        { label: n > 1 ? t('exp_html_n', { n }) : t('exp_html'), fn: () => X.exportHtml(idxs) },
      ]);
    });
    d.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-slide', String(i)); e.dataTransfer.effectAllowed = 'move'; });
    d.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('text/x-slide')) return;
      e.preventDefault();
      e.stopPropagation();
      const before = e.offsetY < d.offsetHeight / 2;
      d.classList.toggle('drop-before', before);
      d.classList.toggle('drop-after', !before);
    });
    d.addEventListener('dragleave', () => d.classList.remove('drop-before', 'drop-after'));
    d.addEventListener('drop', (e) => {
      const from = e.dataTransfer.getData('text/x-slide');
      if (from === '') return;
      e.preventDefault();
      e.stopPropagation();
      const before = e.offsetY < d.offsetHeight / 2;
      d.classList.remove('drop-before', 'drop-after');
      moveSlide(Number(from), i, before);
    });
    list.appendChild(d);
  });
  updateStatus();
}

function updateThumbImage(i) {
  const d = $('#thumb-list').children[i];
  const url = thumbMap.get(S.slides[i]);
  if (d && url) d.querySelector('.pic').innerHTML = `<img src="${url}" alt="">`;
}

function highlightThumb() {
  [...$('#thumb-list').children].forEach((d, i) => d.classList.toggle('active', i === S.cur));
  const a = $('#thumb-list').children[S.cur];
  if (a) a.scrollIntoView({ block: 'nearest' });
  updateStatus();
  N.pageChanged(); // 批注列表：切页后展开新的当前页
}

function navigate(i) {
  if (!S.slides.length) return;
  i = Math.max(0, Math.min(S.slides.length - 1, i));
  if (S.editing) endEdit();
  S.cur = i;
  S.lockUntil = Date.now() + 700; // 程序切页引起的滚动不要反过来改当前页
  showSlide(S.slides, S.info, S.win, i);
  if (S.sel && !S.slides[i].contains(S.sel)) select(null);
  highlightThumb();
  updateOverlay();
  if (!S.busy) setTimeout(() => captureSlide(i), 350);
}

function syncCurFromScroll() {
  if (S.info.kind !== 'scroll' || S.busy || Date.now() < (S.lockUntil || 0)) return;
  const cy = S.win.innerHeight / 2;
  const i = S.slides.findIndex((s) => { const r = s.getBoundingClientRect(); return r.top <= cy && r.bottom >= cy; });
  if (i >= 0 && i !== S.cur) { S.cur = i; highlightThumb(); }
}

function moveSlide(from, to, before) {
  const el = S.slides[from];
  const ref = S.slides[to];
  if (!el || !ref || el === ref) return;
  const pos = before ? 'before' : 'after';
  // 目标位置相邻时无需移动
  if ((pos === 'before' && S.slides[to - 1] === el) || (pos === 'after' && S.slides[to + 1] === el)) return;
  commit([{ type: 'move', el, refEl: ref, pos, parent: el.parentNode, next: el.nextSibling }]);
  S.cur = S.slides.indexOf(el);
  navigate(S.cur);
}

/* ---------------- 缩略图 ---------------- */
let capChain = Promise.resolve();
function captureSlide(i) {
  capChain = capChain.then(async () => {
    const s = S.slides[i];
    if (!s || !S.doc || S.cur !== S.slides.indexOf(s)) return; // 已切到别页，截图会错位
    // 截图是对窗口取像素，截图瞬间要把盖在页面上的浮层（选框、缩放条、弹窗、提示）先藏起来
    const floaters = ['#overlay', '#zoombar', '#settings', '#replace-pop', '#toast'].map((s) => $(s)).filter(Boolean);
    const prev = floaters.map((e) => e.style.visibility);
    try {
      const r = frame.getBoundingClientRect();
      const sr = $('#stage').getBoundingClientRect();
      // 放大后画面超出可视区时截图不完整，保留旧缩略图
      if (r.left < sr.left - 1 || r.top < sr.top - 1 || r.right > sr.right + 1 || r.bottom > sr.bottom + 1) return;
      floaters.forEach((e) => (e.style.visibility = 'hidden'));
      const url = await window.api.capture({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });
      if (url) { thumbMap.set(s, url); freshThumb.add(s); updateThumbImage(S.slides.indexOf(s)); }
    } catch { /* 忽略截图失败 */ } finally {
      floaters.forEach((e, i) => (e.style.visibility = prev[i]));
    }
  });
  return capChain;
}

let thumbTimer;
function scheduleThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => { if (!S.busy && S.slides[S.cur]) captureSlide(S.cur); }, 600);
}

// 后台生成缩略图：主进程在看不见的窗口里加载同一份页面逐页截图，结果一张张发回来。
// 编辑界面里截过的页（用户翻到过、改过）以编辑界面的为准，后台结果不覆盖，避免拿旧内容盖掉新内容。
let thumbJobId = 0;
const freshThumb = new WeakSet();
function stopBackgroundThumbs() {
  thumbJobId++;
  window.api.thumbsStop();
}
function startBackgroundThumbs(live) {
  const id = ++thumbJobId;
  if (!S.slides.length || S.info.kind === 'single') return; // 只有一页：编辑界面自己截一张就够了
  const ids = S.slides.map((s) => idOf(s));
  if (ids.every((x) => !x)) return; // 页面全由脚本生成，后台无法对应，只能翻到时再截
  setStatusLeft(t('thumbBg', { i: 0, n: ids.length }));
  window.api.thumbsStart({ jobId: id, html: live, ids: ids.filter(Boolean), kind: S.info.kind, activeClass: S.info.activeClass || '' })
    .finally(() => { if (id === thumbJobId) updateStatus(); });
}
window.api.onThumb((r) => {
  if (!r || r.jobId !== thumbJobId || !S.doc) return;
  const s = S.slides.find((x) => idOf(x) === r.id);
  if (s && r.url && !freshThumb.has(s)) {
    thumbMap.set(s, r.url);
    updateThumbImage(S.slides.indexOf(s));
  }
  if (r.done < r.total) setStatusLeft(t('thumbBg', { i: r.done, n: r.total }));
  else updateStatus();
});

/* ---------------- 选择 / 悬停 / 拖动 ---------------- */
function pick(target) {
  let el = target;
  if (!el || el.nodeType !== 1) return null;
  if (el === S.doc.documentElement || el === S.doc.body) return null;
  if (el instanceof S.win.SVGElement) return el.ownerSVGElement || el; // SVG 内部元素归到整个图形
  // 行内元素（加粗、链接、span 等）归到所在的块，更符合直觉
  while (el.parentElement && el.parentElement !== S.doc.body && S.win.getComputedStyle(el).display === 'inline') el = el.parentElement;
  return el;
}

function kindOf(el) {
  const tag = el.tagName;
  if (['IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE'].includes(tag.toUpperCase())) return t('kindImage');
  const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  return own ? t('kindText') : t('kindBox');
}

function select(el) {
  liveCommit();
  if (S.editing && S.editing !== el) endEdit();
  S.sel = el;
  if (el) {
    const idx = S.slides.findIndex((s) => s.contains(el));
    if (idx >= 0 && idx !== S.cur) { S.cur = idx; highlightThumb(); }
  }
  updateOverlay();
  updatePanel();
  updateChrome();
  N.refreshComposer();
}

function onHover(e) {
  if (S.dragging || S.editing || S.busy) return;
  const el = pick(e.target);
  if (!el || el === S.sel) { hoverBox.style.display = 'none'; return; }
  placeBox(hoverBox, el);
}

function placeBox(box, el) {
  const r = el.getBoundingClientRect();
  const s = S.scale;
  box.style.display = r.width === 0 && r.height === 0 ? 'none' : 'block';
  box.style.left = r.left * s + 'px';
  box.style.top = r.top * s + 'px';
  box.style.width = r.width * s + 'px';
  box.style.height = r.height * s + 'px';
}

function updateOverlay() {
  N.renderMarks();
  SM.updateHint();
  if (!S.sel || !S.sel.isConnected || !S.doc) { selBox.hidden = true; return; }
  const r = S.sel.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) { selBox.hidden = true; return; }
  selBox.hidden = false;
  placeBox(selBox, S.sel);
  selBox.classList.toggle('editing', !!S.editing);
  $('#sel-label').textContent = kindOf(S.sel);
}
setInterval(() => { if ((S.sel || S.notes.length) && !S.dragging) updateOverlay(); }, 300);

function localScale(el) {
  // 页面自身（如 reveal.js）可能对内容做了缩放，换算出元素局部坐标与屏幕坐标的比例
  const r = el.getBoundingClientRect();
  const w = el.offsetWidth;
  return w > 0 && r.width > 0 ? r.width / w : 1;
}
// 元素自身的 CSS scale（整体缩放）
function ownScale(el) {
  const v = S.win.getComputedStyle(el).scale;
  const n = v && v !== 'none' ? parseFloat(v) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}
// 外层（父级）带来的缩放：translate、宽高的 1 个单位在页面上对应多少像素（不含元素自身的 scale）
const parentScale = (el) => localScale(el) / ownScale(el);

function parseTranslate(el) {
  const v = el.style.getPropertyValue('translate');
  if (!v || v === 'none') return [0, 0];
  const p = v.split(/\s+/).map((x) => parseFloat(x));
  return [p[0] || 0, p[1] || 0];
}
const fmtT = (x, y) => `${Math.round(x * 100) / 100}px ${Math.round(y * 100) / 100}px`;

function onDown(e) {
  e.stopPropagation(); // 鼠标按下不再传给页面自带的脚本
  SM.closeMenu();
  N.dismissPopover();
  if (e.button === 2) { if (!S.editing) e.preventDefault(); return; } // 右键：保持当前选区，由 contextmenu 事件弹出菜单
  if (e.button !== 0 || S.busy) return;
  if (S.editing) {
    if (S.editing.contains(e.target)) return; // 编辑文字时正常点击定位光标
    // 正在编辑时点到别处：结束编辑并取消选中，不立刻选中新目标（需再点一次才选）
    endEdit();
    e.preventDefault();
    e.stopPropagation();
    select(null);
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  S.win.getSelection().removeAllRanges(); // 任意点击都会取消已选中的文字
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const el = pick(e.target);
  select(el);
  if (!el) return;
  const g = glyphAt(e.clientX, e.clientY, el);
  dbg(`onDown el=${el.tagName} onText=${!!g} -> ${g ? '选字' : '移动'}`);
  if (g) startTextSelect(g); else startDrag(e, el);
}

document.addEventListener('pointerdown', (e) => dbg(`[外层] pointerdown btn=${e.button} target=${e.target.tagName}#${e.target.id}.${e.target.className} at=${Math.round(e.clientX)},${Math.round(e.clientY)}`), true);
// 点击软件界面的其他地方（面板、顶栏等）同样取消页面里选中的文字
document.addEventListener('mousedown', (e) => {
  if (e.target.closest && e.target.closest('.sel-ui')) return; // 菜单、选区小按钮、批注弹窗里的点击不取消选区
  SM.closeMenu();
  N.dismissPopover();
  if (S.win && !S.editing) S.win.getSelection().removeAllRanges();
}, true);

// 右键：有选中文字 -> 复制 / 剪切 / 批注；没有 -> 给点到的元素添加批注
function onContext(e) {
  e.stopPropagation();
  if (S.editing && S.editing.contains(e.target)) return; // 编辑文字时保持系统默认行为
  e.preventDefault();
  if (S.busy) return;
  const fr = frame.getBoundingClientRect();
  const x = fr.left + e.clientX * S.scale;
  const y = fr.top + e.clientY * S.scale;
  const sel = S.win.getSelection();
  let hasText = false;
  if (sel.rangeCount && !sel.isCollapsed && sel.toString().trim()) {
    // 右键点在选中的文字上，才算对选中文字操作；点在别处就取消选区
    const inside = [...sel.getRangeAt(0).getClientRects()].some((b) => e.clientX >= b.left - 3 && e.clientX <= b.right + 3 && e.clientY >= b.top - 3 && e.clientY <= b.bottom + 3);
    if (inside) hasText = true; else sel.removeAllRanges();
  }
  let target = null;
  if (!hasText) { target = pick(e.target); if (target) select(target); }
  dbg(`contextmenu hasText=${hasText} target=${target ? target.tagName : '-'}`);
  if (!hasText && !target) return;
  SM.openMenu(x, y, { hasText, target });
}

// 把鼠标事件坐标换算成页面（iframe 内部）坐标
function docPoint(ev) {
  if (ev.currentTarget === document) {
    const r = frame.getBoundingClientRect();
    return [(ev.clientX - r.left) / S.scale, (ev.clientY - r.top) / S.scale];
  }
  return [ev.clientX, ev.clientY];
}
const caretAt = (x, y) => (S.doc.caretRangeFromPoint ? S.doc.caretRangeFromPoint(x, y) : null);

// 鼠标按下的位置是否正好落在文字上（而不是元素的空白、内边距处）；是则返回该处的光标位置
function glyphAt(x, y, el) {
  const r = caretAt(x, y);
  if (!r) return null;
  const n = r.startContainer;
  if (n.nodeType !== 3 || !n.nodeValue.trim() || !el.contains(n)) return null;
  const rg = S.doc.createRange();
  rg.selectNodeContents(n);
  for (const b of rg.getClientRects()) {
    if (x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2) return r;
  }
  return null;
}

// 拖动文字：选中一段文字（不进入编辑状态），可用 Ctrl/⌘+C 复制
function startTextSelect(anchor) {
  const sel = S.win.getSelection();
  sel.setBaseAndExtent(anchor.startContainer, anchor.startOffset, anchor.startContainer, anchor.startOffset);
  S.dragging = true;
  const move = (ev) => {
    const [x, y] = docPoint(ev);
    const r = caretAt(x, y);
    if (r) sel.setBaseAndExtent(anchor.startContainer, anchor.startOffset, r.startContainer, r.startOffset);
  };
  const up = () => {
    for (const doc of [document, S.doc]) {
      doc.removeEventListener('mousemove', move, true);
      doc.removeEventListener('mouseup', up, true);
    }
    S.dragging = false;
    dbg(`选字结束 选中文字="${S.win.getSelection().toString().slice(0, 30)}"`);
    try { S.win.focus(); } catch { /* 让选区显示为高亮色而不是灰色 */ }
    SM.updateHint();
  };
  for (const doc of [document, S.doc]) {
    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('mouseup', up, true);
  }
}

// 拖动元素本身（落在元素空白处、图片上，或拖动选框边缘）：移动位置
const MOVE_AXES = { x: ['left', 'cx', 'right'], y: ['top', 'cy', 'bottom'] };
const shiftRect = (r, dx, dy) => ({ left: r.left + dx, right: r.right + dx, top: r.top + dy, bottom: r.bottom + dy, width: r.width, height: r.height });
function startDrag(e, el) {
  const pk = parentScale(el); // translate 的 1 个单位对应页面上多少像素
  const [x0, y0] = parseTranslate(el);
  const from = el.style.getPropertyValue('translate');
  const r0 = el.getBoundingClientRect();
  const d = { sx: e.screenX, sy: e.screenY, moved: false };
  S.dragging = true;
  G.begin(el);
  const move = (ev) => {
    // dx / dy：页面（iframe 视口）里的像素
    let dx = (ev.screenX - d.sx) / S.scale;
    let dy = (ev.screenY - d.sy) / S.scale;
    if (!d.moved && Math.hypot(dx, dy) < 4 / S.scale) return;
    d.moved = true;
    const off = held(ev, 'nosnap'); // 按住 Alt / ⌥ 临时关闭吸附
    const s = G.snap(shiftRect(r0, dx, dy), MOVE_AXES, off);
    dx += s.dx;
    dy += s.dy;
    setStyle(el, 'translate', fmtT(x0 + dx / pk, y0 + dy / pk));
    updateOverlay();
    G.draw(el.getBoundingClientRect(), MOVE_AXES, off, 'move');
    hoverBox.style.display = 'none';
  };
  const up = () => {
    for (const doc of [document, S.doc]) {
      doc.removeEventListener('mousemove', move, true);
      doc.removeEventListener('mouseup', up, true);
    }
    S.dragging = false;
    G.end();
    dbg(`移动结束 moved=${d.moved}`);
    if (d.moved) commit([{ type: 'style', el, prop: 'translate', from, to: el.style.getPropertyValue('translate') }], { applied: true });
  };
  for (const doc of [document, S.doc]) {
    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('mouseup', up, true);
  }
}

// 选框的四条边和左上角标签：按住拖动就是移动当前选中的元素
document.querySelectorAll('#sel-box .edge, #sel-label').forEach((h) =>
  h.addEventListener('mousedown', (e) => {
    if (!S.sel || S.editing) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag(e, S.sel);
  })
);
/* 缩放手柄 */
selBox.querySelectorAll('.h').forEach((h) =>
  h.addEventListener('mousedown', (e) => {
    if (!S.sel) return;
    e.preventDefault();
    e.stopPropagation();
    startResize(e, h.dataset.h);
  })
);

function startResize(e, dir) {
  const el = S.sel;
  const pk = parentScale(el);
  const s = ownScale(el); // 元素做过整体缩放时，宽高要按缩放前的尺寸换算
  const r = el.getBoundingClientRect();
  const w0 = r.width / pk / s;
  const h0 = r.height / pk / s;
  // 缩放基准点（transform-origin）占元素宽高的比例；用来保证拖哪条边就只动哪条边
  const cs = S.win.getComputedStyle(el);
  const [oxPx, oyPx] = String(cs.transformOrigin || '').split(/\s+/).map(parseFloat);
  const ox = el.offsetWidth > 0 && Number.isFinite(oxPx) ? oxPx / el.offsetWidth : 0.5;
  const oy = el.offsetHeight > 0 && Number.isFinite(oyPx) ? oyPx / el.offsetHeight : 0.5;
  const [x0, y0] = parseTranslate(el);
  const props = ['width', 'height', 'box-sizing', 'translate'];
  const froms = props.map((p) => el.style.getPropertyValue(p));
  const ratio = el.tagName === 'IMG' || el instanceof S.win.SVGElement;
  const corner = dir.length === 2;
  // 参与吸附的是正在拖动的那条边；等比缩放的图片拖角时只按横向吸附（高度跟着宽度走）
  const axes = {
    x: dir.includes('e') ? ['right'] : dir.includes('w') ? ['left'] : [],
    y: ratio && corner ? [] : dir.includes('s') ? ['bottom'] : dir.includes('n') ? ['top'] : [],
  };
  let moved = false;
  S.dragging = true;
  G.begin(el);
  const move = (ev) => {
    // 页面像素里的鼠标位移
    let dx = (ev.screenX - e.screenX) / S.scale;
    let dy = (ev.screenY - e.screenY) / S.scale;
    const off = held(ev, 'nosnap');
    const pred = {
      left: r.left + (dir.includes('w') ? dx : 0), right: r.right + (dir.includes('e') ? dx : 0),
      top: r.top + (dir.includes('n') ? dy : 0), bottom: r.bottom + (dir.includes('s') ? dy : 0),
    };
    const sn = G.snap(pred, axes, off);
    dx += sn.dx;
    dy += sn.dy;
    let w = w0, h = h0;
    if (dir.includes('e')) w = w0 + dx / pk / s;
    if (dir.includes('w')) w = w0 - dx / pk / s;
    if (dir.includes('s')) h = h0 + dy / pk / s;
    if (dir.includes('n')) h = h0 - dy / pk / s;
    if (ratio && corner) h = (w * h0) / w0;
    w = Math.max(12, w); h = Math.max(12, h);
    const dw = w - w0;
    const dh = h - h0;
    // 改宽高会让缩放后的元素两边都动，用 translate 把不该动的那条边拉回原位
    let tx = x0, ty = y0;
    if (dir.includes('e')) tx = x0 - dw * ox * (1 - s);
    if (dir.includes('w')) tx = x0 - dw * (ox + s * (1 - ox));
    if (dir.includes('s')) ty = y0 - dh * oy * (1 - s);
    if (dir.includes('n')) ty = y0 - dh * (oy + s * (1 - oy));
    moved = true;
    setStyle(el, 'box-sizing', 'border-box');
    setStyle(el, 'width', w + 'px');
    setStyle(el, 'height', h + 'px');
    setStyle(el, 'translate', fmtT(tx, ty));
    updateOverlay();
    G.draw(el.getBoundingClientRect(), axes, off, 'resize');
  };
  const up = () => {
    for (const doc of [document, S.doc]) {
      doc.removeEventListener('mousemove', move, true);
      doc.removeEventListener('mouseup', up, true);
    }
    S.dragging = false;
    G.end();
    if (moved) commit(props.map((p, i) => ({ type: 'style', el, prop: p, from: froms[i], to: el.style.getPropertyValue(p) })), { applied: true });
  };
  for (const doc of [document, S.doc]) {
    doc.addEventListener('mousemove', move, true);
    doc.addEventListener('mouseup', up, true);
  }
}

/* ---------------- 文字编辑 ---------------- */
function onDbl(e) {
  if (S.busy) return;
  e.preventDefault();
  e.stopPropagation();
  if (S.editing && S.editing.contains(e.target)) return; // 正在编辑的文字里双击：选中单词
  if (S.editing) endEdit(); // 编辑中双击另一处：直接切换过去继续编辑
  const el = pick(e.target);
  if (!el) { select(null); return; } // 双击空白处：相当于 Esc，取消选择
  select(el);
  startEdit(el, e);
}

function startEdit(el, e) {
  if (['IMG', 'VIDEO', 'CANVAS', 'SVG'].includes(el.tagName.toUpperCase())) return;
  S.editing = el;
  S.editFrom = el.innerHTML;
  S.editHadAttr = el.getAttribute('contenteditable');
  el.setAttribute('contenteditable', 'true');
  el.spellcheck = false;
  el.focus();
  try {
    const range = e && S.doc.caretRangeFromPoint ? S.doc.caretRangeFromPoint(e.clientX, e.clientY) : null;
    const sel = S.win.getSelection();
    sel.removeAllRanges();
    if (range && el.contains(range.startContainer)) sel.addRange(range);
    else { const r = S.doc.createRange(); r.selectNodeContents(el); sel.addRange(r); }
  } catch { /* 忽略 */ }
  updateOverlay();
  setStatusLeft(t('editing'));
}

function endEdit() {
  const el = S.editing;
  if (!el) return;
  S.editing = null;
  if (S.editHadAttr == null) el.removeAttribute('contenteditable');
  else el.setAttribute('contenteditable', S.editHadAttr);
  S.win.getSelection().removeAllRanges();
  const to = el.innerHTML;
  if (to !== S.editFrom) commit([{ type: 'html', el, from: S.editFrom, to }], { applied: true });
  updateOverlay();
  updateStatus();
}

/* ---------------- 元素操作 ---------------- */
function removeEl(el) {
  if (!el) return;
  if (S.slides.includes(el)) { toast(t('noPageOps')); return; } // 不提供整页删除，只能删除页面里的具体内容
  if (el === S.doc.body) return;
  commit([{ type: 'remove', el, parent: el.parentNode, next: el.nextSibling }]);
}

function duplicate(el) {
  if (!el || el === S.doc.body) return;
  if (S.slides.includes(el)) { toast(t('noPageOps')); return; } // 不提供整页复制
  const node = el.cloneNode(true);
  const map = {};
  for (const e of [node, ...node.querySelectorAll(`[${ID}]`)]) {
    const old = e.getAttribute(ID);
    if (old) { const nid = 'n' + ++S.idCounter; map[old] = nid; e.setAttribute(ID, nid); }
    ['data-pe-hide', 'data-pe-cur', 'data-pe-disp', 'contenteditable', 'data-slideease-note'].forEach((a) => e.removeAttribute(a));
  }
  if (S.info.activeClass) node.classList.remove(S.info.activeClass);
  commit([{ type: 'clone', srcEl: el, node, map }]);
  select(node);
}

function nudge(dx, dy) {
  const el = S.sel;
  if (!el) return;
  const [x, y] = parseTranslate(el);
  const from = el.style.getPropertyValue('translate');
  commit([{ type: 'style', el, prop: 'translate', from, to: fmtT(x + dx, y + dy) }]);
}

/* ---------------- 键盘 ---------------- */
function onKey(e) {
  // 编辑区里的按键由软件处理，不再传给页面自带的脚本（否则页面里常见的 F=全屏、方向键=翻页 等会和软件冲突）
  if (e.view !== window) e.stopPropagation();
  // 快捷键都在 shortcuts.js 里配置，这里按配置的 id 判断
  const mod = e.ctrlKey || e.metaKey;
  if (mod) dbg(`keydown mod+${e.key} inFrame=${e.view !== window} hasSel=${SM.hasSelection()}`);
  const zi = matchIndex(e, 'zoom'); // 0 放大，1 缩小，2 适应窗口
  if (zi >= 0 && hasDoc()) {
    e.preventDefault();
    if (zi === 2) zoomFit(); else zoomStep(zi === 1 ? -1 : 1);
    return;
  }
  if (matches(e, 'preview') && hasDoc()) { e.preventDefault(); preview(); return; }
  if (matches(e, 'find') && hasDoc()) { e.preventDefault(); F.focus(); return; }
  // 在面板输入框里正常输入，只保留保存快捷键
  const inField = e.view === window && e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
  if (inField && !matches(e, 'save') && !matches(e, 'saveAs')) return;
  if (matches(e, 'deselect') && (SM.isMenuOpen() || N.isPopoverOpen())) { e.preventDefault(); SM.closeMenu(); N.closePopover(); return; }
  // 复制 / 剪切选中的文字（选区不在系统焦点里，统一走软件自己的剪贴板接口）
  if (matches(e, 'copy') && SM.hasSelection()) { e.preventDefault(); SM.copySelection(); return; }
  if (matches(e, 'cut') && SM.hasSelection()) { e.preventDefault(); SM.cutSelection(); return; }
  if (matches(e, 'note') && hasDoc()) { e.preventDefault(); if (!S.editing) SM.noteFromSelection(); return; }
  if (S.editing) {
    if (matches(e, 'deselect')) { e.preventDefault(); endEdit(); }
    else if (matches(e, 'save')) { e.preventDefault(); save(false); }
    else e.stopPropagation();
    return;
  }
  if (matches(e, 'undo')) { e.preventDefault(); undo(); }
  else if (matches(e, 'redo')) { e.preventDefault(); redo(); }
  else if (matches(e, 'save')) { e.preventDefault(); save(false); }
  else if (matches(e, 'saveAs')) { e.preventDefault(); save(true); }
  else if (matches(e, 'open')) { e.preventDefault(); openDialog(); }
  else if (!hasDoc() || S.busy) return;
  else if (matches(e, 'dup')) { e.preventDefault(); if (S.sel) duplicate(S.sel); }
  else if (matches(e, 'del')) { e.preventDefault(); if (S.sel) removeEl(S.sel); }
  else if (matches(e, 'deselect')) { e.preventDefault(); select(null); }
  else if (e.key === 'Enter' && !mod && S.sel) { e.preventDefault(); startEdit(S.sel); }
  else if (matches(e, 'move')) {
    e.preventDefault();
    if (S.sel) {
      const n = held(e, 'fast') ? 10 : 1;
      const k = parentScale(S.sel);
      const m = { ArrowLeft: [-n, 0], ArrowRight: [n, 0], ArrowUp: [0, -n], ArrowDown: [0, n] }[e.key];
      nudge(m[0] / k, m[1] / k);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') navigate(S.cur - 1);
    else navigate(S.cur + 1);
  } else if (e.key === 'PageDown') { e.preventDefault(); navigate(S.cur + 1); }
  else if (e.key === 'PageUp') { e.preventDefault(); navigate(S.cur - 1); }
  else if (e.view !== window && !mod) e.stopPropagation();
}
document.addEventListener('keydown', onKey);

/* ---------------- 右侧属性面板 ---------------- */
let live = null;
function targets(withDesc) {
  const el = S.sel;
  if (!el) return [];
  if (!withDesc) return [el];
  return [el, ...[...el.querySelectorAll('*')].filter((x) => !['SCRIPT', 'STYLE'].includes(x.tagName)).slice(0, 300)];
}

function liveApply(map, withDesc = false) {
  if (!S.sel) return;
  const key = Object.keys(map).join() + (withDesc ? '+d' : '');
  if (!live || live.key !== key || live.root !== S.sel) {
    liveCommit();
    live = { key, root: S.sel, items: [], map };
    for (const el of targets(withDesc)) for (const prop in map) live.items.push({ el, prop, from: el.style.getPropertyValue(prop) });
  }
  live.map = map;
  live.items.forEach((i) => setStyle(i.el, i.prop, map[i.prop]));
  updateOverlay();
}

function liveCommit() {
  if (!live) return;
  const l = live;
  live = null;
  commit(l.items.map((i) => ({ type: 'style', el: i.el, prop: i.prop, from: i.from, to: l.map[i.prop] })), { applied: true });
}

const once = (map, withDesc) => { liveApply(map, withDesc); liveCommit(); };

function bindLive(input, build, withDesc) {
  input.addEventListener('input', () => liveApply(build(input.value), withDesc));
  input.addEventListener('change', () => { liveCommit(); updatePanel(); });
}

function curStyle() { return S.win.getComputedStyle(S.sel); }

function updatePanel() {
  const el = S.sel;
  $('#panel-hint').hidden = !!el;
  $('#panel-body').hidden = !el;
  if (!el) return;
  const cs = curStyle();
  $('#fs-input').value = Math.round(parseFloat(cs.fontSize));
  $('#color-input').value = toHex(cs.color).hex;
  $('#b-bold').classList.toggle('on', parseInt(cs.fontWeight, 10) >= 600);
  $('#b-italic').classList.toggle('on', cs.fontStyle === 'italic');
  $('#b-underline').classList.toggle('on', cs.textDecorationLine.includes('underline'));
  const al = cs.textAlign === 'start' || cs.textAlign === 'left' ? 'left' : cs.textAlign === 'end' ? 'right' : cs.textAlign;
  ['left', 'center', 'right'].forEach((a) => $('#a-' + a).classList.toggle('on', al === a));
  const bg = toHex(cs.backgroundColor);
  $('#fill-input').value = bg.alpha > 0 ? bg.hex : '#ffffff';
  $('#opacity-input').value = Math.round(parseFloat(cs.opacity) * 100);
  $('#radius-input').value = parseFloat(cs.borderTopLeftRadius) || 0;
  const sc = curScale();
  $('#sc-input').value = sc;
  $('#sc-range').value = Math.min(300, sc);
  $('#g-scale').hidden = S.slides.includes(el); // 整页容器不提供缩放
  const isPage = S.slides.includes(el); // 选中的是整页容器时，不提供复制/删除
  $('#btn-dup').disabled = isPage;
  $('#btn-del').disabled = isPage;
  $('#g-image').hidden = !(el.tagName === 'IMG' || /url\(/.test(cs.backgroundImage));
}

bindLive($('#color-input'), (v) => ({ color: v }), true);
bindLive($('#fill-input'), (v) => ({ 'background-color': v, 'background-image': 'none' }));
bindLive($('#opacity-input'), (v) => ({ opacity: String(v / 100) }));
bindLive($('#radius-input'), (v) => ({ 'border-radius': v + 'px', overflow: 'hidden' }));
// 整体缩放：用 CSS scale 把选中的元素连同里面的文字、图片一起按比例放大缩小（以元素中心为基准，不影响周围排版）
const SCALE_MIN = 10;
const SCALE_MAX = 500;
function curScale() {
  const v = curStyle().scale;
  const n = v && v !== 'none' ? parseFloat(v) : 1;
  return Math.round((Number.isFinite(n) ? n : 1) * 100);
}
const scaleMap = (pct) => {
  const p = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(pct)));
  return { scale: p === 100 ? '' : String(p / 100) }; // 100% 时去掉样式，保持文件干净
};
bindLive($('#sc-range'), (v) => { $('#sc-input').value = v; return scaleMap(Number(v)); });
$('#sc-input').addEventListener('change', () => {
  const v = parseFloat($('#sc-input').value);
  if (S.sel && v > 0) once(scaleMap(v));
  updatePanel();
});
const stepScale = (d) => {
  if (!S.sel) return;
  const cur = curScale();
  once(scaleMap(d > 0 ? Math.floor(cur / 10) * 10 + 10 : Math.ceil(cur / 10) * 10 - 10)); // 每次 10%，并对齐到整十
  updatePanel();
};
$('#sc-minus').onclick = () => stepScale(-1);
$('#sc-plus').onclick = () => stepScale(1);
$('#sc-reset').onclick = () => { if (S.sel) { once(scaleMap(100)); updatePanel(); } };
$('#fs-input').addEventListener('change', () => {
  const v = parseFloat($('#fs-input').value);
  if (v > 0) once({ 'font-size': v + 'px' });
});
const stepFs = (d) => {
  if (!S.sel) return;
  const v = Math.max(1, Math.round(parseFloat(curStyle().fontSize)) + d);
  once({ 'font-size': v + 'px' });
  updatePanel();
};
$('#fs-minus').onclick = () => stepFs(-2);
$('#fs-plus').onclick = () => stepFs(2);
$('#b-bold').onclick = () => { once({ 'font-weight': parseInt(curStyle().fontWeight, 10) >= 600 ? '400' : '700' }); updatePanel(); };
$('#b-italic').onclick = () => { once({ 'font-style': curStyle().fontStyle === 'italic' ? 'normal' : 'italic' }); updatePanel(); };
$('#b-underline').onclick = () => { once({ 'text-decoration': curStyle().textDecorationLine.includes('underline') ? 'none' : 'underline' }); updatePanel(); };
['left', 'center', 'right'].forEach((a) => ($('#a-' + a).onclick = () => { once({ 'text-align': a }); updatePanel(); }));
$('#fill-none').onclick = () => { once({ 'background-color': 'transparent', 'background-image': 'none' }); updatePanel(); };
$('#btn-parent').onclick = () => {
  const p = S.sel && S.sel.parentElement;
  if (p && p !== S.doc.body && p !== S.doc.documentElement) select(p);
};
$('#btn-dup').onclick = () => duplicate(S.sel);
$('#btn-del').onclick = () => removeEl(S.sel);
$('#btn-replace-img').onclick = async () => {
  const el = S.sel;
  if (!el) return;
  const url = await window.api.pickImage();
  if (!url) return;
  if (el.tagName === 'IMG') {
    commit([
      { type: 'attr', el, name: 'src', from: el.getAttribute('src'), to: url },
      { type: 'attr', el, name: 'srcset', from: el.getAttribute('srcset'), to: null },
    ]);
  } else once({ 'background-image': `url("${url}")` });
  updatePanel();
};

/* ---------------- 顶栏 / 状态栏 ---------------- */
function setStatusLeft(s) { $('#status-left').textContent = s; }
function updateStatus() {
  setStatusLeft(hasDoc() ? t('page', { n: S.cur + 1, total: S.slides.length }) : t('ready'));
}

function updateChrome() {
  const doc = hasDoc();
  $('#btn-save').disabled = !doc || S.busy;
  $('#btn-history').disabled = !doc;
  $('#btn-notes').disabled = !doc;
  $('#btn-preview').disabled = !doc || S.busy;
  F.setEnabled(doc && !S.busy);
  $('#btn-save').classList.toggle('primary', isDirty()); // 有修改时保存按钮高亮
  $('#btn-saveas').disabled = !doc || S.busy;
  $('#btn-undo').disabled = !S.history.length;
  $('#docname').textContent = S.name ? (isDirty() ? '● ' : '') + S.name : '';
  window.api.setState({ dirty: isDirty(), name: S.name, lang: getLang() });
  updateStatus();
}

$('#btn-open').onclick = openDialog;
$('#btn-empty-open').onclick = openDialog;
$('#btn-save').onclick = () => save(false);
$('#btn-saveas').onclick = () => save(true);
$('#btn-preview').onclick = preview;
$('#btn-undo').onclick = undo;
new ResizeObserver(() => { if (hasDoc()) layoutStage(); }).observe($('#stage'));

/* 拖入文件 */
const stage = $('#stage');
window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer.types.includes('Files')) stage.classList.add('drag-over'); });
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) stage.classList.remove('drag-over'); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  stage.classList.remove('drag-over');
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (!f) return;
  const p = window.api.pathForFile(f);
  const doc = await window.api.openPath(p);
  if (doc) await openDoc(doc);
  else toast(t('openFailed'));
});

window.api.onOpenDoc((doc) => openDoc(doc));
// 使用教程：首次打开软件时自动打开；之后可以从设置和开始页的列表里再次进入
async function openTutorial(page) {
  const f = await window.api.readTutorial();
  if (!f) { toast(t('tutorialMissing')); return false; }
  f.content = buildTutorial(f.content);
  f.name = t('tutorialFile');
  settings.hidden = true;
  window.api.track('tutorial_open');
  const ok = await openDoc(f);
  if (ok && page > 0 && page < S.slides.length) navigate(page); // 切换语言后回到原来那一页
  return ok;
}
window.api.getPending().then((doc) => {
  if (doc) { openDoc(doc); return; } // 双击 HTML 文件启动时，直接打开那个文件
  if (!localStorage.getItem('tutorialSeen') && !new URLSearchParams(location.search).has('test')) {
    localStorage.setItem('tutorialSeen', '1');
    openTutorial();
  }
});
refreshRecent();
window.api.onSaveThenClose(async () => { if (await save(false)) window.api.closeNow(); });

// 有新版本时弹窗提示，点击用浏览器打开下载页（不自动下载）。force 时不可关闭。
window.api.onUpdateAvailable((info) => {
  if (!info || !info.version || document.querySelector('#update-mask')) return;
  const mask = document.createElement('div');
  mask.id = 'update-mask';
  mask.className = info.force ? 'force' : '';

  const box = document.createElement('div');
  box.id = 'update-box';

  const title = document.createElement('div');
  title.className = 'u-title';
  title.textContent = t(info.force ? 'updateForceTitle' : 'updateAvailable', { v: info.version });
  box.appendChild(title);

  if (info.notes) {
    const notes = document.createElement('div');
    notes.className = 'u-notes';
    notes.textContent = info.notes; // 用 white-space: pre-wrap 保留换行
    box.appendChild(notes);
  }

  const acts = document.createElement('div');
  acts.className = 'u-acts';
  const go = document.createElement('button');
  go.className = 'btn primary';
  go.textContent = t('updateDownload');
  go.onclick = () => window.api.openUpdateUrl(info.url);
  acts.appendChild(go);
  if (!info.force) {
    const close = document.createElement('button');
    close.className = 'btn';
    close.textContent = t('updateLater');
    close.onclick = () => mask.remove();
    acts.appendChild(close);
  }
  box.appendChild(acts);
  mask.appendChild(box);
  document.body.appendChild(mask);
  window.api.track(info.force ? 'update_prompt_force' : 'update_prompt_shown');
});

if (new URLSearchParams(location.search).has('test')) window.__t = { openTutorial: () => openTutorial(), H, N, changeNotes, preview, buildHtml, refreshRecent, openRecent, zoomAt, zoomStep, zoomFit, S, openDoc, select, duplicate, removeEl, undo, redo, collectOps, save, navigate, startEdit, endEdit, once, moveSlide, pick };

H.init({ S, navigate, select, commit, openDoc, updateChrome, isDirty, toast });
// 批注的每次增 / 改 / 删都作为一次可撤销的修改（el 用来在修改记录里定位到目标元素）
function changeNotes(next, action, el, text) {
  commit([{ type: 'notes', from: S.notes, to: next, action, text, el }]);
}
N.init({ S, changeNotes, navigate, select, toast, idOf, updateOverlay });
SM.init({ S, frame, pick, idOf, commit, toast, openNotePopover: N.openPopover });
$('#btn-note').onclick = () => { N.openComposer(); };
F.init({ S, navigate, commit, toast, updateOverlay, notes: N });
G.init({ S, overlay: $('#overlay') });
X.init({ S, frame, navigate, select, collectOps, idOf, setLoading, toast, layoutStage, endEdit, pageOfNote: N.pageOf });

/* ---------------- 设置（语言 / 版本信息） ---------------- */
const settings = $('#settings');
$('#set-lang').value = getLang();
$('#btn-settings').onclick = () => { settings.hidden = !settings.hidden; };
document.addEventListener('mousedown', (e) => {
  if (!settings.hidden && !settings.contains(e.target) && e.target !== $('#btn-settings')) settings.hidden = true;
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') settings.hidden = true; });
$('#set-tutorial').onclick = () => openTutorial();
$('#btn-tutorial').onclick = () => openTutorial();
$('#set-lang').onchange = () => {
  setLang($('#set-lang').value);
  renderThumbs();
  updatePanel();
  updateChrome();
  H.render();
  refreshRecent();
  // 正在看教程且没有改动：按新语言重新打开教程，停在同一页
  if (hasDoc() && S.isTutorial && !isDirty() && !S.busy) openTutorial(S.cur);
};
window.api.appInfo().then((i) => {
  $('#about-version').textContent = 'v' + i.version;
  $('#about-runtime').textContent = `Electron ${i.electron} · Chromium ${i.chrome.split('.')[0]}`;
  $('#about-os').textContent = i.platform;
});

applyStatic();
updateChrome();


















