// 保存时把相对路径的外部资源（图片、样式、脚本、字体、音视频）合并进 HTML，让用户只面对一个文件
const decoder = new TextDecoder('utf-8');

function b64ToText(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return decoder.decode(bytes);
}

export async function inlineResources(html, baseHref) {
  const stat = { inlined: 0, missing: 0 };
  const cache = new Map();

  // 只处理指向本地文件的相对路径；网络地址、data:、锚点保持不变
  const resolve = (raw, base) => {
    if (!raw) return null;
    raw = raw.trim();
    if (!raw || raw.startsWith('#') || /^(data|blob|about|javascript|mailto|tel):/i.test(raw) || /^(https?:)?\/\//i.test(raw)) return null;
    try {
      const u = new URL(raw, base);
      return u.protocol === 'file:' ? u.href : null;
    } catch { return null; }
  };

  const read = async (url) => {
    const key = url.split('#')[0].split('?')[0];
    if (!cache.has(key)) cache.set(key, window.api.readResources([url]).then((r) => r[0]));
    const r = await cache.get(key);
    if (!r) stat.missing++;
    return r;
  };
  const dataUrl = async (raw, base) => {
    const url = resolve(raw, base);
    if (!url) return null;
    const r = await read(url);
    if (!r) return null;
    stat.inlined++;
    return `data:${r.mime};base64,${r.data}`;
  };

  async function replaceAsync(str, re, fn) {
    const parts = [];
    let last = 0;
    for (const m of str.matchAll(re)) {
      parts.push(str.slice(last, m.index), fn(m));
      last = m.index + m[0].length;
    }
    parts.push(str.slice(last));
    return (await Promise.all(parts)).join('');
  }

  async function inlineCss(css, base, depth = 0) {
    if (depth < 4) {
      css = await replaceAsync(css, /@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/g, async (m) => {
        const url = resolve(m[2], base);
        const r = url && (await read(url));
        if (!r) return m[0];
        stat.inlined++;
        return inlineCss(b64ToText(r.data), url, depth + 1);
      });
    }
    return replaceAsync(css, /url\(\s*(['"]?)(.*?)\1\s*\)/g, async (m) => {
      const d = await dataUrl(m[2], base);
      return d ? `url("${d}")` : m[0];
    });
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const base = (() => {
    const b = doc.querySelector('base[href]');
    try { return b ? new URL(b.getAttribute('href'), baseHref).href : baseHref; } catch { return baseHref; }
  })();
  const jobs = [];

  // 带 src / poster / href 的资源标签
  const attrJobs = [
    ['img[src], source[src], video[src], audio[src], track[src], input[type=image][src], embed[src]', 'src'],
    ['video[poster]', 'poster'],
    ['link[rel~=icon][href], link[rel=apple-touch-icon][href]', 'href'],
    ['image[href]', 'href'],
  ];
  for (const [sel, attr] of attrJobs) {
    doc.querySelectorAll(sel).forEach((el) =>
      jobs.push((async () => {
        const d = await dataUrl(el.getAttribute(attr), base);
        if (d) el.setAttribute(attr, d);
      })())
    );
  }

  // srcset
  doc.querySelectorAll('[srcset]').forEach((el) =>
    jobs.push((async () => {
      const items = el.getAttribute('srcset').split(',').map((s) => s.trim()).filter(Boolean);
      const out = await Promise.all(items.map(async (it) => {
        const [u, ...rest] = it.split(/\s+/);
        return [(await dataUrl(u, base)) || u, ...rest].join(' ');
      }));
      el.setAttribute('srcset', out.join(', '));
    })())
  );

  // 外链样式表 -> <style>
  doc.querySelectorAll('link[rel~=stylesheet][href]').forEach((el) =>
    jobs.push((async () => {
      const url = resolve(el.getAttribute('href'), base);
      const r = url && (await read(url));
      if (!r) return;
      stat.inlined++;
      const style = doc.createElement('style');
      const media = el.getAttribute('media');
      if (media) style.setAttribute('media', media);
      style.textContent = await inlineCss(b64ToText(r.data), url);
      el.replaceWith(style);
    })())
  );

  // 外链脚本 -> 内联脚本（ES module 脚本有相互引用，保持原样）
  doc.querySelectorAll('script[src]').forEach((el) =>
    jobs.push((async () => {
      if ((el.getAttribute('type') || '').toLowerCase() === 'module') return;
      const r = await (async () => { const u = resolve(el.getAttribute('src'), base); return u ? read(u) : null; })();
      if (!r) return;
      stat.inlined++;
      el.removeAttribute('src');
      el.textContent = b64ToText(r.data).replace(/<\/script/gi, '<\\/script');
    })())
  );

  // <style> 与 style="" 中的 url(...)
  doc.querySelectorAll('style').forEach((el) =>
    jobs.push((async () => { if (/url\(|@import/.test(el.textContent)) el.textContent = await inlineCss(el.textContent, base); })())
  );
  doc.querySelectorAll('[style*="url("]').forEach((el) =>
    jobs.push((async () => { el.setAttribute('style', await inlineCss(el.getAttribute('style'), base)); })())
  );

  await Promise.all(jobs);
  // 样式表被替换成 <style> 后，其中的 url 已在 inlineCss 中处理；这里不再二次处理
  const dt = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) + '\n' : '';
  return { html: dt + doc.documentElement.outerHTML, stat };
}
