const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('interactDesktop', {
  isDesktop: true,
  platform: process.platform,
  enterPresenterMode: (sessionId) => ipcRenderer.invoke('window:presenter-mode', sessionId),
  setPresenterExpanded: (expanded) => ipcRenderer.invoke('window:set-expanded', expanded),
  openSessionReport: (sessionId) => ipcRenderer.invoke('window:open-session-report', sessionId),
  startWindowDrag: (screenX, screenY) => ipcRenderer.send('window:drag-start', { screenX, screenY }),
  moveWindowDrag: (screenX, screenY) => ipcRenderer.send('window:drag-move', { screenX, screenY }),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  listCaptureSources: () => ipcRenderer.invoke('capture:list'),
  startCaptureSelection: () => ipcRenderer.invoke('capture:start-selection'),
  finishCaptureSelection: (expanded) => ipcRenderer.invoke('capture:finish-selection', expanded),
})
