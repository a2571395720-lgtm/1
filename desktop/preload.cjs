const { contextBridge, ipcRenderer } = require('electron');
const methods = ['getState', 'saveProfile', 'saveJob', 'importJobs', 'deleteJob', 'setJobStatus',
  'importResume', 'removeResume', 'openResume', 'saveSettings', 'exportBackup', 'importBackup',
  'openDataFolder', 'getAppInfo', 'openApplication', 'fillApplication', 'attachResume', 'copyText', 'scoreJob'];
const api = Object.fromEntries(methods.map((method) => [method, (value) => ipcRenderer.invoke(`jobpilot:${method}`, value)]));
api.onApplicationEvent = (callback) => {
  const listener = (_event, data) => callback(data);
  ipcRenderer.on('application:event', listener);
  return () => ipcRenderer.removeListener('application:event', listener);
};
contextBridge.exposeInMainWorld('jobpilot', Object.freeze(api));
