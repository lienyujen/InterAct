import { backendConfig } from './supabase'

// Students load this shared page instead of one the presenter has to deploy, so
// the link has to say which Supabase project the session lives in.
const DEFAULT_PUBLIC_APP_URL = 'https://lienyujen.github.io/InterAct'

export function buildJoinUrl(sessionReference: string) {
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined
  const fallback = typeof window !== 'undefined' && window.location.protocol.startsWith('http')
    ? `${window.location.origin}${window.location.pathname}`
    : DEFAULT_PUBLIC_APP_URL
  const base = (configuredBase || fallback).replace(/\/$/, '')
  const project = backendConfig
    ? `?p=${encodeURIComponent(backendConfig.ref)}&k=${encodeURIComponent(backendConfig.key)}`
    : ''
  return `${base}/#/join/${sessionReference}${project}`
}
