/**
 * Regression test for the sidebar label: the button must never keep claiming
 * 「鲸鱼娘 开」 after the App is quit (the client cannot reach it any more).
 *
 *   node --test test/
 *
 * The client half is a plain DSH module-loader script, so it is loaded through
 * a small React + fetch stub instead of a browser.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** url prefix → handler returning `{ ok?, body }` or an Error to throw. */
const routes = new Map()
const calls = []

async function fetchStub(url, options = {}) {
  calls.push(`${options.method ?? 'GET'} ${url}`)
  const hit = [...routes.entries()].find(([prefix]) => url.startsWith(prefix))
  if (!hit) throw new Error('ECONNREFUSED')
  const result = await hit[1](url, options)
  if (result instanceof Error) throw result
  return { ok: result.ok !== false, async json() { return result.body } }
}

const DIRECT_STATUS = 'http://127.0.0.1:47113/status'

function createRuntime(getComponent) {
  let hookIndex = 0
  const state = []
  const effects = []
  let effectsRan = false
  let queued = false

  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => { queued = false; draw() })
  }

  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      const index = hookIndex++
      if (!(index in state)) state[index] = initial
      const set = (next) => {
        state[index] = typeof next === 'function' ? next(state[index]) : next
        schedule()
      }
      return [state[index], set]
    },
    useCallback: (fn) => { hookIndex++; return fn },
    useEffect(fn) { const index = hookIndex++; if (!effects[index]) effects[index] = fn }
  }

  function draw() {
    hookIndex = 0
    const tree = getComponent()()
    if (!effectsRan) {
      effectsRan = true
      for (const fn of effects) fn?.()
    }
    return tree
  }

  return { React, draw }
}

function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { node.forEach((child) => collectText(child, out)); return out }
  if (node.children) node.children.forEach((child) => collectText(child, out))
  return out
}

const timers = []
const windowStub = {
  __ModuleLoader__: { load: ({ factory }) => { loaded = factory(requireStub) } },
  setInterval: (fn) => { timers.push(fn); return timers.length },
  clearInterval: () => {},
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  addEventListener: () => {},
  removeEventListener: () => {},
  location: { href: '' }
}
const documentStub = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} }

const component = { current: null }
const runtime = createRuntime(() => component.current)
let loaded
const requireStub = (id) => {
  if (id !== 'react') throw new Error(`unexpected require(${id})`)
  return runtime.React
}

new Function('window', 'document', 'fetch', 'globalThis', source)(
  windowStub, documentStub, fetchStub, globalThis
)

const ctx = {
  slots: {
    inject: (_name, cb) => cb(ctx),
    register: (_meta, Component) => { component.current = Component; return () => {} }
  },
  inject: (_deps, cb) => cb(ctx)
}

const flush = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)) }
const label = () => collectText(runtime.draw()).join(' ')
const poll = async () => { timers.forEach((fn) => fn()); await flush() }

test('sidebar label follows the pet, and never sticks on 开 after it quits', async () => {
  loaded.apply(ctx)

  runtime.draw()
  await flush()
  assert.equal(label(), '鲸鱼娘', 'off before anything answers')

  routes.set(DIRECT_STATUS, () => ({ body: { ok: true, running: true, visible: true } }))
  await poll()
  assert.equal(label(), '鲸鱼娘 开')

  routes.set(DIRECT_STATUS, () => ({ body: { ok: true, running: true, visible: false } }))
  await poll()
  assert.equal(label(), '鲸鱼娘 隐')

  // The reported bug: the App quits, its port closes, and the host route is
  // missing on DSH desktop (404), so both probes fail.
  routes.clear()
  routes.set('/bluefish-pet/ensure', () => ({ ok: false, body: null }))
  routes.set('/bluefish-pet/status', () => ({ ok: false, body: null }))
  await poll()
  assert.equal(label(), '鲸鱼娘', 'quit must not leave 「鲸鱼娘 开」 behind')

  // Host route alone is still honoured.
  routes.set('/bluefish-pet/status', () => ({ body: { ok: true, running: true, visible: true } }))
  await poll()
  assert.equal(label(), '鲸鱼娘 开')
})
