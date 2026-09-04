const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('interactDesktop', {
  isDesktop: true,
  platform: process.platform,
  enterPresenterMode: (sessionId) => ipcRenderer.invoke('window:presenter-mode', sessionId),
  setPresenterExpanded: (expanded, settingsOpen = false, interactiveOpen = false) => ipcRenderer.invoke('window:set-expanded', expanded, settingsOpen, interactiveOpen),
  setLotteryInteraction: (enabled) => ipcRenderer.invoke('lottery:set-interactive', enabled),
  showLottery: (event) => ipcRenderer.invoke('lottery:show', event),
  getLatestLottery: () => ipcRenderer.invoke('lottery:get-latest'),
  onLottery: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lottery:event', listener)
    return () => ipcRenderer.removeListener('lottery:event', listener)
  },
  openSessionReport: (sessionId, generate = false) => ipcRenderer.invoke('window:open-session-report', sessionId, generate),
  returnFromSessionReport: () => ipcRenderer.invoke('window:return-from-session-report'),
  openWordCloud: (sessionId) => ipcRenderer.invoke('window:open-word-cloud', sessionId),
  openRoster: (sessionId) => ipcRenderer.invoke('window:open-roster', sessionId),
  openCustomQuizReview: (sessionId, questionId) => ipcRenderer.invoke('window:open-custom-quiz-review', sessionId, questionId),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  close: () => ipcRenderer.invoke('window:close'),
  listCaptureSources: () => ipcRenderer.invoke('capture:list'),
  startCaptureSelection: () => ipcRenderer.invoke('capture:start-selection'),
  finishCaptureSelection: (expanded) => ipcRenderer.invoke('capture:finish-selection', expanded),
  logDiagnostic: (details) => ipcRenderer.invoke('diagnostics:write', details),
  supabaseManagement: (request) => ipcRenderer.invoke('supabase:management', request),
})
