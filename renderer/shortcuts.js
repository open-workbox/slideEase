// 快捷键配置：软件里所有快捷键都只在这里定义一次。
// 按键处理（app.js）、快捷键帮助、设置面板、菜单上的按键提示、使用教程都从这里读取，改这里就全部同步。
//
// 每一项：
//   id     代码里引用的名字
//   keys   按键写法，可以有多个（第一个是主要的，显示时默认只显示第一个）
//          修饰键：mod = Windows/Linux 的 Ctrl、macOS 的 ⌘；alt = Alt / ⌥；shift；ctrl = 两个系统都是 Ctrl
//          普通键：字母、数字、f1~f12、esc、del（Delete 和 Backspace 都算）、enter、plus（= 或 +）、minus（- 或 _）、
//                  up / down / left / right（方向键）
//   label  说明文字在 i18n.js 里的键名
//   hold   true 表示“按住”类的键（拖动、点击时按住），不是按一下就触发的快捷键
//   show   显示用的写法（不填就按 keys 自动生成）；all = true 时把 keys 全部列出来
//   list   false 表示不在快捷键列表里显示
export const SHORTCUTS = [
  { id: 'undo', keys: ['mod+z'], label: 'sc_undo' },
  { id: 'redo', keys: ['mod+shift+z', 'mod+y'], label: 'sc_redo' },
  { id: 'save', keys: ['mod+s'], label: 'sc_save' },
  { id: 'saveAs', keys: ['mod+shift+s'], label: 'sc_saveAs' },
  { id: 'open', keys: ['mod+o'], label: 'sc_open' },
  { id: 'preview', keys: ['f5'], label: 'sc_preview' },
  { id: 'find', keys: ['mod+f'], label: 'sc_find' },
  { id: 'copy', keys: ['mod+c'], label: 'sc_copy' },
  { id: 'cut', keys: ['mod+x'], label: 'sc_cut' },
  { id: 'note', keys: ['mod+alt+m'], label: 'sc_note' },
  { id: 'multi', keys: ['mod', 'shift'], label: 'sc_multi', hold: true, all: true }, // 第一个：逐个多选；第二个：连续选择
  { id: 'dup', keys: ['mod+d'], label: 'sc_dup' },
  { id: 'del', keys: ['del'], label: 'sc_del' },
  { id: 'move', keys: ['up', 'down', 'left', 'right'], show: '↑↓←→', label: 'sc_move' },
  { id: 'fast', keys: ['shift'], label: 'sc_fast', hold: true, list: false }, // 方向键移动时按住，每次移动 10 像素
  { id: 'nosnap', keys: ['alt'], label: 'sc_nosnap', hold: true },
  { id: 'zoom', keys: ['mod+plus', 'mod+minus', 'mod+0'], label: 'sc_zoom', all: true }, // 依次是：放大、缩小、适应窗口
  { id: 'deselect', keys: ['esc'], label: 'sc_deselect' },
  { id: 'noteSave', keys: ['mod+enter'], label: 'sc_noteSave', list: false }, // 批注输入框里保存
];

const byId = new Map(SHORTCUTS.map((s) => [s.id, s]));
export const shortcut = (id) => byId.get(id);

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);

/* ---------------- 显示：按操作系统显示，Windows/Linux 用 Ctrl+Z，macOS 用 ⌘Z ---------------- */
function keyName(k) {
  const map = {
    mod: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: isMac ? '⇧' : 'Shift', ctrl: isMac ? '⌃' : 'Ctrl',
    del: isMac ? '⌫' : 'Delete', esc: 'Esc', plus: '+', minus: '-', enter: isMac ? '↩' : 'Enter',
    up: '↑', down: '↓', left: '←', right: '→',
  };
  return map[k] || k.toUpperCase();
}
export function fmtKeys(spec) {
  const parts = spec.split('+');
  const key = keyName(parts.pop());
  if (isMac) {
    const sym = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘' };
    return ['ctrl', 'alt', 'shift', 'mod'].filter((m) => parts.includes(m)).map((m) => sym[m]).join('') + key;
  }
  const nm = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  return [...parts.map((m) => nm[m]), key].join('+');
}
// 某个快捷键的显示文字列表（每个元素是一组按键，例如 ['Ctrl+Z']）
export function keyTexts(id, all) {
  const s = byId.get(id);
  if (!s) return [];
  if (s.show) return [s.show];
  return (all || s.all ? s.keys : s.keys.slice(0, 1)).map(fmtKeys);
}
// 第 i 个按键的显示文字（用于说明文字里的 {sc:id} / {sc:id:1}）
export function keyText(id, i = 0) {
  const s = byId.get(id);
  if (!s) return id;
  if (s.show && i === 0) return s.show;
  return fmtKeys(s.keys[i] || s.keys[0]);
}

/* ---------------- 匹配：判断键盘事件是不是某个快捷键 ---------------- */
// 把键盘事件换算成配置里的写法
function eventKey(e) {
  const k = (e.key || '').toLowerCase();
  if (/^[a-z]$/.test(k)) return k; // 优先用实际输入的字母，兼容 AZERTY 等键盘布局
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase(); // Alt/⌥ 会把字母变成特殊字符，此时按键位判断
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  const map = {
    escape: 'esc', delete: 'del', backspace: 'del', '=': 'plus', '+': 'plus', '-': 'minus', _: 'minus',
    arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right',
  };
  return map[k] || k;
}
function matchSpec(e, spec) {
  const parts = spec.split('+');
  const key = parts.pop();
  if (eventKey(e) !== key) return false;
  const want = new Set(parts);
  const mod = e.ctrlKey || e.metaKey;
  if (want.has('mod') !== mod && !(want.has('ctrl') && e.ctrlKey)) return false;
  if (want.has('alt') !== e.altKey) return false;
  // 字母、数字、功能键要求 Shift 状态一致；符号键（+ -）和方向键不限制 Shift（很多键盘上 + 本身就要按 Shift）
  const loose = ['plus', 'minus', 'up', 'down', 'left', 'right'].includes(key);
  if (!loose && want.has('shift') !== e.shiftKey) return false;
  return true;
}
// 返回匹配到的是 keys 里的第几个（没匹配到返回 -1）
export function matchIndex(e, id) {
  const s = byId.get(id);
  if (!s || s.hold) return -1;
  return s.keys.findIndex((spec) => matchSpec(e, spec));
}
export const matches = (e, id) => matchIndex(e, id) >= 0;
// “按住”类的键：鼠标或键盘事件发生时，这个键是否按着（i 是 keys 里的第几个）
export function held(e, id, i = 0) {
  const s = byId.get(id);
  const spec = s && s.keys[i];
  if (!spec) return false;
  return spec.split('+').every((m) => (m === 'mod' ? (isMac ? e.metaKey : e.ctrlKey) : m === 'alt' ? e.altKey : m === 'shift' ? e.shiftKey : m === 'ctrl' ? e.ctrlKey : false));
}
