/**
 * dsh-bluefish-pet — start / hide / quit the BlueFish desktop pet from DSH.
 *
 * Host-only plugin. It registers slash commands (`/pet`, `/pet-start`,
 * `/pet-hide`, `/pet-show`, `/pet-quit`, `/pet-status`) whose handlers run in
 * the DSH Node process and drive the pet through its `bluefish://` URL scheme
 * (plus `/usr/bin/open` to launch it when it is not running).
 */
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin.log')

/** Diagnostic log; also makes "did auto-start run?" answerable after a restart. */
function log(message) {
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* logging must never break the plugin */
  }
}

log('module loaded')

export const name = 'dsh-bluefish-pet'
/** The command registry is the only DSH service this plugin needs. */
export const inject = []

const STATE_FILE = join(homedir(), '.dsh', 'storages', 'bluefish-pet.json')
const PROCESS_PATTERNS = ['Contents/MacOS/WhaleGirl', 'Contents/MacOS/BlueFish']

/** Where the pet app may live, most specific first. */
export function appCandidates() {
  return [
    process.env.WHALEGIRL_APP,
    process.env.BLUEFISH_APP,
    join(homedir(), 'project/myself/dshpeg/build/WhaleGirl.app'),
    join(homedir(), 'project/myself/dshpeg/build/BlueFish.app'),
    '/Applications/WhaleGirl.app',
    '/Applications/BlueFish.app',
    join(homedir(), 'Applications/WhaleGirl.app'),
    join(homedir(), 'Applications/BlueFish.app')
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)
}

export function findApp() {
  return appCandidates().find((candidate) => existsSync(candidate))
}

export async function isRunning() {
  for (const pattern of PROCESS_PATTERNS) {
    try {
      const { stdout } = await run('/usr/bin/pgrep', ['-f', pattern])
      if (stdout.trim().length > 0) return true
    } catch {
      /* pgrep exits 1 when nothing matches */
    }
  }
  return false
}

/** `{ running, visible }` — visible comes from the pet's own state file. */
export async function petStatus() {
  const running = await isRunning()
  let visible = null
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    if (typeof parsed?.visible === 'boolean') visible = parsed.visible
  } catch {
    /* no state file yet */
  }
  return { running, visible }
}

async function openTarget(target) {
  await run('/usr/bin/open', [target])
}

export async function ensureRunning() {
  if (await isRunning()) return
  await startPet()
}

export async function startPet() {
  const app = findApp()
  if (app === undefined) {
    throw new Error('没找到 WhaleGirl.app，可用 WHALEGIRL_APP 环境变量指定路径')
  }
  await openTarget(app)
  return '已启动鲸鱼娘桌宠'
}

/**
 * One of `toggle | show | hide | quit`. Starts the app first when needed;
 * `hide` on a stopped pet is a no-op with a friendly message.
 */
export async function petAction(action) {
  if (action === 'quit') {
    if (!(await isRunning())) return '鲸鱼娘本来就没开着'
    await openTarget('bluefish://quit')
    return '已让鲸鱼娘退出'
  }

  const running = await isRunning()
  if (!running) {
    if (action === 'hide') return '鲸鱼娘本来就没开着'
    await startPet()
    if (action === 'show' || action === 'toggle') return '已启动鲸鱼娘桌宠'
    return '已启动鲸鱼娘桌宠'
  }

  await openTarget(`bluefish://${action}`)
  switch (action) {
    case 'toggle': return '已切换鲸鱼娘的显示 / 隐藏'
    case 'show': return '鲸鱼娘出来啦'
    case 'hide': return '鲸鱼娘藏起来了（再点菜单栏的小鱼可以叫回来）'
    default: return 'done'
  }
}

async function statusText() {
  const { running, visible } = await petStatus()
  if (!running) return '鲸鱼娘没有运行'
  if (visible === false) return '鲸鱼娘在运行，但已隐藏'
  return '鲸鱼娘正在桌面上'
}

function ok(text) {
  return { kind: 'success', text }
}

function fail(error) {
  return { kind: 'error', text: String(error?.message ?? error) }
}

const STATUS_ROUTE = '/bluefish-pet/status'
const TOGGLE_ROUTE = '/bluefish-pet/toggle'

