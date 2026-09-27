const path = require('node:path');
function applicationUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的招聘页面网址。'); }
  if (url.username || url.password) throw new Error('网址不能包含账号或密码。');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('招聘页面需要使用 HTTPS 安全网址。');
  }
  return url.href;
}
function uiAssetPath(value, uiDir) {
  const url = new URL(value);
  if (url.protocol !== 'jobpilot:' || url.hostname !== 'app') return null;
  let name;
  try { name = decodeURIComponent(url.pathname).replace(/^\//, ''); } catch { return null; }
  if (!name || name.includes('..') || name.includes('\\') || name.includes('\0')) return null;
  const target = path.resolve(uiDir, name);
  if (!target.startsWith(path.resolve(uiDir) + path.sep)) return null;
  if (!['.html', '.js', '.css', '.svg', '.png', '.ico'].includes(path.extname(target))) return null;
  return target;
}
module.exports = { applicationUrl, uiAssetPath };
