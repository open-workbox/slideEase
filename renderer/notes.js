// 批注：挂在页面元素上（文字、图片、区块都可以），带状态，可单条编辑 / 删除。
// 数据保存在 HTML 文件里（见 source.js 的 embedNotes），随文件一起走。
import { t } from './i18n.js';
import { matches } from './shortcuts.js';
import { fingerprint, NOTE_STATUS } from './source.js';

let C; // { S, changeNotes, navigate, select, toast, idOf, updateOverlay }
let filter = 'all';
let editingId = null;
let flashId = null;
let showMarks = true;
// 按页分组：默认只展开当前页；expandAll 为“一键全部展开”；toggled 记录用户手动点开 / 收起的页（相对默认状态取反）
let expandAll = false;
const toggled = new Set();
let lastPage = -1;
// 查找框里的关键词（批注内容也参与查找），findCurId 是查找当前定位到的那条批注
let findQ = '';
let findCurId = null;

const $ = (s) => document.querySelector(s);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const STATUS_KEY = { todo: 'n_s_todo', doing: 'n_s_doing', done: 'n_s_done' };

export function init(ctx) {
  C = ctx;
  $('#btn-notes').onclick = toggle;
  $('#n-close').onclick = () => ($('#notes').hidden = true);
  $('#n-add').onclick = addNote;
  $('#n-marks').onchange = (e) => { showMarks = e.target.checked; renderMarks(); };
  $('#n-input').addEventListener('keydown', (e) => {
    if (matches(e, 'noteSave')) { e.preventDefault(); addNote(); }
  });
}

export function reset() {
  closePopover();
  lastSig = '';
  filter = 'all';
  editingId = null;
  flashId = null;
  expandAll = false;
  toggled.clear();
  lastPage = -1;
  $('#note-warn')?.remove();
  render();
}

function toggle() {
  const el = $('#notes');
  el.hidden = !el.hidden;
  if (!el.hidden) { $('#history').hidden = true; render(); }
}

export function openComposer() {
  openPanel();
  setTimeout(() => { const i = $('#n-input'); if (i && !i.disabled) i.focus(); }, 0);
}

function openPanel() {
  $('#history').hidden = true;
  $('#notes').hidden = false;
  render();
}

/* ---------------- 工具 ---------------- */
export function elOf(note) {
  const d = C.S.doc;
  return d && note.pid ? d.querySelector(`[data-pe-id="${note.pid}"]`) : null;
}
function kindName(el) {
  if (['IMG', 'SVG', 'VIDEO', 'CANVAS'].includes(el.tagName.toUpperCase())) return t('kindImage');
  const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  return own ? t('kindText') : t('kindBox');
}
function summaryOf(el) {
  if (el.tagName === 'IMG') return el.getAttribute('alt') || (el.getAttribute('src') || '').split('/').pop().slice(0, 30);
  return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
}
// 批注所在的页（从 0 开始）；目标元素找不到时返回 -1
export function pageOf(note) {
  const el = elOf(note);
  if (!el) return -1;
  return C.S.slides.findIndex((s) => s === el || s.contains(el));
}
// 某一组默认是否展开：当前页、找不到目标的那组（需要用户处理）默认展开
function isOpen(page) {
  const def = expandAll || page === C.S.cur || page < 0;
  return toggled.has(page) ? !def : def;
}
function ensureOpen(page) {
  if (!isOpen(page)) { if (toggled.has(page)) toggled.delete(page); else toggled.add(page); }
}
// 切换了当前页：回到“只展开当前页”的状态（一键全展开时保持全展开）
export function pageChanged() {
  if (!C || C.S.cur === lastPage) return;
  lastPage = C.S.cur;
  toggled.clear();
  if (!$('#notes').hidden) render();
}
// 查找：批注内容是否包含关键词（不区分大小写）
export const noteMatches = (n, q) => !!q && String(n.text || '').toLowerCase().includes(q.toLowerCase());
export function setFind(q, curId) {
  findQ = q || '';
  findCurId = curId || null;
  if (!$('#notes').hidden) render();
}
// 查找定位到某条批注：打开批注面板、展开所在页、跳到对应页面并选中目标元素
export function reveal(id) {
  const n = C.S.notes.find((x) => x.id === id);
  if (!n) return;
  const page = pageOf(n);
  if (filter !== 'all' && filter !== n.status) filter = 'all';
  $('#history').hidden = true;
  $('#notes').hidden = false;
  const el = elOf(n);
  if (page >= 0 && page !== C.S.cur) C.navigate(page);
  lastPage = C.S.cur;
  ensureOpen(page);
  if (el) C.select(el);
  findCurId = id;
  render();
}
const newId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const fmtTime = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ---------------- 增删改 ---------------- */
// 在元素 el 上创建一条批注；quote 是用户当时选中的文字（可为空）
function createNote(el, text, status, quote) {
  const pid = C.idOf(el);
  if (!pid) { C.toast(t('n_dynamic')); return null; } // 脚本动态生成的元素没有稳定编号，批注存不住
  const now = Date.now();
  const note = {
    id: newId(), text, status, created: now, updated: now,
    fp: fingerprint(el), kind: kindName(el), summary: summaryOf(el),
    quote: String(quote || '').replace(/\s+/g, ' ').trim().slice(0, 200), pid, state: 'ok',
  };
  C.changeNotes([...C.S.notes, note], 'add', el, text);
  flashId = note.id;
  return note;
}

