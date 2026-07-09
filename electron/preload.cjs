const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('interactDesktop', {
  isDesktop: true,
  platform: process.platform,
  listCaptureSources: () => ipcRenderer.invoke('capture:list'),
  captureFirstScreen: () => ipcRenderer.invoke('capture:first-screen'),
})
