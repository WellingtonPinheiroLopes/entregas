import { useCallback, useEffect, useState } from 'react'

const DEFAULT_NOTICE = 'Há uma nova entrega disponível.'

function formatDate(value) {
  const date = new Date(typeof value === 'string' && value.includes(' ') ? value.replace(' ', 'T') : value)
  if (Number.isNaN(date.valueOf())) return ''
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}

export default function Notifications({ api, csrfToken, onExpired, onOpenDeliveries }) {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const result = await api('/notifications')
      setNotifications(result.notifications || [])
      setUnreadCount(Number(result.unreadCount || 0))
      setError('')
    } catch (requestError) {
      if (/sessão|autentica/i.test(requestError.message)) onExpired?.()
      else setError(requestError.message)
    } finally { if (showLoading) setLoading(false) }
  }, [api, onExpired])

  useEffect(() => {
    refresh()
    const timer = window.setInterval(() => refresh(), 30000)
    return () => window.clearInterval(timer)
  }, [refresh])

  async function markRead(id) {
    try {
      const result = await api(`/notifications/${id}/read`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken } })
      setNotifications((items) => items.map((item) => item.id === id ? { ...item, lida: true } : item))
      setUnreadCount(Number(result.unreadCount || 0))
    } catch (requestError) {
      if (/sessão|autentica/i.test(requestError.message)) onExpired?.()
      else setError(requestError.message)
    }
  }

  async function markAllRead() {
    try {
      await api('/notifications/read-all', { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken } })
      setNotifications((items) => items.map((item) => ({ ...item, lida: true })))
      setUnreadCount(0)
    } catch (requestError) {
      if (/sessão|autentica/i.test(requestError.message)) onExpired?.()
      else setError(requestError.message)
    }
  }

  async function selectNotification(item) {
    if (!item.lida) await markRead(item.id)
    setOpen(false)
    // Deliberately open the authorized list rather than a delivery URL. An
    // assignment may have changed since the notification was created.
    onOpenDeliveries()
  }

  return <div className="notification-control">
    <button type="button" className="notification-trigger" aria-label={`Notificações${unreadCount ? `, ${unreadCount} não lidas` : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen((value) => !value); if (!open) refresh(true) }}>
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <section className="notifications-popover" role="dialog" aria-label="Notificações">
      <header className="notifications-heading"><strong>Notificações</strong>{unreadCount > 0 && <button type="button" onClick={markAllRead}>Marcar todas como lidas</button>}</header>
      {error && <p className="notifications-error" role="alert">{error}</p>}
      {loading ? <p className="notifications-empty">Carregando...</p> : notifications.length === 0 ? <p className="notifications-empty">Nenhuma notificação.</p> : <ul className="notifications-list">{notifications.map((item) => <li key={item.id}>
        <button type="button" className={`notification-item ${item.lida ? 'is-read' : ''}`} onClick={() => selectNotification(item)}>
          <span className="notification-dot" aria-hidden="true" />
          <span className="notification-copy"><strong>{item.mensagem || DEFAULT_NOTICE}</strong><time dateTime={item.criado_em}>{formatDate(item.criado_em)}</time></span>
        </button>
        {!item.lida && <button type="button" className="notification-mark-read" aria-label="Marcar como lida" onClick={() => markRead(item.id)}>Marcar lida</button>}
      </li>)}</ul>}
    </section>}
  </div>
}
