// 查找与替换：在整份文档（所有页面）的文字里查找，高亮、跳转、替换，替换走统一的修改历史
import { t } from './i18n.js';

let C;
const st = { q: '', matches: [], idx: -1 };
const $ = (s) => document.querySelector(s);
let timer;

export function init(ctx) {
  C = ctx;
  const input = $('#find-input');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => run(true), 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { input.blur(); }
  });
  $('#find-next').onclick = () => step(1);
  $('#find-prev').onclick = () => step(-1);
  $('#find-toggle').onclick = () => {
    const pop = $('#replace-pop');
    pop.hidden = !pop.hidden;
    if (!pop.hidden) $('#replace-input').focus();
  };
  $('#rep-one').onclick = replaceOne;
  $('#rep-all').onclick = replaceAll;
  $('#replace-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); replaceOne(); }
  });
  document.addEventListener('mousedown', (e) => {
    const pop = $('#replace-pop');
    if (!pop.hidden && !$('#find').contains(e.target)) pop.hidden = true;
  });
}

export function setEnabled(on) {
  ['#find-input', '#find-prev', '#find-next', '#find-toggle'].forEach((s) => ($(s).disabled = !on));
  if (!on) { $('#replace-pop').hidden = true; }
}

export function focus() {
  const i = $('#find-input');
  if (i.disabled) return;
  // 页面里有选中的文字时，直接带入查找框并开始查找
  let sel = '';
  try { sel = C.S.win.getSelection().toString().replace(/\s+/g, ' ').trim().slice(0, 100); } catch { /* 忽略 */ }
  if (sel) { i.value = sel; run(true); }
  i.focus();
  i.select();
}

// 打开新文档时重置
export function reset() {
  st.matches = [];
  st.idx = -1;
  $('#find-count').textContent = '';
  if (st.q) run(false);
}

function collect() {
  const S = C.S;
  st.matches = [];
  if (!S.doc || !st.q) return;
  const q = st.q.toLowerCase();
  const walker = S.doc.createTreeWalker(S.doc.body, 4 /* SHOW_TEXT */, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) return 2; // REJECT
      return n.nodeValue.trim() ? 1 : 2;
    },
  });
  let n;
  const pageOfNode = (node) => C.S.slides.findIndex((s) => s.contains(node.parentElement));
  while ((n = walker.nextNode())) {
    const low = n.nodeValue.toLowerCase();
    let i = low.indexOf(q);
    const page = low.includes(q) ? pageOfNode(n) : -1;
    while (i >= 0) {
      st.matches.push({ node: n, start: i, end: i + q.length, page });
      i = low.indexOf(q, i + q.length);
    }
  }
  // 批注内容也参与查找：每条命中的批注算一个结果，排在所在页的页面文字之后
  const notes = (S.notes || []).filter((x) => C.notes.noteMatches(x, st.q));
  if (notes.length) {
    for (const x of notes) {
      const p = C.notes.pageOf(x);
      st.matches.push({ note: x, page: p < 0 ? Infinity : p, after: 1 });
    }
    st.matches = st.matches
      .map((m, i) => ({ m, i }))
      .sort((a, b) => (a.m.page < 0 ? Infinity : a.m.page) - (b.m.page < 0 ? Infinity : b.m.page) || (a.m.after || 0) - (b.m.after || 0) || a.i - b.i)
      .map((x) => x.m);
  }
}
const textMatches = (list) => list.filter((m) => m.node);
// 把查找状态同步给批注面板（高亮命中的批注）
function syncNotes() {
  const m = st.idx >= 0 ? st.matches[st.idx] : null;
  C.notes.setFind(st.matches.some((x) => x.note) ? st.q : '', m && m.note ? m.note.id : null);
}

function paint() {
  const S = C.S;
  try {
    const reg = S.win.CSS.highlights;
    reg.delete('pe-find');
    reg.delete('pe-find-cur');
    const texts = textMatches(st.matches);
    if (!texts.length) return;
    const mk = (m) => {
      const r = S.doc.createRange();
      r.setStart(m.node, m.start);
      r.setEnd(m.node, m.end);
      return r;
    };
    reg.set('pe-find', new S.win.Highlight(...texts.map(mk)));
    if (st.idx >= 0 && st.matches[st.idx].node) {
      const cur = new S.win.Highlight(mk(st.matches[st.idx]));
      cur.priority = 1;
      reg.set('pe-find-cur', cur);
    }
  } catch { /* 不支持高亮时仍可跳转与替换 */ }
}

