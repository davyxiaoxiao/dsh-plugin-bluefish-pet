/**
 * dsh-bluefish-pet — client half.
 *
 * Adds a compact "桌宠" toggle to the DSH sidebar footer. It talks to the host
 * half's `/bluefish-pet/*` routes; the host owns the process control.
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

    const API = 'http://127.0.0.1:47113'

    function BlueFishButton() {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const [toast, setToast] = useState('')

      const refresh = useCallback(async () => {
        try {
          const response = await fetch(`${API}/status`, { cache: 'no-store' })
          if (!response.ok) return
          const data = await response.json()
          if (data?.ok) {
            setStatus({ running: data.running === true, visible: data.visible !== false })
          }
        } catch {
          /* DSH host restarting — leave the last state */
        }
      }, [])

      useEffect(() => {
        // Second auto-start path: if the GUI mounts and the pet is not running,
        // start it through the host. `/status` + `/toggle` exist in every
        // version of the host, so this also works before a host-code reload.
        const autoStart = async () => {
          try {
            const response = await fetch(`${API}/status`, { cache: 'no-store' })
            if (!response.ok) return
            const data = await response.json()
            if (!data?.ok) return
            setStatus({ running: data.running === true, visible: data.visible !== false })
            if (data.running === true) return
            const started = await fetch(`${API}/toggle`, { method: 'POST' })
            const info = await started.json()
            if (info?.status) {
              setStatus({ running: info.status.running === true, visible: info.status.visible !== false })
            }
          } catch {
            /* host not ready yet */
          }
        }
        void autoStart()
        const timer = window.setInterval(() => { void refresh() }, 5000)
        return () => window.clearInterval(timer)
      }, [refresh])

      const toggle = useCallback(async () => {
        if (busy) return
        setBusy(true)
        try {
          const response = await fetch(`${API}/toggle`, { method: 'POST' })
          const data = await response.json()
          if (data?.status) {
            setStatus({ running: data.status.running === true, visible: data.status.visible !== false })
          }
          if (data?.text) setToast(data.text)
        } catch {
          setToast('切换失败')
        } finally {
          setBusy(false)
          window.setTimeout(() => setToast(''), 3200)
        }
      }, [busy])

      const running = status?.running === true
      const visible = running && status?.visible !== false
      const dotColor = !running ? 'rgba(150,160,180,.55)' : visible ? '#54e39a' : '#f2b54d'
      const label = !running ? '鲸鱼娘' : visible ? '鲸鱼娘 开' : '鲸鱼娘 隐'
      const title = toast || (!running ? '点击启动鲸鱼娘桌宠' : visible ? '点击隐藏鲸鱼娘' : '点击显示鲸鱼娘')

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
