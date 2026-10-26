/**
 * dsh-bluefish-pet — start / hide / show / quit the WhaleGirl desktop pet
 * from DSH, on macOS and Windows.
 *
 * Host-only plugin. The control port (`127.0.0.1:47113`) is the primary API;
 * launching the app is platform-specific (open the .app on macOS, spawn the
 * installed .exe on Windows). The `bluefish://` scheme is kept as a macOS
 * fallback for older builds.
 */
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const LOG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugin.log')
const IS_MAC = process.platform === 'darwin'
const IS_WIN = process.platform === 'win32'
const CONTROL_BASE = 'http://127.0.0.1:47113'
const STATE_FILE = join(homedir(), '.dsh', 'storages', 'bluefish-pet.json')
const PROCESS_PATTERNS = [
  'Contents/MacOS/whalegirl-app',
  'Contents/MacOS/WhaleGirl',
  'Contents/MacOS/BlueFish'
]

/** Diagnostic log; also makes "did auto-start run?" answerable after a restart. */
function log(message) {
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${message}\n`)
  } catch {
    /* logging must never break the plugin */
  }
}

log(`module loaded platform=${process.platform} arch=${process.arch}`)

export const name = 'dsh-bluefish-pet'
/** The command registry is the only DSH service this plugin needs. */
export const inject = []

/** Where the pet app may live, most specific first. */
export function appCandidates(settings = {}) {
  const candidates = [
    settings.appPath,
    process.env.WHALEGIRL_APP,
    process.env.BLUEFISH_APP
  ]

  if (IS_MAC) {
    candidates.push(
      '/Applications/鲸鱼娘.app',
      '/Applications/WhaleGirl.app',
      '/Applications/BlueFish.app',
      join(homedir(), 'Applications/鲸鱼娘.app'),
      join(homedir(), 'Applications/WhaleGirl.app'),
      join(homedir(), 'Applications/BlueFish.app')
    )
  }

  if (IS_WIN) {
    const local = process.env.LOCALAPPDATA
    const programs = process.env.ProgramFiles
    const programsX86 = process.env['ProgramFiles(x86)']
    const bases = [
      local && join(local, '鲸鱼娘'),
      local && join(local, 'Programs', '鲸鱼娘'),
      programs && join(programs, '鲸鱼娘'),
      programsX86 && join(programsX86, '鲸鱼娘'),
      local && join(local, 'WhaleGirl'),
      local && join(local, 'Programs', 'WhaleGirl'),
      programs && join(programs, 'WhaleGirl'),
      programsX86 && join(programsX86, 'WhaleGirl')
    ].filter(Boolean)
    for (const base of bases) {
      candidates.push(join(base, 'whalegirl-app.exe'))
      candidates.push(join(base, '鲸鱼娘.exe'))
    }
  }

  return [...new Set(candidates.filter((candidate) => typeof candidate === 'string' && candidate.length > 0))]
}

export function findApp(settings = {}) {
  for (const candidate of appCandidates(settings)) {
    try {
      if (!existsSync(candidate)) continue
      if (IS_MAC && candidate.endsWith('.app')) return candidate
      if (statSync(candidate).isDirectory()) {
        const exe = IS_WIN ? join(candidate, 'whalegirl-app.exe') : join(candidate, 'whalegirl-app')
        if (existsSync(exe)) return exe
        continue
      }
      return candidate
    } catch {
      /* keep looking */
    }
  }
  return undefined
}

async function controlRequest(path, method = 'GET') {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 900)
  try {
    const response = await fetch(`${CONTROL_BASE}${path}`, {
      method,
      signal: controller.signal
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function isProcessRunning() {
  if (IS_WIN) {
    try {
      const { stdout } = await run('tasklist', ['/FI', 'IMAGENAME eq whalegirl-app.exe', '/NH'])
      return /whalegirl-app\.exe/i.test(stdout)
    } catch {
      return false
    }
  }

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

export async function isRunning() {
  const status = await controlRequest('/status')
  if (status?.running) return true
  return isProcessRunning()
}

/** `{ running, visible, board }` — the control port is authoritative. */
export async function petStatus() {
  const status = await controlRequest('/status')
  if (status?.running) {
    return {
      running: true,
      visible: typeof status.visible === 'boolean' ? status.visible : null,
      board: Boolean(status.board)
    }
  }

  const running = await isProcessRunning()
  let visible = null
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'))
    if (typeof parsed?.visible === 'boolean') visible = parsed.visible
  } catch {
    /* no state file yet */
  }
  return { running, visible, board: null }
}

async function waitUntilRunning(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const status = await controlRequest('/status')
    if (status?.running) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

async function openTarget(target) {
  if (IS_MAC) {
    await run('/usr/bin/open', [target])
    return
  }
  if (IS_WIN) {
    await run('cmd', ['/c', 'start', '', target])
    return
  }
  throw new Error(`当前平台 ${process.platform} 暂不支持启动鲸鱼娘`)
}

export async function startPet(settings = {}) {
  const app = findApp(settings)
  if (app !== undefined) {
    if (IS_MAC) {
      await run('/usr/bin/open', [app])
    } else if (IS_WIN) {
      const child = spawn(app, [], { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
    } else {
      throw new Error(`当前平台 ${process.platform} 暂不支持启动鲸鱼娘`)
    }
  } else if (IS_MAC) {
    // Bundle id fallback for a renamed / moved app.
    await run('/usr/bin/open', ['-b', 'com.daiwei.whalegirl'])
  } else {
    const searched = appCandidates(settings).map((candidate) => `  - ${candidate}`).join('\n')
    throw new Error(`没找到鲸鱼娘，可用 WHALEGIRL_APP 指定路径。\n搜索过：\n${searched}`)
  }

  if (!(await waitUntilRunning(8000))) {
    throw new Error('鲸鱼娘已启动，但 127.0.0.1:47113 没有响应；请确认宠物窗口已经出现')
  }
  return '已启动鲸鱼娘桌宠'
}

export async function ensureRunning(settings = {}) {
  if (await isRunning()) return
  await startPet(settings)
}

/**
 * One of `toggle | show | hide | quit`. Starts the app first when needed.
 */
export async function petAction(action, settings = {}) {
  if (action === 'quit') {
    if (!(await isRunning())) return '鲸鱼娘本来就没开着'
    if (await controlRequest('/quit', 'POST')) return '已让鲸鱼娘退出'
    if (IS_MAC) {
      await openTarget('bluefish://quit')
      return '已让鲸鱼娘退出'
    }
    if (IS_WIN) {
      await run('taskkill', ['/IM', 'whalegirl-app.exe', '/F'])
      return '已结束鲸鱼娘进程'
    }
    throw new Error('鲸鱼娘在运行，但控制端口没有响应')
  }

  const running = await isRunning()
  if (!running) {
    if (action === 'hide') return '鲸鱼娘本来就没开着'
    await startPet(settings)
    return '已启动鲸鱼娘桌宠'
  }

  const response = await controlRequest(`/${action}`, 'POST')
  if (response == null) {
    if (IS_MAC) {
      await openTarget(`bluefish://${action}`)
    } else {
      throw new Error('鲸鱼娘在运行，但 127.0.0.1:47113 控制端口没有响应')
    }
  }

  switch (action) {
    case 'toggle':
      return '已切换鲸鱼娘的显示 / 隐藏'
    case 'show':
      return '鲸鱼娘出来啦'
    case 'hide':
      return '鲸鱼娘藏起来了（再点菜单栏 / 托盘的小鱼可以叫回来）'
    default:
      return 'done'
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
const ENSURE_ROUTE = '/bluefish-pet/ensure'

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

async function serveEnsure(req, res, settings) {
  if (req.method !== 'POST') {
    sendJson(res, { ok: false, error: 'POST only' }, 405)
    return
  }
  try {
    await ensureRunning(settings)
    sendJson(res, { ok: true, status: await petStatus() })
  } catch (error) {
    sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500)
  }
}

