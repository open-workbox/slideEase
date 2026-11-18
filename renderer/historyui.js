// 修改记录：记录生成、持久化、面板展示、定位、单条还原、恢复到保存点
import { t, getLang } from './i18n.js';
import { slideTitle } from './slides.js';

const ID = 'data-pe-id';
const MARKS = ['data-pe-hide', 'data-pe-cur', 'data-pe-disp', 'contenteditable'];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let C; // 由 app.js 传入的上下文
const recs = []; // 全部记录（时间顺序）
const changesOf = new Map(); // 记录 id -> 本次打开期间的修改对象
let last = null; // 用于合并连续的同类操作（拖动、微调等）
let activeId = null;

const $ = (s) => document.querySelector(s);
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function init(ctx) {
  C = ctx;
  $('#btn-history').onclick = toggle;
  $('#h-close').onclick = () => ($('#history').hidden = true);
  $('#h-clear').onclick = async () => {
    if (!confirm(t('h_clearConfirm'))) return;
    const list = await window.api.historyClear();
    recs.length = 0;
    recs.push(...list);
    changesOf.clear();
    last = null;
    activeId = null;
    render();
  };
}

export function setRecords(list) {
  C.S.epoch = uid(); // 每次打开文档为一个“世代”，元素编号只在同一世代内有效
  changesOf.clear();
  last = null;
  activeId = null;
  if (list !== null) { recs.length = 0; recs.push(...list); }
  render();
}

export function addRecord(r) {
  recs.push(r);
  render();
}

function persist(rec) {
  try { window.api.historyAppend(JSON.parse(JSON.stringify(rec))); } catch { /* 忽略 */ }
}

function toggle() {
  const el = $('#history');
  el.hidden = !el.hidden;
  if (!el.hidden) { document.querySelector('#notes').hidden = true; render(); }
}

/* ---------------- 元素定位 ---------------- */
function pathOf(el) {
  const parts = [];
  let n = el;
  const body = C.S.doc.body;
  while (n && n !== body && n.parentElement) {
    parts.unshift(Array.prototype.indexOf.call(n.parentElement.children, n));
    n = n.parentElement;
  }
  return parts.join('/');
}
function locOf(el) {
  if (!el || el.nodeType !== 1) return null;
  return {
    epoch: C.S.epoch, pid: el.getAttribute(ID), tag: el.tagName, path: pathOf(el),
    fp: (el.textContent || '').trim().slice(0, 40),
  };
}
function locLite(el) {
  return el && el.nodeType === 1 ? { epoch: C.S.epoch, pid: el.getAttribute(ID), tag: el.tagName } : null;
}
function resolveLoc(loc) {
  const d = C.S.doc;
  if (!loc || !d) return null;
  const byPid = () => (loc.pid ? d.querySelector(`[${ID}="${loc.pid}"]`) : null);
  if (loc.epoch === C.S.epoch) {
    const e = byPid();
    return e ? { el: e } : null;
  }
  // 跨次打开：页面结构可能变过，依次尝试 编号 → 结构路径 → 文字指纹，并且要求标签和文字都对得上
  const fp = (e) => (e.textContent || '').trim().slice(0, 40);
  const ok = (e) => e && e !== d.body && e.tagName === loc.tag && (!loc.fp || fp(e) === loc.fp);
  let c = byPid();
  if (!ok(c)) {
    c = null;
    if (loc.path != null) {
      let n = d.body;
      for (const i of String(loc.path).split('/').filter((x) => x !== '')) n = n && n.children[+i];
      if (ok(n)) c = n;
    }
  }
  if (!c && loc.fp) c = [...d.body.querySelectorAll(loc.tag)].find((e) => fp(e) === loc.fp) || null;
  return c ? { el: c, approx: true } : null;
}

