// 主进程：窗口、文件读写、对话框、缩略图截图
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, Menu, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const history = require('./history');
const analytics = require('./analytics');
const updater = require('./updater');

let win = null;
let docDir = null; // 当前文档所在目录；只允许读取该目录内的相对资源
let pendingFile = null; // 通过“用 SlideEase 打开”启动时传入的文件
const MAX_RES = 60 * 1024 * 1024;
const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4', webm: 'video/webm', ogg: 'audio/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', json: 'application/json',
};
let currentPath = null; // 只允许写入用户通过对话框选择过的文件
let dirty = false;
let forceClose = false;
let lang = 'zh';
const backedUp = new Set();

const TEXT = {
  zh: { unsaved: '当前文档有未保存的修改，要保存吗？', save: '保存', discard: '不保存', cancel: '取消', htmlFiles: 'HTML 文件', images: '图片', allFiles: '所有文件', pngFiles: 'PNG 图片', exportDir: '选择导出到的文件夹', tutorialName: 'SlideEase 使用教程.html' },
  en: { unsaved: 'You have unsaved changes. Save them?', save: 'Save', discard: "Don't Save", cancel: 'Cancel', htmlFiles: 'HTML files', images: 'Images', allFiles: 'All files', pngFiles: 'PNG images', exportDir: 'Choose a folder to export to', tutorialName: 'SlideEase Tutorial.html' },
};
const tr = (k) => TEXT[lang][k];

