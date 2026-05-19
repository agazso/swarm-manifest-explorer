import { browser } from '$app/environment'

const KEY_BEE = 'snaha.manifest-explorer.beeUrl'
const KEY_LAST_REF = 'snaha.manifest-explorer.lastRef'

export const DEFAULT_BEE = 'https://api.gateway.ethswarm.org'
const HEX64 = /^[0-9a-f]{64}$/
const ENS = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.eth$/i

function load(key: string, fallback: string): string {
  if (!browser) return fallback
  return localStorage.getItem(key) ?? fallback
}

export const settings = $state({
  beeUrl: load(KEY_BEE, DEFAULT_BEE),
  lastRef: load(KEY_LAST_REF, ''),
})

export function setBeeUrl(url: string): void {
  settings.beeUrl = url.trim().replace(/\/$/, '')
  if (browser) localStorage.setItem(KEY_BEE, settings.beeUrl)
}

export function setLastRef(ref: string): void {
  const trimmed = ref.trim()
  settings.lastRef = isEnsName(trimmed) ? trimmed.toLowerCase() : normHex(trimmed)
  if (browser) localStorage.setItem(KEY_LAST_REF, settings.lastRef)
}

export function normHex(s: string): string {
  return s.trim().toLowerCase().replace(/^0x/, '')
}

export function isHex64(s: string): boolean {
  return HEX64.test(s)
}

export function isEnsName(s: string): boolean {
  return ENS.test(s)
}

export function isValidManifestInput(s: string): boolean {
  return isHex64(s) || isEnsName(s)
}

export function shortRef(ref: string): string {
  if (isEnsName(ref)) return ref
  if (!isHex64(ref)) return '(invalid)'
  return `${ref.slice(0, 10)}…${ref.slice(-6)}`
}
