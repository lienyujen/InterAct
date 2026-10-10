const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'electron/main.cjs'), 'utf8')
const ico = fs.readFileSync(path.join(root, 'build/icon.ico'))
assert.equal(ico.readUInt16LE(0), 0)
assert.equal(ico.readUInt16LE(2), 1)
assert.ok(ico.readUInt16LE(4) > 0)
const config = require('../electron-builder.cjs')
assert.ok(config.extraResources.some(item => item.from === 'build/icon.ico' && item.to === 'icon.ico'))
assert.equal(config.win.icon, 'build/icon.ico')
assert.match(source, /const APP_RELAUNCH_ICON_PATH = APP_WINDOW_ICON_PATH/)
assert.match(source, /const APP_WINDOW_ICON_PATH = !app\.isPackaged/)
const start = source.indexOf('function applyTaskbarIdentity(')
const end = source.indexOf('\nfunction ', start + 1)
const calls = []
const context = {
  process: { platform: 'win32' },
  APP_WINDOW_ICON_PATH: 'resources/icon.ico',
  APP_RELAUNCH_ICON_PATH: 'resources/icon.ico',
  APP_USER_MODEL_ID: config.appId,
  APP_EXECUTABLE_PATH: 'C:/USB/InterAct.exe',
}
vm.createContext(context)
vm.runInContext(source.slice(start, end), context)
context.applyTaskbarIdentity({ setIcon: icon => calls.push(icon), setAppDetails: details => calls.push(details) })
assert.equal(calls[0], 'resources/icon.ico')
assert.equal(calls[1].appIconPath, 'resources/icon.ico')
assert.equal(calls[1].relaunchCommand, '"C:/USB/InterAct.exe"')
context.process.platform = 'darwin'
context.applyTaskbarIdentity({})
console.log('PASS: ICO resource, packaged/dev paths, explicit Windows taskbar icon and macOS guard')
