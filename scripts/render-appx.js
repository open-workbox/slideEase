// 生成 Microsoft Store（appx / MSIX）包需要的图标，输出到 build/appx/。
// 用法：npx electron scripts/render-appx.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// [文件名, 宽, 高, 图标占画面的比例]
const ASSETS = [
  ['StoreLogo.png', 50, 50, 1],
  ['Square44x44Logo.png', 44, 44, 1],
  ['Square150x150Logo.png', 150, 150, 0.66],
  ['Wide310x150Logo.png', 310, 150, 0.66],
  ['LargeTile.png', 310, 310, 0.66],
  ['SmallTile.png', 71, 71, 0.8],
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const root = path.join(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');
  const out = path.join(root, 'build', 'appx');
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ width: 400, height: 400, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  for (const [name, wd, ht, k] of ASSETS) {
    const s = Math.round(Math.min(wd, ht) * k);
    const html = `<!DOCTYPE html><meta charset="utf-8"><style>html,body{margin:0;width:${wd}px;height:${ht}px;background:transparent;display:grid;place-items:center;overflow:hidden}svg{display:block;width:${s}px;height:${s}px}</style>${svg}`;
    w.setContentSize(wd, ht);
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    let img = await w.webContents.capturePage({ x: 0, y: 0, width: wd, height: ht });
    const sz = img.getSize();
    if (sz.width !== wd || sz.height !== ht) img = img.resize({ width: wd, height: ht, quality: 'best' }); // 高分屏下统一成规定尺寸
    fs.writeFileSync(path.join(out, name), img.toPNG());
    console.log('wrote', name, wd + 'x' + ht);
  }
  app.exit(0);
});
