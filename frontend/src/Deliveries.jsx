import { useEffect, useState } from 'react'
import { missingClientAddressFields, populateDeliveryAddress, requiresClientAddressConfirmation } from './deliveryAddress.js'
import RecordSearch from './RecordSearch.jsx'

const STATUS_LABELS = { na_farmacia: 'Na farmácia', em_transito: 'Em trânsito', concluida: 'Concluída', cancelada: 'Cancelada' }
const emptyForm = { cliente_id: '', entregador_id: '', descricao: '', cep_destino: '', endereco_destino: '', quadra_destino: '', lote_destino: '', numero_destino: '', setor_destino: '', cidade_destino: '', estado_destino: '', observacoes: '' }
const digits = (value) => String(value || '').replace(/\D/g, '')
const cepMask = (value) => digits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
const displayDate = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
const addressSummary = (item) => [item.endereco_destino, item.numero_destino, item.quadra_destino && `Qd. ${item.quadra_destino}`, item.lote_destino && `Lt. ${item.lote_destino}`, item.setor_destino, item.cidade_destino, item.estado_destino].filter(Boolean).join(', ') || 'Endereço não informado'
const clientDetails = (item) => [item.endereco && `${item.endereco}${item.numero ? `, ${item.numero}` : ''}`, item.cpf && `CPF ${item.cpf}`].filter(Boolean).join(' · ')
const delivererDetails = (item) => [item.cpf && `CPF ${item.cpf}`, item.email].filter(Boolean).join(' · ')

