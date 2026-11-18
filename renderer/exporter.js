// 导出页面：导出为图片（PNG）或单页 HTML，可一次导出多页。
// 图片按编辑画面里看到的样子截取（包含未保存的修改），统一输出 1920×1080；
// 单页 HTML 用当前编辑结果生成，只保留这一页，图片等资源合并进文件，可以单独打开。
import { t } from './i18n.js';
import { applyOps } from './source.js';
import { inlineResources } from './inline.js';

let C; // { S, frame, navigate, select, collectOps, idOf, setLoading, toast, layoutStage, endEdit, pageOfNote }
const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMG_WIDTH = 1920; // 编辑画面的页面逻辑尺寸是 1920×1080

export function init(ctx) {
  C = ctx;
}

function baseName() {
  return String(C.S.name || 'slides').replace(/\.html?$/i, '');
}
// 文件名：文档名-第03页；页数多于 99 时位数跟着增加，保证按名称排序就是页序
function fileName(i) {
  const w = Math.max(2, String(C.S.slides.length).length);
  return `${baseName()}-${t('exp_file_page', { n: String(i + 1).padStart(w, '0') })}`;
}

function report(r, n) {
  if (!r) return; // 用户取消
  if (r.error) { C.toast(t('exp_fail') + ' ' + r.error); return; }
  C.toast(t('exp_done', { n: r.count || n }));
}

/* ---------------- 导出为图片 ---------------- */
export async function exportImages(idxs) {
  const S = C.S;
  if (!idxs.length || S.busy) return;
  if (S.editing) C.endEdit();
  const keep = { cur: S.cur, sel: S.sel, zoom: S.zoom };
  // 截图期间藏起盖在页面上的浮层，清掉页面里的选中文字和查找高亮
  const floaters = ['#overlay', '#zoombar', '#settings', '#replace-pop', '#toast', '#note-warn', '.sel-hint', '.sel-menu', '.note-pop']
    .map((s) => $(s)).filter(Boolean);
  const vis = floaters.map((e) => e.style.visibility);
  let reg = null;
  let savedHl = null;
  try { reg = S.win.CSS.highlights; savedHl = new Map(reg); reg.clear(); } catch { reg = null; }
  try { S.win.getSelection().removeAllRanges(); } catch { /* 忽略 */ }
  const items = [];
  let failed = 0;
  S.busy = true;
  try {
    C.select(null);
    floaters.forEach((e) => (e.style.visibility = 'hidden'));
    S.zoom = null; // 先恢复“适应窗口”，保证整页都在画面里
    C.layoutStage();
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      C.setLoading('block', t('exp_working', { i: k + 1, n: idxs.length }));
      C.navigate(i);
      await sleep(450); // 等切页动画、图片加载完成
      const r = C.frame.getBoundingClientRect();
      // 取整到像素内侧，避免边缘混进画布背景形成细线
      const x = Math.ceil(r.left);
      const y = Math.ceil(r.top);
      const rect = { x, y, width: Math.floor(r.right) - x, height: Math.floor(r.bottom) - y };
      const png = await window.api.exportShot(rect, IMG_WIDTH);
      if (png) items.push({ name: fileName(i), data: png });
      else failed++;
    }
  } finally {
    floaters.forEach((e, i) => (e.style.visibility = vis[i]));
    if (reg && savedHl) { try { for (const [k, v] of savedHl) reg.set(k, v); } catch { /* 忽略 */ } }
    S.zoom = keep.zoom;
    C.layoutStage();
    S.busy = false;
    C.navigate(keep.cur);
    if (keep.sel && keep.sel.isConnected) C.select(keep.sel);
    C.setLoading(null);
  }
  if (!items.length) { C.toast(t('exp_fail')); return; }
  window.api.track('export_png');
  const r = await window.api.exportSave(items, 'png');
  report(r, items.length);
  if (r && !r.error && failed) C.toast(t('exp_partial', { n: failed }));
}

/* ---------------- 导出为单页 HTML ---------------- */
export async function exportHtml(idxs) {
  const S = C.S;
  if (!idxs.length || S.busy) return;
  if (S.editing) C.endEdit();
  const ids = S.slides.map((s) => C.idOf(s));
  if (idxs.some((i) => !ids[i])) { C.toast(t('exp_no_id')); return; } // 由页面脚本生成的页，没有稳定编号，无法单独导出
  const { ops } = C.collectOps();
  const showClass = S.info && S.info.kind === 'exclusive' ? S.info.activeClass : null;
  const items = [];
  C.setLoading('full', t('exp_working', { i: 0, n: idxs.length }));
  try {
    for (let k = 0; k < idxs.length; k++) {
      const i = idxs[k];
      C.setLoading('full', t('exp_working', { i: k + 1, n: idxs.length }));
      const removeIds = ids.filter((id, j) => id && j !== i);
      const notes = S.notes.filter((n) => C.pageOfNote(n) === i); // 只带上这一页的批注
      let { html } = applyOps(S.tagged, ops, notes, { removeIds, showId: ids[i], showClass });
      try { ({ html } = await inlineResources(html, S.baseHref)); } catch { /* 合并失败时仍导出原结构 */ }
      items.push({ name: fileName(i), data: html });
    }
  } finally {
    C.setLoading(null);
  }
  window.api.track('export_html');
  report(await window.api.exportSave(items, 'html'), items.length);
}
