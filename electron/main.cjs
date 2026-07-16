const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron')
const path = require('node:path')

const isDesktopDev = process.env.INTERACT_DESKTOP_DEV === '1'
const CONTROL_COLLAPSED = { width: 300, height: 276 }
const CONTROL_EXPANDED = { width: 420, height: 760 }
const WINDOW_MARGIN = 12

let mainWindow = null
let overlayWindow = null
let reportWindow = null
let lastControlBounds = null
let isQuitting = false
let releaseTopmostTimer = null

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
    minWidth: 300,
    minHeight: 276,
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

  overlayWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
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

async function listCaptureSources() {
  const display = screen.getPrimaryDisplay()
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: {
      width: Math.max(1920, display.size.width),
      height: Math.max(1080, display.size.height),
    },
    fetchWindowIcons: true,
  })

  return sources.map((source) => ({
    id: source.id,
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

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize()
})
ipcMain.handle('window:close', () => app.quit())
ipcMain.handle('window:open-session-report', (_event, sessionId) => {
  if (!sessionId) throw new Error('缺少場次資料。')
  createReportWindow(sessionId)
})
ipcMain.handle('capture:list', listCaptureSources)

ipcMain.handle('capture:start-selection', async () => {
  if (!mainWindow) throw new Error('InterAct presenter window is unavailable.')

  lastControlBounds = mainWindow.getBounds()
  mainWindow.hide()
  overlayWindow?.hide()
  await new Promise((resolve) => setTimeout(resolve, 160))

  const sources = await listCaptureSources()
  const captureSource = sources.find((source) => source.id.startsWith('screen:')) || sources[0]
  if (!captureSource) throw new Error('找不到可截取的螢幕來源。')

  const display = screen.getPrimaryDisplay()
  mainWindow.setBounds(display.bounds)
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