function updateCount() {
  const el = $('#find-count');
  if (!st.q) el.textContent = '';
  else el.textContent = st.matches.length ? `${st.idx + 1}/${st.matches.length}` : t('findNone');
}

function go(i, jump) {
  const S = C.S;
  const n = st.matches.length;
  if (!n) { st.idx = -1; paint(); updateCount(); syncNotes(); return; }
  st.idx = ((i % n) + n) % n;
  paint();
  updateCount();
  syncNotes();
  if (!jump) return;
  const cur = st.matches[st.idx];
  if (cur.note) { C.notes.reveal(cur.note.id); return; } // 命中的是批注：打开批注面板并定位
  const el = cur.node.parentElement;
  const si = S.slides.findIndex((s) => s.contains(el));
  if (si >= 0 && si !== S.cur) C.navigate(si);
  try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); } catch { /* 忽略 */ }
  C.updateOverlay();
}

function run(jump) {
  st.q = $('#find-input').value;
  collect();
  // 从当前页开始找第一个
  let start = st.matches.findIndex((m) => m.page >= C.S.cur);
  if (start < 0) start = 0;
  go(start, jump);
}

function step(d) {
  if (!st.q) return;
  if (!st.matches.length) collect();
  go(st.idx < 0 ? 0 : st.idx + d, true);
}

// 文档被修改后刷新匹配（不跳转）
let rt;
export function refresh() {
  if (!st.q) return;
  clearTimeout(rt);
  rt = setTimeout(() => {
    const old = st.idx;
    collect();
    go(Math.min(old < 0 ? 0 : old, Math.max(0, st.matches.length - 1)), false);
  }, 150);
}

/* ---------------- 替换 ---------------- */
function replaceMatches(list, rep) {
  const byNode = new Map();
  for (const m of list) {
    if (!byNode.has(m.node)) byNode.set(m.node, []);
    byNode.get(m.node).push(m);
  }
  const parents = new Set([...byNode.keys()].map((n) => n.parentElement));
  // 嵌套时只处理最外层，内层的修改已包含在外层的 innerHTML 里
  const top = [...parents].filter((p) => ![...parents].some((q) => q !== p && q.contains(p)));
  const from = new Map(top.map((p) => [p, p.innerHTML]));
  const orig = new Map();
  for (const [n, ms] of byNode) {
    orig.set(n, n.nodeValue);
    let v = n.nodeValue;
    for (const m of ms.sort((a, b) => b.start - a.start)) v = v.slice(0, m.start) + rep + v.slice(m.end);
    n.nodeValue = v;
  }
  const to = new Map(top.map((p) => [p, p.innerHTML]));
  for (const [n, v] of orig) n.nodeValue = v;
  const changes = top.filter((p) => from.get(p) !== to.get(p)).map((p) => ({ type: 'html', el: p, from: from.get(p), to: to.get(p) }));
  if (changes.length) C.commit(changes);
  return list.length;
}

function ready() {
  if (C.S.editing) { C.toast(t('findEditing')); return false; }
  if (!st.q) return false;
  collect();
  if (textMatches(st.matches).length) return true;
  if (st.matches.length) C.toast(t('findNoteOnly')); // 只有批注命中：批注不参与替换
  return false;
}

function replaceOne() {
  if (!ready()) return;
  const rep = $('#replace-input').value;
  // 当前定位的是批注时，替换它后面最近的一处页面文字（批注只查找、不替换）
  let pos = Math.max(0, st.idx);
  const n = st.matches.length;
  for (let k = 0; k < n && !st.matches[pos].node; k++) pos = (pos + 1) % n;
  replaceMatches([st.matches[pos]], rep);
  collect();
  // 如果替换后的文字本身还包含查找词，要跳过它，避免原地打转
  const next = rep.toLowerCase().includes(st.q.toLowerCase()) ? pos + 1 : pos;
  go(next, true);
}

function replaceAll() {
  if (!ready()) return;
  const n = replaceMatches(textMatches(st.matches), $('#replace-input').value);
  collect();
  go(0, false);
  C.toast(t('replaced', { n }));
}

export const _test = { st, collect, replaceMatches };