async function serveToggle(req, res, settings) {
  if (req.method !== 'POST') {
    sendJson(res, { ok: false, error: 'POST only' }, 405)
    return
  }
  try {
    const text = await petAction('toggle', settings)
    sendJson(res, { ok: true, text, status: await petStatus() })
  } catch (error) {
    sendJson(res, { ok: false, error: String(error?.message ?? error) }, 500)
  }
}

function registerRoutes(ctx, settings) {
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
      () => c.webServer.register({ kind: 'prefix', path: TOGGLE_ROUTE, handler: (req, res) => { void serveToggle(req, res, settings) } }),
      'bluefish-pet: toggle route'
    )
    c.effect(
      () => c.webServer.register({ kind: 'prefix', path: ENSURE_ROUTE, handler: (req, res) => { void serveEnsure(req, res, settings) } }),
      'bluefish-pet: ensure route'
    )
    log('web routes registered')
  }
  if (typeof ctx.inject === 'function') ctx.inject(['webServer'], install)
  else if (ctx.webServer) install(ctx)
  else log('webServer service unavailable (no inject)')
}

function registerCommands(ctx, settings) {
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
              return ok(action === undefined ? await statusText() : await petAction(action, settings))
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
  log(`plugin applied: autoStart=${settings.autoStart !== false} appPath=${settings.appPath ?? '-'}`)
  try {
    registerCommands(ctx, settings)
  } catch (error) {
    log(`commands setup failed: ${error?.stack ?? error}`)
  }
  try {
    registerRoutes(ctx, settings)
  } catch (error) {
    log(`routes setup failed: ${error?.stack ?? error}`)
  }

  // Start the pet together with DSH. Disable with `config: { autoStart: false }`.
  if ((IS_MAC || IS_WIN) && settings.autoStart !== false) {
    const attempt = async (index) => {
      log(`auto start attempt ${index}`)
      try {
        await ensureRunning(settings)
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
