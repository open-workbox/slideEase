// 智能参考线：拖动或缩放元素时，和页面上其它元素、页面边缘、页面中线对齐时自动吸附，并画出参考线；
// 旁边的小标签实时显示位置或尺寸。按住 Alt（macOS ⌥）临时关闭吸附。
// 坐标统一用 iframe 视口里的像素（即 getBoundingClientRect 的结果），画到外层时再乘以画布缩放比例。
import { t } from './i18n.js';

let C; // { S, overlay }
let st = null; // 一次拖动期间的数据
let layer = null;
let badge = null;

const SNAP_PX = 6; // 吸附距离：屏幕上 6 像素以内
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'BR', 'HEAD', 'TITLE']);
const MAX_CANDIDATES = 600;

export function init(ctx) {
  C = ctx;
  layer = document.createElement('div');
  layer.id = 'guides';
  badge = document.createElement('div');
  badge.id = 'guide-badge';
  badge.hidden = true;
  C.overlay.append(layer, badge);
}

const rectOf = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });

// 开始拖动 / 缩放：收集当前页里可以对齐的目标
export function begin(el) {
  const S = C.S;
  const slide = S.slides.find((s) => s === el || s.contains(el)) || S.slides[S.cur] || S.doc.body;
  const sr = slide.getBoundingClientRect();
  const vw = S.win.innerWidth;
  const vh = S.win.innerHeight;
  // 页面可见区域：页面本身和视口取交集（滚动式长页面只对齐当前可见的这一屏）
  const page = rectOf({
    left: Math.max(0, sr.left), top: Math.max(0, sr.top),
    right: Math.min(vw, sr.right), bottom: Math.min(vh, sr.bottom),
  });
  page.width = page.right - page.left;
  page.height = page.bottom - page.top;
  const xs = [];
  const ys = [];
  const add = (r, kind) => {
    xs.push({ v: r.left, r, kind }, { v: (r.left + r.right) / 2, r, kind, mid: true }, { v: r.right, r, kind });
    ys.push({ v: r.top, r, kind }, { v: (r.top + r.bottom) / 2, r, kind, mid: true }, { v: r.bottom, r, kind });
  };
  if (page.width > 0 && page.height > 0) add(page, 'page');
  let n = 0;
  for (const x of slide.querySelectorAll('*')) {
    if (n >= MAX_CANDIDATES) break;
    if (x === el || el.contains(x) || SKIP.has(x.tagName)) continue;
    const r = x.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    if (r.right < page.left || r.left > page.right || r.bottom < page.top || r.top > page.bottom) continue;
    if (Math.abs(r.width - page.width) < 1 && Math.abs(r.height - page.height) < 1) continue; // 和整页一样大的背景层，已由页面边缘代表
    const cs = S.win.getComputedStyle(x);
    if (cs.display === 'inline' || cs.visibility === 'hidden' || cs.opacity === '0') continue; // 行内文字片段不参与，避免参考线太多太乱
    add(rectOf(r), 'el');
    n++;
  }
  const ss = slide.offsetWidth > 0 && sr.width > 0 ? sr.width / slide.offsetWidth : 1;
  st = { el, xs, ys, page, slideRect: sr, slideScale: ss };
  return st;
}

export function end() {
  st = null;
  if (layer) layer.innerHTML = '';
  if (badge) badge.hidden = true;
}

// 在候选线里找离 points 最近的一条（points 是元素上可以吸附的几个位置）
function nearest(lines, points, th) {
  let best = null;
  for (const p of points) {
    for (const l of lines) {
      const d = l.v - p;
      if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d) || (Math.abs(d) === Math.abs(best.d) && l.kind === 'page'))) best = { d, l };
    }
  }
  return best;
}

/**
 * 计算吸附后的偏移。
 * rect：移动后（尚未吸附）元素的位置；axes：{ x: [参与吸附的横向位置], y: [纵向位置] }，
 * 位置写成 'left' | 'cx' | 'right' / 'top' | 'cy' | 'bottom'。
 * 返回 { dx, dy }：需要再加上的修正量。
 */
