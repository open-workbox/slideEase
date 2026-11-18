// 源文件处理：给每个元素打上稳定编号；保存时把编辑操作回放到“原始文档”上，
// 这样不会把页面脚本运行后产生的临时 DOM 写进用户文件。
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const ID = 'data-pe-id';

function serialize(doc) {
  const dt = doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) + '\n' : '';
  return dt + doc.documentElement.outerHTML;
}

export function prepare(sourceHtml, baseHref) {
  const doc = new DOMParser().parseFromString(sourceHtml, 'text/html');
  let n = 0;
  if (doc.body) {
    for (const el of [doc.body, ...doc.body.querySelectorAll('*')]) {
      if (SKIP.has(el.tagName)) continue;
      el.setAttribute(ID, 'e' + n++);
    }
  }
  const { notes, issues } = extractNotes(doc); // 必须在打完编号之后读取，才能把批注对应到元素编号
  const tagged = serialize(doc);
  neutralize(doc); // 以下只作用于编辑画面里的实时副本，不会写进用户文件
  // 仅用于预览：补上 <base>，让相对路径的图片/样式能正确加载
  if (baseHref && doc.head && !doc.querySelector('base[href]')) {
    const b = doc.createElement('base');
    b.href = baseHref;
    doc.head.prepend(b);
  }
  return { tagged, live: serialize(doc), notes, issues };
}


/* ---- 让网页自带的“禁用右键 / 禁止选择 / 禁止复制 / 禁止拖拽”脚本在编辑画面里失效 ----
   只处理编辑用的实时副本；保存的文件和“预览”都用原始内容，页面脚本照常工作。 */
const STRIP_ATTRS = ['oncontextmenu', 'onselectstart', 'ondragstart', 'oncopy', 'oncut', 'onpaste', 'onmousedown', 'onmouseup', 'onpointerdown', 'onpointerup'];
const BOOT = [
  '(function(){',
  'var deny={contextmenu:1,selectstart:1,dragstart:1,copy:1,cut:1};',
  // 页面注册这些事件的监听一律忽略；软件自己的监听带有 __se 标记，可以通过
  'try{var orig=EventTarget.prototype.addEventListener;',
  'EventTarget.prototype.addEventListener=function(t,f,o){',
  'if(Object.prototype.hasOwnProperty.call(deny,t)&&!(o&&typeof o==="object"&&o.__se))return;',
  'return orig.call(this,t,f,o);};}catch(e){}',
  // document.oncontextmenu = ... 之类的写法也让它不生效
  '["oncontextmenu","onselectstart","ondragstart","oncopy","oncut"].forEach(function(p){',
  '[window,Document.prototype,HTMLElement.prototype,SVGElement.prototype].forEach(function(o){',
  'try{Object.defineProperty(o,p,{configurable:true,get:function(){return null},set:function(){}});}catch(e){}',
  '});});',
  '})();',
].join('');

function neutralize(doc) {
  doc.querySelectorAll('*').forEach((el) => STRIP_ATTRS.forEach((a) => el.removeAttribute(a)));
  const s = doc.createElement('script');
  s.textContent = BOOT;
  (doc.head || doc.documentElement).prepend(s); // 放在最前面，早于页面自己的脚本
}
function setStyle(el, prop, v) {
  if (v) el.style.setProperty(prop, v, 'important');
  else el.style.removeProperty(prop);
}

