import { useCallback, useEffect, useRef, useState } from 'react'
import { lookupCep } from './address.js'
import { mergeClientViaCep } from './clientAddress.js'

const emptyForm = { nome: '', cpf: '', cep: '', endereco: '', quadra: '', lote: '', observacao: '' }
const digits = (value) => value.replace(/\D/g, '')
const cpfMask = (value) => digits(value).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
const cepMask = (value) => digits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')

export default function Clients({ api, csrfToken, onExpired }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [selected, setSelected] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [cepMessage, setCepMessage] = useState('')
  const cepRequest = useRef(0)
  const listRequest = useRef(0)

  const refresh = useCallback(async (term = query, showLoading = true) => {
    const requestId = ++listRequest.current
    if (showLoading) setLoading(true)
    try {
      const result = await api(`/clients${term.trim() ? `?q=${encodeURIComponent(term.trim())}` : ''}`)
      if (requestId === listRequest.current) setItems(result)
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
        setForm((current) => mergeClientViaCep(current, address))
        setCepMessage(address.logradouro ? 'Logradouro localizado. Confira e ajuste se necessário.' : 'CEP localizado sem logradouro. Preencha manualmente.')
      } catch (requestError) {
        if (requestError.name !== 'AbortError' && requestId === cepRequest.current) setCepMessage(requestError.message || 'Não foi possível consultar o CEP. Preencha manualmente.')
      } finally { if (requestId === cepRequest.current) setCepLoading(false) }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [form.cep])

  function startNew() { setFormOpen(true); setSelected(null); setForm({ ...emptyForm }); setError(''); setNotice(''); setCepMessage('') }
  function closeForm() { setFormOpen(false); setSelected(null); setForm({ ...emptyForm }); setError(''); setCepMessage('') }
  function openRecord(item) {
    setFormOpen(true); setSelected(item)
    setForm(Object.fromEntries(Object.keys(emptyForm).map((key) => [key, item[key] || ''])))
    setError(''); setNotice(''); setCepMessage('')
  }
  async function save(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (!form.nome.trim()) { setError('Informe o nome completo.'); return }
    if (digits(form.cpf).length && digits(form.cpf).length !== 11) { setError('Informe um CPF com 11 dígitos.'); return }
    if (digits(form.cep).length && digits(form.cep).length !== 8) { setError('Informe um CEP com 8 dígitos.'); return }
    setSaving(true)
    try {
      const payload = { ...form, nome: form.nome.trim(), cpf: digits(form.cpf) || null, cep: digits(form.cep) || null }
      const result = await api(selected ? `/clients/${selected.id}` : '/clients', { method: selected ? 'PATCH' : 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) })
      setNotice(result.mensagem); setFormOpen(false); setSelected(null); setForm({ ...emptyForm }); await refresh(query)
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setSaving(false) }
  }
  async function deleteClient() {
    if (!deleteTarget || deleting) return
    setDeleting(true); setDeleteError('')
    try {
      const result = await api(`/clients/${deleteTarget.id}`, { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } })
      setItems((current) => current.filter((item) => item.id !== deleteTarget.id))
      setDeleteTarget(null); setNotice(result.mensagem); setError(''); await refresh(query)
    } catch (requestError) {
      setDeleteError(requestError.message || 'Não foi possível excluir o cliente. Tente novamente.')
      if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired()
    } finally { setDeleting(false) }
  }

  return <section className="users-page deliverers-page" aria-labelledby="clients-title">
    <header className="account-heading users-heading"><div><span className="section-label"><i /> ADMINISTRAÇÃO</span><h1 id="clients-title">Cadastro de clientes</h1><p>Cadastre, consulte e mantenha os dados dos clientes.</p></div><span className="users-heading-icon" aria-hidden="true">♙</span></header>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
    <div className="deliverer-toolbar"><label className="users-search">Pesquisar por nome ou CPF<input type="search" placeholder="Ex.: Ana ou 000.000.000-00" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && refresh(query)} /></label><button className="submit-button account-submit" type="button" onClick={startNew}>＋ Novo cliente</button></div>
    {loading ? <div className="account-loading"><span className="spinner" /> Carregando clientes...</div> : items.length === 0 ? <div className="users-empty"><span aria-hidden="true">⌕</span><h2>{query ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}</h2><p>{query ? 'Tente pesquisar por outro nome ou CPF.' : 'Cadastre o primeiro cliente para começar.'}</p></div> : <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Nome</th><th>CPF</th><th>CEP</th><th>Logradouro</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="Nome"><span className="user-name-cell"><span className="user-mini-avatar">{item.nome.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>{item.nome}</span></td><td data-label="CPF">{item.cpf ? cpfMask(item.cpf) : 'Não informado'}</td><td data-label="CEP">{item.cep ? cepMask(item.cep) : 'Não informado'}</td><td data-label="Logradouro">{item.endereco || 'Não informado'}</td><td data-label="Ações"><div className="deliverer-row-actions"><button className="edit-user-button" type="button" onClick={() => openRecord(item)}>Ver / editar</button><button className="edit-user-button delete-deliverer-button" type="button" aria-label={`Excluir ${item.nome}`} onClick={() => { setDeleteTarget(item); setDeleteError('') }}><span>Excluir</span></button></div></td></tr>)}</tbody></table></div>}
    {formOpen && <div className="user-modal-backdrop" role="presentation"><section className="user-modal deliverer-modal" role="dialog" aria-modal="true" aria-labelledby="client-form-title"><header className="account-heading"><div><span className="section-label">DADOS DO CLIENTE</span><h2 id="client-form-title">{selected ? 'Consultar / editar cadastro' : 'Novo cliente'}</h2><p>Nome completo é obrigatório. Os demais campos são opcionais.</p></div><button className="modal-close" type="button" aria-label="Fechar" onClick={closeForm}>×</button></header>
      <form onSubmit={save} noValidate><div className="deliverer-fields">
        <label className="account-field">Nome completo *<input autoComplete="name" maxLength={150} required value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></label>
        <label className="account-field">CPF (opcional)<input inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpfMask(form.cpf)} onChange={(event) => setForm({ ...form, cpf: cpfMask(event.target.value) })} /></label>
        <label className="account-field">CEP<input inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={cepMask(form.cep)} onChange={(event) => setForm({ ...form, cep: cepMask(event.target.value) })} />{cepLoading && <small><span className="spinner" /> Consultando CEP...</small>}{cepMessage && <small role="status">{cepMessage}</small>}</label>
        <label className="account-field">Rua / Logradouro<input autoComplete="address-line1" maxLength={255} value={form.endereco} onChange={(event) => setForm({ ...form, endereco: event.target.value })} /></label>
        <label className="account-field">Quadra<input maxLength={50} value={form.quadra} onChange={(event) => setForm({ ...form, quadra: event.target.value })} /></label>
        <label className="account-field">Lote<input maxLength={50} value={form.lote} onChange={(event) => setForm({ ...form, lote: event.target.value })} /></label>
        <label className="account-field client-observation">Observação<textarea rows="4" maxLength={5000} placeholder="Complemento, ponto de referência ou instruções para localizar o endereço" value={form.observacao} onChange={(event) => setForm({ ...form, observacao: event.target.value })} /></label>
      </div>{error && <p className="error-message" role="alert">{error}</p>}<div className="account-actions"><button className="secondary-button" type="button" disabled={saving} onClick={closeForm}>Cancelar</button><button className="submit-button account-submit" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Salvando...</> : selected ? 'Salvar alterações' : 'Cadastrar cliente'}</button></div></form>
    </section></div>}
    {deleteTarget && <div className="user-modal-backdrop" role="presentation"><section className="user-modal delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-client-title" aria-describedby="delete-client-description"><div className="delete-confirmation-icon" aria-hidden="true">⌫</div><h2 id="delete-client-title">Excluir cliente?</h2><p className="delete-confirmation-name">{deleteTarget.nome}</p><p id="delete-client-description">Esta exclusão é permanente. O cadastro será removido se não houver registros vinculados.</p>{deleteError && <p className="error-message" role="alert">{deleteError}</p>}<div className="account-actions"><button className="secondary-button" type="button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteError('') }}>Cancelar</button><button className="danger-button" type="button" disabled={deleting} onClick={deleteClient}>{deleting ? <><span className="spinner" /> Excluindo...</> : 'Excluir cliente'}</button></div></section></div>}
  </section>
}
