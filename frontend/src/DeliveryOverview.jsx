import { useEffect, useState } from 'react'

const statuses = [
  ['na_farmacia', 'Na farmácia'], ['em_transito', 'Em trânsito'],
  ['concluida', 'Concluídas'], ['cancelada', 'Canceladas'],
]

export default function DeliveryOverview({ api, version = 0 }) {
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api('/deliveries/summary').then((result) => active && setSummary(result))
      .catch((requestError) => active && setError(requestError.message))
    return () => { active = false }
  }, [api, version])
  return <section className="delivery-overview" aria-label="Resumo das entregas">
    <div className="delivery-overview-heading"><div><span className="section-label">OPERAÇÃO</span><h2>Entregas</h2></div><div className="delivery-total"><strong>{summary?.total ?? '—'}</strong><span>Total</span></div></div>
    {error ? <p className="error-message" role="alert">Não foi possível carregar os indicadores: {error}</p> : <div className="delivery-metrics" aria-live="polite">{statuses.map(([status, label]) => <div className={`delivery-metric metric-${status}`} key={status}><strong>{summary?.statuses?.[status] ?? '—'}</strong><span>{label}</span></div>)}</div>}
    {summary?.total === 0 && <p className="delivery-zero-note">Ainda não há entregas cadastradas.</p>}
  </section>
}