export function applyOps(tagged, ops, notes, opts) {
  const doc = new DOMParser().parseFromString(tagged, 'text/html');
  const find = (id) => doc.querySelector(`[${ID}="${id}"]`);
  let failed = 0;
  for (const op of ops) {
    try {
      const el = op.id ? find(op.id) : null;
      switch (op.type) {
        case 'style': setStyle(el, op.prop, op.value); break;
        case 'html': el.innerHTML = op.value; break;
        case 'attr':
          if (op.value == null) el.removeAttribute(op.name);
          else el.setAttribute(op.name, op.value);
          break;
        case 'remove': el.remove(); break;
        case 'move': {
          const ref = find(op.refId);
          if (op.pos === 'after') ref.after(el);
          else ref.before(el);
          break;
        }
        case 'insert': {
          const parent = find(op.parentId);
          const tpl = doc.createElement('template');
          tpl.innerHTML = op.html;
          const next = op.nextId ? find(op.nextId) : null;
          parent.insertBefore(tpl.content.firstElementChild, next && next.parentNode === parent ? next : null);
          break;
        }
        case 'clone': {
          const src = find(op.srcId);
          const c = src.cloneNode(true);
          for (const e of [c, ...c.querySelectorAll(`[${ID}]`)]) {
            const nid = op.map[e.getAttribute(ID)];
            if (nid) e.setAttribute(ID, nid);
            else e.removeAttribute(ID);
          }
          src.after(c);
          break;
        }
      }
    } catch (e) {
      failed++;
    }
  }
  // 导出单页：删掉其它页；“一次只显示一页”的写法给保留的页加上显示用的类名
  if (opts && Array.isArray(opts.removeIds)) {
    for (const id of opts.removeIds) { const el = find(id); if (el) el.remove(); }
  }
  if (opts && opts.showId && opts.showClass) { const el = find(opts.showId); if (el) el.classList.add(opts.showClass); }
  if (Array.isArray(notes)) embedNotes(doc, notes); // 传入批注时才改写文件里的批注（预览不需要）
  doc.querySelectorAll(`[${ID}]`).forEach((e) => e.removeAttribute(ID));
  return { html: serialize(doc), failed };
}


/* ======================= 批注 =======================
   批注随 HTML 文件保存，由三部分组成：
   1) 元素上的标记属性  data-slideease-note="批注编号"（一个元素可有多条，空格分隔）
   2) 元素前的一条 HTML 注释：写给 AI/其他工具看，提醒“这是批注，请勿删除或当作页面内容”
   3) 文件末尾的 JSON 数据块：保存全部批注的完整内容
   打开文件时会检查这三者是否对得上，对不上就提醒用户（常见原因：用 AI 调整页面时被误删或改写）。 */
export const NOTE_ATTR = 'data-slideease-note';
const NOTE_DATA_ID = 'slideease-notes';
const MARK_RE = /^\s*SlideEase-note/; // 软件自己写入的注释都以此开头，保存时据此清理后重写
export const NOTE_STATUS = ['todo', 'doing', 'done'];
const STATUS_ZH = { todo: '待处理', doing: '处理中', done: '已完成' };

