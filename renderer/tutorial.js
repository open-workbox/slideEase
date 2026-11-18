// 使用教程：软件自带的一份 HTML 幻灯片（renderer/tutorial/tutorial.html）。
// 打开前按当前界面语言只保留对应语言的文字，并把里面的快捷键占位填成 shortcuts.js 里配置的按键，
// 这样以后改了快捷键，教程里的说明和演示会自动跟着变。
//
// 教程文件里可用的写法：
//   <span data-zh>中文</span><span data-en>English</span>   按语言二选一
//   <kbd data-sc="undo"></kbd>          填入快捷键（默认第一个按键）；data-sc-i="1" 取第二个；data-sc-all 列出全部
//   <ul data-sc-list></ul>              填入完整的快捷键列表
import { t, getLang } from './i18n.js';
import { SHORTCUTS, keyText, keyTexts } from './shortcuts.js';

export function buildTutorial(html) {
  const lang = getLang() === 'en' ? 'en' : 'zh';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  doc.title = lang === 'zh' ? 'SlideEase 使用教程' : 'SlideEase Tutorial';
  const drop = lang === 'zh' ? 'en' : 'zh';
  doc.querySelectorAll(`[data-${drop}]`).forEach((e) => e.remove());
  doc.querySelectorAll(`[data-${lang}]`).forEach((e) => e.removeAttribute(`data-${lang}`));

  doc.querySelectorAll('[data-sc]').forEach((e) => {
    const id = e.getAttribute('data-sc');
    if (e.hasAttribute('data-sc-all')) {
      // 多组按键：每组一个 <kbd>
      const parts = keyTexts(id, true);
      const frag = doc.createDocumentFragment();
      parts.forEach((k, i) => {
        if (i) frag.append(' / ');
        const kb = doc.createElement('kbd');
        kb.textContent = k;
        frag.append(kb);
      });
      e.replaceWith(frag);
      return;
    }
    e.textContent = keyText(id, Number(e.getAttribute('data-sc-i') || 0));
    e.removeAttribute('data-sc');
    e.removeAttribute('data-sc-i');
  });

  doc.querySelectorAll('[data-sc-list]').forEach((ul) => {
    ul.removeAttribute('data-sc-list');
    ul.textContent = '';
    for (const s of SHORTCUTS) {
      if (s.list === false) continue;
      const li = doc.createElement('li');
      const keys = doc.createElement('span');
      keys.className = 'k';
      keyTexts(s.id).forEach((k) => {
        const kb = doc.createElement('kbd');
        kb.textContent = k;
        keys.append(kb);
      });
      const label = doc.createElement('span');
      label.className = 'l';
      label.textContent = t(s.label);
      li.append(keys, label);
      ul.append(li);
    }
  });
  return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
}
