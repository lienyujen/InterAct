const { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell, systemPreferences } = require('electron')
const path = require('node:path')

const isDesktopDev = process.env.INTERACT_DESKTOP_DEV === '1'
const CONTROL_COLLAPSED = { width: 194, height: 242 }
const CONTROL_EXPANDED = { width: 420, height: 760 }
const WINDOW_MARGIN = 12

let mainWindow = null
let overlayWindow = null
let reportWindow = null
let wordCloudWindow = null
let lastControlBounds = null
let isQuitting = false
let releaseTopmostTimer = null
let latestLotteryEvent = null
const windowDragState = new Map()

function appUrl(hash) {
  return isDesktopDev ? `http://127.0.0.1:5173/#${hash}` : null
}

function loadAppRoute(window, hash) {
  if (isDesktopDev) {
    return window.loadURL(appUrl(hash))
  }

  return window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 540,
    height: 680,
    minWidth: 194,
    minHeight: 242,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    title: 'InterAct Presenter',
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  loadAppRoute(mainWindow, '/presenter/new')

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error('InterAct failed to load', { errorCode, errorDescription, validatedUrl })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('InterAct renderer process gone', details)
  })

  mainWindow.on('restore', () => {
    setTimeout(bringControlToFront, 60)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    overlayWindow?.close()
    overlayWindow = null
    wordCloudWindow?.close()
    wordCloudWindow = null
  })
}

function bringControlToFront() {
  if (!mainWindow || mainWindow.isDestroyed() || reportWindow) return

  if (releaseTopmostTimer) clearTimeout(releaseTopmostTimer)
  mainWindow.setAlwaysOnTop(true, 'floating')
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.moveTop()
  mainWindow.focus()
  releaseTopmostTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false)
    releaseTopmostTimer = null
  }, 250)
}

function createOverlayWindow(sessionId) {
  overlayWindow?.close()
  latestLotteryEvent = null

  overlayWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  overlayWindow.setIgnoreMouseEvents(true)
  overlayWindow.setAlwaysOnTop(true, 'floating')
  loadAppRoute(overlayWindow, `/desktop-overlay/${sessionId}`)
  overlayWindow.once('ready-to-show', () => {
    overlayWindow?.showInactive()
    setTimeout(bringControlToFront, 60)
  })
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

function createReportWindow(sessionId) {
  if (reportWindow && !reportWindow.isDestroyed()) {
    if (reportWindow.isMinimized()) reportWindow.restore()
    reportWindow.show()
    reportWindow.moveTop()
    reportWindow.focus()
    return
  }

  mainWindow?.hide()
  overlayWindow?.hide()

  reportWindow = new BrowserWindow({
    width: 1120,
    height: 820,
    minWidth: 840,
    minHeight: 620,
    frame: false,
    show: false,
    resizable: true,
    maximizable: true,
    backgroundColor: '#f7f8fb',
    title: 'InterAct 課堂互動報告',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  loadAppRoute(reportWindow, `/session-report/${sessionId}`)
  reportWindow.once('ready-to-show', () => {
    reportWindow?.show()
    reportWindow?.focus()
  })
  reportWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    app.quit()
  })
  reportWindow.on('closed', () => {
    reportWindow = null
  })
}

function createWordCloudWindow(sessionId) {
  if (wordCloudWindow && !wordCloudWindow.isDestroyed()) {
    if (wordCloudWindow.isMinimized()) wordCloudWindow.restore()
    wordCloudWindow.show()
    wordCloudWindow.moveTop()
    wordCloudWindow.focus()
    return
  }

  const targetDisplay = displayForBounds(mainWindow?.getBounds())
  const width = Math.min(1180, Math.max(860, targetDisplay.workArea.width - 120))
  const height = Math.min(780, Math.max(600, targetDisplay.workArea.height - 120))
  wordCloudWindow = new BrowserWindow({
    width,
    height,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    show: false,
    resizable: true,
    maximizable: true,
    backgroundColor: '#0b1020',
    title: 'InterAct 彈幕文字雲',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  loadAppRoute(wordCloudWindow, `/word-cloud/${sessionId}`)
  wordCloudWindow.once('ready-to-show', () => {
    wordCloudWindow?.show()
    wordCloudWindow?.focus()
  })
  wordCloudWindow.on('closed', () => {
    wordCloudWindow = null
  })
}

function displayForBounds(bounds) {
  return screen.getDisplayMatching(bounds || mainWindow?.getBounds() || screen.getPrimaryDisplay().bounds)
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum))
}

function setControlBounds(expanded, snapToTopRight = false) {
  if (!mainWindow) return

  const size = expanded ? CONTROL_EXPANDED : CONTROL_COLLAPSED
  const current = lastControlBounds || mainWindow.getBounds()
  const display = displayForBounds(current)
  const workArea = display.workArea
  const right = snapToTopRight ? workArea.x + workArea.width - WINDOW_MARGIN : current.x + current.width
  const x = clamp(right - size.width, workArea.x + WINDOW_MARGIN, workArea.x + workArea.width - size.width - WINDOW_MARGIN)
  const y = snapToTopRight
    ? workArea.y + WINDOW_MARGIN
    : clamp(current.y, workArea.y + WINDOW_MARGIN, workArea.y + workArea.height - size.height - WINDOW_MARGIN)

  const bounds = { x, y, ...size }
  mainWindow.setBounds(bounds, true)
  lastControlBounds = bounds
}

async function listCaptureSources(targetDisplay = screen.getPrimaryDisplay(), types = ['screen', 'window']) {
  if (process.platform === 'darwin') {
    const permission = systemPreferences.getMediaAccessStatus('screen')
    if (permission === 'denied' || permission === 'restricted') {
      throw new Error('macOS 尚未允許 InterAct 錄製螢幕。請到「系統設定 > 隱私權與安全性 > 螢幕與系統音訊錄製」開啟權限，然後重新啟動 InterAct。')
    }
  }

  const captureWidth = Math.round(targetDisplay.size.width * targetDisplay.scaleFactor)
  const captureHeight = Math.round(targetDisplay.size.height * targetDisplay.scaleFactor)
  const sources = await desktopCapturer.getSources({
    types,
    thumbnailSize: {
      width: Math.max(1920, captureWidth),
      height: Math.max(1080, captureHeight),
    },
    fetchWindowIcons: true,
  })

  return sources.map((source) => ({
    id: source.id,
    displayId: source.display_id || null,
    name: source.name,
    width: source.thumbnail.getSize().width,
    height: source.thumbnail.getSize().height,
    thumbnailDataUrl: source.thumbnail.toDataURL(),
    appIconDataUrl: source.appIcon?.toDataURL() || null,
  }))
}

ipcMain.handle('window:presenter-mode', (_event, sessionId) => {
  if (!mainWindow || !sessionId) return
  setControlBounds(false, true)
  createOverlayWindow(sessionId)
})

ipcMain.handle('window:set-expanded', (_event, expanded) => {
  setControlBounds(Boolean(expanded))
})

ipcMain.handle('lottery:set-interactive', (_event, enabled) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const interactive = Boolean(enabled)
  overlayWindow.setFocusable(interactive)
  overlayWindow.setIgnoreMouseEvents(!interactive)
  if (interactive) {
    overlayWindow.show()
    overlayWindow.focus()
  } else {
    setTimeout(bringControlToFront, 60)
  }
})