const snippet = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 30);
function slideIdxOf(el) {
  const i = el ? C.S.slides.findIndex((s) => s === el || s.contains(el)) : -1;
  return i < 0 ? C.S.cur : i;
}
function cleanHtml(el) {
  const c = el.cloneNode(true);
  for (const e of [c, ...c.querySelectorAll('*')]) {
    MARKS.forEach((a) => e.removeAttribute(a));
    if (C.S.info.activeClass && e === c) e.classList.remove(C.S.info.activeClass);
  }
  return c.outerHTML;
}
function elKind(el) {
  if (!el) return 'box';
  if (['IMG', 'SVG', 'VIDEO', 'CANVAS'].includes(el.tagName.toUpperCase())) return 'image';
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ? 'text' : 'box';
}

/* ---------------- 生成记录 ---------------- */
function toItem(c, lite) {
  const L = lite ? locLite : locOf;
  const S = C.S;
  switch (c.type) {
    case 'style': return { type: 'style', loc: L(c.el), prop: c.prop, from: c.from, to: c.to };
    case 'html': return { type: 'html', loc: L(c.el), from: c.from, to: c.to };
    case 'attr': return { type: 'attr', loc: L(c.el), name: c.name, from: c.from, to: c.to };
    case 'remove':
      return {
        type: 'remove', loc: locOf(c.el), html: cleanHtml(c.el), text: snippet(c.el), isSlide: S.slides.includes(c.el),
        parentLoc: locOf(c.parent && c.parent.nodeType === 1 ? c.parent : c.el.parentElement),
        nextLoc: locOf(c.el.nextElementSibling),
      };
    case 'clone':
      return { type: 'clone', srcLoc: locOf(c.srcEl), newPid: c.node.getAttribute(ID), text: snippet(c.srcEl), isSlide: S.slides.includes(c.srcEl) };
    case 'move':
      return {
        type: 'move', loc: locOf(c.el), text: snippet(c.el), isSlide: S.slides.includes(c.el),
        refIdx: S.slides.indexOf(c.refEl), pos: c.pos, fromIdx: S.slides.indexOf(c.el),
        fromPrevLoc: locOf(c.el.previousElementSibling), fromNextLoc: locOf(c.el.nextElementSibling),
      };
    case 'notes': return { type: 'notes', action: c.action, text: String(c.text || '').slice(0, 200), loc: locOf(c.el) };
    case 'insert': return { type: 'insert', loc: locOf(c.el), text: snippet(c.el), isSlide: S.slides.includes(c.el) };
  }
  return null;
}

