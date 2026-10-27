/**
 * dsh-bluefish-pet — client half.
 *
 * Adds a compact "桌宠" toggle to the DSH sidebar footer. It talks to the host
 * half's `/bluefish-pet/*` routes; the host owns the process control.
 *
 * The pet's own control port (`127.0.0.1:47113`) is the primary source of
 * truth: DSH's desktop build does not always expose host plugin routes, and
 * the App answers on that port whenever it is alive. When *neither* source
 * answers, the pet is gone — the button must say so instead of keeping the
 * last label it saw.
 *
 * Client plugins in DSH are plain scripts registered through the module loader
 * (not ES modules), so this file intentionally has no import/export syntax.
 */
window.__ModuleLoader__.load({
  id: 'dsh-bluefish-pet',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const DIRECT_API = 'http://127.0.0.1:47113'
    const HOST_API = '/bluefish-pet'
    /** How often the button re-checks the pet. */
    const POLL_MS = 4000
    /** The App answers on loopback instantly; a missing port fails instantly too. */
    const PROBE_TIMEOUT_MS = 1200
    /** After asking the host to launch the App, wait this long for its port. */
    const LAUNCH_WAIT_MS = 9000

    function timeoutSignal(ms) {
      const timeout = globalThis.AbortSignal?.timeout
      return typeof timeout === 'function' ? timeout(ms) : undefined
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    async function readJson(url, options, timeoutMs = PROBE_TIMEOUT_MS) {
      try {
        const response = await fetch(url, {
          cache: 'no-store',
          signal: timeoutSignal(timeoutMs),
          ...(options ?? {})
        })
        if (!response.ok) return null
        const data = await response.json()
        return data?.ok ? data : null
      } catch {
        return null
      }
    }

    function normalize(data) {
      return {
        running: data.running === true,
        visible: data.visible !== false,
        /** False when nothing answered: the pet is not reachable right now. */
        reachable: true
      }
    }

    const GONE = { running: false, visible: false, reachable: false }

    /**
     * `{ running, visible, reachable }`.
     *
     * The App's own port is preferred (it is live and cheap). The host route is
     * the fallback, because it can still start the App on installs that expose
     * it. Neither answering means the pet is not running.
     */
    async function probeStatus() {
      const direct = await readJson(`${DIRECT_API}/status`)
      if (direct) return normalize(direct)
      const host = await readJson(`${HOST_API}/status`, undefined, 4000)
      if (host) return normalize(host)
      return GONE
    }

    /** Wait for the App to come up after a launch request. */
    async function waitForPet(timeoutMs) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const status = await probeStatus()
        if (status.running) return status
        await sleep(500)
      }
      return probeStatus()
    }

    function BlueFishButton() {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')

      useEffect(() => {
        let alive = true
        const apply = (next) => {
          if (alive) setStatus(next)
        }

        // The host route owns process start on installs that expose it. When it
        // is missing (DSH desktop), this 404s and we simply probe the App.
        const autoStart = async () => {
          const ensured = await readJson(`${HOST_API}/ensure`, { method: 'POST' }, 6000)
          if (ensured?.status) {
            apply(normalize(ensured.status))
            return
          }
          apply(await probeStatus())
        }
        void autoStart()

        const tick = () => {
          if (!document.hidden) void probeStatus().then(apply)
        }
        const timer = window.setInterval(tick, POLL_MS)
        // Coming back to the window should not wait for the next tick.
        window.addEventListener('focus', tick)
        document.addEventListener('visibilitychange', tick)
        return () => {
          alive = false
          window.clearInterval(timer)
          window.removeEventListener('focus', tick)
          document.removeEventListener('visibilitychange', tick)
        }
      }, [])

      const toggle = useCallback(async () => {
        if (busy) return
        setBusy(true)
        const current = status ?? (await probeStatus())
        try {
          if (current.running) {
            const data = (await readJson(`${HOST_API}/toggle`, { method: 'POST' }, 6000)) ??
              (await readJson(`${DIRECT_API}/toggle`, { method: 'POST' }))
            if (data?.text) setToast(data.text)
            setStatus(data?.status ? normalize(data.status) : await probeStatus())
            return
          }

          // Not running: ask the host to launch it (works wherever host routes
          // exist), otherwise fall back to the App's own URL scheme.
          const started = await readJson(`${HOST_API}/toggle`, { method: 'POST' }, 6000) ??
            await readJson(`${DIRECT_API}/toggle`, { method: 'POST' })
          if (started?.status) {
            setStatus(normalize(started.status))
            if (started.text) setToast(started.text)
            return
          }

          const isMac = /Mac/i.test(globalThis.navigator?.userAgent ?? '')
          if (isMac) {
            setToast('正在唤醒鲸鱼娘…')
            try {
              window.location.href = 'bluefish://show'
            } catch {
              /* the OS may refuse the scheme; the probe below reports the truth */
            }
            const after = await waitForPet(LAUNCH_WAIT_MS)
            setStatus(after)
            if (!after.running) setToast('没唤醒成功：手动打开鲸鱼娘，或确认它还是 127.0.0.1:47113')
            return
          }

          setToast('没探测到鲸鱼娘：先打开 App，或确认控制端口 47113 没被占用')
          setStatus(await probeStatus())
        } finally {
          setBusy(false)
          window.setTimeout(() => setToast(''), 3600)
        }
      }, [busy, status])

      const running = status?.running === true
      const visible = running && status?.visible !== false
      const dotColor = !running ? 'rgba(150,160,180,.55)' : visible ? '#54e39a' : '#f2b54d'
      const label = !running ? '鲸鱼娘' : visible ? '鲸鱼娘 开' : '鲸鱼娘 隐'
      // A status that never got an answer reads as "not running"; the tooltip
      // keeps the difference between "quit" and "port did not answer".
      const offlineTitle = status?.reachable === false
        ? '没探测到鲸鱼娘的控制端口（127.0.0.1:47113），点击尝试启动'
        : '点击启动鲸鱼娘桌宠'
      const title = toast ||
        (busy ? '处理中…' : !running
          ? offlineTitle
          : visible ? '点击隐藏鲸鱼娘' : '点击显示鲸鱼娘')

      return h('button', {
        type: 'button',
        onClick: () => { void toggle() },
        disabled: busy,
        title,
        'aria-label': title,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 9px',
          borderRadius: 999,
          border: '1px solid rgba(120,170,220,.28)',
          background: 'rgba(40,90,150,.12)',
          color: 'inherit',
          cursor: busy ? 'default' : 'pointer',
          font: 'inherit',
          fontSize: 11,
          lineHeight: 1.25,
          opacity: busy ? 0.6 : 1
        }
      },
        h('span', {
          style: {
            width: 6,
            height: 6,
            borderRadius: 999,
            background: dotColor,
            display: 'inline-block',
            flex: '0 0 auto'
          }
        }),
        h('span', null, label)
      )
    }

    exports.name = 'dsh-bluefish-pet'
    exports.apply = (ctx) => {
      try {
        const mount = (ctx) => {
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register({
              name: 'sidebar.footer.action',
              id: 'bluefish-pet',
              order: 4,
              inject: () => ({})
            }, BlueFishButton)
          )
        }
        if (typeof ctx.inject === 'function') ctx.inject(['slots'], mount)
        else mount(ctx)
      } catch (error) {
        console.error('[dsh-bluefish-pet] client init failed', error)
      }
    }

    return module.exports
  }
})