// 元素“指纹”：用于发现目标内容在软件之外被改动
export function fingerprint(el) {
  if (!el) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'img') return 'img:' + String(el.getAttribute('src') || '').slice(-40);
  if (tag === 'svg' || tag === 'canvas' || tag === 'video') return tag + ':' + el.getAttribute('id');
  return tag + ':' + (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanText(s, max) {
  // HTML 注释里不能出现 “--”，且不宜换行
  return String(s || '').replace(/\s+/g, ' ').replace(/-{2,}/g, '–').slice(0, max);
}

function idsOf(el) {
  return String(el.getAttribute(NOTE_ATTR) || '').split(/\s+/).filter(Boolean);
}

// 从已打好编号的文档里读出批注，并检查完整性
export function extractNotes(doc) {
  const issues = { orphan: 0, changed: 0, stray: 0, badJson: false };
  let data = null;
  const script = doc.querySelector(`script#${NOTE_DATA_ID}`);
  if (script) {
    try { data = JSON.parse(script.textContent); } catch { issues.badJson = true; }
  }
  const list = data && Array.isArray(data.notes) ? data.notes : [];
  const byId = new Map(); // 批注编号 -> 带标记的元素
  doc.querySelectorAll(`[${NOTE_ATTR}]`).forEach((el) => idsOf(el).forEach((id) => byId.set(id, el)));

  const notes = [];
  for (const n of list) {
    if (!n || typeof n.id !== 'string' || !/^[\w-]{1,40}$/.test(n.id)) continue;
    const note = {
      id: n.id,
      text: String(n.text || ''),
      status: NOTE_STATUS.includes(n.status) ? n.status : 'todo',
      created: Number(n.created) || Date.now(),
      updated: Number(n.updated) || Number(n.created) || Date.now(),
      fp: String(n.fp || ''),
      kind: String(n.kind || ''),
      quote: String(n.quote || '').slice(0, 200),
      summary: String(n.summary || ''),
      pid: null,
      state: 'ok',
    };
    const el = byId.get(n.id);
    if (!el) { note.state = 'orphan'; issues.orphan++; } // 数据在，但元素上的标记没了
    else {
      note.pid = el.getAttribute(ID);
      if (note.fp && fingerprint(el) !== note.fp) { note.state = 'changed'; issues.changed++; } // 元素还在，但内容变了
      byId.delete(n.id);
    }
    notes.push(note);
  }
  issues.stray = byId.size; // 元素上有标记，但数据块里没有对应内容（数据块被删了）
  return { notes, issues };
}

// 把批注写进文档：先清掉旧的，再按当前批注重新写入
export function embedNotes(doc, notes) {
  doc.querySelectorAll(`[${NOTE_ATTR}]`).forEach((e) => e.removeAttribute(NOTE_ATTR));
  doc.querySelectorAll(`script#${NOTE_DATA_ID}`).forEach((e) => e.remove());
  const walker = doc.createTreeWalker(doc, 128 /* SHOW_COMMENT */);
  const dead = [];
  while (walker.nextNode()) if (MARK_RE.test(walker.currentNode.data)) dead.push(walker.currentNode);
  dead.forEach((n) => n.remove());
  if (!notes.length || !doc.body) return;

  const out = [];
  for (const n of notes) {
    const el = n.pid ? doc.querySelector(`[${ID}="${n.pid}"]`) : null;
    const rec = {
      id: n.id, text: n.text, status: n.status, created: n.created, updated: n.updated,
      kind: n.kind, summary: n.summary, quote: n.quote || '', fp: n.fp,
    };
    if (el) {
      rec.fp = fingerprint(el); // 以保存时的内容为准，下次打开若不一致说明被软件之外的工具改过
      const ids = idsOf(el);
      ids.push(n.id);
      el.setAttribute(NOTE_ATTR, ids.join(' '));
      el.before(doc.createComment(
        ` SlideEase-note ${n.id} [${STATUS_ZH[n.status] || n.status}] ${cleanText(n.text, 80)}${n.quote ? ` (针对文字：${cleanText(n.quote, 40)})` : ''} | ` +
        '这是用户用 SlideEase 添加的批注标记，不属于页面内容。调整页面时请原样保留本注释和下方元素上的 data-slideease-note 属性，' +
        '不要删除、改写，也不要当作页面文字处理。(User annotation made with SlideEase, not page content. Keep this comment and the data-slideease-note attribute unchanged.) '
      ));
    }
    out.push(rec);
  }
  const json = JSON.stringify({ version: 1, notes: out }).replace(/</g, '\\u003c'); // 避免内容里的 </script> 或 <!-- 破坏页面
  doc.body.appendChild(doc.createTextNode('\n'));
  doc.body.appendChild(doc.createComment(
    ' SlideEase-notes-data 以下是 SlideEase 的批注数据，保存着本文档全部批注，与元素上的 data-slideease-note 属性一一对应。' +
    '调整页面时请原样保留，不要删除或改写。(SlideEase annotation data. Keep unchanged.) '
  ));
  doc.body.appendChild(doc.createTextNode('\n'));
  const script = doc.createElement('script');
  script.type = 'application/json';
  script.id = NOTE_DATA_ID;
  script.textContent = json;
  doc.body.appendChild(script);
  doc.body.appendChild(doc.createTextNode('\n'));
}

