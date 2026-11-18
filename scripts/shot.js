// 把一个 HTML 文件渲染成 PNG 截图（用于本地预览页面效果）
// 用法：npx electron scripts/shot.js <html路径> [输出png] [宽] [高]
//   路径相对项目根目录；省略输出则存为 shot.png；省略宽高默认 1100x1500
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs');
app.disableHardwareAcceleration();

const root = path.join(__dirname, '..');
const arg = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const target = arg[0] || 'contest/conversation.html';
const out = arg[1] || 'shot.png';
const width = parseInt(arg[2], 10) || 1100;
const height = parseInt(arg[3], 10) || 1500;

app.whenReady().then(async () => {
  const w = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true } });
  await w.loadFile(path.join(root, target));
  await new Promise((r) => setTimeout(r, 800));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(root, out), img.toPNG());
  console.log('wrote', out, `${width}x${height} from ${target}`);
  app.exit(0);
});