function readDoc(p) {
  let content = fs.readFileSync(p, 'utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  currentPath = p;
  docDir = path.dirname(p);
  let hist = null;
  try { hist = history.open(p, content); } catch { /* 记录功能出错不影响打开文件 */ }
  addRecent(p);
  return {
    path: p,
    name: path.basename(p),
    content,
    baseHref: pathToFileURL(path.dirname(p) + path.sep).href,
    history: hist,
  };
}

/* ---------- 最近打开的文件（存软件数据目录，不含文件内容） ---------- */
const RECENT_MAX = 12;
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
function readRecent() {
  try {
    const list = JSON.parse(fs.readFileSync(recentFile(), 'utf8'));
    return Array.isArray(list) ? list.filter((r) => r && typeof r.path === 'string') : [];
  } catch { return []; }
}
function writeRecent(list) {
  try { fs.writeFileSync(recentFile(), JSON.stringify(list.slice(0, RECENT_MAX))); } catch { /* 忽略 */ }
}
function addRecent(p) {
  const abs = path.resolve(p);
  let list = readRecent().filter((r) => path.resolve(r.path) !== abs);
  list.unshift({ path: abs, name: path.basename(abs), time: Date.now() });
  writeRecent(list);
}
// 返回时标出文件是否仍然存在，供界面灰显
ipcMain.handle('recent:list', () => readRecent().map((r) => ({ ...r, exists: fs.existsSync(r.path) })));
ipcMain.handle('recent:remove', (_e, p) => {
  if (typeof p !== 'string') return readRecent();
  const abs = path.resolve(p);
  const list = readRecent().filter((r) => path.resolve(r.path) !== abs);
  writeRecent(list);
  return list.map((r) => ({ ...r, exists: fs.existsSync(r.path) }));
});
// 打开最近文件：校验路径合法且存在后再读取
ipcMain.handle('recent:open', (_e, p) => {
  if (typeof p !== 'string' || !isHtml(p) || !fs.existsSync(p)) {
    const list = readRecent().filter((r) => path.resolve(r.path) !== path.resolve(p || ''));
    writeRecent(list);
    return { error: 'missing', records: list.map((r) => ({ ...r, exists: false })) };
  }
  return { doc: readDoc(p) };
});

function isHtml(p) {
  return /\.(html?|xhtml)$/i.test(p);
}

function writeWithBackup(p, content) {
  // 首次覆盖原文件前，自动留一份备份，防止误改
  if (!backedUp.has(p) && fs.existsSync(p)) {
    const ext = path.extname(p);
    const bak = p.slice(0, -ext.length) + '.backup' + ext;
    if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
    backedUp.add(p);
  }
  fs.writeFileSync(p, content, 'utf8');
}


/* ---------- 加载浮层：独立的视图层 ----------
   做成与主页面分离的 WebContentsView，盖在窗口最上层用来阻断操作；
   而缩略图是对主页面取像素，不会拍到这一层。 */
const LOADING_HTML = `<!DOCTYPE html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;cursor:progress;user-select:none;font:13px "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center}
body.full{background:rgba(243,244,246,.9)}
.pill{display:flex;align-items:center;gap:10px;padding:10px 18px;background:#fff;border:1px solid #e2e5ea;border-radius:999px;box-shadow:0 4px 16px rgba(20,30,60,.14);color:#1f2430}
.spin{width:16px;height:16px;border:2px solid #e8ecfd;border-top-color:#4f6bed;border-radius:50%;animation:s .8s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}
</style><div class="pill"><i class="spin"></i><span id="t"></span></div>
<script>window.setLoading=function(mode,text){document.body.className=mode;document.getElementById('t').textContent=text}</script>`;
let loadingView = null;
let loadingReady = null;

function ensureLoadingView() {
  if (loadingView) return;
  loadingView = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true } });
  loadingView.setBackgroundColor('#00000000');
  loadingReady = new Promise((r) => loadingView.webContents.once('did-finish-load', r));
  loadingView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML));
}
function layoutLoading() {
  if (!loadingView || !win) return;
  const [w, h] = win.getContentSize();
  loadingView.setBounds({ x: 0, y: 0, width: w, height: h });
}
ipcMain.on('loading:set', async (_e, arg) => {
  if (!win) return;
  const mode = arg && arg.mode;
  if (!mode) {
    if (loadingView) { try { win.contentView.removeChildView(loadingView); } catch { /* 未添加 */ } }
    win.webContents.focus();
    return;
  }
  ensureLoadingView();
  win.contentView.addChildView(loadingView); // 再次添加会把它提到最上层
  layoutLoading();
  await loadingReady;
  loadingView.webContents.executeJavaScript(`window.setLoading(${JSON.stringify(String(mode))}, ${JSON.stringify(String(arg.text || ''))})`).catch(() => {});
});
function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 600,
    backgroundColor: '#f3f4f6',
    title: 'SlideEase',
    icon: path.join(__dirname, 'build', 'icon.png'), // 运行时任务栏/窗口图标
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), process.env.SLIDEEASE_TEST ? { query: { test: '1' } } : undefined);

  win.webContents.setVisualZoomLevelLimits(1, 1); // 禁用整窗口的捏合缩放，由应用自己控制画布缩放

  win.on('resize', layoutLoading);

  win.on('close', (e) => {
    if (!dirty || forceClose) return;
    e.preventDefault();
    const r = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: [tr('save'), tr('discard'), tr('cancel')],
      defaultId: 0,
      cancelId: 2,
      message: tr('unsaved'),
    });
    if (r === 0) win.webContents.send('app:save-then-close');
    else if (r === 1) {
      try { history.discard(); } catch { /* 忽略 */ } // 不保存：同时清掉本次的修改记录
      forceClose = true;
      win.close();
    }
  });
}

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: tr('htmlFiles'), extensions: ['html', 'htm'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDoc(r.filePaths[0]);
});

// 内置的使用教程：只读取软件自带的文件，不记入“最近打开”，也不建立修改记录
ipcMain.handle('tutorial:read', () => {
  const p = path.join(__dirname, 'renderer', 'tutorial', 'tutorial.html');
  try {
    return { name: tr('tutorialName'), content: fs.readFileSync(p, 'utf8'), baseHref: pathToFileURL(path.dirname(p) + path.sep).href, tutorial: true };
  } catch { return null; }
});
// 打开了一份不对应磁盘文件的文档（如教程）：断开当前文件，之后“保存”会改为另存为，不会覆盖软件自带文件或之前打开的文件
ipcMain.on('doc:detach', () => { currentPath = null; });

ipcMain.handle('file:openPath', async (_e, p) => {
  if (typeof p !== 'string' || !isHtml(p) || !fs.existsSync(p)) return null;
  return readDoc(p);
});

