const { app, BrowserWindow, desktopCapturer, ipcMain, screen, shell } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

function logFatalError(scope, error) {
  const message = `[${new Date().toISOString()}] [${scope}] ${error?.stack || error}\n`
  console.error(message)
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), message)
  } catch {
    // Best-effort logging only; never let logging itself crash the process.
  }
}

function writeDiagnostic(details) {
  try {
    const logPath = path.join(app.getPath('userData'), 'diagnostics.log')
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
      if (fs.existsSync(`${logPath}.previous`)) fs.rmSync(`${logPath}.previous`)
      fs.renameSync(logPath, `${logPath}.previous`)
    }
    const safeDetails = details && typeof details === 'object' ? details : { event: String(details) }
    fs.appendFileSync(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...safeDetails })}\n`)
  } catch {
    // Best-effort logging only; never interrupt a live class.
  }
}

// Without these, any uncaught error anywhere in the main process (e.g. a timer
// callback touching an already-destroyed BrowserWindow) exits the whole app
// instantly with no dialog and no trace — every window vanishes mid-class.
process.on('uncaughtException', (error) => logFatalError('uncaughtException', error))
process.on('unhandledRejection', (reason) => logFatalError('unhandledRejection', reason))

// This app hides/shows several BrowserWindows constantly (overlay keep-alive
// every 750ms, presenter panel expand/collapse). Chromium's native window
// occlusion tracking throttles rendering for windows it thinks are covered,
// which fights that pattern; disable it like other frequently-hidden apps do.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

const isDesktopDev = process.env.INTERACT_DESKTOP_DEV === '1'
const APP_USER_MODEL_ID = 'tw.interact.presenter.desktop'
const APP_WINDOW_ICON_PATH = isDesktopDev
  ? path.join(__dirname, '..', 'build', 'icon.ico')
  : path.join(process.resourcesPath, 'icon.ico')
const APP_EXECUTABLE_PATH = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
const APP_RELAUNCH_ICON_PATH = isDesktopDev ? APP_WINDOW_ICON_PATH : APP_EXECUTABLE_PATH
const CONTROL_COLLAPSED = { width: 194, height: 242 }
const CONTROL_EXPANDED = { width: 420, height: 760 }
const CONTROL_WITH_SETTINGS = { width: 1100, height: 760 }
const WINDOW_MARGIN = 12
const TOPMOST_LEVEL = 'screen-saver'
const CONTROL_RELATIVE_LEVEL = 6
const OVERLAY_RELATIVE_LEVEL = 2
const WORD_CLOUD_RELATIVE_LEVEL = 4
const QUIZ_REVIEW_RELATIVE_LEVEL = 5

app.setAppUserModelId(APP_USER_MODEL_ID)

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function requireUuid(value, label = 'session') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`Invalid ${label} identifier.`)
  }
  return value
}

function configureWebContents(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(parsed.toString())
    } catch {
      // Malformed external URLs are ignored.
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault()
  })
}

let mainWindow = null
let overlayWindow = null
let overlayKeepAliveTimer = null
let overlayVisibilitySuppressed = false
let reportWindow = null
let wordCloudWindow = null
let quizReviewWindow = null
let lastControlBounds = null
let isQuitting = false
let latestLotteryEvent = null
let presenterTopmostEnabled = false

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
    show: false,
    title: 'InterAct Presenter',
    icon: APP_WINDOW_ICON_PATH,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: APP_RELAUNCH_ICON_PATH,
    appIconIndex: 0,
    relaunchCommand: `"${APP_EXECUTABLE_PATH}"`,
    relaunchDisplayName: 'InterAct',
  })
  configureWebContents(mainWindow)

  loadAppRoute(mainWindow, '/presenter/new')

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error('InterAct failed to load', { errorCode, errorDescription, validatedUrl })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('InterAct renderer process gone', details)
  })

  mainWindow.on('restore', () => {
    setTimeout(() => bringControlToFront(true), 60)
  })

  mainWindow.on('move', () => {
    if (lastControlBounds) lastControlBounds = mainWindow.getBounds()
  })

  mainWindow.on('will-resize', (event) => {
    event.preventDefault()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    closeOverlayWindow()
    wordCloudWindow?.close()
    wordCloudWindow = null
    quizReviewWindow?.close()
    quizReviewWindow = null
  })
}

function setPresenterTopmost(enabled) {
  presenterTopmostEnabled = Boolean(enabled)
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setAlwaysOnTop(enabled, TOPMOST_LEVEL, enabled ? CONTROL_RELATIVE_LEVEL : 0)
}

function reinforcePresenterTopmost() {
  if (
    !presenterTopmostEnabled
    || !mainWindow
    || mainWindow.isDestroyed()
    || mainWindow.isMinimized()
    || !mainWindow.isVisible()
    || reportWindow
  ) return
  mainWindow.setAlwaysOnTop(true, TOPMOST_LEVEL, CONTROL_RELATIVE_LEVEL)
  mainWindow.moveTop()
}

function bringControlToFront(focus = false) {
  if (!mainWindow || mainWindow.isDestroyed() || reportWindow) return

  if (mainWindow.isMinimized()) mainWindow.restore()
  if (focus) mainWindow.show()
  else mainWindow.showInactive()
  mainWindow.moveTop()
  if (focus) mainWindow.focus()
}

function showOverlayInactive() {
  if (overlayVisibilitySuppressed || !overlayWindow || overlayWindow.isDestroyed()) return

  overlayWindow.setAlwaysOnTop(true, TOPMOST_LEVEL, OVERLAY_RELATIVE_LEVEL)
  overlayWindow.showInactive()
  overlayWindow.moveTop()
}

function stopOverlayKeepAlive() {
  if (overlayKeepAliveTimer) clearInterval(overlayKeepAliveTimer)
  overlayKeepAliveTimer = null
}

function startOverlayKeepAlive() {
  stopOverlayKeepAlive()
  overlayKeepAliveTimer = setInterval(() => {
    reinforcePresenterTopmost()
    if (overlayVisibilitySuppressed || !overlayWindow || overlayWindow.isDestroyed()) return
    const targetDisplay = displayForBounds(safeBounds(mainWindow))
    const bounds = overlayWindow.getBounds()
    if (
      bounds.x !== targetDisplay.bounds.x
      || bounds.y !== targetDisplay.bounds.y
      || bounds.width !== targetDisplay.bounds.width
      || bounds.height !== targetDisplay.bounds.height
    ) overlayWindow.setBounds(targetDisplay.bounds, false)
    showOverlayInactive()
  }, 750)
}

function closeOverlayWindow() {
  stopOverlayKeepAlive()
  const target = overlayWindow
  overlayWindow = null
  if (target && !target.isDestroyed()) target.close()
}

function createOverlayWindow(sessionId) {
  closeOverlayWindow()
  overlayVisibilitySuppressed = false
  latestLotteryEvent = null
  const targetDisplay = displayForBounds(safeBounds(mainWindow))

  const nextOverlayWindow = new BrowserWindow({
    ...targetDisplay.bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      backgroundThrottling: false,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  overlayWindow = nextOverlayWindow
  configureWebContents(nextOverlayWindow)

  nextOverlayWindow.setIgnoreMouseEvents(true, { forward: true })
  nextOverlayWindow.setAlwaysOnTop(true, TOPMOST_LEVEL, OVERLAY_RELATIVE_LEVEL)
  nextOverlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  loadAppRoute(nextOverlayWindow, `/desktop-overlay/${sessionId}`)
  nextOverlayWindow.once('ready-to-show', () => {
    showOverlayInactive()
    startOverlayKeepAlive()
    setTimeout(bringControlToFront, 60)
  })
  nextOverlayWindow.on('closed', () => {
    if (overlayWindow === nextOverlayWindow) {
      overlayWindow = null
      stopOverlayKeepAlive()
    }
  })
}

function createReportWindow(sessionId, generate = false) {
  if (reportWindow && !reportWindow.isDestroyed()) {
    if (reportWindow.isMinimized()) reportWindow.restore()
    reportWindow.show()
    reportWindow.moveTop()
    reportWindow.focus()
    return
  }

  mainWindow?.hide()
  overlayVisibilitySuppressed = true
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
    icon: APP_WINDOW_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  reportWindow.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: APP_RELAUNCH_ICON_PATH,
    appIconIndex: 0,
    relaunchCommand: `"${APP_EXECUTABLE_PATH}"`,
    relaunchDisplayName: 'InterAct',
  })
  configureWebContents(reportWindow)

  loadAppRoute(reportWindow, `/session-report/${sessionId}${generate ? '?generate=1' : ''}`)
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
    wordCloudWindow.setAlwaysOnTop(true, TOPMOST_LEVEL, WORD_CLOUD_RELATIVE_LEVEL)
    wordCloudWindow.show()
    wordCloudWindow.moveTop()
    wordCloudWindow.focus()
    return
  }

  const targetDisplay = displayForBounds(safeBounds(mainWindow))
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
    alwaysOnTop: true,
    backgroundColor: '#0b1020',
    title: 'InterAct 彈幕文字雲',
    icon: APP_WINDOW_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  wordCloudWindow.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: APP_RELAUNCH_ICON_PATH,
    appIconIndex: 0,
    relaunchCommand: `"${APP_EXECUTABLE_PATH}"`,
    relaunchDisplayName: 'InterAct',
  })
  configureWebContents(wordCloudWindow)
  wordCloudWindow.setAlwaysOnTop(true, TOPMOST_LEVEL, WORD_CLOUD_RELATIVE_LEVEL)

  loadAppRoute(wordCloudWindow, `/word-cloud/${sessionId}`)
  wordCloudWindow.once('ready-to-show', () => {
    overlayVisibilitySuppressed = true
    overlayWindow?.hide()
    wordCloudWindow?.show()
    wordCloudWindow?.moveTop()
    wordCloudWindow?.focus()
  })
  wordCloudWindow.on('closed', () => {
    wordCloudWindow = null
    overlayVisibilitySuppressed = false
    showOverlayInactive()
    setTimeout(() => bringControlToFront(false), 60)
  })
}

function createCustomQuizReviewWindow(sessionId, questionId) {
  if (quizReviewWindow && !quizReviewWindow.isDestroyed()) {
    loadAppRoute(quizReviewWindow, `/custom-quiz-review/${sessionId}/${questionId}`)
    if (quizReviewWindow.isMinimized()) quizReviewWindow.restore()
    quizReviewWindow.show()
    quizReviewWindow.moveTop()
    quizReviewWindow.focus()
    return
  }

  const targetDisplay = displayForBounds(safeBounds(mainWindow))
  const workArea = targetDisplay.workArea
  const width = Math.max(800, Math.round(workArea.width * 0.8))
  const height = Math.max(600, Math.round(workArea.height * 0.8))
  const x = workArea.x + Math.round((workArea.width - width) / 2)
  const y = workArea.y + Math.round((workArea.height - height) / 2)

  overlayVisibilitySuppressed = true
  overlayWindow?.hide()
  mainWindow?.hide()

  const nextQuizReviewWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 760,
    minHeight: 520,
    frame: false,
    show: false,
    resizable: true,
    maximizable: true,
    alwaysOnTop: true,
    backgroundColor: '#f7f8fb',
    title: 'InterAct 自訂測驗檢視',
    icon: APP_WINDOW_ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  quizReviewWindow = nextQuizReviewWindow
  nextQuizReviewWindow.setAppDetails({
    appId: APP_USER_MODEL_ID,
    appIconPath: APP_RELAUNCH_ICON_PATH,
    appIconIndex: 0,
    relaunchCommand: `"${APP_EXECUTABLE_PATH}"`,
    relaunchDisplayName: 'InterAct',
  })
  configureWebContents(nextQuizReviewWindow)
  nextQuizReviewWindow.setAlwaysOnTop(true, TOPMOST_LEVEL, QUIZ_REVIEW_RELATIVE_LEVEL)
  loadAppRoute(nextQuizReviewWindow, `/custom-quiz-review/${sessionId}/${questionId}`)
  nextQuizReviewWindow.once('ready-to-show', () => {
    nextQuizReviewWindow.show()
    nextQuizReviewWindow.moveTop()
    nextQuizReviewWindow.focus()
  })
  nextQuizReviewWindow.on('closed', () => {
    if (quizReviewWindow === nextQuizReviewWindow) quizReviewWindow = null
    overlayVisibilitySuppressed = false
    showOverlayInactive()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.moveTop()
      mainWindow.focus()
    }
  })
}

// A destroyed BrowserWindow still passes a truthy/non-null check, but calling
// any method on it (e.g. getBounds) throws. Route every bounds read through
// here so a window torn down mid-tick can never throw an uncaught exception.
function safeBounds(window) {
  return window && !window.isDestroyed() ? window.getBounds() : null
}

function displayForBounds(bounds) {
  return screen.getDisplayMatching(bounds || safeBounds(mainWindow) || screen.getPrimaryDisplay().bounds)
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum))
}

function setControlBounds(expanded, snapToTopRight = false, settingsOpen = false) {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const size = settingsOpen ? CONTROL_WITH_SETTINGS : expanded ? CONTROL_EXPANDED : CONTROL_COLLAPSED
  const current = lastControlBounds || safeBounds(mainWindow) || screen.getPrimaryDisplay().workArea
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
  if (!mainWindow) return
  requireUuid(sessionId)
  setPresenterTopmost(true)
  setControlBounds(false, true)
  createOverlayWindow(sessionId)
})

ipcMain.handle('diagnostics:write', (_event, details) => {
  writeDiagnostic(details)
})

ipcMain.handle('window:set-expanded', (_event, expanded, settingsOpen = false, interactiveOpen = false) => {
  // Reapplying always-on-top closes native Windows select popups. Temporarily
  // suspend the presenter topmost reinforcement while settings are interactive.
  setPresenterTopmost(!(settingsOpen || interactiveOpen))
  setControlBounds(Boolean(expanded), false, settingsOpen)
  setTimeout(() => bringControlToFront(false), 30)
})

ipcMain.handle('lottery:set-interactive', (_event, enabled) => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const interactive = Boolean(enabled)
  overlayWindow.setFocusable(interactive)
  overlayWindow.setIgnoreMouseEvents(!interactive, { forward: !interactive })
  if (interactive) {
    overlayWindow.setAlwaysOnTop(true, TOPMOST_LEVEL, OVERLAY_RELATIVE_LEVEL)
    overlayWindow.show()
    overlayWindow.focus()
  } else {
    overlayWindow.setFocusable(false)
    showOverlayInactive()
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
  if (targetWindow && (targetWindow === wordCloudWindow || targetWindow === quizReviewWindow)) {
    targetWindow.close()
    return
  }
  app.quit()
})
ipcMain.handle('window:open-session-report', (_event, sessionId, generate = false) => {
  requireUuid(sessionId)
  createReportWindow(sessionId, Boolean(generate))
})
ipcMain.handle('window:return-from-session-report', async (event) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender)
  if (!targetWindow || targetWindow !== reportWindow) return false

  reportWindow = null
  targetWindow.destroy()
  closeOverlayWindow()
  setPresenterTopmost(false)

  if (mainWindow && !mainWindow.isDestroyed()) {
    await loadAppRoute(mainWindow, '/presenter/new')
    mainWindow.show()
    mainWindow.moveTop()
    mainWindow.focus()
  }
  return true
})
ipcMain.handle('window:open-word-cloud', (_event, sessionId) => {
  requireUuid(sessionId)
  createWordCloudWindow(sessionId)
})
ipcMain.handle('window:open-custom-quiz-review', (_event, sessionId, questionId) => {
  requireUuid(sessionId)
  requireUuid(questionId, 'question')
  createCustomQuizReviewWindow(sessionId, questionId)
})

ipcMain.handle('capture:list', listCaptureSources)

ipcMain.handle('capture:start-selection', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('InterAct presenter window is unavailable.')

  lastControlBounds = mainWindow.getBounds()
  const targetDisplay = displayForBounds(lastControlBounds)
  mainWindow.hide()
  overlayVisibilitySuppressed = true
  overlayWindow?.hide()
  try {
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
  } catch (error) {
    overlayVisibilitySuppressed = false
    setControlBounds(false)
    bringControlToFront(true)
    showOverlayInactive()
    throw error
  }
})

ipcMain.handle('capture:finish-selection', (_event, expanded = true) => {
  setControlBounds(Boolean(expanded))
  overlayVisibilitySuppressed = false
  bringControlToFront(true)
  showOverlayInactive()
  setTimeout(() => {
    showOverlayInactive()
    bringControlToFront(false)
  }, 120)
})

app.whenReady().then(() => {
  createWindow()

  for (const eventName of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(eventName, () => showOverlayInactive())
  }

  app.on('activate', () => {
    if (reportWindow && !reportWindow.isDestroyed()) {
      reportWindow.show()
      reportWindow.focus()
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      bringControlToFront(true)
    } else {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
  stopOverlayKeepAlive()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
