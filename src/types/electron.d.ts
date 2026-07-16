export {}

declare global {
  interface InterActCaptureSource {
    id: string
    name: string
    width: number
    height: number
    thumbnailDataUrl: string
    appIconDataUrl: string | null
  }

  interface Window {
    interactDesktop?: {
      isDesktop: boolean
      platform: string
      enterPresenterMode: (sessionId: string) => Promise<void>
      setPresenterExpanded: (expanded: boolean) => Promise<void>
      openSessionReport: (sessionId: string) => Promise<void>
      minimize: () => Promise<void>
      close: () => Promise<void>
      listCaptureSources: () => Promise<InterActCaptureSource[]>
      startCaptureSelection: () => Promise<InterActCaptureSource>
      finishCaptureSelection: (expanded?: boolean) => Promise<void>
    }
  }
}