// 面板顶部的输入框：给当前选中的元素添加批注
function addNote() {
  const el = C.S.sel;
  if (!el) { C.toast(t('n_pick_first')); return; }
  const text = $('#n-input').value.trim();
  if (!text) { $('#n-input').focus(); return; }
  if (createNote(el, text, $('#n-status').value, '')) {
    $('#n-input').value = '';
    render();
  }
}

/* ---------------- Tips 弹窗：在选中文字 / 元素旁直接写批注 ---------------- */
let pop = null;
export function closePopover() { if (pop) { pop.remove(); pop = null; } }
// 点别处时：弹窗里还没写内容就收起；写了内容就保留，避免误丢
export function dismissPopover() { if (pop && !pop.querySelector('textarea').value.trim()) closePopover(); }
export const isPopoverOpen = () => !!pop;

export function openPopover(el, quote, pt) {
  closePopover();
  if (!el) { C.toast(t('n_pick_first')); return; }
  if (!C.idOf(el)) { C.toast(t('n_dynamic')); return; }
  const q = String(quote || '').replace(/\s+/g, ' ').trim();
  pop = h('div', 'sel-ui note-pop');
  pop.appendChild(h('div', 'np-title', t('n_pop_title')));
  pop.appendChild(h('div', 'np-quote', q
    ? `${t('n_pop_quote')}「${q.slice(0, 60)}${q.length > 60 ? '…' : ''}」`
    : `${t('n_target')}：${kindName(el)}${summaryOf(el) ? ' · ' + summaryOf(el) : ''}`));
  const ta = h('textarea', 'np-input');
  ta.rows = 3;
  ta.placeholder = t('n_pop_placeholder');
  pop.appendChild(ta);
  const row = h('div', 'n-row');
  const st = h('select');
  for (const s of NOTE_STATUS) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = t(STATUS_KEY[s]);
    st.appendChild(o);
  }
  row.appendChild(st);
  const btns = h('div', 'np-btns');
  const cancel = h('button', 'btn', t('n_cancel'));
  const save = h('button', 'btn primary', t('n_save'));
  btns.append(cancel, save);
  row.appendChild(btns);
  pop.appendChild(row);
  document.body.appendChild(pop);

  const w = pop.offsetWidth;
  const hgt = pop.offsetHeight;
  pop.style.left = Math.max(6, Math.min(pt.x, window.innerWidth - w - 10)) + 'px';
  pop.style.top = Math.max(6, Math.min(pt.y, window.innerHeight - hgt - 10)) + 'px';
  ta.focus();

  const doSave = () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    if (createNote(el, text, st.value, q)) { closePopover(); render(); }
  };
  cancel.onclick = closePopover;
  save.onclick = doSave;
  ta.addEventListener('keydown', (e) => {
    if (matches(e, 'noteSave')) { e.preventDefault(); e.stopPropagation(); doSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); }
  });
}
function updateNote(id, patch, action) {
  const cur = C.S.notes.find((n) => n.id === id);
  if (!cur) return;
  const next = C.S.notes.map((n) => (n.id === id ? { ...n, ...patch, updated: Date.now() } : n));
  C.changeNotes(next, action, elOf(cur), patch.text != null ? patch.text : cur.text);
}

