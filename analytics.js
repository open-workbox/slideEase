// 匿名使用统计（主进程）。
// 严守隐私红线：只上报“软件自身的通用产品数据”——版本、随机设备标识、系统类型、语言。
// 绝不上报任何用户数据：文件名、路径、幻灯片内容、编辑了什么，一概不碰。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const POSTHOG_KEY = 'phc_mMD88iz2KXqPmPWzG3QtG63vETY2oiXyhYhA4Ba2fkin';
const POSTHOG_HOST = 'https://us.i.posthog.com';

let client = null;
let distinctId = null;
let commonProps = {};

const idFile = () => path.join(app.getPath('userData'), 'device-id');

// 随机设备标识，仅本机生成、不含任何个人信息
function getDistinctId() {
  try {
    const p = idFile();
    if (fs.existsSync(p)) {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v) return v;
    }
    const id = crypto.randomUUID();
    fs.writeFileSync(p, id);
    return id;
  } catch {
    return crypto.randomUUID(); // 写不进磁盘也不影响运行
  }
}

function init() {
  distinctId = getDistinctId();
  commonProps = {
    app_version: app.getVersion(),
    platform: process.platform, // win32 / darwin / linux —— 系统类型
    arch: process.arch,
    os_release: require('os').release(),
    electron: process.versions.electron,
    locale: app.getLocale(),
  };
  try {
    const { PostHog } = require('posthog-node');
    client = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST, flushAt: 1, flushInterval: 10000 });
  } catch { client = null; }
}

// 只接受固定事件名与非敏感属性；调用处自己保证不传用户内容
function capture(event, props) {
  if (!client) return;
  try {
    client.capture({ distinctId, event, properties: { ...commonProps, ...(props || {}) } });
  } catch { /* 忽略 */ }
}

// Feature flag：用于更新提示的灰度与下载地址下发
async function getFlagPayload(key) {
  try {
    const { PostHog } = require('posthog-node');
    const c = client || new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
    const id = distinctId || getDistinctId();
    let payload = null;
    if (typeof c.evaluateFlags === 'function') {
      // 新 API：一次 /flags 请求拿到全部结果，再取指定 flag 的 payload
      const flags = await c.evaluateFlags(id);
      payload = flags && typeof flags.getFlagPayload === 'function' ? flags.getFlagPayload(key) : null;
    } else {
      payload = await c.getFeatureFlagPayload(key, id); // 兼容旧版本
    }
    if (c !== client) await c.shutdown();
    return payload || null;
  } catch { return null; }
}

async function shutdown() {
  if (client) { try { await client.shutdown(); } catch { /* 忽略 */ } }
}

module.exports = { init, capture, getFlagPayload, shutdown };
