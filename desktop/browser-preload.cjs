const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('applicationBrowser', {
  action: (action) => ipcRenderer.invoke('application:action', action),
  onState: (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('browser:state', listener);
    return () => ipcRenderer.removeListener('browser:state', listener);
  },
});