ipcMain.handle('file:save', async (_e, content) => {
  if (typeof content !== 'string') return null;
  if (!currentPath) return saveAs(content);
  content = history.prepareSave(content);
  writeWithBackup(currentPath, content);
  let rec = null;
  try { rec = history.saved(content, currentPath); } catch { /* 忽略 */ }
  return { path: currentPath, name: path.basename(currentPath), rec };
});

async function saveAs(content) {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: currentPath || 'slides.html',
    filters: [{ name: tr('htmlFiles'), extensions: ['html'] }],
  });
  if (r.canceled || !r.filePath) return null;
  let p = r.filePath;
  if (!isHtml(p)) p += '.html';
  content = history.prepareSave(content);
  fs.writeFileSync(p, content, 'utf8');
  currentPath = p;
  let rec = null;
  try { rec = history.saved(content, p); } catch { /* 忽略 */ }
  return { path: p, name: path.basename(p), rec };
}

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  platform: `${process.platform} ${process.arch}`,
}));

// 调试记录：仅当用 SLIDEEASE_DEBUG=1 启动时才开启，把鼠标/选区相关的事件写进项目根目录的 debug-input.log
const DEBUG_LOG = path.join(__dirname, 'debug-input.log');
if (process.env.SLIDEEASE_DEBUG) { try { fs.writeFileSync(DEBUG_LOG, ''); } catch { /* 忽略 */ } }
ipcMain.handle('debug:enabled', () => !!process.env.SLIDEEASE_DEBUG);
ipcMain.on('debug:log', (_e, line) => {
  if (!process.env.SLIDEEASE_DEBUG || typeof line !== 'string') return;
  try { fs.appendFileSync(DEBUG_LOG, new Date().toISOString().slice(11, 23) + ' ' + line.slice(0, 400) + '\n'); } catch { /* 忽略 */ }
});

ipcMain.on('clipboard:write', (_e, text) => { if (typeof text === 'string') clipboard.writeText(text.slice(0, 1000000)); });

ipcMain.on('history:append', (_e, rec) => { try { history.append(rec); } catch { /* 忽略 */ } });
ipcMain.handle('history:snap', (_e, h) => history.getSnap(h));
ipcMain.handle('history:blob', (_e, h) => history.getBlob(h));
ipcMain.handle('history:discard', (_e, id) => history.discard(typeof id === 'string' ? id : undefined));
ipcMain.handle('history:clear', () => history.clear());
ipcMain.handle('file:saveAs', (_e, content) => (typeof content === 'string' ? saveAs(content) : null));

ipcMain.handle('image:pick', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: tr('images'), extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
});

// 读取文档目录内的相对资源，保存时合并进单个 HTML
ipcMain.handle('res:read', (_e, urls) =>
  (Array.isArray(urls) ? urls : []).map((u) => {
    try {
      if (!docDir) return null;
      const url = new URL(u);
      if (url.protocol !== 'file:') return null;
      url.hash = '';
      url.search = '';
      const p = fileURLToPath(url);
      const rel = path.relative(docDir, p);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
      const st = fs.statSync(p);
      if (!st.isFile() || st.size > MAX_RES) return null;
      const ext = path.extname(p).slice(1).toLowerCase();
      return { mime: MIME[ext] || 'application/octet-stream', data: fs.readFileSync(p).toString('base64') };
    } catch {
      return null;
    }
  })
);

ipcMain.handle('app:get-pending', () => {
  const p = pendingFile;
  pendingFile = null;
  return p && fs.existsSync(p) ? readDoc(p) : null;
});

