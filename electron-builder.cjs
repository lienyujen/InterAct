// APP_EDITION picks the Windows app to build. It only renames the artifact and
// its product name; both editions ship the same code, and the caption controls
// are gated at runtime by VITE_APP_EDITION (see src/lib/edition.ts).
//   unset / standard -> InterAct.exe
//   plus             -> InterActPlus.exe
const productName = process.env.APP_EDITION === 'plus' ? 'InterActPlus' : 'InterAct'

module.exports = {
  appId: 'tw.interact.presenter.desktop',
  productName,
  artifactName: `${productName}.\${ext}`,
  directories: {
    output: 'release',
  },
  files: [
    'dist/**/*',
    'electron/**/*',
    'package.json',
    // package.json's dependencies are renderer-only libraries already
    // bundled into dist/**/*.js by Vite; electron/*.cjs only requires
    // electron/node:path/node:fs, so none of node_modules ever runs.
    '!node_modules/**/*',
  ],
  // The UI only ships zh-TW and en-US strings; without this, electron-builder
  // bundles all ~55 Chromium locale .pak files (~49MB of unused languages).
  electronLanguages: ['en-US', 'zh-TW'],
  extraResources: [
    {
      from: 'build/icon.ico',
      to: 'icon.ico',
    },
  ],
  win: {
    icon: 'build/icon.ico',
    executableName: productName,
    requestedExecutionLevel: 'asInvoker',
    target: [
      {
        target: 'portable',
        arch: ['x64'],
      },
      // Unlike portable, which re-extracts its full payload to a temp folder
      // on every launch (~10s), this zip is unpacked once and the exe inside
      // then starts directly (~2s) on every subsequent run.
      {
        target: 'zip',
        arch: ['x64'],
      },
    ],
  },
  nsis: {
    allowElevation: false,
    installerIcon: 'build/icon.ico',
    installerHeaderIcon: 'build/icon.ico',
    packElevateHelper: false,
    perMachine: false,
    uninstallerIcon: 'build/icon.ico',
  },
  portable: {
    requestExecutionLevel: 'user',
  },
}
