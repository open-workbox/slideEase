import { SHORTCUTS, fmtKeys, keyText, keyTexts } from './shortcuts.js';
// 中英文界面文案
const dict = {
  zh: {
    history: '修改记录', h_title: '修改记录', h_empty: '还没有修改记录', h_locate: '定位', h_revert: '撤销这条修改', h_restore: '恢复到此保存点',
    h_clear: '清除记录', h_clearConfirm: '清除后将无法再追溯此文件之前的修改，也无法恢复到旧的保存点。确定吗？',
    h_before: '修改前', h_after: '修改后', h_conflict: '这里之后又被修改过。仍要恢复成这条记录修改前的样子吗？',
    h_cantRevert: '这条修改无法单独撤销（内容已变化，或不在当前文档中）', h_gone: '找不到对应的位置，可能已被删除或修改过',
    h_goneDeleted: '这里的内容已被删除，可点击“撤销这条修改”恢复', h_approx: '已按位置大致定位', h_default: '默认', h_none: '（无）',
    h_right: '向右', h_left: '向左', h_down: '向下', h_up: '向上', h_slideLabel: '第 {n} 页',
    h_baseline: '打开文件（初始版本）', h_external: '文件在软件之外被修改过', h_save: '保存', h_restoreEvt: '恢复到保存点',
    h_text: '修改文字', h_style: '修改样式', h_move: '移动位置', h_resize: '调整大小', h_image: '更换图片', h_delete: '删除内容',
    h_deleteSlide: '删除页面', h_duplicate: '复制内容', h_duplicateSlide: '复制页面', h_reorder: '调整页面顺序', h_undelete: '恢复被删除的内容',
    h_undo: '撤销', h_redo: '重做', h_undone: '已撤销', h_partUndone: '部分撤销', h_reverted: '已被还原', h_revertPrefix: '还原：',
    h_deletedContent: '被删除的内容', h_dupDesc: '复制了：{x}', h_dupSlideDesc: '复制了整页：{x}', h_reorderDesc: '第 {a} 页移到了第 {b} 页{pos}',
    h_after_pos: '之后', h_before_pos: '之前', h_snapDesc: '这是一个保存点，可以把整份文档恢复到这个时刻的样子。',
    h_alreadyUndone: '这条修改已经被撤销', h_revertDone: '已还原这条修改', h_cantRestore: '找不到这个保存点的数据',
    h_restoreConfirm: '将用这个保存点替换当前内容（需要再点“保存”才会写入文件）。继续吗？', h_restored: '已恢复到保存点，确认无误后请点“保存”',
    p_color: '文字颜色', 'p_font-size': '字号', 'p_font-weight': '加粗', 'p_font-style': '斜体', 'p_text-decoration': '下划线', 'p_text-align': '对齐',
    'p_background-color': '填充颜色', 'p_background-image': '背景图', p_opacity: '透明度', 'p_border-radius': '圆角', p_translate: '位置', p_scale: '缩放', p_width: '宽度', p_height: '高度',
    notes: '批注', n_title: '批注', n_add: '添加', n_add_note: '添加批注', n_placeholder: '写下你的批注…（{sc:noteSave} 添加）',
    n_s_todo: '待处理', n_s_doing: '处理中', n_s_done: '已完成', n_all: '全部',
    n_expand_all: '全部展开', n_collapse_all: '全部收起', n_page: '第 {n} 页', n_cur_page: '当前页', n_lost_group: '目标已找不到',
    n_count: '{n} 条', n_hits: '匹配 {n} 条', n_mark_title: '{n} 条批注（点击查看）',
    n_empty: '还没有批注。选中页面上的文字、图片或区块，写下想法即可。', n_target: '批注对象',
    n_pick_first: '先在页面上选中一个元素（文字、图片、区块都可以），再添加批注', n_dynamic: '这个元素由页面脚本生成，批注无法保存在文件里',
    n_delete_confirm: '确定删除这条批注吗？', n_save: '保存', n_cancel: '取消', n_edit: '编辑', n_delete: '删除', n_locate: '定位',
    n_rebind: '绑定到选中元素', n_state_orphan: '目标元素已找不到（可能被删除或改写）', n_state_changed: '目标内容已变化（可能被改动过）',
    n_target_lost: '找不到这条批注的目标元素', n_show_marks: '在页面上显示批注标记',
    n_w_title: '批注检查：发现异常', n_w_orphan: '{n} 条批注找不到对应的元素', n_w_changed: '{n} 条批注所在的内容已被改动',
    n_w_stray: '{n} 处批注标记缺少批注内容', n_w_badjson: '批注数据已损坏，无法读取',
    n_w_tip: '这通常是文件被 AI 或其他工具修改后造成的。请逐条检查；如果目标换了位置，先选中新的元素，再点批注上的“绑定到选中元素”。',
    ctx_copy: '复制', ctx_cut: '剪切', ctx_note: '批注', ctx_hint: '添加批注（{sc:note}）；点鼠标右键可复制 / 剪切', ctx_key_copy: '{sc:copy}', ctx_key_cut: '{sc:cut}', ctx_key_note: '{sc:note}',
    ctx_cut_fail: '这段文字无法剪切（跨页选择，或由页面脚本生成）', cut: '已剪切',
    n_pop_title: '添加批注', n_pop_quote: '针对文字：', n_pop_placeholder: '写下批注…（{sc:noteSave} 保存）',
    n_w_view: '查看批注', n_w_ok: '知道了', h_note: '批注', h_note_add: '添加了批注', h_note_edit: '修改了批注内容', h_note_status: '修改了批注状态', h_note_delete: '删除了批注', h_note_rebind: '把批注绑定到了新的元素',
    open: '打开', save: '保存', saveAs: '另存为', preview: '预览', previewTip: '全屏放映当前文档（{sc:preview}），按 Esc 退出', previewOpening: '正在打开预览…', undo: '撤销', undoTip: '撤销（{sc:undo}）；撤销过头了按 {sc:redo} 恢复',
    zoomOut: '缩小（{sc:zoom:1}）', zoomIn: '放大（{sc:zoom}）', zoomFit: '点击恢复自适应（{sc:zoom:2}）', zoomFitBtn: '适应窗口',
    canvas: '画布', size169: '16:9 宽屏', size43: '4:3 标准', size720: '16:9 小尺寸', sizeFit: '自适应窗口',
    emptyTitle: '别让 AI 比你老板还清楚公司营收',
    emptyDesc: '效率交给 AI，饭碗留给自己。AI 时代，数据保密要养成习惯：先脱敏，再喂 AI。先用脱敏数据让 AI 排好版、出幻灯片，再拖到这里把真实数据填回去。',
    emptyBtn: '选择 HTML 文件', recentTitle: '历史记录', recentManage: '管理历史记录', recentRemove: '从历史记录中移除', recentMissing: '文件已不存在，已从历史记录移除',
    privacyTitle: '数据不出你的电脑',
    privacyDesc: '打开、编辑、保存都在本机完成，不会上传你的任何文件信息和内容。真实数据可以放心在这里填。',
    slides: '页面', addSlide: '复制当前页', dupSlide: '复制此页', delSlide: '删除此页', page: '第 {n} / {total} 页',
    panelHint: '<b>点一下</b>选中，<b>双击</b>改字。<br>选中后拖动可以换位置，拖四周的小圆点改大小，靠近别的内容会自动对齐。<br>从文字上<b>拖过去</b>能选中文字，点 💬 或按 {sc:note} 写批注，右键可以复制、剪切。', shortcutsTitle: '快捷键', copied: '已复制',
    text: '文字', fontSize: '字号', color: '文字颜色', bold: '加粗', italic: '斜体', underline: '下划线',
    alignLeft: '左对齐', alignCenter: '居中', alignRight: '右对齐',
    scaleTitle: '缩放', scale: '整体缩放', scaleTip: '把选中的内容连同里面的文字、图片一起按比例放大或缩小', scaleReset: '恢复原始大小（100%）',
    appearance: '外观', fill: '填充颜色', noFill: '无填充', opacity: '透明度', radius: '圆角',
    image: '图片', replaceImage: '更换图片…',
    arrange: '操作', duplicate: '复制', delete: '删除', selectParent: '选择上一级',
    kindText: '文字', kindImage: '图片', kindBox: '区块',
    saved: '已保存', saveFailed: '保存失败', confirmDiscard: '当前文档有未保存的修改，打开新文件会丢失这些修改，继续吗？',
    dynWarn: '这个内容由页面脚本动态生成，修改只在编辑时有效，可能无法保存。',
    skipWarn: '有 {n} 处修改因内容是动态生成的而未能保存。',
    inlined: '已将 {n} 个外部资源合并进文件', missingRes: '{n} 个资源未找到，保持原样',
    loading: '正在打开文件…',
    thumbGen: '正在生成缩略图…', thumbBg: '正在后台生成缩略图 {i}/{n}，可以直接开始编辑', cannotDeleteLast: '至少要保留一页', openFailed: '无法打开这个文件',
    editing: '正在编辑文字，按 Esc 或点击空白处完成', ready: '就绪',
    exp_png: '导出为图片', exp_png_n: '导出 {n} 页为图片', exp_html: '导出为单页 HTML', exp_html_n: '导出 {n} 页为单页 HTML（每页一个文件）', exp_working: '正在导出 {i}/{n}…', exp_done: '已导出 {n} 个文件', exp_fail: '导出失败', exp_partial: '有 {n} 页截图失败，未导出', exp_no_id: '所选的页由页面脚本生成，无法单独导出', exp_file_page: '第{n}页',
    g_pos: '位置（以页面左上角为原点）', g_size: '宽 × 高', tutorialFile: 'SlideEase 使用教程.html', tutorialMissing: '找不到使用教程文件', tutorialTitle: '帮助', tutorialDesc: '3 分钟学会：选中、改字、移动、批注、保存', tutorialLabel: '第一次用？看看怎么操作', tutorialOpen: '打开帮助', sc_noteSave: '保存批注',
    sc_fast: '按住加速移动', sc_nosnap: '拖动或缩放时按住：临时关闭自动吸附',
    sc_multi: '点缩略图多选页面，右键导出',
    sc_undo: '撤销', sc_redo: '重做', sc_save: '保存', sc_saveAs: '另存为', sc_open: '打开', sc_preview: '预览',
    sc_find: '查找', sc_copy: '复制选中文字', sc_cut: '剪切选中文字', sc_note: '添加批注（选中的文字或元素）', sc_dup: '复制元素', sc_del: '删除', sc_move: '移动（按住 {sc:fast} 加速）', sc_zoom: '缩放', sc_deselect: '取消选择 / 退出预览',
    settings: '设置', language: '界面语言 / Language', updateAvailable: '发现新版本 {v}', updateForceTitle: '需要更新到新版本 {v}', updateDownload: '前往下载', updateLater: '稍后', about: '关于', version: '版本', runtime: '运行环境', systemLabel: '系统',
    findPlaceholder: '查找文字和批注', findNone: '无结果', findPrev: '上一个（Shift+Enter）', findNext: '下一个（Enter）', replaceToggle: '替换',
    replacePlaceholder: '替换为', replaceOne: '替换', replaceAll: '全部替换', replaced: '已替换 {n} 处', findEditing: '先完成当前文字编辑再替换', findNoteOnly: '批注内容只参与查找，不会被替换',
  },
  en: {
    history: 'History', h_title: 'Edit history', h_empty: 'No edits yet', h_locate: 'Locate', h_revert: 'Undo this edit', h_restore: 'Restore this save point',
    h_clear: 'Clear history', h_clearConfirm: 'After clearing you can no longer trace earlier edits or restore old save points. Continue?',
    h_before: 'Before', h_after: 'After', h_conflict: 'This spot was changed again afterwards. Restore it to how it was before this edit anyway?',
    h_cantRevert: 'This edit cannot be undone on its own (content changed, or it is not in the current document)', h_gone: 'Cannot find the location. It may have been deleted or changed',
    h_goneDeleted: 'This content was deleted. Click "Undo this edit" to bring it back', h_approx: 'Located approximately by position', h_default: 'default', h_none: '(none)',
    h_right: 'right', h_left: 'left', h_down: 'down', h_up: 'up', h_slideLabel: 'Slide {n}',
    h_baseline: 'Opened file (original version)', h_external: 'File was modified outside the app', h_save: 'Saved', h_restoreEvt: 'Restored a save point',
    h_text: 'Edited text', h_style: 'Changed style', h_move: 'Moved', h_resize: 'Resized', h_image: 'Replaced image', h_delete: 'Deleted content',
    h_deleteSlide: 'Deleted slide', h_duplicate: 'Duplicated content', h_duplicateSlide: 'Duplicated slide', h_reorder: 'Reordered slides', h_undelete: 'Restored deleted content',
    h_undo: 'Undo', h_redo: 'Redo', h_undone: 'Undone', h_partUndone: 'Partly undone', h_reverted: 'Reverted', h_revertPrefix: 'Reverted: ',
    h_deletedContent: 'Deleted content', h_dupDesc: 'Duplicated: {x}', h_dupSlideDesc: 'Duplicated slide: {x}', h_reorderDesc: 'Slide {a} moved {pos} slide {b}',
    h_after_pos: 'after', h_before_pos: 'before', h_snapDesc: 'A save point. You can restore the whole document to how it was at this moment.',
    h_alreadyUndone: 'This edit has already been undone', h_revertDone: 'Edit reverted', h_cantRestore: 'Data for this save point was not found',
    h_restoreConfirm: 'This replaces the current content with the save point (click Save afterwards to write the file). Continue?', h_restored: 'Restored to the save point. Click Save when you are happy with it',
    p_color: 'Text color', 'p_font-size': 'Size', 'p_font-weight': 'Bold', 'p_font-style': 'Italic', 'p_text-decoration': 'Underline', 'p_text-align': 'Alignment',
    'p_background-color': 'Fill color', 'p_background-image': 'Background image', p_opacity: 'Opacity', 'p_border-radius': 'Corner radius', p_translate: 'Position', p_scale: 'Scale', p_width: 'Width', p_height: 'Height',
    notes: 'Notes', n_title: 'Notes', n_add: 'Add', n_add_note: 'Add note', n_placeholder: 'Write a note… ({sc:noteSave} to add)',
    n_s_todo: 'To do', n_s_doing: 'In progress', n_s_done: 'Done', n_all: 'All',
    n_expand_all: 'Expand all', n_collapse_all: 'Collapse all', n_page: 'Slide {n}', n_cur_page: 'Current', n_lost_group: 'Target not found',
    n_count: '{n}', n_hits: '{n} match(es)', n_mark_title: '{n} note(s) (click to view)',
    n_empty: 'No notes yet. Select text, an image or a block on the slide and write your thoughts.', n_target: 'Target',
    n_pick_first: 'Select an element on the slide first (text, image or block), then add a note', n_dynamic: 'This element is generated by page scripts, so a note cannot be saved on it',
    n_delete_confirm: 'Delete this note?', n_save: 'Save', n_cancel: 'Cancel', n_edit: 'Edit', n_delete: 'Delete', n_locate: 'Locate',
    n_rebind: 'Attach to selected element', n_state_orphan: 'Target element not found (it may have been deleted or rewritten)', n_state_changed: 'Target content has changed (it may have been edited)',
    n_target_lost: 'Cannot find the target element of this note', n_show_marks: 'Show note markers on the slide',
    n_w_title: 'Note check: problems found', n_w_orphan: '{n} note(s) have lost their element', n_w_changed: '{n} note(s) sit on content that was changed',
    n_w_stray: '{n} note marker(s) are missing their note content', n_w_badjson: 'The note data is damaged and cannot be read',
    n_w_tip: 'This usually happens after the file was edited by AI or another tool. Please check each note; if the target moved, select the new element and click "Attach to selected element" on the note.',
    ctx_copy: 'Copy', ctx_cut: 'Cut', ctx_note: 'Add note', ctx_hint: 'Add note ({sc:note}); right-click to copy / cut', ctx_key_copy: '{sc:copy}', ctx_key_cut: '{sc:cut}', ctx_key_note: '{sc:note}',
    ctx_cut_fail: 'This text cannot be cut (it spans slides or is generated by page scripts)', cut: 'Cut',
    n_pop_title: 'Add note', n_pop_quote: 'About: ', n_pop_placeholder: 'Write a note… ({sc:noteSave} to save)',
    n_w_view: 'View notes', n_w_ok: 'Got it', h_note: 'Note', h_note_add: 'Added a note', h_note_edit: 'Edited a note', h_note_status: 'Changed a note status', h_note_delete: 'Deleted a note', h_note_rebind: 'Re-attached a note to another element',
    open: 'Open', save: 'Save', saveAs: 'Save As', preview: 'Preview', previewTip: 'Play current document full screen ({sc:preview}), Esc to exit', previewOpening: 'Opening preview…', undo: 'Undo', undoTip: 'Undo ({sc:undo}). Went too far? {sc:redo} brings it back',
    zoomOut: 'Zoom out ({sc:zoom:1})', zoomIn: 'Zoom in ({sc:zoom})', zoomFit: 'Click to fit window ({sc:zoom:2})', zoomFitBtn: 'Fit',
    canvas: 'Canvas', size169: '16:9 Widescreen', size43: '4:3 Standard', size720: '16:9 Small', sizeFit: 'Fit to window',
    emptyTitle: 'Don\'t let AI know your revenue better than your boss does',
    emptyDesc: 'Let AI do the work. Keep your job. In the AI era, make it a habit: mask first, then feed the AI. Have AI design the deck with masked data, then drop it here and put the real numbers back.',
    emptyBtn: 'Choose HTML file', recentTitle: 'Recent', recentManage: 'Manage recent files', recentRemove: 'Remove from recent', recentMissing: 'File no longer exists; removed from recent',
    privacyTitle: 'Your data stays on this computer',
    privacyDesc: 'Opening, editing and saving all happen on this computer, and nothing about your files is ever uploaded. It is safe to fill in real data here.',
    slides: 'Slides', addSlide: 'Duplicate current slide', dupSlide: 'Duplicate slide', delSlide: 'Delete slide', page: 'Slide {n} / {total}',
    panelHint: '<b>Click</b> to select, <b>double-click</b> to edit text.<br>Drag a selected item to move it, drag the dots around it to resize. It snaps into line with nearby items.<br><b>Drag over text</b> to select it, then click 💬 or press {sc:note} to add a note, or right-click to copy or cut.', shortcutsTitle: 'Shortcuts', copied: 'Copied',
    text: 'Text', fontSize: 'Size', color: 'Text color', bold: 'Bold', italic: 'Italic', underline: 'Underline',
    alignLeft: 'Align left', alignCenter: 'Center', alignRight: 'Align right',
    scaleTitle: 'Scale', scale: 'Scale all', scaleTip: 'Scale the selection together with its text and images', scaleReset: 'Reset to original size (100%)',
    appearance: 'Appearance', fill: 'Fill color', noFill: 'No fill', opacity: 'Opacity', radius: 'Corner radius',
    image: 'Image', replaceImage: 'Replace image…',
    arrange: 'Actions', duplicate: 'Duplicate', delete: 'Delete', selectParent: 'Select parent',
    kindText: 'Text', kindImage: 'Image', kindBox: 'Block',
    saved: 'Saved', saveFailed: 'Save failed', confirmDiscard: 'You have unsaved changes that will be lost. Continue?',
    dynWarn: 'This content is generated by page scripts. Changes only apply while editing and may not be saved.',
    skipWarn: '{n} change(s) could not be saved because the content is generated dynamically.',
    inlined: '{n} external resource(s) merged into the file', missingRes: '{n} resource(s) not found, left as is',
    loading: 'Opening file…',
    thumbGen: 'Generating thumbnails…', thumbBg: 'Generating thumbnails in the background {i}/{n}. You can start editing', cannotDeleteLast: 'At least one slide must remain', noPageOps: 'Duplicating or deleting whole slides is not supported. Select something on the slide instead', openFailed: 'Unable to open this file',
    editing: 'Editing text. Press Esc or click outside to finish', ready: 'Ready',
    exp_png: 'Export as image', exp_png_n: 'Export {n} slides as images', exp_html: 'Export as single-slide HTML', exp_html_n: 'Export {n} slides as HTML (one file each)', exp_working: 'Exporting {i}/{n}…', exp_done: 'Exported {n} file(s)', exp_fail: 'Export failed', exp_partial: '{n} slide(s) could not be captured and were skipped', exp_no_id: 'The selected slide is generated by page scripts and cannot be exported on its own', exp_file_page: 'slide-{n}',
    g_pos: 'Position (from the top-left of the slide)', g_size: 'Width × height', tutorialFile: 'SlideEase Tutorial.html', tutorialMissing: 'The tutorial file is missing', tutorialTitle: 'Help', tutorialDesc: 'Learn in 3 minutes: select, edit text, move, notes, save', tutorialLabel: 'New here? See how it works', tutorialOpen: 'Open help', sc_noteSave: 'Save note',
    sc_fast: 'Hold to move faster', sc_nosnap: 'Hold while dragging or resizing: turn off snapping',
    sc_multi: 'Select several slides: hold and click thumbnails ({sc:multi:1} for a range), then right-click to export',
    sc_undo: 'Undo', sc_redo: 'Redo', sc_save: 'Save', sc_saveAs: 'Save as', sc_open: 'Open', sc_preview: 'Preview',
    sc_find: 'Find', sc_copy: 'Copy selected text', sc_cut: 'Cut selected text', sc_note: 'Add note (selected text or element)', sc_dup: 'Duplicate element', sc_del: 'Delete', sc_move: 'Move (hold {sc:fast} for faster)', sc_zoom: 'Zoom', sc_deselect: 'Deselect / exit preview',
    settings: 'Settings', language: 'Language / 界面语言', updateAvailable: 'New version {v} available', updateForceTitle: 'Update required: {v}', updateDownload: 'Download', updateLater: 'Later', about: 'About', version: 'Version', runtime: 'Runtime', systemLabel: 'System',
    findPlaceholder: 'Find text and notes', findNone: 'No results', findPrev: 'Previous (Shift+Enter)', findNext: 'Next (Enter)', replaceToggle: 'Replace',
    replacePlaceholder: 'Replace with', replaceOne: 'Replace', replaceAll: 'Replace all', replaced: 'Replaced {n} place(s)', findEditing: 'Finish editing the current text first', findNoteOnly: 'Notes are searched but never replaced',
  },
};

