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
      listCaptureSources: () => Promise<InterActCaptureSource[]>
      captureFirstScreen: () => Promise<InterActCaptureSource>
    }
  }
}
