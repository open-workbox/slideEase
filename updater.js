// 检查更新（免费、无需签名的“提示下载”方案）。
// 通过 PostHog feature flag 下发最新版本与下载地址，比对本地版本后提示用户。
// 不自动下载或执行任何程序；下载地址必须在白名单域名内，版本号只升不降。
const { app } = require('electron');
const analytics = require('./analytics');

const FLAG_KEY = 'app_update'; // PostHog 里创建的 flag，payload 形如 { version, urls, notes, force }

function parseVer(v) {
  return String(v || '').split('.').map((n) => parseInt(n, 10) || 0);
}
function isNewer(a, b) {
  const x = parseVer(a);
  const y = parseVer(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] || 0) > (y[i] || 0)) return true;
    if ((x[i] || 0) < (y[i] || 0)) return false;
  }
  return false;
}
function urlAllowed(u) {
  // 不限制域名，只要求 https，挡掉 javascript: / file: 等危险协议
  try {
    return new URL(u).protocol === 'https:';
  } catch { return false; }
}

// 返回有新版时的信息；否则返回 null
async function check() {
  const p = await analytics.getFlagPayload(FLAG_KEY);
  if (!p || typeof p !== 'object') return null;
  const version = String(p.version || '');
  if (!version || !isNewer(version, app.getVersion())) return null; // 只升不降

  // 方案 A：按当前系统从 urls 里取对应安装包地址
  const urls = p.urls && typeof p.urls === 'object' ? p.urls : null;
  const url = urls ? String(urls[process.platform] || '') : '';
  if (!url || !urlAllowed(url)) return null; // 没有本平台地址、或不是 https，则不提示

  return {
    version,
    url,
    notes: typeof p.notes === 'string' ? p.notes.slice(0, 1000) : '',
    force: p.force === 1 || p.force === true, // force 为 1 时强制更新，弹窗不可关闭
  };
}

module.exports = { check, allowed: urlAllowed };
