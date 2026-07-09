const { app, BrowserWindow, desktopCapturer, ipcMain } = require('electron')
const path = require('node:path')

const isDesktopDev = process.env.INTERACT_DESKTOP_DEV === '1'

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'InterAct Presenter',
    backgroundColor: '#0b1020',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  if (isDesktopDev) {
    mainWindow.loadURL('http://127.0.0.1:5173/#/presenter/new')
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
      hash: '/presenter/new',
    })
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error('InterAct failed to load', { errorCode, errorDescription, validatedUrl })
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('InterAct renderer process gone', details)
  })
}

async function listCaptureSources() {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: true,
  })

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnailDataUrl: source.thumbnail.toDataURL(),
    appIconDataUrl: source.appIcon?.toDataURL() || null,
  }))
}

ipcMain.handle('capture:list', listCaptureSources)

ipcMain.handle('capture:first-screen', async () => {
  const sources = await listCaptureSources()
  const screen = sources.find((source) => source.id.startsWith('screen:')) || sources[0]

  if (!screen) {
    throw new Error('找不到可截取的螢幕來源。')
  }

  return screen
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