function deleteNote(id) {
  const cur = C.S.notes.find((n) => n.id === id);
  if (!cur || !confirm(t('n_delete_confirm'))) return;
  C.changeNotes(C.S.notes.filter((n) => n.id !== id), 'delete', elOf(cur), cur.text);
}

function rebind(id) {
  const el = C.S.sel;
  if (!el) { C.toast(t('n_pick_first')); return; }
  const pid = C.idOf(el);
  if (!pid) { C.toast(t('n_dynamic')); return; }
  updateNote(id, { pid, fp: fingerprint(el), kind: kindName(el), summary: summaryOf(el), state: 'ok' }, 'rebind');
}

export function locate(id) {
  const n = C.S.notes.find((x) => x.id === id);
  const el = n && elOf(n);
  if (!el) { C.toast(t('n_target_lost')); return; }
  const idx = C.S.slides.findIndex((s) => s === el || s.contains(el));
  if (idx >= 0) C.navigate(idx);
  C.select(el);
  const box = $('#sel-box');
  box.classList.remove('pulse');
  void box.offsetWidth;
  box.classList.add('pulse');
}

/* ---------------- 面板 ---------------- */
export function refreshComposer() {
  const target = $('#n-target');
  if (!target) return;
  const el = C.S.sel;
  const ok = !!el;
  target.textContent = ok ? `${t('n_target')}：${kindName(el)}${summaryOf(el) ? ' · ' + summaryOf(el) : ''}` : t('n_pick_first');
  target.classList.toggle('muted', !ok);
  $('#n-add').disabled = !ok;
  $('#n-input').disabled = !ok;
}

export function render() {
  if (!C || !C.S) return;
  renderMarks();
  const panel = $('#notes');
  if (!panel || panel.hidden) { $('#btn-notes').classList.toggle('has', C.S.notes.length > 0); return; }
  $('#btn-notes').classList.toggle('has', C.S.notes.length > 0);
  refreshComposer();

  // 筛选条
  const counts = { all: C.S.notes.length };
  NOTE_STATUS.forEach((s) => (counts[s] = C.S.notes.filter((n) => n.status === s).length));
  const bar = $('#n-filters');
  bar.innerHTML = '';
  for (const key of ['all', ...NOTE_STATUS]) {
    const b = h('button', 'n-chip' + (filter === key ? ' on' : ''), `${key === 'all' ? t('n_all') : t(STATUS_KEY[key])} ${counts[key]}`);
    b.onclick = () => { filter = key; render(); };
    bar.appendChild(b);
  }

  // 一键全部展开 / 收起（收起后回到只展开当前页）
  const all = h('button', 'n-chip n-expand', expandAll ? t('n_collapse_all') : t('n_expand_all'));
  all.onclick = () => { expandAll = !expandAll; toggled.clear(); render(); };
  bar.appendChild(all);

  // 列表：按页分组，页序排列；找不到目标的批注单独放最后
  const list = $('#n-list');
  list.innerHTML = '';
  const items = C.S.notes.filter((n) => filter === 'all' || n.status === filter);
  if (!items.length) list.appendChild(h('p', 'h-empty', t('n_empty')));
  const groups = new Map();
  for (const n of items) {
    const p = pageOf(n);
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(n);
  }
  const flashNote = flashId && C.S.notes.find((n) => n.id === flashId);
  if (flashNote) ensureOpen(pageOf(flashNote));
  const pages = [...groups.keys()].sort((a, b) => (a < 0 ? Infinity : a) - (b < 0 ? Infinity : b));
  for (const p of pages) {
    const ns = groups.get(p);
    const open = isOpen(p);
    const g = h('div', 'n-group' + (open ? ' open' : '') + (p === C.S.cur ? ' cur' : ''));
    const head = h('button', 'n-ghead');
    head.appendChild(h('span', 'n-arrow', '▸'));
    head.appendChild(h('span', 'n-gtitle', p < 0 ? t('n_lost_group') : t('n_page', { n: p + 1 })));
    if (p === C.S.cur) head.appendChild(h('span', 'n-gcur', t('n_cur_page')));
    const hits = findQ ? ns.filter((n) => noteMatches(n, findQ)).length : 0;
    if (hits) head.appendChild(h('span', 'n-ghit', t('n_hits', { n: hits })));
    head.appendChild(h('span', 'n-gcount', t('n_count', { n: ns.length })));
    head.onclick = () => { if (toggled.has(p)) toggled.delete(p); else toggled.add(p); render(); };
    g.appendChild(head);
    if (open) {
      const body = h('div', 'n-gbody');
      for (const n of ns) body.appendChild(row(n));
      g.appendChild(body);
    }
    list.appendChild(g);
  }
  if (flashId) {
    const f = list.querySelector(`[data-nid="${flashId}"]`);
    if (f) { f.scrollIntoView({ block: 'nearest' }); f.classList.add('flash'); }
    flashId = null;
  }
  if (findCurId) {
    const f = list.querySelector(`[data-nid="${findCurId}"]`);
    if (f) f.scrollIntoView({ block: 'nearest' });
  }
}

