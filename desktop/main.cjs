const { app, BrowserWindow, WebContentsView, ipcMain, protocol, dialog, shell, clipboard, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { Store, scoreJob } = require('./store.cjs');
const { autofill, findResumeInput } = require('./autofill.cjs');
const { applicationUrl, uiAssetPath } = require('./security.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'jobpilot', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('JobPilot');
if (process.env.JOBPILOT_TEST_DATA_DIR) app.setPath('userData', path.resolve(process.env.JOBPILOT_TEST_DATA_DIR));
else app.setPath('userData', path.join(app.getPath('appData'), 'JobPilot'));
let mainWindow;
let store;
const applicationWindows = new Map();
const uiDir = path.join(__dirname, 'ui');
const APP_URL = 'jobpilot://app/index.html';
const BROWSER_URL = 'jobpilot://app/browser.html';
const safePrefs = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };

function showMain() { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } }
function notify(data) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('application:event', data); }
function trusted(event, window, url) {
  return window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame === event.sender.mainFrame && event.senderFrame.url === url;
}
function lockLocalWindow(window) {
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}
function browserMessage(entry, message) {
  if (!entry.window.isDestroyed()) entry.window.webContents.send('browser:state', { url: entry.view.webContents.getURL(), message });
}
function getApplication(id) {
  const entry = applicationWindows.get(id);
  if (!entry || entry.window.isDestroyed()) throw new Error('请先打开这个职位的申请页面。');
  applicationUrl(entry.view.webContents.getURL());
  return entry;
}
async function fillApplication(id) {
  const entry = getApplication(id);
  const result = await entry.view.webContents.executeJavaScript(`(${autofill.toString()})(${JSON.stringify(store.getState().profile)})`, true);
  result.message ||= `已填写 ${result.filledCount} 项；${result.sensitiveCount} 项敏感问题需你确认。已有内容保留，请检查后提交。`;
  browserMessage(entry, result.message);
  return result;
}
async function attachResume(id) {
  const entry = getApplication(id);
  const job = store.getState().jobs.find((item) => item.id === id);
  if (!job?.resumeId) throw new Error('请先在职位详情中选择要使用的简历。');
  const file = store.getResumePath(job.resumeId);
  const target = entry.view.webContents;
  const destination = applicationUrl(target.getURL());
  let found = await target.executeJavaScript(`(${findResumeInput.toString()})()`, true);
  if (!found.selector) return { attached: false, message: found.message };
  const consent = await dialog.showMessageBox(entry.window, {
    type: 'question', title: '附加简历', message: `将 ${path.basename(file)} 附加到 ${new URL(destination).hostname}？`,
    detail: '招聘网站可能立即接收文件。附加后请核对页面提示，软件不会提交申请。',
    buttons: ['附加简历', '取消'], defaultId: 1, cancelId: 1,
  });
  if (consent.response !== 0) return { attached: false, message: '已取消附加。' };
  if (target.getURL() !== destination) throw new Error('页面已跳转，请确认当前页面后重试。');
  found = await target.executeJavaScript(`(${findResumeInput.toString()})()`, true);
  if (!found.selector) return { attached: false, message: found.message };
  if (target.debugger.isAttached()) throw new Error('页面正在被调试，请关闭开发者工具后重试。');
  target.debugger.attach('1.3');
  try {
    const { root } = await target.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await target.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: found.selector });
    if (!nodeId) throw new Error('简历上传框已变化，请重新点击附加简历。');
    await target.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] });
    const attached = await target.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(found.selector)})?.files?.length)`, true);
    const message = attached ? '简历已放入上传框；请查看招聘网站是否接收成功，再自行提交。' : '未能确认文件已附加，请在页面中手动选择简历。';
    browserMessage(entry, message);
    return { attached, message };
  } finally { if (target.debugger.isAttached()) target.debugger.detach(); }
}
async function openApplication(id) {
  const job = store.getState().jobs.find((item) => item.id === id);
  if (!job) throw new Error('职位不存在。');
  const url = applicationUrl(job.url);
  const existing = applicationWindows.get(id);
  if (existing && !existing.window.isDestroyed()) { existing.window.show(); existing.window.focus(); return { url: existing.view.webContents.getURL() }; }
  const window = new BrowserWindow({ width: 1240, height: 860, minWidth: 1080, minHeight: 640, title: `${job.company || '招聘页面'} · JobPilot`,
    icon: path.join(__dirname, 'assets/icon.png'), backgroundColor: '#f6f7f3', show: false,
    webPreferences: { ...safePrefs, preload: path.join(__dirname, 'browser-preload.cjs') } });
  lockLocalWindow(window);
  const view = new WebContentsView({ webPreferences: { ...safePrefs, partition: 'persist:applications' } });
  window.contentView.addChildView(view);
  const entry = { window, view, id };
  applicationWindows.set(id, entry);
  const resize = () => { const [width, height] = window.getContentSize(); view.setBounds({ x: 0, y: 100, width, height: Math.max(1, height - 100) }); };
  window.on('resize', resize);
  resize();
  const remote = view.webContents;
  const allowNavigation = (event, nextUrl) => {
    try { applicationUrl(nextUrl); } catch { event.preventDefault(); browserMessage(entry, '无法在申请窗口打开这个链接。请使用 HTTPS 招聘页面。'); }
  };
  remote.on('will-navigate', allowNavigation);
  remote.on('will-redirect', allowNavigation);
  remote.setWindowOpenHandler(({ url: nextUrl }) => {
    try { applicationUrl(nextUrl); remote.loadURL(nextUrl).catch(() => {}); } catch { browserMessage(entry, '此链接无法打开。'); }
    return { action: 'deny' };
  });
  remote.on('will-attach-webview', (event) => event.preventDefault());
  const onNavigation = () => { browserMessage(entry); notify({ jobId: id, type: 'navigation', url: remote.getURL() }); };
  remote.on('did-navigate', onNavigation);
  remote.on('did-navigate-in-page', onNavigation);
  remote.on('did-fail-load', (_event, code, _description, _validatedURL, isMainFrame) => {
    if (code === -3 || !isMainFrame) return;
    const message = '页面未能加载。请检查网络，或在默认浏览器中打开。';
    browserMessage(entry, message); notify({ jobId: id, type: 'error', message });
  });
  window.on('closed', () => { applicationWindows.delete(id); if (!remote.isDestroyed()) remote.close(); notify({ jobId: id, type: 'closed' }); });
  await window.loadURL(BROWSER_URL);
  window.show();
  remote.loadURL(url).catch(() => {});
  return { url };
}
function registerIPC() {
  const actions = {
    getState: () => store.getState(), saveProfile: (value) => store.saveProfile(value),
    saveJob: (value) => store.saveJob(value), importJobs: (value) => store.importJobs(value),
    deleteJob: (id) => { applicationWindows.get(id)?.window.close(); return store.deleteJob(id); },
    setJobStatus: (value) => store.setJobStatus(value), scoreJob: (value) => scoreJob(value),
    removeResume: (id) => store.removeResume(id),
    importResume: async () => {
      const result = await dialog.showOpenDialog(mainWindow, { title: '导入简历', properties: ['openFile'], filters: [{ name: '简历文档', extensions: ['pdf', 'docx', 'doc'] }] });
      return result.canceled ? store.getState() : store.importResume(result.filePaths[0]);
    },
    openResume: async (id) => { const error = await shell.openPath(store.getResumePath(id)); if (error) throw new Error(error); },
    saveSettings: (value) => {
      const state = store.saveSettings(value);
      if (app.isPackaged && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: state.settings.startAtLogin, path: process.execPath });
      return state;
    },
    exportBackup: async () => {
      const result = await dialog.showSaveDialog(mainWindow, { title: '导出档案、职位和简历备份', defaultPath: `JobPilot-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JobPilot 备份', extensions: ['json'] }] });
      if (result.canceled) return { canceled: true };
      store.exportBackup(result.filePath);
      return { canceled: false, path: result.filePath };
    },
    importBackup: async () => {
      const result = await dialog.showOpenDialog(mainWindow, { title: '选择 JobPilot 备份', properties: ['openFile'], filters: [{ name: 'JobPilot 备份', extensions: ['json'] }] });
      if (result.canceled) return store.getState();
      const answer = await dialog.showMessageBox(mainWindow, { type: 'question', title: '恢复备份', message: '用备份替换当前档案、职位和简历？', detail: '请先导出当前数据，方便恢复。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0 });
      if (answer.response !== 1) return store.getState();
      for (const entry of applicationWindows.values()) entry.window.close();
      const state = store.importBackup(result.filePaths[0]);
      if (app.isPackaged && process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: state.settings.startAtLogin, path: process.execPath });
      return state;
    },
    openDataFolder: async () => { const error = await shell.openPath(app.getPath('userData')); if (error) throw new Error(error); },
    getAppInfo: () => ({ version: app.getVersion(), dataPath: app.getPath('userData'), platform: process.platform, recoveryMessage: store.recoveryMessage }),
    copyText: (value) => { if (typeof value !== 'string' || value.length > 100000) throw new Error('复制内容无效。'); clipboard.writeText(value); },
    openApplication, fillApplication, attachResume,
  };
  for (const [name, action] of Object.entries(actions)) ipcMain.handle(`jobpilot:${name}`, (event, value) => {
    if (!trusted(event, mainWindow, APP_URL)) throw new Error('不允许的操作来源。');
    return action(value);
  });
  ipcMain.handle('application:action', async (event, action) => {
    const entry = [...applicationWindows.values()].find((item) => trusted(event, item.window, BROWSER_URL));
    if (!entry) throw new Error('不允许的操作来源。');
    const remote = entry.view.webContents;
    if (action === 'back') { if (remote.navigationHistory.canGoBack()) remote.navigationHistory.goBack(); }
    else if (action === 'reload') remote.reload();
    else if (action === 'fill') return fillApplication(entry.id);
    else if (action === 'attach') return attachResume(entry.id);
    else if (action === 'external') await shell.openExternal(applicationUrl(remote.getURL()));
    else if (action === 'dashboard') showMain();
    else throw new Error('未知操作。');
    return {};
  });
}
async function start() {
  store = new Store(app.getPath('userData'));
  protocol.handle('jobpilot', async (request) => {
    const file = uiAssetPath(request.url, uiDir);
    if (!file) return new Response('Not found', { status: 404 });
    try {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      return new Response(await fs.readFile(file), { headers: { 'Content-Type': `${types[path.extname(file)]}; charset=utf-8`,
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'" } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  for (const ses of [session.defaultSession, session.fromPartition('persist:applications')]) {
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
  }
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({ width: 1280, height: 860, minWidth: 1040, minHeight: 700, title: 'JobPilot',
    show: false, backgroundColor: '#f6f7f3', icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: { ...safePrefs, preload: path.join(__dirname, 'preload.cjs') } });
  lockLocalWindow(mainWindow);
  registerIPC();
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
  await mainWindow.loadURL(APP_URL);
  mainWindow.show();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showMain);
  app.whenReady().then(start).catch((error) => { dialog.showErrorBox('JobPilot 启动失败', `${error.message}\n现有资料保存在 ${app.getPath('userData')}`); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
