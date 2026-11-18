// 幻灯片识别与切换：尽量兼容各种 AI 生成的结构（reveal.js、.slide 容器、整页滚动等）
const ACTIVE_CLASSES = ['active', 'present', 'current', 'is-active', 'is-current', 'show', 'visible', 'selected'];
const IGNORE_TAGS = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'META']);
const SELECTORS = [
  '.reveal .slides section', '.swiper-slide', 'section.slide', '.slide', '[data-slide]',
  '.slides > *', '.ppt-slide', '.page', '.step', 'section',
];

const leafOnly = (els) => els.filter((e) => !els.some((o) => o !== e && e.contains(o)));

export function detectSlides(doc, win) {
  for (const sel of SELECTORS) {
    let list;
    try { list = leafOnly([...doc.querySelectorAll(sel)]); } catch { continue; }
    list = list.filter((e) => !IGNORE_TAGS.has(e.tagName));
    if (list.length >= 2) return list;
  }
  // 结构兜底：找出若干个高度接近整屏的同级块
  let c = doc.body;
  for (let d = 0; d < 3; d++) {
    const kids = [...c.children].filter((k) => !IGNORE_TAGS.has(k.tagName));
    if (kids.length === 1) c = kids[0]; else break;
  }
  const kids = [...c.children].filter((k) => !IGNORE_TAGS.has(k.tagName));
  const vh = win.innerHeight;
  const big = kids.filter((k) => k.getBoundingClientRect().height >= vh * 0.5);
  if (big.length >= 2 && big.length >= kids.length * 0.6) return big;
  // 一次只显示一页的写法：同级同类元素，其中一页可见，其余被隐藏
  const sig = (k) => k.tagName + '.' + [...k.classList].filter((x) => !ACTIVE_CLASSES.includes(x)).sort().join('.');
  const groups = new Map();
  kids.forEach((k) => groups.set(sig(k), [...(groups.get(sig(k)) || []), k]));
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const visibleBig = g.filter((k) => k.getBoundingClientRect().height >= vh * 0.5).length;
    const hidden = g.filter((k) => k.getClientRects().length === 0).length;
    if (visibleBig >= 1 && visibleBig + hidden === g.length) return g;
  }
  return [doc.body];
}

export function analyze(slides, win) {
  if (slides.length < 2) return { kind: 'single' };
  if (win.Reveal && typeof win.Reveal.slide === 'function' && slides[0].closest('.reveal')) return { kind: 'reveal' };
  const hidden = slides.filter((s) => win.getComputedStyle(s).display === 'none' || s.getClientRects().length === 0).length;
  const rects = slides.map((s) => s.getBoundingClientRect()).filter((r) => r.width > 0);
  const overlap = rects.length > 1 && rects.slice(1).some((r) => Math.abs(r.top - rects[0].top) < 2 && Math.abs(r.left - rects[0].left) < 2);
  if (hidden > 0 || overlap) {
    let activeClass = null;
    for (const c of ACTIVE_CLASSES) {
      const n = slides.filter((s) => s.classList.contains(c)).length;
      if (n >= 1 && n < slides.length) { activeClass = c; break; }
    }
    return { kind: 'exclusive', activeClass };
  }
  return { kind: 'scroll' };
}

export const STYLE_CSS = `
[data-pe-hide]{display:none !important}
[data-pe-cur]{opacity:1 !important;visibility:visible !important}
[data-pe-disp]{display:block !important}
*{caret-color:auto}
*{-webkit-user-select:text !important;user-select:text !important}
::highlight(pe-find){background-color:#ffe066;color:#000}
::highlight(pe-find-cur){background-color:#ff9f43;color:#000}
`;

export function clearMarks(slides) {
  slides.forEach((s) => ['data-pe-hide', 'data-pe-cur', 'data-pe-disp'].forEach((a) => s.removeAttribute(a)));
}

export function showSlide(slides, info, win, i) {
  const s = slides[i];
  if (!s || info.kind === 'single') return;
  if (info.kind === 'reveal') {
    try {
      const idx = win.Reveal.getIndices(s);
      win.Reveal.slide(idx.h, idx.v, idx.f);
    } catch { /* 忽略 */ }
  } else if (info.kind === 'scroll') {
    s.scrollIntoView({ block: 'start', inline: 'start', behavior: 'instant' }); // 无视页面 CSS 的平滑滚动
  } else if (info.kind === 'exclusive') {
    slides.forEach((x) => {
      x.removeAttribute('data-pe-cur');
      x.removeAttribute('data-pe-disp');
      x.toggleAttribute('data-pe-hide', x !== s);
      if (info.activeClass) x.classList.toggle(info.activeClass, x === s);
    });
    s.setAttribute('data-pe-cur', '');
    if (win.getComputedStyle(s).display === 'none') s.setAttribute('data-pe-disp', '');
  }
}

export function slideTitle(el) {
  const h = el.querySelector('h1,h2,h3,h4');
  const txt = ((h && h.textContent) || el.textContent || '').replace(/\s+/g, ' ').trim();
  return txt.length > 26 ? txt.slice(0, 26) + '…' : txt;
}