// 把文字里的查找关键词包上 <mark> 高亮
function fillMarked(el, text, q) {
  el.textContent = '';
  if (!q) { el.textContent = text; return; }
  const low = text.toLowerCase();
  const ql = q.toLowerCase();
  let i = 0;
  let j;
  while ((j = low.indexOf(ql, i)) >= 0) {
    if (j > i) el.appendChild(document.createTextNode(text.slice(i, j)));
    el.appendChild(h('mark', null, text.slice(j, j + q.length)));
    i = j + q.length;
  }
  if (i < text.length) el.appendChild(document.createTextNode(text.slice(i)));
}

function row(n) {
  const hit = noteMatches(n, findQ);
  const r = h('div', 'n-item st-' + n.status + (n.state !== 'ok' ? ' warn' : '') + (hit ? ' hit' : '') + (hit && n.id === findCurId ? ' hit-cur' : ''));
  r.dataset.nid = n.id;

  const head = h('div', 'n-head');
  head.appendChild(h('span', 'n-kind', n.kind || t('kindBox')));
  const sum = h('span', 'n-sum', n.summary || '');
  head.appendChild(sum);
  head.appendChild(h('span', 'n-time', fmtTime(n.updated)));
  r.appendChild(head);

  if (n.quote) r.appendChild(h('div', 'n-quote', '「' + n.quote.slice(0, 80) + (n.quote.length > 80 ? '…' : '') + '」'));
  if (n.state === 'orphan') r.appendChild(h('div', 'n-warn', '⚠ ' + t('n_state_orphan')));
  if (n.state === 'changed') r.appendChild(h('div', 'n-warn', '⚠ ' + t('n_state_changed')));

  if (editingId === n.id) {
    const ta = h('textarea', 'n-edit');
    ta.rows = 3;
    ta.value = n.text;
    r.appendChild(ta);
    const acts = h('div', 'n-acts');
    const save = h('button', 'btn primary', t('n_save'));
    save.onclick = () => {
      const text = ta.value.trim();
      editingId = null;
      if (text && text !== n.text) updateNote(n.id, { text }, 'edit'); else render();
    };
    const cancel = h('button', 'btn', t('n_cancel'));
    cancel.onclick = () => { editingId = null; render(); };
    acts.append(save, cancel);
    r.appendChild(acts);
    setTimeout(() => ta.focus(), 0);
    return r;
  }

  const tx = h('div', 'n-text');
  fillMarked(tx, n.text, hit ? findQ : '');
  r.appendChild(tx);

  const acts = h('div', 'n-acts');
  const sel = h('select', 'n-st');
  for (const s of NOTE_STATUS) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = t(STATUS_KEY[s]);
    if (s === n.status) o.selected = true;
    sel.appendChild(o);
  }
  sel.onchange = () => updateNote(n.id, { status: sel.value }, 'status');
  acts.appendChild(sel);

  const mk = (label, fn, cls) => { const b = h('button', 'n-link' + (cls ? ' ' + cls : ''), label); b.onclick = fn; acts.appendChild(b); };
  mk(t('n_locate'), () => locate(n.id));
  mk(t('n_edit'), () => { editingId = n.id; render(); });
  if (n.state !== 'ok') mk(t('n_rebind'), () => rebind(n.id));
  mk(t('n_delete'), () => deleteNote(n.id), 'danger');
  r.appendChild(acts);
  return r;
}

