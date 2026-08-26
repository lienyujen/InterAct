export type AppEdition = 'standard' | 'plus'

export const APP_EDITION: AppEdition = import.meta.env.VITE_APP_EDITION === 'standard' ? 'standard' : 'plus'

export const isPlusEdition = APP_EDITION === 'plus'