function sendJson(res, body, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(JSON.stringify(body))
}

async function serveStatus(res) {
  try {
    sendJson(res, { ok: true, ...(await petStatus()) })
  } catch (error) {
    sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500)
  }
}

async function serveEnsure(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, { ok: false, error: 'POST only' }, 405)
    return
  }
  try {
    await ensureRunning()
    sendJson(res, { ok: true, status: await petStatus() })
  } catch (error) {
    sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500)
  }
}

async function serveToggle(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, { ok: false, error: 'POST only' }, 405)
    return
  }
  try {
    const text = await petAction('toggle')
    sendJson(res, { ok: true, text, status: await petStatus() })
  } catch (error) {
    sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500)
  }
}

function registerRoutes(ctx) {
  const install = (c) => {
    if (!c.webServer) {
      log('webServer service unavailable')
      return
    }
    c.effect(
      () => c.webServer.register({ kind: 'prefix', path: STATUS_ROUTE, handler: (req, res) => { void serveStatus(res) } }),
      'bluefish-pet: status route'
    )
    c.effect(
      () => c.webServer.register({ kind: 'prefix', path: TOGGLE_ROUTE, handler: (req, res) => { void serveToggle(req, res) } }),
      'bluefish-pet: toggle route'
    )
    c.effect(
      () => c.webServer.register({ kind: 'prefix', path: ENSURE_ROUTE, handler: (req, res) => { void serveEnsure(req, res) } }),
      'bluefish-pet: ensure route'
    )
    log('web routes registered')
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], install)
  else if (ctx.webServer) install(ctx)
  else log('webServer service unavailable (no inject)')
}

function registerCommands(ctx) {
  const install = (c) => {
    if (!c.commands) {
      log('commands service unavailable')
      return
    }
    const register = (commandName, description, action) => {
      c.effect(
        () => c.commands.register({
          name: commandName,
          description,
          handler: async () => {
            try {
              return ok(action === undefined ? await statusText() : await petAction(action))
            } catch (error) {
              return fail(error)
            }
          }
        }),
        `bluefish-pet: command ${commandName}`
      )
    }
    register('pet', '启动 / 显示 / 隐藏鲸鱼娘桌面宠物', 'toggle')
    register('pet-start', '启动鲸鱼娘桌面宠物', 'show')
    register('pet-show', '显示鲸鱼娘桌面宠物', 'show')
    register('pet-hide', '隐藏鲸鱼娘桌面宠物', 'hide')
    register('pet-quit', '退出鲸鱼娘桌面宠物', 'quit')
    register('pet-status', '查看鲸鱼娘是否在运行 / 显示中', undefined)
    log('commands registered')
  }
  if (typeof ctx.inject === 'function') ctx.inject(['commands'], install)
  else if (ctx.commands) install(ctx)
  else log('commands service unavailable (no inject)')
}

export function apply(ctx, config = {}) {
  // Cordis forbids reading ctx.config without injecting `config`; the plugin
  // config is passed as the second apply argument instead.
  const settings = { autoStart: true, ...(config ?? {}) }
  log(`plugin applied: autoStart=${settings.autoStart !== false}`)
  try {
    registerCommands(ctx)
  } catch (error) {
    log(`commands setup failed: ${error?.stack ?? error}`)
  }
  try {
    registerRoutes(ctx)
  } catch (error) {
    log(`routes setup failed: ${error?.stack ?? error}`)
  }

  // Start the pet together with DSH so it never has to be opened by hand.
  // Disable with `config: { autoStart: false }` on the profile entry.
  if (process.platform === 'darwin' && settings.autoStart !== false) {
    const attempt = async (index) => {
      log(`auto start attempt ${index}`)
      try {
        await ensureRunning()
        const state = await petStatus()
        log(`auto start ok: running=${state.running} visible=${state.visible}`)
        if (!state.running && index < 2) setTimeout(() => { void attempt(index + 1) }, 2500)
      } catch (error) {
        log(`auto start error: ${error?.stack ?? error}`)
        if (index < 2) setTimeout(() => { void attempt(index + 1) }, 2500)
      }
    }
    setTimeout(() => { void attempt(0) }, 1500)
  }
}