/* ---------------- 页面上的标记 ---------------- */
let lastSig = '';
export function renderMarks() {
  const box = $('#note-marks');
  if (!box) return;
  const S = C.S;
  const groups = new Map(); // 元素 -> 该元素上的批注
  if (S.doc && showMarks) {
    for (const n of S.notes) {
      const el = elOf(n);
      if (!el) continue;
      if (!groups.has(el)) groups.set(el, []);
      groups.get(el).push(n);
    }
  }
  const marks = [];
  for (const [el, list] of groups) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue; // 不在当前页
    const worst = list.some((n) => n.status === 'todo') ? 'todo' : list.some((n) => n.status === 'doing') ? 'doing' : 'done';
    marks.push({
      el, list, worst,
      warn: list.some((n) => n.state !== 'ok'),
      left: Math.max(2, Math.round(r.right * S.scale - 36)), // 往左挪一点，避开选框右上角的缩放小圆点
      top: Math.max(2, Math.round(r.top * S.scale - 11)),
    });
  }
  // 位置和状态没变就不重建，避免点击标记的过程中它被替换掉
  const sig = marks.map((m) => `${m.list.map((n) => n.id + n.status + n.state).join(',')}@${m.left},${m.top}`).join('|');
  if (sig === lastSig && box.childElementCount === marks.length) return;
  lastSig = sig;
  box.innerHTML = '';
  for (const m of marks) {
    // 标记是个气泡图标；同一元素上有多条批注时，右上角小圆点显示条数
    const d = h('div', 'note-mark st-' + m.worst + (m.warn ? ' warn' : ''));
    d.innerHTML = '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path fill="currentColor" d="M3 3h10v6H8l-3 3V9H3z"/></svg>';
    if (m.list.length > 1) d.appendChild(h('span', 'nm-count', String(m.list.length)));
    d.style.left = m.left + 'px';
    d.style.top = m.top + 'px';
    d.title = t('n_mark_title', { n: m.list.length }) + '\n' + m.list.map((n) => `· ${n.text}`).join('\n').slice(0, 300);
    d.onmousedown = (e) => e.stopPropagation();
    d.onclick = (e) => {
      e.stopPropagation();
      openPanel();
      filter = 'all';
      flashId = m.list[0].id;
      C.select(m.el);
      render();
    };
    box.appendChild(d);
  }
}
/* ---------------- 打开文件时的完整性提醒 ---------------- */
export function showWarn(issues) {
  $('#note-warn')?.remove();
  if (!issues) return;
  const parts = [];
  if (issues.orphan) parts.push(t('n_w_orphan', { n: issues.orphan }));
  if (issues.changed) parts.push(t('n_w_changed', { n: issues.changed }));
  if (issues.stray) parts.push(t('n_w_stray', { n: issues.stray }));
  if (issues.badJson) parts.push(t('n_w_badjson'));
  if (!parts.length) return;
  const bar = h('div');
  bar.id = 'note-warn';
  bar.appendChild(h('div', 'w-title', '⚠ ' + t('n_w_title')));
  bar.appendChild(h('div', 'w-body', parts.join('；') + '。'));
  bar.appendChild(h('div', 'w-tip', t('n_w_tip')));
  const acts = h('div', 'w-acts');
  const view = h('button', 'btn primary', t('n_w_view'));
  view.onclick = () => { openPanel(); bar.remove(); };
  const ok = h('button', 'btn', t('n_w_ok'));
  ok.onclick = () => bar.remove();
  acts.append(view, ok);
  bar.appendChild(acts);
  document.body.appendChild(bar);
}





