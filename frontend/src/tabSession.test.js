import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { coordinateTabSession, getTabSessionCredential, setTabSessionCredential } from './tabSession.js'

test('guia duplicada descarta a credencial copiada antes de criar uma sessão anônima', async () => {
  const previous = {
    window: globalThis.window,
    sessionStorage: globalThis.sessionStorage,
    BroadcastChannel: globalThis.BroadcastChannel,
  }
  const values = new Map()
  const listeners = new Map()
  globalThis.window = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
    dispatchEvent: () => true,
  }
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
  globalThis.BroadcastChannel = class {
    addEventListener(_name, listener) { this.listener = listener }
    postMessage(message) {
      if (message.type === 'hello') queueMicrotask(() => this.listener?.({ data: { type: 'peer', id: 'older-tab', createdAt: 1, fingerprint: message.fingerprint } }))
    }
    close() {}
  }

  try {
    setTabSessionCredential('copied-session-credential')
    const calls = []
    const result = await coordinateTabSession(async (path) => {
      calls.push([path, getTabSessionCredential()])
      setTabSessionCredential('new-anonymous-session')
      return { csrfToken: 'new-csrf' }
    }, 'copied-csrf')
    assert.equal(result.forked, true)
    assert.equal(result.csrfToken, 'new-csrf')
    assert.deepEqual(calls, [['/auth/csrf', '']])
    assert.equal(getTabSessionCredential(), 'new-anonymous-session')
    result.close()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key]
      else globalThis[key] = value
    }
    setTabSessionCredential('')
  }
})

test('frontend envia credencial tab-scoped e não envia cookies do navegador', async () => {
  const source = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  assert.match(source, /'X-Tab-Session': tabCredential/)
  assert.match(source, /credentials: 'omit'/)
  assert.doesNotMatch(source, /credentials: 'include'/)
})
