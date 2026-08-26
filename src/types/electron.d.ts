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
      setPresenterExpanded: (expanded: boolean, settingsOpen?: boolean, interactiveOpen?: boolean) => Promise<void>
      setLotteryInteraction: (enabled: boolean) => Promise<void>
      showLottery: (event: SessionEvent) => Promise<void>
      getLatestLottery: () => Promise<SessionEvent | null>
      onLottery: (callback: (event: SessionEvent) => void) => () => void
      openSessionReport: (sessionId: string, generate?: boolean) => Promise<void>
      returnFromSessionReport: () => Promise<boolean>
      openWordCloud: (sessionId: string) => Promise<void>
      openCustomQuizReview: (sessionId: string, questionId: string) => Promise<void>
      minimize: () => Promise<void>
      close: () => Promise<void>
      listCaptureSources: () => Promise<InterActCaptureSource[]>
      startCaptureSelection: () => Promise<InterActCaptureSource>
      finishCaptureSelection: (expanded?: boolean) => Promise<void>
      logDiagnostic: (details: Record<string, string | number | boolean | null | undefined>) => Promise<void>
    }
  }
}
