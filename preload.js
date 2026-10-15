const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dynbar', {
  onActivity: (cb) => ipcRenderer.on('activity', (_e, a) => cb(a)),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (p) => ipcRenderer.send('settings:set', p),
  setInteractive: (v) => ipcRenderer.send('interactive', v),
  raise: (v) => ipcRenderer.send('raise', v),
  test: () => ipcRenderer.send('test'),
  onMedia: (cb) => ipcRenderer.on('media', (_e, m) => cb(m)),
  getMedia: () => ipcRenderer.invoke('media:get'),
  media: (c) => ipcRenderer.send('media:cmd', c),
  on: (ch, cb) => ipcRenderer.on(ch, (_e, d) => cb(d)),
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  send: (ch, ...a) => ipcRenderer.send(ch, ...a)
});
