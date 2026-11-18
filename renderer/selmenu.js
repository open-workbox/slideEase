// 选中文字后的操作：选区旁的小按钮、右键菜单（复制 / 剪切 / 批注）、复制与剪切本身
import { t } from './i18n.js';

let C; // { S, frame, pick, idOf, commit, toast, openNotePopover }
let hint = null;
let menu = null;
let menuOpen = false;

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function init(ctx) {
  C = ctx;
}

/* ---------- 当前选中的文字 ---------- */
function currentSel() {
  const S = C.S;
  if (!S.win || S.editing) return null;
  const sel = S.win.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const text = sel.toString();
  if (!text.trim()) return null;
  return { sel, range: sel.getRangeAt(0), text };
}

export const hasSelection = () => !!currentSel();

// 选区所在的块级元素（批注挂在元素上，不挂在文字范围上）
function hostOf(range) {
  let n = range.commonAncestorContainer;
  if (n.nodeType !== 1) n = n.parentElement;
  return n ? C.pick(n) : null;
}

// 把页面（iframe）里的矩形换算成软件窗口里的坐标
function toViewport(r) {
  const fr = C.frame.getBoundingClientRect();
  const k = C.S.scale;
  return { left: fr.left + r.left * k, top: fr.top + r.top * k, right: fr.left + r.right * k, bottom: fr.top + r.bottom * k };
}

/* ---------- 选区旁的小按钮 ---------- */
function ensureHint() {
  if (hint) return hint;
  hint = h('button', 'sel-ui sel-hint', '💬');
  hint.hidden = true;
  hint.title = t('ctx_hint');
  // 点小按钮直接给选中的文字添加批注（复制、剪切走右键菜单或快捷键）
  hint.onclick = (e) => {
    e.stopPropagation();
    const r = hint.getBoundingClientRect();
    noteFromSelection({ x: r.left, y: r.bottom + 4 });
  };
  document.body.appendChild(hint);
  return hint;
}

export function updateHint() {
  if (!C) return;
  const btn = ensureHint();
  const S = C.S;
  const cur = !S.dragging && !menuOpen ? currentSel() : null;
  if (!cur) { btn.hidden = true; return; }
  const rects = cur.range.getClientRects();
  if (!rects.length) { btn.hidden = true; return; }
  const last = toViewport(rects[rects.length - 1]);
  const fr = C.frame.getBoundingClientRect();
  if (last.bottom < fr.top || last.top > fr.bottom) { btn.hidden = true; return; } // 选区已滚出画面
  btn.hidden = false;
  btn.title = t('ctx_hint');
  btn.style.left = Math.min(Math.max(last.right + 6, fr.left + 4), fr.right - 30) + 'px';
  btn.style.top = Math.max(last.top - 26, fr.top + 4) + 'px';
}

/* ---------- 右键菜单 ---------- */
export function openMenu(x, y, opts) {
  closeMenu();
  const cur = currentSel();
  const hasText = !!(opts && opts.hasText && cur);
  const target = (opts && opts.target) || (cur ? hostOf(cur.range) : null);
  const quote = hasText ? cur.text : '';
  menu = h('div', 'sel-ui sel-menu');
  const add = (label, key, fn) => {
    const b = h('button', 'sel-item');
    b.appendChild(h('span', null, label));
    if (key) b.appendChild(h('kbd', null, key));
    b.onclick = (e) => { e.stopPropagation(); const pt = { x, y }; closeMenu(); fn(pt); };
    menu.appendChild(b);
  };
  if (hasText) {
    add(t('ctx_copy'), t('ctx_key_copy'), () => copySelection());
    add(t('ctx_cut'), t('ctx_key_cut'), () => cutSelection());
  }
  add(t('ctx_note'), t('ctx_key_note'), (pt) => C.openNotePopover(target, quote, pt));
  document.body.appendChild(menu);
  menuOpen = true;
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - hgt - 8)) + 'px';
  if (hint) hint.hidden = true;
}

// 批注快捷键 / 小按钮：有选中文字就针对这段文字，否则针对当前选中的元素
export function noteFromSelection(pt) {
  closeMenu();
  const cur = currentSel();
  const S = C.S;
  let target = null;
  let quote = '';
  let at = pt;
  if (cur) {
    target = hostOf(cur.range);
    quote = cur.text;
    if (!at) {
      const rects = cur.range.getClientRects();
      const last = rects.length ? toViewport(rects[rects.length - 1]) : null;
      if (last) at = { x: last.left, y: last.bottom + 6 };
    }
  } else if (S.sel && !S.editing) {
    target = S.sel;
    if (!at) {
      const b = toViewport(S.sel.getBoundingClientRect());
      at = { x: b.left, y: b.bottom + 6 };
    }
  }
  if (!target) { C.openNotePopover(null); return false; } // 什么都没选：提示先选择
  if (hint) hint.hidden = true;
  C.openNotePopover(target, quote, at || { x: 100, y: 100 });
  return true;
}

// 通用右键菜单（如缩略图列表）：items = [{ label, fn }]，样式和关闭方式与选中文字的菜单一致
export function openCustomMenu(x, y, items) {
  closeMenu();
  menu = h('div', 'sel-ui sel-menu');
  for (const it of items) {
    const b = h('button', 'sel-item');
    b.appendChild(h('span', null, it.label));
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.fn(); };
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  menuOpen = true;
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - hgt - 8)) + 'px';
  if (hint) hint.hidden = true;
}

export function closeMenu() {
  if (menu) { menu.remove(); menu = null; }
  menuOpen = false;
}

export const isMenuOpen = () => menuOpen;

/* ---------- 复制 / 剪切 ---------- */
export function copySelection() {
  const cur = currentSel();
  if (!cur) return false;
  window.api.copyText(cur.text);
  C.toast(t('copied'));
  return true;
}

// 剪切：先复制到剪贴板，再把选中的文字从页面里删掉；作为一次可撤销的“修改文字”
export function cutSelection() {
  const cur = currentSel();
  if (!cur) return false;
  const S = C.S;
  let host = cur.range.commonAncestorContainer;
  if (host.nodeType !== 1) host = host.parentElement;
  while (host && host !== S.doc.body && !C.idOf(host)) host = host.parentElement;
  if (!host || host === S.doc.body || S.slides.some((s) => s !== host && host.contains(s))) {
    C.toast(t('ctx_cut_fail'));
    return false;
  }
  window.api.copyText(cur.text);
  const from = host.innerHTML;
  cur.range.deleteContents();
  const to = host.innerHTML;
  cur.sel.removeAllRanges();
  if (to !== from) C.commit([{ type: 'html', el: host, from, to }], { applied: true });
  C.toast(t('cut'));
  updateHint();
  return true;
}

export function closeAll() {
  closeMenu();
  if (hint) hint.hidden = true;
}
