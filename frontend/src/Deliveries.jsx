import { useEffect, useState } from 'react'
import { populateDeliveryAddress, requiresClientAddressConfirmation } from './deliveryAddress.js'

const STATUS_LABELS = { na_farmacia: 'Na farmácia', em_transito: 'Em trânsito', concluida: 'Concluída', cancelada: 'Cancelada' }
const emptyForm = { cliente_id: '', entregador_id: '', descricao: '', cep_destino: '', endereco_destino: '', quadra_destino: '', lote_destino: '', numero_destino: '', setor_destino: '', cidade_destino: '', estado_destino: '', observacoes: '' }
const digits = (value) => String(value || '').replace(/\D/g, '')
const cepMask = (value) => digits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
const displayDate = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
const addressSummary = (item) => [item.endereco_destino, item.numero_destino, item.quadra_destino && `Qd. ${item.quadra_destino}`, item.lote_destino && `Lt. ${item.lote_destino}`, item.setor_destino, item.cidade_destino, item.estado_destino].filter(Boolean).join(', ') || 'Endereço não informado'

export default function Deliveries({ api, csrfToken, onExpired, onNavigate, onDeliveryChange }) {
  const [items, setItems] = useState(null)
  const [clients, setClients] = useState([])
  const [deliverers, setDeliverers] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [filters, setFilters] = useState({ q: '', status: '', cliente_id: '', entregador_id: '', de: '', ate: '' })
  const [reload, setReload] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [addressEdited, setAddressEdited] = useState(false)
  const [pendingClientId, setPendingClientId] = useState(null)

  const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString()
  useEffect(() => {
    let active = true
    api(`/deliveries${queryString ? `?${queryString}` : ''}`).then((result) => { if (active) { setItems(result); setError('') } })
      .catch((requestError) => { if (active) { setItems([]); setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() } })
    return () => { active = false }
  }, [api, onExpired, queryString, reload])
  function changeFilter(field, value) { setItems(null); setFilters((current) => ({ ...current, [field]: value })) }
  function reloadList() { setItems(null); setReload((value) => value + 1) }
  useEffect(() => {
    let active = true
    Promise.all([api('/clients'), api('/deliverers')]).then(([clientRows, delivererRows]) => {
      if (active) { setClients(clientRows); setDeliverers(delivererRows) }
    }).catch((requestError) => {
      if (active) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    }).finally(() => active && setOptionsLoading(false))
    return () => { active = false }
  }, [api, onExpired])

  function startNew() { setForm({ ...emptyForm }); setSelected(null); setFormOpen(true); setError(''); setAddressEdited(false); setPendingClientId(null) }
  function openEdit(item) {
    setSelected(item); setForm({ cliente_id: item.cliente_id, entregador_id: item.entregador_id, descricao: item.descricao, cep_destino: item.cep_destino || '', endereco_destino: item.endereco_destino || '', quadra_destino: item.quadra_destino || '', lote_destino: item.lote_destino || '', numero_destino: item.numero_destino || '', setor_destino: item.setor_destino || '', cidade_destino: item.cidade_destino || '', estado_destino: item.estado_destino || '', observacoes: item.observacoes || '' }); setFormOpen(true); setError(''); setAddressEdited(false); setPendingClientId(null)
  }
  function selectClient(id) {
    const client = clients.find((item) => String(item.id) === String(id))
    if (!client) { setForm((current) => ({ ...current, cliente_id: '' })); return }
    if (requiresClientAddressConfirmation(form, id, addressEdited)) { setPendingClientId(String(id)); return }
    setForm((current) => populateDeliveryAddress(current, client)); setAddressEdited(false); setPendingClientId(null)
  }
  function changeDestination(field, value) {
    setForm((current) => ({ ...current, [field]: value })); setAddressEdited(true)
  }
  function confirmClientChange() {
    const client = clients.find((item) => String(item.id) === pendingClientId)
    if (client) setForm((current) => populateDeliveryAddress(current, client))
    setAddressEdited(false); setPendingClientId(null)
  }
  async function save(event) {
    event.preventDefault(); setError('')
    if (!form.cliente_id || !form.entregador_id) { setError('Selecione um cliente e um entregador.'); return }
    if (!form.descricao.trim()) { setError('Informe a descrição da entrega.'); return }
    if (digits(form.cep_destino).length && digits(form.cep_destino).length !== 8) { setError('O CEP de destino deve ter 8 dígitos.'); return }
    setSaving(true)
    const payload = { ...form, cep_destino: digits(form.cep_destino) || null, descricao: form.descricao.trim() }
    if (selected) delete payload.cliente_id
    try {
      const result = await api(selected ? `/deliveries/${selected.id}` : '/deliveries', { method: selected ? 'PATCH' : 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) })
      setNotice(result.mensagem); setFormOpen(false); setSelected(null); reloadList(); onDeliveryChange()
      if (detail && selected) await openDetail(selected.id)
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setSaving(false) }
  }
  async function openDetail(id) {
    setDetailLoading(true); setError('')
    try { setDetail(await api(`/deliveries/${id}`)) }
    catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setDetailLoading(false) }
  }
  async function updateStatus(status) {
    if (!detail || actionBusy) return
    setActionBusy(true); setError('')
    try {
      const result = await api(`/deliveries/${detail.entrega.id}/status`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ status }) })
      setNotice(result.mensagem); await openDetail(detail.entrega.id); reloadList(); onDeliveryChange()
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setActionBusy(false) }
  }
  async function cancelDelivery() {
    if (!detail || actionBusy) return
    setActionBusy(true); setError('')
    try {
      const result = await api(`/deliveries/${detail.entrega.id}/cancel`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ motivo: cancelReason }) })
      setNotice(result.mensagem); setCancelReason(''); await openDetail(detail.entrega.id); reloadList(); onDeliveryChange()
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setActionBusy(false) }
  }

  const noClients = !optionsLoading && clients.length === 0
  const noDeliverers = !optionsLoading && deliverers.length === 0
  const terminal = detail && ['concluida', 'cancelada'].includes(detail.entrega.status)
  return <section className="users-page deliverers-page" aria-labelledby="deliveries-title">
    <header className="account-heading users-heading"><div><span className="section-label"><i /> OPERAÇÃO</span><h1 id="deliveries-title">Gerenciamento de entregas</h1><p>Cadastre os pedidos, acompanhe o andamento e consulte o histórico de status.</p></div><span className="users-heading-icon" aria-hidden="true">↗</span></header>
    {error && !formOpen && !detail && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
    {(noClients || noDeliverers) && <div className="delivery-prerequisites" role="status"><strong>Antes de cadastrar:</strong>{noClients && <span>Nenhum cliente cadastrado. <button type="button" className="text-link-button" onClick={() => onNavigate('clients')}>Abrir Clientes</button></span>}{noDeliverers && <span>Nenhum entregador cadastrado. <button type="button" className="text-link-button" onClick={() => onNavigate('deliverers')}>Abrir Entregadores</button></span>}</div>}
    <div className="deliverer-toolbar"><label className="users-search">Pesquisar descrição, cliente ou entregador<input type="search" placeholder="Ex.: pedido ou nome" value={filters.q} onChange={(event) => changeFilter('q', event.target.value)} /></label><button className="submit-button account-submit" type="button" onClick={startNew} disabled={optionsLoading || noClients || noDeliverers}>＋ Nova entrega</button></div>
    <div className="delivery-filters"><label>Status<select value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}><option value="">Todos</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Cliente<select value={filters.cliente_id} onChange={(event) => changeFilter('cliente_id', event.target.value)}><option value="">Todos</option>{clients.map((item) => <option value={item.id} key={item.id}>{item.nome} · #{item.id}{item.cpf ? ` · ${item.cpf}` : ''}</option>)}</select></label><label>Entregador<select value={filters.entregador_id} onChange={(event) => changeFilter('entregador_id', event.target.value)}><option value="">Todos</option>{deliverers.map((item) => <option value={item.id} key={item.id}>{item.nome} · #{item.id}{item.cpf ? ` · ${item.cpf}` : ''}</option>)}</select></label><label>De<input type="date" value={filters.de} onChange={(event) => changeFilter('de', event.target.value)} /></label><label>Até<input type="date" value={filters.ate} onChange={(event) => changeFilter('ate', event.target.value)} /></label></div>
    {items === null ? <div className="account-loading"><span className="spinner" /> Carregando entregas...</div> : items.length === 0 ? <div className="users-empty"><span aria-hidden="true">⌕</span><h2>{Object.values(filters).some(Boolean) ? 'Nenhuma entrega encontrada' : 'Nenhuma entrega cadastrada'}</h2><p>{Object.values(filters).some(Boolean) ? 'Ajuste os filtros e tente novamente.' : 'Cadastre a primeira entrega para acompanhar a operação.'}</p></div> : <div className="users-table-wrap"><table className="users-table deliveries-table"><thead><tr><th>ID</th><th>Cliente</th><th>Entregador</th><th>Descrição</th><th>Destino</th><th>Criada em</th><th>Status</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="ID">#{item.id}</td><td data-label="Cliente">{item.cliente_nome} <small>#{item.cliente_id}{item.cliente_cpf ? ` · ${item.cliente_cpf}` : ''}</small></td><td data-label="Entregador">{item.entregador_nome} <small>#{item.entregador_id}{item.entregador_cpf ? ` · ${item.entregador_cpf}` : ''}</small></td><td data-label="Descrição">{item.descricao}</td><td data-label="Destino">{addressSummary(item)}</td><td data-label="Criada em">{displayDate(item.criado_em)}</td><td data-label="Status"><span className={`delivery-status status-${item.status}`}>{STATUS_LABELS[item.status]}</span></td><td data-label="Ações"><div className="deliverer-row-actions"><button className="edit-user-button" type="button" onClick={() => openDetail(item.id)}>Detalhes</button>{!['concluida', 'cancelada'].includes(item.status) && <button className="edit-user-button" type="button" onClick={() => openEdit(item)}>Editar</button>}</div></td></tr>)}</tbody></table></div>}

    {formOpen && <div className="user-modal-backdrop" role="presentation"><section className="user-modal deliverer-modal delivery-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-form-title"><header className="account-heading"><div><span className="section-label">DADOS DA ENTREGA</span><h2 id="delivery-form-title">{selected ? `Editar entrega #${selected.id}` : 'Nova entrega'}</h2><p>O status inicial é definido automaticamente como Na farmácia.</p></div><button className="modal-close" type="button" aria-label="Fechar" onClick={() => setFormOpen(false)}>×</button></header>
      {error && <p className="error-message" role="alert">{error}</p>}
      {noClients || noDeliverers ? <div className="delivery-prerequisites"><strong>Vínculos necessários</strong>{noClients && <p>Cadastre primeiro um cliente. <button type="button" className="text-link-button" onClick={() => onNavigate('clients')}>Abrir Clientes</button></p>}{noDeliverers && <p>Cadastre primeiro um entregador. <button type="button" className="text-link-button" onClick={() => onNavigate('deliverers')}>Abrir Entregadores</button></p>}</div> : <form onSubmit={save} noValidate><div className="deliverer-fields">
        <label className="account-field">Cliente *<select required disabled={!!selected} value={form.cliente_id} onChange={(event) => selectClient(event.target.value)}><option value="">Selecione um cliente</option>{clients.map((item) => <option value={item.id} key={item.id}>{item.nome} · #{item.id}{item.cpf ? ` · CPF ${item.cpf}` : ''}{item.endereco ? ` · ${item.endereco}` : ''}</option>)}</select></label>
        <label className="account-field">Entregador *<select required value={form.entregador_id} onChange={(event) => setForm({ ...form, entregador_id: event.target.value })}><option value="">Selecione um entregador</option>{deliverers.map((item) => <option value={item.id} key={item.id}>{item.nome} · #{item.id}{item.cpf ? ` · CPF ${item.cpf}` : ''}{item.email ? ` · ${item.email}` : ''}</option>)}</select></label>
        <label className="account-field delivery-full-row">Descrição da entrega *<input required maxLength={500} value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} placeholder="Ex.: medicamentos do pedido" /></label>
        <p className="delivery-address-intro">Destino copiado do cadastro do cliente. Você pode ajustar este snapshot sem alterar o endereço cadastrado.</p>
        {pendingClientId && <div className="delivery-prerequisites delivery-client-switch" role="alert"><strong>Substituir o endereço editado?</strong><p>Ao trocar de cliente, o destino será carregado do cadastro do novo cliente. As alterações manuais atuais serão substituídas.</p><button type="button" className="secondary-button" onClick={() => setPendingClientId(null)}>Manter endereço atual</button> <button type="button" className="submit-button account-submit" onClick={confirmClientChange}>Trocar cliente e carregar endereço</button></div>}
        <label className="account-field">CEP destino<input inputMode="numeric" value={cepMask(form.cep_destino)} onChange={(event) => changeDestination('cep_destino', cepMask(event.target.value))} /></label>
        <label className="account-field">Rua / Logradouro<input maxLength={255} value={form.endereco_destino} onChange={(event) => changeDestination('endereco_destino', event.target.value)} /></label>
        <label className="account-field">Quadra<input maxLength={50} value={form.quadra_destino} onChange={(event) => changeDestination('quadra_destino', event.target.value)} /></label>
        <label className="account-field">Lote<input maxLength={50} value={form.lote_destino} onChange={(event) => changeDestination('lote_destino', event.target.value)} /></label>
        <label className="account-field">Número<input maxLength={30} value={form.numero_destino} onChange={(event) => changeDestination('numero_destino', event.target.value)} /></label>
        <label className="account-field">Setor / bairro<input maxLength={120} value={form.setor_destino} onChange={(event) => changeDestination('setor_destino', event.target.value)} /></label>
        <label className="account-field">Cidade<input maxLength={100} value={form.cidade_destino} onChange={(event) => changeDestination('cidade_destino', event.target.value)} /></label>
        <label className="account-field">Estado / UF<input maxLength={2} value={form.estado_destino} onChange={(event) => changeDestination('estado_destino', event.target.value.toLocaleUpperCase('pt-BR').slice(0, 2))} /></label>
        <label className="account-field delivery-full-row">Observações<textarea rows="3" maxLength={5000} value={form.observacoes} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} /></label>
      </div><div className="account-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</button><button className="submit-button account-submit" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Salvando...</> : selected ? 'Salvar alterações' : 'Cadastrar entrega'}</button></div></form>}
    </section></div>}

    {(detail || detailLoading) && <div className="user-modal-backdrop" role="presentation"><section className="user-modal delivery-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-detail-title"><header className="account-heading"><div><span className="section-label">ACOMPANHAMENTO</span><h2 id="delivery-detail-title">{detail ? `Entrega #${detail.entrega.id}` : 'Carregando entrega...'}</h2></div><button className="modal-close" type="button" aria-label="Fechar" onClick={() => { setDetail(null); setError('') }}>×</button></header>
      {detailLoading && <div className="account-loading"><span className="spinner" /> Carregando detalhes...</div>}{error && <p className="error-message" role="alert">{error}</p>}
      {detail && <><div className="delivery-detail-grid"><div><span>Status</span><strong className={`delivery-status status-${detail.entrega.status}`}>{STATUS_LABELS[detail.entrega.status]}</strong></div><div><span>Cliente</span><strong>{detail.entrega.cliente_nome} · #{detail.entrega.cliente_id}</strong></div><div><span>Entregador</span><strong>{detail.entrega.entregador_nome} · #{detail.entrega.entregador_id}</strong></div><div><span>Criada em</span><strong>{displayDate(detail.entrega.criado_em)}</strong></div><div className="delivery-full-row"><span>Descrição</span><strong>{detail.entrega.descricao}</strong></div><div className="delivery-full-row"><span>Endereço de destino (snapshot)</span><strong>{addressSummary(detail.entrega)}{detail.entrega.cep_destino ? ` · CEP ${cepMask(detail.entrega.cep_destino)}` : ''}</strong></div>{detail.entrega.observacoes && <div className="delivery-full-row"><span>Observações</span><strong className="delivery-preserve-whitespace">{detail.entrega.observacoes}</strong></div>}{detail.entrega.motivo_cancelamento && <div className="delivery-full-row"><span>Motivo do cancelamento</span><strong className="delivery-preserve-whitespace">{detail.entrega.motivo_cancelamento}</strong></div>}</div>
        {!terminal && <div className="delivery-detail-actions">{detail.entrega.status === 'na_farmacia' && <button type="button" className="submit-button account-submit" disabled={actionBusy} onClick={() => updateStatus('em_transito')}>Marcar em trânsito</button>}{detail.entrega.status === 'em_transito' && <button type="button" className="submit-button account-submit" disabled={actionBusy} onClick={() => updateStatus('concluida')}>Concluir entrega</button>}<label className="account-field">Motivo para cancelar<textarea rows="2" maxLength={2000} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Informe por que esta entrega será cancelada" /></label><button type="button" className="danger-button" disabled={actionBusy || cancelReason.trim().length < 3} onClick={cancelDelivery}>{actionBusy ? 'Salvando...' : 'Cancelar entrega'}</button></div>}
        <h3 className="delivery-history-title">Histórico de status</h3>{detail.historico.length ? <ol className="delivery-history">{detail.historico.map((entry) => <li key={entry.id}><strong>{STATUS_LABELS[entry.status_novo]}</strong><span>{entry.status_anterior ? `${STATUS_LABELS[entry.status_anterior]} → ` : 'Criada em '}{displayDate(entry.criado_em)}</span>{entry.usuario_nome && <small>Por {entry.usuario_nome}</small>}{entry.motivo && <small>Motivo: {entry.motivo}</small>}</li>)}</ol> : <p>Sem alterações registradas.</p>}</>}
    </section></div>}
  </section>
}
