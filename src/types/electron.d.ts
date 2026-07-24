import type { SessionEvent } from './index'

export {}

declare global {
  interface InterActCaptureSource {
    id: string
    displayId: string | null
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
      setLotteryInteraction: (enabled: boolean) => Promise<void>
      showLottery: (event: SessionEvent) => Promise<void>
      getLatestLottery: () => Promise<SessionEvent | null>
      onLottery: (callback: (event: SessionEvent) => void) => () => void
      openSessionReport: (sessionId: string) => Promise<void>
      openWordCloud: (sessionId: string) => Promise<void>
      startWindowDrag: (screenX: number, screenY: number) => void
      moveWindowDrag: (screenX: number, screenY: number) => void
      endWindowDrag: () => void
      minimize: () => Promise<void>
      close: () => Promise<void>
      listCaptureSources: () => Promise<InterActCaptureSource[]>
      getScreenCapturePermission: () => Promise<'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'>
      openScreenCaptureSettings: () => Promise<boolean>
      startCaptureSelection: () => Promise<InterActCaptureSource>
      finishCaptureSelection: (expanded?: boolean) => Promise<void>
    }
  }
}