let lang = localStorage.getItem('lang') || (navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');

export const getLang = () => lang;

export { isMac, fmtKeys } from './shortcuts.js';

export function t(key, params) {
  let s = dict[lang][key] ?? key;
  s = s.replace(/\{k:([^}]+)\}/g, (_, spec) => fmtKeys(spec));
  s = s.replace(/\{sc:(\w+)(?::(\d))?\}/g, (_, id, i) => keyText(id, Number(i || 0))); // 从快捷键配置读取按键
  if (params) for (const k in params) s = s.replace(`{${k}}`, params[k]);
  return s;
}

export function setLang(l) {
  lang = l;
  localStorage.setItem('lang', l);
  applyStatic();
}

export function applyStatic() {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
  renderShortcutLists();
}

// 快捷键列表：一行一个，键名在前，说明在后；内容来自 shortcuts.js 的配置
function renderShortcutLists() {
  const html = SHORTCUTS.filter((s) => s.list !== false)
    .map((s) => `<li><span class="sc-keys">${keyTexts(s.id).map((k) => `<kbd>${k}</kbd>`).join(' ')}</span><span class="sc-label">${t(s.label)}</span></li>`).join('');
  document.querySelectorAll('.sc-list').forEach((ul) => (ul.innerHTML = html));
}