// 预览（放映）：把当前编辑结果放进一个全屏窗口里，脚本照常运行，便于按 AI 原本的交互放映
let previewWin = null;
ipcMain.handle('preview:open', (_e, html, opts) => {
  if (typeof html !== 'string') return;
  if (previewWin && !previewWin.isDestroyed()) previewWin.close();
  previewWin = new BrowserWindow({
    parent: win,
    fullscreen: true,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  previewWin.setMenuBarVisibility(false);
  previewWin.webContents.setVisualZoomLevelLimits(1, 1); // 由脚本自己用 CSS zoom 控制，禁用整窗捏合
  // 把放映用的辅助脚本（Esc 退出、方向键/点击翻页、顶部提示）注入到用户 HTML 末尾
  const lang = opts && opts.lang === 'en' ? 'en' : 'zh';
  const index = opts && Number.isInteger(opts.index) ? opts.index : 0;
  const inject = buildPreviewScript(lang, index);
  let out = html;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, inject + '</body>');
  else out += inject;
  previewWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(out));
  previewWin.once('ready-to-show', () => previewWin.show());
  previewWin.on('closed', () => { previewWin = null; });
});

function buildPreviewScript(lang, index) {
  // 顶部提示里把 Esc 高亮；{ESC} 占位在脚本里替换成带样式的 <b>
  const tipHtml = lang === 'en'
    ? 'Press {ESC} to exit preview'
    : '按 {ESC} 退出预览';
  // 这段脚本在预览窗口内运行；用启发式方式识别幻灯片并逐页放映，兼容多数 AI 生成结构
  return `<script>(function(){
  var SEL=['.reveal .slides section','.swiper-slide','section.slide','.slide','[data-slide]','.slides>*','.ppt-slide','.page','.step','section'];
  function leaf(a){return a.filter(function(e){return !a.some(function(o){return o!==e&&e.contains(o)})})}
  function find(){for(var i=0;i<SEL.length;i++){try{var l=leaf([].slice.call(document.querySelectorAll(SEL[i]))).filter(function(e){return !/^(SCRIPT|STYLE|LINK|META)$/.test(e.tagName)});if(l.length>=2)return l}catch(e){}}return []}
  var slides=find(),cur=${index}||0,nativeReveal=window.Reveal&&typeof window.Reveal.slide==='function';
  // 判断是不是“一次只显示一页”的结构：有页面被隐藏，或多页重叠在同一位置
  var exclusive=nativeReveal||slides.some(function(o){return getComputedStyle(o).display==='none'||!o.getClientRects().length});
  if(!exclusive&&slides.length>1){var r0=slides[0].getBoundingClientRect();exclusive=slides.slice(1).some(function(o){var r=o.getBoundingClientRect();return Math.abs(r.top-r0.top)<2&&Math.abs(r.left-r0.left)<2})}
  function show(i){if(!slides.length)return;cur=Math.max(0,Math.min(slides.length-1,i));var s=slides[cur];
    if(nativeReveal){try{var x=window.Reveal.getIndices(s);window.Reveal.slide(x.h,x.v,x.f);return}catch(e){}}
    slides.forEach(function(o){o.__d=o.__d||o.style.display;o.style.display=o===s?(o.__d&&o.__d!=='none'?o.__d:'block'):'none'})}
  if(exclusive&&slides.length>1&&!nativeReveal)show(cur);

  // ---- 缩放：触摸板捏合（ctrl+wheel）与 Ctrl/⌘ +、-、0；用 CSS zoom 整体缩放 ----
  var zoom=1;
  function applyZoom(z){zoom=Math.min(4,Math.max(0.25,z));document.documentElement.style.zoom=zoom;showZoomTip()}
  var zt,ztEl;
  function showZoomTip(){
    if(!ztEl){ztEl=document.createElement('div');
      ztEl.style.cssText='position:fixed;right:20px;bottom:20px;z-index:2147483647;background:rgba(20,24,32,.82);color:#fff;font:13px system-ui,"Microsoft YaHei";padding:7px 14px;border-radius:999px;pointer-events:none;transition:opacity .4s';
      document.documentElement.appendChild(ztEl)}
    ztEl.textContent=Math.round(zoom*100)+'%';ztEl.style.opacity='1';
    clearTimeout(zt);zt=setTimeout(function(){ztEl.style.opacity='0'},3000);
  }
  window.addEventListener('wheel',function(e){if(!e.ctrlKey&&!e.metaKey)return;e.preventDefault();applyZoom(zoom*Math.exp(-e.deltaY*0.01))},{passive:false});

  document.addEventListener('keydown',function(e){
    var mod=e.ctrlKey||e.metaKey,k=e.key;
    if(k==='Escape'){window.close()}
    else if(mod&&(k==='='||k==='+')){e.preventDefault();applyZoom(zoom*1.1)}
    else if(mod&&(k==='-'||k==='_')){e.preventDefault();applyZoom(zoom/1.1)}
    else if(mod&&k==='0'){e.preventDefault();applyZoom(1)}
    else if(exclusive&&(k==='ArrowRight'||k==='PageDown'||k===' ')){e.preventDefault();show(cur+1)}
    else if(exclusive&&(k==='ArrowLeft'||k==='PageUp')){e.preventDefault();show(cur-1)}
    else if(exclusive&&k==='Home'){e.preventDefault();show(0)}
    else if(exclusive&&k==='End'){e.preventDefault();show(slides.length-1)}},true);
  // 只有“一次一页”的放映才用点击翻页；滚动式长页面保持正常滚动，不劫持点击
  if(exclusive)document.addEventListener('click',function(e){if(e.target.closest('a,button,input,select,textarea'))return;show(cur+(e.clientX<innerWidth*0.3?-1:1))},true);

  var tip=document.createElement('div');tip.innerHTML=${JSON.stringify(tipHtml)}.replace('{ESC}','<b style="color:#ffd34d;font-weight:700">Esc</b>');
  tip.style.cssText='position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#000;color:#fff;font:14px system-ui,"Microsoft YaHei";text-align:center;padding:10px 16px;pointer-events:none;transition:opacity .5s';
  document.documentElement.appendChild(tip);setTimeout(function(){tip.style.opacity='0'},10000);
})();</script>`;
}