function kindOf(items) {
  const has = (ty) => items.find((i) => i.type === ty);
  if (has('notes')) return 'note';
  if (has('remove')) return has('remove').isSlide ? 'deleteSlide' : 'delete';
  if (has('clone')) return has('clone').isSlide ? 'duplicateSlide' : 'duplicate';
  if (has('move')) return 'reorder';
  if (has('insert')) return 'undelete';
  if (has('html')) return 'text';
  if (items.some((i) => (i.type === 'attr' && i.name === 'src') || (i.type === 'style' && i.prop === 'background-image' && /url\(/.test(i.to || '')))) return 'image';
  const props = items.filter((i) => i.type === 'style').map((i) => i.prop);
  if (props.length && props.every((p) => p === 'translate')) return 'move';
  if (props.some((p) => p === 'width' || p === 'height' || p === 'scale')) return 'resize';
  return 'style';
}

export function logChanges(changes, opts = {}) {
  try {
    const S = C.S;
    const now = Date.now();
    const lite = changes.length > 10;
    const items = changes.map((c, i) => toItem(c, lite && i > 0)).filter(Boolean);
    if (!items.length) return null;

    const allStyle = items.every((i) => i.type === 'style');
    const sig = !opts.revertOf && allStyle ? items.map((i) => (i.loc && i.loc.pid) + '|' + i.prop).join(',') : null;
    if (sig && last && last.sig === sig && now - last.t < 1500) {
      // 连续同类操作合并成一条（保留最初的“修改前”和最后的“修改后”）
      items.forEach((it, i) => { last.rec.items[i].to = it.to; });
      last.rec.count = (last.rec.count || 1) + 1;
      last.t = now;
      changesOf.get(last.rec.id).push(...changes);
      persist(last.rec);
      render();
      return last.rec;
    }

    const first = changes[0];
    const el0 = first.el || first.srcEl;
    const where = first.type === 'insert' ? first.parent : el0;
    const idx = slideIdxOf(where);
    const rec = {
      id: uid(), t: now, epoch: S.epoch, kind: kindOf(items),
      slide: { i: idx, title: S.slides[idx] ? slideTitle(S.slides[idx]) : '' },
      el: elKind(el0), target: snippet(el0), items, revertOf: opts.revertOf || null,
    };
    recs.push(rec);
    changesOf.set(rec.id, [...changes]);
    last = sig ? { rec, sig, t: now } : null;
    persist(rec);
    render();
    return rec;
  } catch (e) {
    console.warn('history', e);
    return null;
  }
}

export function logEvent(kind, ref, extra = {}) {
  last = null;
  const rec = { id: uid(), t: Date.now(), kind, ref: ref || null, ...extra };
  recs.push(rec);
  persist(rec);
  render();
}

/* ---------------- 展示 ---------------- */
const ICON = {
  baseline: '●', external: '⚠', save: '⬇', text: 'T', style: '◐', move: '✥', resize: '⤢', image: '▣', delete: '✕',
  deleteSlide: '✕', duplicate: '⧉', duplicateSlide: '⧉', reorder: '⇅', undelete: '↺', note: '💬', undo: '↶', redo: '↷', restore: '⟲',
};
const PROP_KEY = {
  color: 'p_color', 'font-size': 'p_font-size', 'font-weight': 'p_font-weight', 'font-style': 'p_font-style', 'text-decoration': 'p_text-decoration',
  'text-align': 'p_text-align', 'background-color': 'p_background-color', 'background-image': 'p_background-image', opacity: 'p_opacity',
  'border-radius': 'p_border-radius', translate: 'p_translate', scale: 'p_scale', width: 'p_width', height: 'p_height',
};
const propName = (p) => (PROP_KEY[p] ? t(PROP_KEY[p]) : p);

function plain(html) {
  // 用 DOMParser 取纯文本（不会执行任何脚本）
  return (new DOMParser().parseFromString(html || '', 'text/html').body.textContent || '').trim();
}

function fmtTime(ts) {
  const d = new Date(ts);
  const lang = getLang() === 'zh' ? 'zh-CN' : 'en-US';
  const time = d.toLocaleTimeString(lang, { hour12: false });
  return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${time}`;
}

function titleOf(rec) {
  if (['baseline', 'external', 'save'].includes(rec.kind)) return t('h_' + rec.kind);
  if (rec.kind === 'restore') return t('h_restoreEvt');
  if (rec.kind === 'undo' || rec.kind === 'redo') {
    const r = recs.find((x) => x.id === rec.ref);
    return t('h_' + rec.kind) + (r ? '：' + titleOf(r) : '');
  }
  let s = t('h_' + rec.kind);
  if (rec.kind === 'style') {
    const names = [...new Set(rec.items.filter((i) => i.type === 'style').map((i) => propName(i.prop)))].slice(0, 3);
    if (names.length) s += '：' + names.join('、');
  }
  if (rec.revertOf) s = t('h_revertPrefix') + s;
  if (rec.count > 1) s += ` ×${rec.count}`;
  return s;
}
function subOf(rec) {
  if (rec.kind === 'undo' || rec.kind === 'redo') {
    const r = recs.find((x) => x.id === rec.ref);
    return r ? subOf(r) : '';
  }
  if (!rec.slide) return '';
  const pg = t('h_slideLabel', { n: rec.slide.i + 1 });
  return rec.target ? `${pg} · ${rec.target}` : pg;
}

function stats() {
  const net = new Map();
  const reverted = new Set();
  for (const r of recs) {
    if (r.kind === 'undo') net.set(r.ref, (net.get(r.ref) || 0) + 1);
    else if (r.kind === 'redo') net.set(r.ref, (net.get(r.ref) || 0) - 1);
    if (r.revertOf) reverted.add(r.revertOf);
  }
  return { net, reverted };
}

export function render() {
  const box = $('#h-list');
  if (!box || $('#history').hidden) return;
  box.innerHTML = '';
  if (!recs.length) { box.appendChild(h('p', 'h-empty', t('h_empty'))); return; }
  const st = stats();
  for (const rec of [...recs].reverse()) box.appendChild(row(rec, st));
}

function row(rec, st) {
  const isEvent = rec.kind === 'undo' || rec.kind === 'redo';
  const r = h('div', `hrow k-${rec.kind}${isEvent ? ' muted' : ''}${rec.id === activeId ? ' active' : ''}`);
  const head = h('div', 'hhead');
  head.appendChild(h('span', 'hicon', ICON[rec.kind] || '•'));
  const main = h('div', 'hmain');
  main.appendChild(h('div', 'htitle', titleOf(rec)));
  const sub = subOf(rec);
  if (sub) main.appendChild(h('div', 'hsub', sub));
  head.appendChild(main);
  const meta = h('div', 'hmeta');
  meta.appendChild(h('span', 'htime', fmtTime(rec.t)));
  const n = st.net.get(rec.id) || 0;
  if (n > 0) meta.appendChild(h('span', 'hbadge', n >= (rec.count || 1) ? t('h_undone') : t('h_partUndone')));
  if (st.reverted.has(rec.id)) meta.appendChild(h('span', 'hbadge green', t('h_reverted')));
  head.appendChild(meta);
  head.onclick = () => activate(rec);
  r.appendChild(head);
  if (rec.id === activeId) r.appendChild(detail(rec, st));
  return r;
}

function activate(rec) {
  activeId = activeId === rec.id ? null : rec.id;
  render();
  if (activeId) locate(rec, true);
}

/* ---------------- 详情（修改前 / 修改后） ---------------- */
function swatch(v) {
  const s = h('span', 'sw');
  s.style.background = v;
  return s;
}
function fmtVal(prop, v) {
  if (v == null || v === '') return t('h_default');
  if (prop === 'opacity' || prop === 'scale') return Math.round(parseFloat(v) * 100) + '%';
  return v;
}
const parseT = (v) => (!v || v === 'none' ? [0, 0] : v.split(/\s+/).map((x) => parseFloat(x) || 0));
function moveText(from, to) {
  const [x0, y0] = parseT(from);
  const [x1, y1] = parseT(to);
  const dx = Math.round(x1 - x0);
  const dy = Math.round(y1 - y0);
  const parts = [];
  if (dx) parts.push(`${t(dx > 0 ? 'h_right' : 'h_left')} ${Math.abs(dx)}px`);
  if (dy) parts.push(`${t(dy > 0 ? 'h_down' : 'h_up')} ${Math.abs(dy)}px`);
  return parts.join('，') || '—';
}

function imgBox(value) {
  const box = h('div', 'imgbox');
  if (!value) { box.textContent = t('h_none'); return box; }
  const m = /url\(["']?(.*?)["']?\)/.exec(value);
  const src = m ? m[1] : value;
  const img = document.createElement('img');
  img.alt = '';
  const sdb = /^sdb:\/\/([0-9a-f]{40})/.exec(src);
  if (sdb) window.api.historyBlob(sdb[1]).then((d) => { if (d) img.src = d; });
  else img.src = src;
  box.appendChild(img);
  return box;
}

function ba(label, node) {
  const c = h('div', 'ba');
  c.appendChild(h('div', 'balabel', label));
  c.appendChild(node);
  return c;
}
function textBox(s) {
  const b = h('div', 'tbox', s || t('h_none'));
  return b;
}
function pair(a, b) {
  const p = h('div', 'pair');
  p.appendChild(a);
  p.appendChild(b);
  return p;
}

function detail(rec, st) {
  const d = h('div', 'hdetail');
  const items = rec.items || [];
  const shown = new Set();
  for (const it of items) {
    const key = it.type + (it.prop || it.name || '');
    if (shown.has(key) || shown.size >= 6) continue;
    shown.add(key);
    if (it.type === 'html') {
      d.appendChild(pair(ba(t('h_before'), textBox(plain(it.from).slice(0, 300))), ba(t('h_after'), textBox(plain(it.to).slice(0, 300)))));
    } else if (it.type === 'style') {
      const line = h('div', 'sline');
      line.appendChild(h('span', 'sname', propName(it.prop)));
      if (it.prop === 'translate') line.appendChild(h('span', 'sval', moveText(it.from, it.to)));
      else if (it.prop === 'background-image' && /url\(/.test(it.to || it.from || '')) d.appendChild(pair(ba(t('h_before'), imgBox(it.from)), ba(t('h_after'), imgBox(it.to))));
      else {
        const v = h('span', 'sval');
        if (/color/.test(it.prop) && it.from) v.appendChild(swatch(it.from));
        v.appendChild(document.createTextNode(fmtVal(it.prop, it.from) + ' → '));
        if (/color/.test(it.prop) && it.to) v.appendChild(swatch(it.to));
        v.appendChild(document.createTextNode(fmtVal(it.prop, it.to)));
        line.appendChild(v);
      }
      if (!(it.prop === 'background-image' && /url\(/.test(it.to || it.from || ''))) d.appendChild(line);
    } else if (it.type === 'attr' && it.name === 'src') {
      d.appendChild(pair(ba(t('h_before'), imgBox(it.from)), ba(t('h_after'), imgBox(it.to))));
    } else if (it.type === 'remove') {
      d.appendChild(ba(t('h_deletedContent'), textBox(plain(it.html).slice(0, 200))));
    } else if (it.type === 'notes') {
      d.appendChild(h('div', 'sline', t('h_note_' + it.action)));
      if (it.text) d.appendChild(textBox(it.text));
    } else if (it.type === 'clone') {
      d.appendChild(h('div', 'sline', t(it.isSlide ? 'h_dupSlideDesc' : 'h_dupDesc', { x: it.text || '' })));
    } else if (it.type === 'move') {
      const pos = t(it.pos === 'after' ? 'h_after_pos' : 'h_before_pos');
      d.appendChild(h('div', 'sline', t('h_reorderDesc', { a: it.fromIdx + 1, b: it.refIdx + 1, pos })));
    }
  }
  if (rec.hash) d.appendChild(h('div', 'sline', t('h_snapDesc')));

  const acts = h('div', 'hacts');
  if (items.length) {
    const b1 = h('button', 'btn', t('h_locate'));
    b1.onclick = () => locate(rec);
    acts.appendChild(b1);
    const n = st.net.get(rec.id) || 0;
    const already = n >= (rec.count || 1);
    const b2 = h('button', 'btn', t('h_revert'));
    b2.disabled = already || st.reverted.has(rec.id);
    b2.title = already ? t('h_alreadyUndone') : '';
    b2.onclick = () => revert(rec);
    if (rec.kind !== 'note') acts.appendChild(b2); // 批注的增删改请直接用撤销（Ctrl+Z）或在批注面板里操作
  }
  if (rec.hash) {
    const b = h('button', 'btn primary', t('h_restore'));
    b.onclick = () => restoreTo(rec);
    acts.appendChild(b);
  }
  d.appendChild(acts);
  return d;
}

/* ---------------- 定位 ---------------- */
function locate(rec, quiet) {
  const S = C.S;
  if (!rec.items) {
    const r = recs.find((x) => x.id === rec.ref);
    if (r && r.items) locate(r, quiet);
    return;
  }
  let target = null;
  let approx = false;
  let goneHere = false;
  for (const it of rec.items) {
    if (it.type === 'remove') { goneHere = true; continue; }
    const r = resolveLoc(it.loc || it.srcLoc);
    if (r) { target = r.el; approx = !!r.approx; break; }
  }
  if (target) {
    C.navigate(slideIdxOf(target));
    C.select(target);
    const box = $('#sel-box');
    box.classList.remove('pulse');
    void box.offsetWidth;
    box.classList.add('pulse');
    if (approx && !quiet) C.toast(t('h_approx'));
  } else {
    C.navigate(Math.min(rec.slide ? rec.slide.i : 0, S.slides.length - 1));
    if (!quiet || goneHere) C.toast(t(goneHere ? 'h_goneDeleted' : 'h_gone'));
  }
}

/* ---------------- 单条还原 ---------------- */
function fromHtml(html) {
  const tpl = C.S.doc.createElement('template');
  tpl.innerHTML = html;
  const node = tpl.content.firstElementChild;
  for (const e of [node, ...node.querySelectorAll(`[${ID}]`)]) if (e.hasAttribute(ID)) e.setAttribute(ID, 'n' + ++C.S.idCounter);
  return node;
}

function revert(rec) {
  const S = C.S;
  const fail = () => C.toast(t('h_cantRevert'));
  const same = rec.epoch === S.epoch;
  const changes = [];
  let conflict = false;
  for (const it of rec.items) {
    if (['style', 'html', 'attr'].includes(it.type)) {
      const r = resolveLoc(it.loc);
      if (!r) return fail();
      const el = r.el;
      const cur = it.type === 'style' ? el.style.getPropertyValue(it.prop) : it.type === 'html' ? el.innerHTML : el.getAttribute(it.name);
      if (cur !== it.to) conflict = true;
      if (it.type === 'style') changes.push({ type: 'style', el, prop: it.prop, from: cur, to: it.from });
      else if (it.type === 'html') changes.push({ type: 'html', el, from: cur, to: it.from });
      else changes.push({ type: 'attr', el, name: it.name, from: cur, to: it.from });
    } else if (it.type === 'remove') {
      const parent = resolveLoc(it.parentLoc);
      if (!parent) return fail();
      const nx = it.nextLoc ? resolveLoc(it.nextLoc) : null;
      const node = fromHtml(it.html);
      changes.push({ type: 'insert', el: node, parent: parent.el, next: nx ? nx.el : null, html: node.outerHTML });
    } else if (it.type === 'clone' && same) {
      const el = S.doc.querySelector(`[${ID}="${it.newPid}"]`);
      if (!el) return fail();
      changes.push({ type: 'remove', el, parent: el.parentNode, next: el.nextSibling });
    } else if (it.type === 'move' && same) {
      const r = resolveLoc(it.loc);
      if (!r) return fail();
      const prev = it.fromPrevLoc && resolveLoc(it.fromPrevLoc);
      const next = it.fromNextLoc && resolveLoc(it.fromNextLoc);
      if (!prev && !next) return fail();
      changes.push({ type: 'move', el: r.el, refEl: prev ? prev.el : next.el, pos: prev ? 'after' : 'before', parent: r.el.parentNode, next: r.el.nextSibling });
    } else return fail();
  }
  if (!changes.length) return fail();
  if (conflict && !confirm(t('h_conflict'))) return;
  C.commit(changes, { revertOf: rec.id });
  const first = changes[0].el;
  if (first && first.isConnected) { C.navigate(slideIdxOf(first)); C.select(first); }
  C.toast(t('h_revertDone'));
}

/* ---------------- 恢复到保存点 ---------------- */
async function restoreTo(rec) {
  const S = C.S;
  const content = await window.api.historySnap(rec.hash);
  if (content == null) { C.toast(t('h_cantRestore')); return; }
  if (!C.isDirty() && !confirm(t('h_restoreConfirm'))) return;
  const ok = await C.openDoc({ name: S.name, baseHref: S.baseHref, content, history: null, restored: true });
  if (ok) {
    S.savedVersion = -1; // 与磁盘上的文件不同，需要保存
    logEvent('restore', null, { hash: rec.hash });
    C.updateChrome();
    C.toast(t('h_restored'));
  }
}

// 供自动化测试使用
export const _test = { recs, revert, restoreTo, locate, resolveLoc };


