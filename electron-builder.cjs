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
  mac: {
    // electron-builder renders the .icns from this; build/icon.ico is Windows-only
    // and build/icon.png is 1254px square, well past the 512px minimum.
    icon: 'build/icon.png',
    category: 'public.app-category.education',
    target: [
      {
        // One download for both Apple Silicon and Intel. Two architecture-specific
        // files would be smaller, but the audience is teachers, and "which one is
        // my Mac?" is a question the download page should not have to answer.
        target: 'dmg',
        arch: ['universal'],
      },
    ],
    // There is no Apple Developer ID to sign with, but "no signature at all" is
    // not an option on Apple Silicon: the kernel refuses to run an arm64 binary
    // that carries none, and no amount of clearing quarantine helps. '-' is the
    // ad-hoc identity — worth nothing as an assurance of who built this, but it
    // is what makes the app launchable once Gatekeeper has been cleared once.
    // Note that identity: null means something else entirely: skip signing.
    identity: '-',
    // Hardened runtime only means anything alongside notarization, and enabling it
    // unsigned costs the entitlements without buying the trust.
    hardenedRuntime: false,
    extendInfo: {
      // macOS denies these outright when the usage string is absent, and the
      // failure surfaces to the renderer as an ordinary permission error, so the
      // feature looks broken rather than unapproved.
      NSMicrophoneUsageDescription: 'InterAct 使用麥克風提供即時字幕與同步口譯。',
      NSScreenCaptureUsageDescription: 'InterAct 需要錄製螢幕，才能把畫面上的內容擷取成題目派送給學員。',
    },
  },
  dmg: {
    title: productName,
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