export function snap(rect, axes, disabled) {
  if (!st || disabled) return { dx: 0, dy: 0 };
  const th = SNAP_PX / C.S.scale;
  const val = (k) => ({ left: rect.left, right: rect.right, cx: (rect.left + rect.right) / 2, top: rect.top, bottom: rect.bottom, cy: (rect.top + rect.bottom) / 2 })[k];
  const bx = axes.x && axes.x.length ? nearest(st.xs, axes.x.map(val), th) : null;
  const by = axes.y && axes.y.length ? nearest(st.ys, axes.y.map(val), th) : null;
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0 };
}

// 画参考线：凡是和元素当前位置重合的线都画出来（可能同时和多个元素对齐）
export function draw(rect, axes, disabled, mode) {
  if (!st || !layer) return;
  layer.innerHTML = '';
  const k = C.S.scale;
  if (!disabled) {
    const val = { left: rect.left, right: rect.right, cx: (rect.left + rect.right) / 2, top: rect.top, bottom: rect.bottom, cy: (rect.top + rect.bottom) / 2 };
    const eps = 0.5;
    const seenX = new Set();
    const seenY = new Set();
    for (const key of axes.x || []) {
      const v = val[key];
      const hits = st.xs.filter((l) => Math.abs(l.v - v) <= eps);
      if (!hits.length) continue;
      const id = Math.round(v * 2);
      if (seenX.has(id)) continue;
      seenX.add(id);
      const top = Math.min(rect.top, ...hits.map((l) => l.r.top));
      const bottom = Math.max(rect.bottom, ...hits.map((l) => l.r.bottom));
      line(v * k, top * k, 0, (bottom - top) * k, hits.some((l) => l.kind === 'page') ? 'page' : 'el', hits.every((l) => l.mid));
    }
    for (const key of axes.y || []) {
      const v = val[key];
      const hits = st.ys.filter((l) => Math.abs(l.v - v) <= eps);
      if (!hits.length) continue;
      const id = Math.round(v * 2);
      if (seenY.has(id)) continue;
      seenY.add(id);
      const left = Math.min(rect.left, ...hits.map((l) => l.r.left));
      const right = Math.max(rect.right, ...hits.map((l) => l.r.right));
      line(left * k, v * k, (right - left) * k, 0, hits.some((l) => l.kind === 'page') ? 'page' : 'el', hits.every((l) => l.mid));
    }
  }
  // 位置 / 尺寸标签：以页面左上角为原点，单位是页面自己的像素
  const ss = st.slideScale || 1;
  const sr = st.slideRect;
  badge.textContent = mode === 'resize'
    ? `${Math.round(rect.width / ss)} × ${Math.round(rect.height / ss)}`
    : `X ${Math.round((rect.left - sr.left) / ss)}  Y ${Math.round((rect.top - sr.top) / ss)}`;
  badge.title = mode === 'resize' ? t('g_size') : t('g_pos');
  badge.hidden = false;
  const bw = badge.offsetWidth;
  let bx = ((rect.left + rect.right) / 2) * k - bw / 2;
  let by = rect.bottom * k + 8;
  const ow = C.overlay.clientWidth;
  const oh = C.overlay.clientHeight;
  if (by + 24 > oh) by = rect.top * k - 30; // 下面放不下就放上面
  bx = Math.max(4, Math.min(ow - bw - 4, bx));
  badge.style.left = bx + 'px';
  badge.style.top = Math.max(4, by) + 'px';
}

function line(x, y, w, h, kind, mid) {
  const d = document.createElement('i');
  d.className = 'gl ' + (w ? 'gh' : 'gv') + ' g-' + kind + (mid ? ' g-mid' : '');
  d.style.left = x + 'px';
  d.style.top = y + 'px';
  if (w) d.style.width = w + 'px';
  else d.style.height = h + 'px';
  layer.appendChild(d);
}