export default function Deliveries({ api, csrfToken, onExpired, onDeliveryChange }) {
  const [items, setItems] = useState(null)
  const [filters, setFilters] = useState({ q: '', status: '', cliente_id: '', entregador_id: '', de: '', ate: '' })
  const [clientFilterQuery, setClientFilterQuery] = useState('')
  const [clientFilterSelected, setClientFilterSelected] = useState(null)
  const [delivererFilterQuery, setDelivererFilterQuery] = useState('')
  const [delivererFilterSelected, setDelivererFilterSelected] = useState(null)
  const [reload, setReload] = useState(0)
  const [form, setForm] = useState(emptyForm)
  const [formOpen, setFormOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [returnDetailId, setReturnDetailId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [actionBusy, setActionBusy] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [addressEdited, setAddressEdited] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [statusConfirmationOpen, setStatusConfirmationOpen] = useState(false)
  const [clientQuery, setClientQuery] = useState('')
  const [selectedClient, setSelectedClient] = useState(null)
  const [previousClient, setPreviousClient] = useState(null)
  const [pendingClient, setPendingClient] = useState(null)
  const [delivererQuery, setDelivererQuery] = useState('')
  const [selectedDeliverer, setSelectedDeliverer] = useState(null)

  const queryString = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== '')).toString()
  useEffect(() => {
    let active = true
    api(`/deliveries${queryString ? `?${queryString}` : ''}`).then((result) => { if (active) { setItems(result); setError('') } })
      .catch((requestError) => { if (active) { setItems([]); setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() } })
    return () => { active = false }
  }, [api, onExpired, queryString, reload])
  function changeFilter(field, value) { setItems(null); setFilters((current) => ({ ...current, [field]: value })) }
  function reloadList() { setItems(null); setReload((value) => value + 1) }
  function startNew() {
    setForm({ ...emptyForm }); setSelected(null); setFormOpen(true); setError(''); setAddressEdited(false)
    setReturnDetailId(null)
    setClientQuery(''); setSelectedClient(null); setPreviousClient(null); setPendingClient(null)
    setDelivererQuery(''); setSelectedDeliverer(null)
  }
  function openEdit(item) {
    setSelected(item); setForm({ cliente_id: item.cliente_id, entregador_id: item.entregador_id, descricao: item.descricao, cep_destino: item.cep_destino || '', endereco_destino: item.endereco_destino || '', quadra_destino: item.quadra_destino || '', lote_destino: item.lote_destino || '', numero_destino: item.numero_destino || '', setor_destino: item.setor_destino || '', cidade_destino: item.cidade_destino || '', estado_destino: item.estado_destino || '', observacoes: item.observacoes || '' }); setFormOpen(true); setError(''); setAddressEdited(false); setPendingClient(null)
    setClientQuery(item.cliente_nome || ''); setSelectedClient({ id: item.cliente_id, nome: item.cliente_nome, cpf: item.cliente_cpf }); setPreviousClient(null)
    setDelivererQuery(item.entregador_nome || ''); setSelectedDeliverer({ id: item.entregador_id, nome: item.entregador_nome, cpf: item.entregador_cpf })
  }
  function editFromDetail() {
    if (!detail) return
    const item = detail.entrega
    setReturnDetailId(item.id); setDetail(null); openEdit(item)
  }
  function closeEditForm() {
    const deliveryId = returnDetailId
    setFormOpen(false); setSelected(null); setReturnDetailId(null)
    if (deliveryId) openDetail(deliveryId)
  }
  function openReturnConfirmation() {
    setError(''); setCancelDialogOpen(false); setStatusConfirmationOpen(true)
  }
  function closeReturnConfirmation() {
    if (!actionBusy) { setStatusConfirmationOpen(false); setError('') }
  }
  function changeClientQuery(value) {
    setClientQuery(value)
    setPendingClient(null)
    if (selectedClient) setPreviousClient(selectedClient)
    setSelectedClient(null)
    setForm((current) => ({ ...current, cliente_id: '' }))
  }
  function applyClient(client) {
    setForm((current) => populateDeliveryAddress(current, client))
    setSelectedClient(client); setPreviousClient(null); setClientQuery(client.nome); setPendingClient(null); setAddressEdited(false)
  }
  function selectClient(client) {
    const prior = previousClient || selectedClient
    if (addressEdited && prior && String(prior.id) === String(client.id)) {
      setForm((current) => ({ ...current, cliente_id: String(client.id) }))
      setSelectedClient(prior); setPreviousClient(null); setClientQuery(prior.nome); return
    }
    if (addressEdited && (!prior || requiresClientAddressConfirmation({ cliente_id: prior.id }, client.id, true))) {
      setPendingClient(client); setClientQuery(client.nome); setSelectedClient(null)
      setForm((current) => ({ ...current, cliente_id: '' })); return
    }
    applyClient(client)
  }
  function cancelClientChange() {
    if (previousClient) {
      setSelectedClient(previousClient); setClientQuery(previousClient.nome)
      setForm((current) => ({ ...current, cliente_id: String(previousClient.id) }))
    } else {
      setClientQuery(''); setSelectedClient(null); setForm((current) => ({ ...current, cliente_id: '' }))
    }
    setPreviousClient(null); setPendingClient(null)
  }
  function confirmClientChange() {
    if (pendingClient) applyClient(pendingClient)
  }
  function changeDelivererQuery(value) {
    setDelivererQuery(value); setSelectedDeliverer(null)
    setForm((current) => ({ ...current, entregador_id: '' }))
  }
  function selectDeliverer(deliverer) {
    setSelectedDeliverer(deliverer); setDelivererQuery(deliverer.nome)
    setForm((current) => ({ ...current, entregador_id: String(deliverer.id) }))
  }
  function changeClientFilterQuery(value) {
    setClientFilterQuery(value); setClientFilterSelected(null); changeFilter('cliente_id', '')
  }
  function selectClientFilter(client) {
    setClientFilterSelected(client); setClientFilterQuery(client.nome); changeFilter('cliente_id', String(client.id))
  }
  function changeDelivererFilterQuery(value) {
    setDelivererFilterQuery(value); setDelivererFilterSelected(null); changeFilter('entregador_id', '')
  }
  function selectDelivererFilter(deliverer) {
    setDelivererFilterSelected(deliverer); setDelivererFilterQuery(deliverer.nome); changeFilter('entregador_id', String(deliverer.id))
  }
  function changeDestination(field, value) {
    setForm((current) => ({ ...current, [field]: value })); setAddressEdited(true)
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
      const deliveryId = returnDetailId || (detail && selected ? selected.id : null)
      setReturnDetailId(null)
      if (deliveryId) await openDetail(deliveryId)
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
    const deliveryId = detail?.entrega.id || selected?.id
    if (!deliveryId || actionBusy) return
    const currentStatus = detail?.entrega.status || selected?.status
    const allowed = (currentStatus === 'na_farmacia' && status === 'em_transito') || (currentStatus === 'em_transito' && ['na_farmacia', 'concluida'].includes(status))
    if (!allowed) return
    setActionBusy(true); setError('')
    try {
      const result = await api(`/deliveries/${deliveryId}/status`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ status }) })
      setNotice(result.mensagem); reloadList(); onDeliveryChange()
      if (detail) await openDetail(deliveryId)
      else if (result.entrega.status === 'concluida') { setFormOpen(false); setSelected(null); setReturnDetailId(null); await openDetail(deliveryId) }
      else setSelected((current) => current?.id === deliveryId ? { ...current, status: result.entrega.status } : current)
      return true
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired(); return false }
    finally { setActionBusy(false) }
  }
  async function confirmReturnToPharmacy() {
    if (await updateStatus('na_farmacia')) setStatusConfirmationOpen(false)
  }
  function openCancelDialog() {
    setCancelReason(''); setError(''); setStatusConfirmationOpen(false); setCancelDialogOpen(true)
  }
  function closeCancelDialog() {
    if (actionBusy) return
    setCancelDialogOpen(false); setCancelReason(''); setError('')
  }
  async function cancelDelivery(event) {
    event.preventDefault()
    const deliveryId = detail?.entrega.id || selected?.id
    if (!deliveryId || actionBusy) return
    if (cancelReason.trim().length < 3) { setError('Informe um motivo com pelo menos 3 caracteres.'); return }
    setActionBusy(true); setError('')
    try {
      const result = await api(`/deliveries/${deliveryId}/cancel`, { method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ motivo: cancelReason.trim() }) })
      setNotice(result.mensagem); setCancelDialogOpen(false); setCancelReason(''); reloadList(); onDeliveryChange()
      if (detail) await openDetail(deliveryId)
      else { setFormOpen(false); setSelected(null); setReturnDetailId(null); await openDetail(deliveryId) }
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setActionBusy(false) }
  }

  const missingClientFields = missingClientAddressFields(selectedClient)
  const terminal = detail && ['concluida', 'cancelada'].includes(detail.entrega.status)
  return <section className="users-page deliverers-page" aria-labelledby="deliveries-title">
    <header className="account-heading users-heading"><div><span className="section-label"><i /> OPERAÇÃO</span><h1 id="deliveries-title">Gerenciamento de entregas</h1><p>Cadastre os pedidos, acompanhe o andamento e consulte o histórico de status.</p></div><span className="users-heading-icon" aria-hidden="true">↗</span></header>
    {error && !formOpen && !detail && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
    <div className="deliverer-toolbar"><label className="users-search">Pesquisar descrição, cliente ou entregador<input type="search" placeholder="Ex.: pedido ou nome" value={filters.q} onChange={(event) => changeFilter('q', event.target.value)} /></label><button className="submit-button account-submit" type="button" onClick={startNew}>＋ Nova entrega</button></div>
    <div className="delivery-filters"><label>Status<select value={filters.status} onChange={(event) => changeFilter('status', event.target.value)}><option value="">Todos</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><RecordSearch api={api} endpoint="/clients" label="Cliente" query={clientFilterQuery} selected={clientFilterSelected} onQueryChange={changeClientFilterQuery} onSelect={selectClientFilter} details={clientDetails} onExpired={onExpired} /><RecordSearch api={api} endpoint="/deliverers" label="Entregador" query={delivererFilterQuery} selected={delivererFilterSelected} onQueryChange={changeDelivererFilterQuery} onSelect={selectDelivererFilter} details={delivererDetails} onExpired={onExpired} /><label>De<input type="date" value={filters.de} onChange={(event) => changeFilter('de', event.target.value)} /></label><label>Até<input type="date" value={filters.ate} onChange={(event) => changeFilter('ate', event.target.value)} /></label></div>
    {items === null ? <div className="account-loading"><span className="spinner" /> Carregando entregas...</div> : items.length === 0 ? <div className="users-empty"><span aria-hidden="true">⌕</span><h2>{Object.values(filters).some(Boolean) ? 'Nenhuma entrega encontrada' : 'Nenhuma entrega cadastrada'}</h2><p>{Object.values(filters).some(Boolean) ? 'Ajuste os filtros e tente novamente.' : 'Cadastre a primeira entrega para acompanhar a operação.'}</p></div> : <div className="users-table-wrap"><table className="users-table deliveries-table"><thead><tr><th>ID</th><th>Cliente</th><th>Entregador</th><th>Descrição</th><th>Destino</th><th>Criada em</th><th>Status</th></tr></thead><tbody>{items.map((item) => <tr key={item.id} tabIndex={0} aria-label={`Gerenciar entrega ${item.id}: ${item.descricao}. Pressione Enter ou Espaço para abrir.`} onClick={(event) => { if (event.target.closest('a,button,input,select,textarea,[role="button"]')) return; openDetail(item.id) }} onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDetail(item.id) } }}><td data-label="ID">#{item.id}</td><td data-label="Cliente">{item.cliente_nome} <small>#{item.cliente_id}{item.cliente_cpf ? ` · ${item.cliente_cpf}` : ''}</small></td><td data-label="Entregador">{item.entregador_nome} <small>#{item.entregador_id}{item.entregador_cpf ? ` · ${item.entregador_cpf}` : ''}</small></td><td data-label="Descrição">{item.descricao}</td><td data-label="Destino">{addressSummary(item)}</td><td data-label="Criada em">{displayDate(item.criado_em)}</td><td data-label="Status"><span className={`delivery-status status-${item.status}`}>{STATUS_LABELS[item.status]}</span></td></tr>)}</tbody></table></div>}

    {formOpen && <div className="user-modal-backdrop" role="presentation"><section className="user-modal deliverer-modal delivery-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-form-title"><header className="account-heading"><div><span className="section-label">DADOS DA ENTREGA</span><h2 id="delivery-form-title">{selected ? `Editar entrega #${selected.id}` : 'Nova entrega'}</h2><p>O status inicial é definido automaticamente como Na farmácia.</p></div><button className="modal-close" type="button" aria-label="Fechar" onClick={closeEditForm}>×</button></header>
      {error && !cancelDialogOpen && <p className="error-message" role="alert">{error}</p>}
      {selected && !['concluida', 'cancelada'].includes(selected.status) && <div className="delivery-edit-actions"><span>Status atual: <strong className={`delivery-status status-${selected.status}`}>{STATUS_LABELS[selected.status]}</strong></span><div>{selected.status === 'na_farmacia' && <button type="button" className="submit-button account-submit" disabled={actionBusy} onClick={() => updateStatus('em_transito')}>Marcar em trânsito</button>}{selected.status === 'em_transito' && <><button type="button" className="secondary-button" disabled={actionBusy} onClick={openReturnConfirmation}>Farmácia</button><button type="button" className="submit-button account-submit" disabled={actionBusy} onClick={() => updateStatus('concluida')}>Concluir entrega</button></>}<button type="button" className="danger-button" disabled={actionBusy} onClick={openCancelDialog}>Cancelar entrega</button></div></div>}
      <form onSubmit={save} noValidate><div className="deliverer-fields">
        <RecordSearch api={api} endpoint="/clients" label="Cliente" query={clientQuery} selected={selectedClient} onQueryChange={changeClientQuery} onSelect={selectClient} details={clientDetails} disabled={!!selected} required onExpired={onExpired} />
        <RecordSearch api={api} endpoint="/deliverers" label="Entregador" query={delivererQuery} selected={selectedDeliverer} onQueryChange={changeDelivererQuery} onSelect={selectDeliverer} details={delivererDetails} disabled={!!selected} required onExpired={onExpired} />
        <label className="account-field delivery-full-row">Descrição da entrega *<input required maxLength={500} value={form.descricao} onChange={(event) => setForm({ ...form, descricao: event.target.value })} placeholder="Ex.: medicamentos do pedido" /></label>
        <p className="delivery-address-intro">Destino copiado do cadastro do cliente. Você pode ajustar este snapshot sem alterar o endereço cadastrado.</p>
        {missingClientFields.length > 0 && <p className="delivery-address-intro" role="status">Dados ausentes no cadastro do cliente: {missingClientFields.join(', ')}. Os campos de destino continuam editáveis.</p>}
        {pendingClient && <div className="delivery-prerequisites delivery-client-switch" role="alert"><strong>Substituir o endereço editado?</strong><p>Ao trocar de cliente, o destino será carregado do cadastro do novo cliente. As alterações manuais atuais serão substituídas.</p><button type="button" className="secondary-button" onClick={cancelClientChange}>Manter endereço atual</button> <button type="button" className="submit-button account-submit" onClick={confirmClientChange}>Trocar cliente e carregar endereço</button></div>}
        <label className="account-field">CEP destino<input inputMode="numeric" value={cepMask(form.cep_destino)} onChange={(event) => changeDestination('cep_destino', cepMask(event.target.value))} /></label>
        <label className="account-field">Rua / Logradouro<input maxLength={255} value={form.endereco_destino} onChange={(event) => changeDestination('endereco_destino', event.target.value)} /></label>
        <label className="account-field">Quadra<input maxLength={50} value={form.quadra_destino} onChange={(event) => changeDestination('quadra_destino', event.target.value)} /></label>
        <label className="account-field">Lote<input maxLength={50} value={form.lote_destino} onChange={(event) => changeDestination('lote_destino', event.target.value)} /></label>
        <label className="account-field">Número<input maxLength={30} value={form.numero_destino} onChange={(event) => changeDestination('numero_destino', event.target.value)} /></label>
        <label className="account-field">Setor / bairro<input maxLength={120} value={form.setor_destino} onChange={(event) => changeDestination('setor_destino', event.target.value)} /></label>
        <label className="account-field">Cidade<input maxLength={100} value={form.cidade_destino} onChange={(event) => changeDestination('cidade_destino', event.target.value)} /></label>
        <label className="account-field">Estado / UF<input maxLength={2} value={form.estado_destino} onChange={(event) => changeDestination('estado_destino', event.target.value.toLocaleUpperCase('pt-BR').slice(0, 2))} /></label>
        <label className="account-field delivery-full-row">Observações<textarea rows="3" maxLength={5000} value={form.observacoes} onChange={(event) => setForm({ ...form, observacoes: event.target.value })} /></label>
      </div><div className="account-actions"><button className="secondary-button" type="button" disabled={saving} onClick={closeEditForm}>{returnDetailId ? 'Voltar à entrega' : 'Cancelar'}</button><button className="submit-button account-submit" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Salvando...</> : selected ? 'Salvar alterações' : 'Cadastrar entrega'}</button></div></form>
    </section></div>}

    {(detail || detailLoading) && <div className="user-modal-backdrop" role="presentation"><section className="user-modal delivery-modal" role="dialog" aria-modal="true" aria-labelledby="delivery-detail-title"><header className="account-heading"><div><span className="section-label">ACOMPANHAMENTO</span><h2 id="delivery-detail-title">{detail ? `Entrega #${detail.entrega.id}` : 'Carregando entrega...'}</h2></div><button className="modal-close" type="button" aria-label="Fechar" onClick={() => { setDetail(null); setError('') }}>×</button></header>
      {detailLoading && <div className="account-loading"><span className="spinner" /> Carregando detalhes...</div>}{error && !cancelDialogOpen && <p className="error-message" role="alert">{error}</p>}
      {detail && <><div className="delivery-detail-grid"><div><span>Status</span><strong className={`delivery-status status-${detail.entrega.status}`}>{STATUS_LABELS[detail.entrega.status]}</strong></div><div><span>Cliente</span><strong>{detail.entrega.cliente_nome} · #{detail.entrega.cliente_id}</strong></div><div><span>Entregador</span><strong>{detail.entrega.entregador_nome} · #{detail.entrega.entregador_id}</strong></div><div><span>Criada em</span><strong>{displayDate(detail.entrega.criado_em)}</strong></div><div className="delivery-full-row"><span>Descrição</span><strong>{detail.entrega.descricao}</strong></div><div className="delivery-full-row"><span>Endereço de destino (snapshot)</span><strong>{addressSummary(detail.entrega)}{detail.entrega.cep_destino ? ` · CEP ${cepMask(detail.entrega.cep_destino)}` : ''}</strong></div>{detail.entrega.observacoes && <div className="delivery-full-row"><span>Observações</span><strong className="delivery-preserve-whitespace">{detail.entrega.observacoes}</strong></div>}{detail.entrega.motivo_cancelamento && <div className="delivery-full-row"><span>Motivo do cancelamento</span><strong className="delivery-preserve-whitespace">{detail.entrega.motivo_cancelamento}</strong></div>}</div>
        {!terminal && <div className="delivery-detail-actions"><button type="button" className="secondary-button" disabled={actionBusy} onClick={editFromDetail}>Editar</button>{detail.entrega.status === 'na_farmacia' && <button type="button" className="submit-button account-submit" disabled={actionBusy} onClick={() => updateStatus('em_transito')}>Marcar em trânsito</button>}{detail.entrega.status === 'em_transito' && <><button type="button" className="secondary-button" disabled={actionBusy} onClick={openReturnConfirmation}>Farmácia</button><button type="button" className="submit-button account-submit" disabled={actionBusy} onClick={() => updateStatus('concluida')}>Concluir entrega</button></>}<button type="button" className="danger-button" disabled={actionBusy} onClick={openCancelDialog}>Cancelar entrega</button></div>}
        <h3 className="delivery-history-title">Histórico de status</h3>{detail.historico.length ? <ol className="delivery-history">{detail.historico.map((entry) => <li key={entry.id}><strong>{STATUS_LABELS[entry.status_novo]}</strong><span>{entry.status_anterior ? `${STATUS_LABELS[entry.status_anterior]} → ` : 'Criada em '}{displayDate(entry.criado_em)}</span>{entry.usuario_nome && <small>Por {entry.usuario_nome}</small>}{entry.motivo && <small>Motivo: {entry.motivo}</small>}</li>)}</ol> : <p>Sem alterações registradas.</p>}</>}
    </section></div>}
    {cancelDialogOpen && <div className="user-modal-backdrop delivery-cancel-backdrop" role="presentation"><section className="user-modal delivery-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-delivery-title"><header className="account-heading"><div><span className="section-label">CONFIRMAÇÃO</span><h2 id="cancel-delivery-title">Cancelar entrega</h2><p>Entrega #{detail?.entrega.id || selected?.id}. O cancelamento não pode ser revertido.</p></div><button className="modal-close" type="button" aria-label="Fechar" disabled={actionBusy} onClick={closeCancelDialog}>×</button></header>{error && <p className="error-message" role="alert">{error}</p>}<form onSubmit={cancelDelivery} noValidate><label className="account-field">Motivo do cancelamento *<textarea required rows="4" maxLength={2000} value={cancelReason} onChange={(event) => { setCancelReason(event.target.value); if (error) setError('') }} placeholder="Descreva o motivo do cancelamento" /></label><div className="account-actions"><button type="button" className="secondary-button" disabled={actionBusy} onClick={closeCancelDialog}>Voltar</button><button type="submit" className="danger-button" disabled={actionBusy || cancelReason.trim().length < 3}>{actionBusy ? <><span className="spinner" /> Confirmando...</> : 'Confirmar cancelamento'}</button></div></form></section></div>}
    {statusConfirmationOpen && <div className="user-modal-backdrop delivery-cancel-backdrop" role="presentation"><section className="user-modal delivery-cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="return-status-title"><header className="account-heading"><div><span className="section-label">CONFIRMAÇÃO</span><h2 id="return-status-title">Voltar para Na farmácia</h2><p>Confirme o retorno da entrega #{detail?.entrega.id || selected?.id} para a farmácia.</p></div><button className="modal-close" type="button" aria-label="Fechar" disabled={actionBusy} onClick={closeReturnConfirmation}>×</button></header>{error && <p className="error-message" role="alert">{error}</p>}<div className="account-actions"><button type="button" className="secondary-button" disabled={actionBusy} onClick={closeReturnConfirmation}>Manter em trânsito</button><button type="button" className="submit-button account-submit" disabled={actionBusy} onClick={confirmReturnToPharmacy}>{actionBusy ? 'Atualizando...' : 'Confirmar retorno'}</button></div></section></div>}
  </section>
}