ipcMain.handle('lottery:show', (_event, lotteryEvent) => {
  if (!overlayWindow || overlayWindow.isDestroyed() || !lotteryEvent?.id) return
  latestLotteryEvent = lotteryEvent
  overlayWindow.webContents.send('lottery:event', lotteryEvent)
})

ipcMain.handle('lottery:get-latest', () => latestLotteryEvent)

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.handle('window:close', (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (targetWindow && targetWindow === wordCloudWindow) {
    targetWindow.close()
    return
  }
  app.quit()
})
ipcMain.handle('window:open-session-report', (_event, sessionId) => {
  if (!sessionId) throw new Error('缺少場次資料。')
  createReportWindow(sessionId)
})
ipcMain.handle('window:open-word-cloud', (_event, sessionId) => {
  if (!sessionId) throw new Error('缺少場次資料。')
  createWordCloudWindow(sessionId)
})

ipcMain.on('window:drag-start', (event, point) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return
  windowDragState.set(window.id, {
    pointerX: point.screenX,
    pointerY: point.screenY,
    bounds: window.getBounds(),
  })
})

ipcMain.on('window:drag-move', (event, point) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const drag = window ? windowDragState.get(window.id) : null
  if (!window || !drag || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return

  const rawX = Math.round(drag.bounds.x + point.screenX - drag.pointerX)
  const rawY = Math.round(drag.bounds.y + point.screenY - drag.pointerY)
  const display = screen.getDisplayNearestPoint({ x: Math.round(point.screenX), y: Math.round(point.screenY) })
  const workArea = display.workArea
  const minimumVisible = 72
  const x = clamp(rawX, workArea.x - drag.bounds.width + minimumVisible, workArea.x + workArea.width - minimumVisible)
  const y = clamp(rawY, workArea.y, workArea.y + workArea.height - minimumVisible)
  window.setPosition(x, y)
  if (window === mainWindow) lastControlBounds = { ...drag.bounds, x, y }
})

ipcMain.on('window:drag-end', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) windowDragState.delete(window.id)
})
ipcMain.handle('capture:list', listCaptureSources)
ipcMain.handle('capture:permission-status', () => (
  process.platform === 'darwin'
    ? systemPreferences.getMediaAccessStatus('screen')
    : 'granted'
))
ipcMain.handle('capture:open-permission-settings', async () => {
  if (process.platform !== 'darwin') return false
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
  return true
})

ipcMain.handle('capture:start-selection', async () => {
  if (!mainWindow) throw new Error('InterAct presenter window is unavailable.')

  lastControlBounds = mainWindow.getBounds()
  const targetDisplay = displayForBounds(lastControlBounds)
  mainWindow.hide()
  overlayWindow?.hide()
  await new Promise((resolve) => setTimeout(resolve, 160))

  const sources = await listCaptureSources(targetDisplay, ['screen'])
  const displayIndex = screen.getAllDisplays().findIndex((display) => display.id === targetDisplay.id)
  const captureSource = sources.find((source) => source.displayId === String(targetDisplay.id))
    || sources.find((source) => source.id.startsWith(`screen:${displayIndex}:`))
    || sources[displayIndex]
  if (!captureSource) throw new Error('找不到可截取的螢幕來源。')

  mainWindow.setBounds(targetDisplay.bounds)
  mainWindow.show()
  mainWindow.focus()
  return captureSource
})

ipcMain.handle('capture:finish-selection', (_event, expanded = true) => {
  setControlBounds(Boolean(expanded))
  overlayWindow?.showInactive()
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (reportWindow && !reportWindow.isDestroyed()) {
      reportWindow.show()
      reportWindow.focus()
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      bringControlToFront()
    } else {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