// 导出图片：截取编辑画面里的页面区域，按指定宽度输出 PNG。
// 用 DevTools 协议截图，可以按比屏幕显示更高的分辨率重新绘制，图片清晰。
ipcMain.handle('export:shot', async (_e, rect, width) => {
  if (!win || !rect || ![rect.x, rect.y, rect.width, rect.height, width].every((v) => Number.isFinite(v)) || rect.width <= 0 || rect.height <= 0) return null;
  width = Math.max(64, Math.min(7680, Math.round(width)));
  const dbg = win.webContents.debugger;
  let attached = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
    const r = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: width / rect.width },
      captureBeyondViewport: true,
    });
    let img = nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
    if (img.isEmpty()) return null;
    // 统一成 16:9 的指定尺寸（高分屏或取整造成的 1~2 像素误差在这里抹平）
    const height = Math.round((width * 9) / 16);
    const sz = img.getSize();
    if (sz.width !== width || sz.height !== height) img = img.resize({ width, height, quality: 'best' });
    return img.toPNG();
  } catch {
    return null;
  } finally {
    if (attached) { try { dbg.detach(); } catch { /* 忽略 */ } }
  }
});

// 导出文件：一个文件弹“另存为”；多个文件先选文件夹，再逐个写入（重名时自动加序号，不覆盖已有文件）
ipcMain.handle('export:save', async (_e, items, kind) => {
  if (!win || !Array.isArray(items) || !items.length || items.length > 500) return null;
  const isPng = kind === 'png';
  const ext = isPng ? '.png' : '.html';
  const clean = (n) => (String(n || 'slide').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'slide');
  const named = items.map((it) => {
    const base = clean(it && it.name);
    return base.toLowerCase().endsWith(ext) ? base : base + ext;
  });
  for (const it of items) if (!it || !(typeof it.data === 'string' || it.data instanceof Uint8Array)) return null;
  const baseDir = currentPath ? path.dirname(currentPath) : app.getPath('documents');
  const filters = [{ name: isPng ? tr('pngFiles') : tr('htmlFiles'), extensions: [ext.slice(1)] }];
  let targets;
  if (items.length === 1) {
    const r = await dialog.showSaveDialog(win, { defaultPath: path.join(baseDir, named[0]), filters });
    if (r.canceled || !r.filePath) return null;
    targets = [r.filePath];
  } else {
    const r = await dialog.showOpenDialog(win, { title: tr('exportDir'), defaultPath: baseDir, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    const used = new Set();
    targets = named.map((n) => {
      const stem = n.slice(0, -ext.length);
      let p = path.join(dir, n);
      for (let k = 2; fs.existsSync(p) || used.has(p.toLowerCase()); k++) p = path.join(dir, `${stem} (${k})${ext}`);
      used.add(p.toLowerCase());
      return p;
    });
  }
  try {
    items.forEach((it, i) => fs.writeFileSync(targets[i], typeof it.data === 'string' ? it.data : Buffer.from(it.data)));
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
  return { count: targets.length };
});

/* ---------- 后台生成缩略图 ----------
   打开文件后，在一个看不见的窗口里加载同一份页面，逐页切换并截图，结果一张张发回编辑界面。
   编辑界面不用等，也不用来回翻页；用户可以立刻开始编辑。 */
let thumbJob = null; // { id, win, file }
function stopThumbJob() {
  const j = thumbJob;
  thumbJob = null;
  if (!j) return;
  try { if (j.win && !j.win.isDestroyed()) j.win.destroy(); } catch { /* 忽略 */ }
  try { if (j.file) fs.rmSync(j.file, { force: true }); } catch { /* 忽略 */ }
}
// 在后台窗口里显示第 n 页（和编辑界面的切页方式一致）
const THUMB_SHOW = `(function(id, kind, activeClass){
  var all = window.__seSlides || (window.__seSlides = window.__seIds.map(function(x){ return document.querySelector('[data-pe-id="' + x + '"]'); }));
  var s = document.querySelector('[data-pe-id="' + id + '"]');
  if (!s) return false;
  if (kind === 'reveal' && window.Reveal && window.Reveal.slide) { try { var ix = window.Reveal.getIndices(s); window.Reveal.slide(ix.h, ix.v, ix.f); } catch (e) {} }
  else if (kind === 'scroll') { s.scrollIntoView({ block: 'start', inline: 'start', behavior: 'instant' }); }
  else if (kind === 'exclusive') {
    all.forEach(function(x){ if (!x) return; if (activeClass) x.classList.toggle(activeClass, x === s);
      if (x === s) { x.style.removeProperty('display'); x.style.setProperty('opacity', '1', 'important'); x.style.setProperty('visibility', 'visible', 'important'); }
      else x.style.setProperty('display', 'none', 'important'); });
    if (getComputedStyle(s).display === 'none') s.style.setProperty('display', 'block', 'important');
  }
  return true;
})`;
ipcMain.handle('thumbs:start', async (_e, job) => {
  stopThumbJob();
  if (!win || !job || typeof job.html !== 'string' || !Array.isArray(job.ids) || !job.ids.length || job.ids.length > 1000) return false;
  const ids = job.ids.filter((x) => typeof x === 'string' && /^[\w-]{1,40}$/.test(x));
  const kind = ['reveal', 'scroll', 'exclusive', 'single'].includes(job.kind) ? job.kind : 'scroll';
  const activeClass = typeof job.activeClass === 'string' && /^[\w-]{1,40}$/.test(job.activeClass) ? job.activeClass : '';
  const me = { id: job.jobId, win: null, file: path.join(app.getPath('temp'), `slideease-thumbs-${process.pid}-${Date.now()}.html`) };
  thumbJob = me;
  const alive = () => thumbJob === me && me.win && !me.win.isDestroyed() && win && !win.isDestroyed();
  try {
    // 写成临时文件再加载：页面里的相对路径资源（图片、样式）仍按原文件所在目录读取
    fs.writeFileSync(me.file, job.html, 'utf8');
    me.win = new BrowserWindow({
      show: false, width: 1920, height: 1080, useContentSize: true, frame: false, skipTaskbar: true, focusable: false,
      webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, devTools: false },
    });
    me.win.webContents.setAudioMuted(true);
    me.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); // 页面脚本不能弹新窗口
    me.win.webContents.on('will-navigate', (ev) => ev.preventDefault()); // 也不能跳走
    me.win.webContents.setFrameRate(30);
    await me.win.loadFile(me.file);
    if (!alive()) return false;
    await me.win.webContents.insertCSS('::-webkit-scrollbar{width:0!important;height:0!important}'); // 截图里不要出现滚动条
    await me.win.webContents.executeJavaScript(`window.__seIds = ${JSON.stringify(ids)}; (document.fonts ? document.fonts.ready : Promise.resolve()).then(function(){ return 1; })`);
    await new Promise((r) => setTimeout(r, 600)); // 等页面自己的脚本、动画初始化完
    for (let i = 0; i < ids.length; i++) {
      if (!alive()) return false;
      const ok = await me.win.webContents.executeJavaScript(`${THUMB_SHOW}(${JSON.stringify(ids[i])}, ${JSON.stringify(kind)}, ${JSON.stringify(activeClass)})`).catch(() => false);
      await new Promise((r) => setTimeout(r, kind === 'reveal' ? 350 : 160)); // 等切页后的绘制（reveal 有切换动画）
      if (!alive()) return false;
      let url = null;
      if (ok) {
        try {
          const img = await me.win.webContents.capturePage();
          if (!img.isEmpty()) url = img.resize({ width: 320, quality: 'good' }).toDataURL();
        } catch { /* 这一页截图失败，编辑界面翻到它时会再截 */ }
      }
      if (alive()) win.webContents.send('thumbs:one', { jobId: me.id, id: ids[i], url, done: i + 1, total: ids.length });
    }
    return true;
  } catch {
    return false;
  } finally {
    if (thumbJob === me) stopThumbJob();
  }
});
ipcMain.on('thumbs:stop', () => stopThumbJob());
app.on('before-quit', stopThumbJob);

ipcMain.handle('capture', async (_e, rect) => {
  if (!win) return null;
  try {
    const img = await win.webContents.capturePage(rect);
    if (img.isEmpty()) return null;
    return img.resize({ width: 320, quality: 'good' }).toDataURL();
  } catch {
    return null; // 窗口被遮挡/最小化时截图可能失败，保留旧缩略图
  }
});

ipcMain.on('app:state', (_e, s) => {
  dirty = !!s.dirty;
  if (s.lang === 'zh' || s.lang === 'en') lang = s.lang;
  if (win) win.setTitle(`${dirty ? '● ' : ''}${s.name ? s.name + ' - ' : ''}SlideEase`);
});

ipcMain.on('app:close-now', () => {
  forceClose = true;
  if (win) win.close();
});

// 文件关联：双击 .html/.htm 或“打开方式”启动时，取出命令行里的文件路径
function findHtmlArg(argv) {
  return argv.slice(1).find((a) => !a.startsWith('-') && isHtml(a) && fs.existsSync(a)) || null;
}
function openExternal(p) {
  if (!p || !fs.existsSync(p)) return;
  if (win && !win.webContents.isLoading()) {
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send('app:open-doc', readDoc(p));
  } else pendingFile = p;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => openExternal(findHtmlArg(argv)));
  app.on('open-file', (e, p) => { e.preventDefault(); openExternal(p); }); // macOS
  pendingFile = findHtmlArg(process.argv);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  analytics.init();
  analytics.capture('app_opened'); // 只记“软件启动”，不含任何用户内容
  createWindow();
  // 启动后台检查更新；有新版时通知渲染层提示，用户自行下载
  setTimeout(async () => {
    try {
      const info = await updater.check();
      if (info && win && !win.isDestroyed()) win.webContents.send('update:available', info);
    } catch { /* 忽略 */ }
  }, 4000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { analytics.shutdown(); });

// 功能使用统计（仅事件名，无用户内容）
ipcMain.on('track', (_e, event) => { if (typeof event === 'string' && /^[\w.]{1,40}$/.test(event)) analytics.capture(event); });
ipcMain.handle('update:check', () => updater.check());
ipcMain.handle('update:open', (_e, url) => {
  // 只允许打开更新器校验过的白名单地址
  if (updater.allowed(url)) require('electron').shell.openExternal(url);
});




