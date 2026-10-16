const SESSION_KEY = 'entregas.tab-session.v1'
const CHANNEL_NAME = 'entregas.tab-session.coordination.v1'
let memoryCredential = ''

export function getTabSessionCredential() {
  try { return sessionStorage.getItem(SESSION_KEY) || memoryCredential } catch { return memoryCredential }
}

export function setTabSessionCredential(credential) {
  memoryCredential = credential || ''
  try {
    if (credential) sessionStorage.setItem(SESSION_KEY, credential)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch { /* A browser with disabled storage remains usable in this tab. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('entregas-tab-session-changed'))
}

async function fingerprint(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') return ''
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function compareTab(a, b) {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
}

// sessionStorage is normally per-tab, but browsers may copy it when duplicating
// a tab. A short-lived same-origin handshake detects that copy. The newer tab
// forks to a fresh anonymous server session before it exposes authenticated UI.
export async function coordinateTabSession(api, csrfToken) {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return { csrfToken, close() {} }
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
  const createdAt = performance.timeOrigin || Date.now()
  const self = { id, createdAt }
  const channel = new BroadcastChannel(CHANNEL_NAME)
  const peers = new Map()
  let activeFingerprint = await fingerprint(getTabSessionCredential())
  const announce = async () => {
    activeFingerprint = await fingerprint(getTabSessionCredential())
    if (activeFingerprint) channel.postMessage({ type: 'hello', ...self, fingerprint: activeFingerprint })
  }
  const hear = async (message) => {
    if (!message || message.id === id || !message.fingerprint) return
    activeFingerprint = await fingerprint(getTabSessionCredential())
    if (!activeFingerprint || message.fingerprint !== activeFingerprint) return
    peers.set(message.id, { id: message.id, createdAt: message.createdAt })
    if (message.type === 'hello') channel.postMessage({ type: 'peer', id, createdAt, fingerprint: activeFingerprint })
  }
  channel.addEventListener('message', (event) => { hear(event.data) })
  const onCredentialChange = () => { announce() }
  window.addEventListener('entregas-tab-session-changed', onCredentialChange)
  channel.postMessage({ type: 'hello', ...self, fingerprint: activeFingerprint })
  await new Promise((resolve) => setTimeout(resolve, 180))

  let nextCsrfToken = csrfToken
  const olderPeer = [...peers.values()].some((peer) => compareTab(peer, self) < 0)
  if (olderPeer && activeFingerprint) {
    // Drop the duplicated bearer locally before creating an anonymous session.
    // Do not destroy or regenerate the shared server session: the older tab
    // still owns it and must remain authenticated.
    setTabSessionCredential('')
    const fork = await api('/auth/csrf')
    nextCsrfToken = fork.csrfToken
    activeFingerprint = await fingerprint(getTabSessionCredential())
  }

  // Keep the channel alive for later duplicated tabs. Credentials themselves
  // are never broadcast; only their SHA-256 fingerprints are exchanged.
  return { csrfToken: nextCsrfToken, forked: olderPeer, close: () => { window.removeEventListener('entregas-tab-session-changed', onCredentialChange); channel.close() } }
}
