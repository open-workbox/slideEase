// 预览层：只向页面暴露最小且安全的接口（AI 生成的页面脚本与编辑器同源，所以不暴露任意路径读写）
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('file:open'),
  openPath: (p) => ipcRenderer.invoke('file:openPath', p),
  save: (content) => ipcRenderer.invoke('file:save', content),
  saveAs: (content) => ipcRenderer.invoke('file:saveAs', content),
  pickImage: () => ipcRenderer.invoke('image:pick'),
  capture: (rect) => ipcRenderer.invoke('capture', rect),
  thumbsStart: (job) => ipcRenderer.invoke('thumbs:start', job),
  thumbsStop: () => ipcRenderer.send('thumbs:stop'),
  onThumb: (cb) => ipcRenderer.on('thumbs:one', (_e, r) => cb(r)),
  readTutorial: () => ipcRenderer.invoke('tutorial:read'),
  detachDoc: () => ipcRenderer.send('doc:detach'),
  exportShot: (rect, width) => ipcRenderer.invoke('export:shot', rect, width),
  exportSave: (items, kind) => ipcRenderer.invoke('export:save', items, kind),
  setLoading: (mode, text) => ipcRenderer.send('loading:set', { mode, text }),
  openPreview: (html, opts) => ipcRenderer.invoke('preview:open', html, opts),
  track: (event) => ipcRenderer.send('track', event),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  openUpdateUrl: (url) => ipcRenderer.invoke('update:open', url),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  recentList: () => ipcRenderer.invoke('recent:list'),
  recentOpen: (p) => ipcRenderer.invoke('recent:open', p),
  recentRemove: (p) => ipcRenderer.invoke('recent:remove', p),
  copyText: (text) => ipcRenderer.send('clipboard:write', text),
  debugEnabled: () => ipcRenderer.invoke('debug:enabled'),
  debugLog: (line) => ipcRenderer.send('debug:log', line),
  appInfo: () => ipcRenderer.invoke('app:info'),
  historyAppend: (rec) => ipcRenderer.send('history:append', rec),
  historySnap: (h) => ipcRenderer.invoke('history:snap', h),
  historyBlob: (h) => ipcRenderer.invoke('history:blob', h),
  historyDiscard: (id) => ipcRenderer.invoke('history:discard', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  readResources: (urls) => ipcRenderer.invoke('res:read', urls),
  getPending: () => ipcRenderer.invoke('app:get-pending'),
  onOpenDoc: (cb) => ipcRenderer.on('app:open-doc', (_e, doc) => cb(doc)),
  setState: (s) => ipcRenderer.send('app:state', s),
  closeNow: () => ipcRenderer.send('app:close-now'),
  pathForFile: (f) => webUtils.getPathForFile(f),
  onSaveThenClose: (cb) => ipcRenderer.on('app:save-then-close', () => cb()),
});




