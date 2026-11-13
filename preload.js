// Bridge between the outline window and Windows (files, dialogs, menus).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onMenu: cb => ipcRenderer.on('menu', (_e, action) => cb(action)),
  onLoad: cb => ipcRenderer.on('load', (_e, file) => cb(file)),
  onReveal: cb => ipcRenderer.on('reveal', (_e, id) => cb(id)),
  setDirty: dirty => ipcRenderer.send('set-dirty', dirty),
  setPath: path => ipcRenderer.send('set-path', path),
  setFullScreen: on => ipcRenderer.send('full-screen', on),
  openDialog: kind => ipcRenderer.invoke('open-dialog', kind),
  saveDialog: (name, kind) => ipcRenderer.invoke('save-dialog', name, kind),
  writeFile: (path, content) => ipcRenderer.invoke('write-file', path, content),
  exportPDF: name => ipcRenderer.invoke('export-pdf', name),
  print: () => ipcRenderer.send('print'),
  openExternal: url => ipcRenderer.send('open-external', url),
  openPath: path => ipcRenderer.send('open-path', path),
  pathForFile: file => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  pickFiles: () => ipcRenderer.invoke('pick-files'),
  copyText: text => ipcRenderer.send('copy-text', text),
  newWindow: template => ipcRenderer.send('new-window', template),
  openInNewWindow: path => ipcRenderer.send('open-in-new-window', path),
  closeWindow: () => ipcRenderer.send('close-window'),
});
