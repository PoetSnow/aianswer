/** 开发者模式：默认关闭，演示给招聘方时勿开启 */

export const DEV_MODE_KEY = 'aianswer-dev-mode'

type Listener = (on: boolean) => void
const listeners = new Set<Listener>()

function readFlag(): boolean {
  try {
    if (typeof window === 'undefined') return false
    const q = new URLSearchParams(window.location.search).get('dev')
    if (q === '1' || q === 'true') return true
    if (q === '0' || q === 'false') return false
    return localStorage.getItem(DEV_MODE_KEY) === '1'
  } catch {
    return false
  }
}

let enabled = false
try {
  enabled = readFlag()
} catch {
  enabled = false
}

function notify() {
  for (const fn of listeners) fn(enabled)
}

export function isDevMode(): boolean {
  return enabled
}

export function setDevMode(on: boolean) {
  enabled = on
  try {
    if (on) localStorage.setItem(DEV_MODE_KEY, '1')
    else localStorage.removeItem(DEV_MODE_KEY)
  } catch {
    /* ignore */
  }
  notify()
}

export function toggleDevMode(): boolean {
  setDevMode(!enabled)
  return enabled
}

export function subscribeDevMode(fn: Listener): () => void {
  listeners.add(fn)
  fn(enabled)
  return () => {
    listeners.delete(fn)
  }
}
