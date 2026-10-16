import { useCallback, useEffect, useRef, useState } from 'react'
import { lookupCep, mergeViaCep } from './address.js'
import { deleteDelivererRequest, removeDelivererFromList } from './deliverers.js'

const emptyForm = { nome: '', email: '', cpf: '', cidade: '', estado: '', cep: '', endereco: '', quadra: '', lote: '', numero: '', setor: '' }
const states = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
const digits = (value) => value.replace(/\D/g, '')
const cpfMask = (value) => digits(value).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
const cepMask = (value) => digits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')

export default function Deliverers({ api, csrfToken, onExpired }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [senhaInicial, setSenhaInicial] = useState('')
  const [showInitialPassword, setShowInitialPassword] = useState(false)
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [cepMessage, setCepMessage] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const cepRequest = useRef(0)
  const listRequest = useRef(0)

  const refresh = useCallback(async (term = query, showLoading = true) => {
    const requestId = ++listRequest.current
    if (showLoading) setLoading(true)
    try {
      const nextItems = await api(`/deliverers${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`)
      if (requestId === listRequest.current) setItems(nextItems)
    } catch (requestError) {
      if (requestId === listRequest.current) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    } finally { if (requestId === listRequest.current) setLoading(false) }
  }, [api, onExpired, query])
  useEffect(() => { refresh(query, false) }, [refresh, query])

  useEffect(() => {
    const requestId = ++cepRequest.current
    const cep = digits(form.cep)
    if (cep.length !== 8) return undefined
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setCepLoading(true); setCepMessage('')
      try {
        const address = await lookupCep(cep, (url) => fetch(url, { signal: controller.signal }))
        if (requestId !== cepRequest.current) return
        setForm((current) => mergeViaCep(current, address))
        setCepMessage(address.logradouro || address.bairro ? 'Endereço localizado. Confira e ajuste os dados se necessário.' : 'CEP localizado, mas sem logradouro ou setor. Preencha manualmente.')
      } catch (requestError) {
        if (requestError.name !== 'AbortError' && requestId === cepRequest.current) setCepMessage(requestError.message || 'Não foi possível consultar o CEP. Preencha o endereço manualmente.')
      } finally { if (requestId === cepRequest.current) setCepLoading(false) }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [form.cep])
  function startNew() { setFormOpen(true); setSelected(null); setForm({ ...emptyForm }); setSenhaInicial(''); setShowInitialPassword(false); setError(''); setNotice(''); setCepMessage('') }
  function closeForm() { setFormOpen(false); setSelected(null); setForm({ ...emptyForm }); setSenhaInicial(''); setShowInitialPassword(false); setError(''); setCepMessage('') }
  function startEdit(item) { setFormOpen(true); setSelected(item); setForm(Object.fromEntries(Object.keys(emptyForm).map((key) => [key, item[key] || '']))); setError(''); setNotice(''); setCepMessage('') }
  async function save(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (!form.nome.trim()) { setError('Informe o nome completo.'); return }
    if (!selected && ([...senhaInicial].length < 1 || [...senhaInicial].length > 10)) { setError('A senha inicial deve ter de 1 a 10 caracteres.'); return }
    const email = form.email.trim().toLowerCase()
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) { setError('Informe um e-mail válido ou deixe o campo em branco.'); return }
    if (!form.endereco.trim()) { setError('Informe o endereço ou logradouro.'); return }
    if (form.cidade.trim().length > 100) { setError('A cidade deve ter até 100 caracteres.'); return }
    if (form.estado.trim() && !states.includes(form.estado.trim().toUpperCase())) { setError('Informe uma UF brasileira válida.'); return }
    if (digits(form.cpf).length && digits(form.cpf).length !== 11) { setError('Informe um CPF com 11 dígitos.'); return }
    const payload = { ...form, email: email || null, cpf: digits(form.cpf) || null, cep: digits(form.cep) || null, ...(!selected ? { senhaInicial } : {}) }
    setSaving(true)
    try {
      const path = selected ? `/deliverers/${selected.id}` : '/deliverers'
      const result = await api(path, { method: selected ? 'PATCH' : 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) })
      setNotice(result.mensagem); setSelected(null); setFormOpen(false); setForm({ ...emptyForm }); setSenhaInicial(''); await refresh(query)
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setSaving(false) }
  }
  async function viewDetails(item) {
    try {
      const result = await api(`/deliverers/${item.id}`)
      setFormOpen(true); setSelected(result.entregador); setForm(Object.fromEntries(Object.keys(emptyForm).map((key) => [key, result.entregador[key] || '']))); setError(''); setNotice('')
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
  }
  async function deleteDeliverer() {
    if (!deleteTarget || deleting) return
    setDeleting(true); setDeleteError('')
    try {
      const result = await deleteDelivererRequest(api, deleteTarget.id, csrfToken)
      setItems((current) => removeDelivererFromList(current, deleteTarget.id))
      setDeleteTarget(null); setNotice(result.mensagem); setError(''); await refresh(query)
    } catch (requestError) {
      setDeleteError(requestError.message || 'Não foi possível excluir o entregador. Tente novamente.')
      if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired()
    } finally { setDeleting(false) }
  }
  return <section className="users-page deliverers-page" aria-labelledby="deliverers-title">
    <header className="account-heading users-heading"><div><span className="section-label"><i /> ADMINISTRAÇÃO</span><h1 id="deliverers-title">Cadastro de entregadores</h1><p>Cadastre e consulte os endereços dos entregadores.</p></div><span className="users-heading-icon" aria-hidden="true">⌖</span></header>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
    <div className="deliverer-toolbar"><label className="users-search">Pesquisar por nome, CPF ou e-mail<input type="search" placeholder="Ex.: Ana ou contato@empresa.com" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && refresh(query)} /></label><button className="submit-button account-submit" type="button" onClick={startNew}>＋ Novo entregador</button></div>
    {loading ? <div className="account-loading"><span className="spinner" /> Carregando entregadores...</div> : items.length === 0 ? <div className="users-empty"><span aria-hidden="true">⌕</span><h2>{query ? 'Nenhum entregador encontrado' : 'Nenhum entregador cadastrado'}</h2><p>{query ? 'Tente pesquisar por outro nome ou CPF.' : 'Cadastre o primeiro entregador para começar.'}</p></div> : <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>CPF</th><th>Endereço</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="Nome"><span className="user-name-cell"><span className="user-mini-avatar">{item.nome.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>{item.nome}</span></td><td data-label="E-mail">{item.email || 'Não vinculado'}</td><td data-label="Perfil">{item.acesso === 'entregador' ? 'Entregador' : 'Não definido'}</td><td data-label="CPF">{item.cpf ? cpfMask(item.cpf) : 'Não informado'}</td><td data-label="Endereço">{[item.endereco, item.numero, item.setor].filter(Boolean).join(', ')}</td><td data-label="Ações"><div className="deliverer-row-actions"><button className="edit-user-button" type="button" onClick={() => viewDetails(item)}>Ver</button> <button className="edit-user-button" type="button" onClick={() => startEdit(item)}>Editar</button> <button className="edit-user-button delete-deliverer-button" type="button" aria-label={`Excluir ${item.nome}`} onClick={() => { setDeleteTarget(item); setDeleteError('') }}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 6h11m-9.5 0 .6 10h7.8L15 6M8 6V4.5h4V6m-3 2.5v5m2-5v5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg><span>Excluir</span></button></div></td></tr>)}</tbody></table></div>}
    {formOpen && <div className="user-modal-backdrop" role="presentation"><section className="user-modal deliverer-modal" role="dialog" aria-modal="true" aria-labelledby="deliverer-form-title"><header className="account-heading"><div><span className="section-label">DADOS DO ENTREGADOR</span><h2 id="deliverer-form-title">{selected ? 'Consultar / editar cadastro' : 'Novo entregador'}</h2><p>Campos marcados com * são obrigatórios.</p></div><button className="modal-close" type="button" aria-label="Fechar" onClick={closeForm}>×</button></header>
      <form onSubmit={save} noValidate><div className="deliverer-fields">
        <label className="account-field">Nome completo *<input autoComplete="name" maxLength={150} required value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></label>
        <label className="account-field">E-mail (opcional)<input type="email" autoComplete="email" maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>{!selected && <><label className="account-field">Perfil de acesso<input value="Entregador" readOnly aria-readonly="true" /></label><label className="account-field">Senha inicial *<span className="password-wrap"><input type={showInitialPassword ? 'text' : 'password'} autoComplete="new-password" maxLength={10} required value={senhaInicial} onChange={(event) => setSenhaInicial(event.target.value)} aria-describedby="initial-password-help" /><button className="show-password" type="button" aria-label={showInitialPassword ? 'Ocultar senha inicial' : 'Mostrar senha inicial'} onClick={() => setShowInitialPassword((visible) => !visible)}>{showInitialPassword ? 'Ocultar' : 'Mostrar'}</button></span><small id="initial-password-help">Use de 1 a 10 caracteres. Esta senha será usada no primeiro acesso.</small></label></>}
        <label className="account-field">CPF (opcional)<input inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpfMask(form.cpf)} onChange={(event) => setForm({ ...form, cpf: cpfMask(event.target.value) })} /></label>
        <label className="account-field">CEP<input inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={cepMask(form.cep)} onChange={(event) => setForm({ ...form, cep: cepMask(event.target.value) })} />{cepLoading && <small><span className="spinner" /> Consultando CEP...</small>}{cepMessage && <small role="status">{cepMessage}</small>}</label>
        <label className="account-field">Rua / Logradouro *<input autoComplete="address-line1" maxLength={255} required value={form.endereco} onChange={(event) => setForm({ ...form, endereco: event.target.value })} /></label>
        <label className="account-field">Quadra<input maxLength={50} value={form.quadra} onChange={(event) => setForm({ ...form, quadra: event.target.value })} /></label>
        <label className="account-field">Lote<input maxLength={50} value={form.lote} onChange={(event) => setForm({ ...form, lote: event.target.value })} /></label>
        <label className="account-field">Número (manual)<input autoComplete="address-line2" maxLength={30} value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} /></label>
        <label className="account-field">Setor / bairro<input autoComplete="address-level3" maxLength={120} value={form.setor} onChange={(event) => setForm({ ...form, setor: event.target.value })} /></label>
        <label className="account-field">Cidade<input autoComplete="address-level2" maxLength={100} value={form.cidade} onChange={(event) => setForm({ ...form, cidade: event.target.value })} /></label>
        <label className="account-field">Estado / UF<input autoComplete="address-level1" maxLength={2} value={form.estado} onChange={(event) => setForm({ ...form, estado: event.target.value.toUpperCase().slice(0, 2) })} /></label>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}<div className="account-actions"><button className="secondary-button" type="button" disabled={saving} onClick={closeForm}>Cancelar</button><button className="submit-button account-submit" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Salvando...</> : selected ? 'Salvar alterações' : 'Cadastrar entregador'}</button></div></form>
    </section></div>}
    {deleteTarget && <div className="user-modal-backdrop" role="presentation"><section className="user-modal delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-deliverer-title" aria-describedby="delete-deliverer-description"><div className="delete-confirmation-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 7h14m-12 0 .8 13h8.4L17 7M9 7V4h6v3m-5 3v7m4-7v7" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></div><h2 id="delete-deliverer-title">Excluir entregador?</h2><p className="delete-confirmation-name">{deleteTarget.nome}</p><p id="delete-deliverer-description">Esta exclusão é permanente. O cadastro do entregador será removido.</p>{deleteError && <p className="error-message" role="alert">{deleteError}</p>}<div className="account-actions"><button className="secondary-button" type="button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError('') }}>Cancelar</button><button className="danger-button" type="button" disabled={deleting} onClick={deleteDeliverer}>{deleting ? <><span className="spinner" /> Excluindo...</> : 'Excluir entregador'}</button></div></section></div>}
  </section>
}
