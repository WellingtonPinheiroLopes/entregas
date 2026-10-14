import { useCallback, useEffect, useRef, useState } from 'react'
import { lookupCep, mergeStreetResult, mergeViaCep } from './address.js'

const emptyForm = { nome: '', cpf: '', cidade: '', estado: '', cep: '', endereco: '', quadra: '', lote: '', numero: '', setor: '' }
const states = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
const digits = (value) => value.replace(/\D/g, '')
const cpfMask = (value) => digits(value).slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
const cepMask = (value) => digits(value).slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')

export default function Deliverers({ api, csrfToken, onExpired }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [cepLoading, setCepLoading] = useState(false)
  const [cepMessage, setCepMessage] = useState('')
  const [streetLoading, setStreetLoading] = useState(false)
  const [streetMessage, setStreetMessage] = useState('')
  const [results, setResults] = useState([])
  const [formOpen, setFormOpen] = useState(false)
  const cepRequest = useRef(0)
  const listRequest = useRef(0)
  const streetTimer = useRef(null)
  const streetRequest = useRef(0)
  const skipStreetSearch = useRef('')

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
  useEffect(() => () => { clearTimeout(streetTimer.current); streetRequest.current += 1 }, [])

  function startNew() { setFormOpen(true); setSelected(null); setForm({ ...emptyForm }); setError(''); setNotice(''); setCepMessage(''); setStreetMessage(''); setResults([]) }
  function closeForm() { clearTimeout(streetTimer.current); streetRequest.current += 1; setStreetLoading(false); setFormOpen(false); setSelected(null); setForm({ ...emptyForm }); setError(''); setCepMessage(''); setResults([]) }
  function startEdit(item) { clearTimeout(streetTimer.current); streetRequest.current += 1; setFormOpen(true); setSelected(item); setForm(Object.fromEntries(Object.keys(emptyForm).map((key) => [key, item[key] || '']))); setError(''); setNotice(''); setCepMessage(''); setStreetMessage(''); setResults([]) }
  async function save(event) {
    event.preventDefault(); setError(''); setNotice('')
    if (!form.nome.trim()) { setError('Informe o nome completo.'); return }
    if (!form.endereco.trim()) { setError('Informe o endereço ou logradouro.'); return }
    if (!form.cidade.trim()) { setError('Informe a cidade.'); return }
    if (!states.includes(form.estado.toUpperCase())) { setError('Selecione uma UF brasileira válida.'); return }
    if (digits(form.cpf).length && digits(form.cpf).length !== 11) { setError('Informe um CPF com 11 dígitos.'); return }
    const payload = { ...form, cpf: digits(form.cpf) || null, cep: digits(form.cep) || null }
    setSaving(true)
    try {
      const path = selected ? `/deliverers/${selected.id}` : '/deliverers'
      const result = await api(path, { method: selected ? 'PATCH' : 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify(payload) })
      setNotice(result.mensagem); setSelected(null); setFormOpen(false); setForm({ ...emptyForm }); await refresh(query)
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setSaving(false) }
  }
  async function viewDetails(item) {
    try {
      const result = await api(`/deliverers/${item.id}`)
      setFormOpen(true); setSelected(result.entregador); setForm(Object.fromEntries(Object.keys(emptyForm).map((key) => [key, result.entregador[key] || '']))); setError(''); setNotice('')
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
  }
  useEffect(() => {
    clearTimeout(streetTimer.current)
    const street = form.endereco.trim(), city = form.cidade.trim(), state = form.estado.trim().toUpperCase()
    const searchKey = `${street}|${city}|${state}`
    const requestId = ++streetRequest.current
    if (skipStreetSearch.current === searchKey) { skipStreetSearch.current = ''; return undefined }
    if (digits(form.cep).length || street.length < 3 || !city || !states.includes(state)) {
      setResults([]); setStreetLoading(false); setStreetMessage(''); return undefined
    }
    setStreetMessage('')
    streetTimer.current = setTimeout(async () => {
      setStreetLoading(true)
      try {
        const params = new URLSearchParams({ street, city, state })
        const { resultados: matches } = await api(`/address/street?${params}`)
        if (requestId !== streetRequest.current) return
        setResults(matches)
        setStreetMessage(matches.length ? 'Selecione o endereço correspondente.' : 'Nenhum endereço encontrado. Você pode preencher manualmente.')
      } catch (requestError) {
        if (requestId !== streetRequest.current) return
        setResults([]); setStreetMessage(`${requestError.message || 'Não foi possível pesquisar.'} Seus dados foram mantidos.`)
        if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired()
      } finally { if (requestId === streetRequest.current) setStreetLoading(false) }
    }, 650)
    return () => clearTimeout(streetTimer.current)
  }, [api, form.endereco, form.cidade, form.estado, form.cep, onExpired])
  function chooseAddress(result) {
    const merged = mergeStreetResult(form, result)
    skipStreetSearch.current = `${merged.endereco}|${merged.cidade}|${merged.estado}`
    setForm(merged)
    const postcode = result.address?.postcode ? digits(result.address.postcode) : ''
    setStreetMessage(postcode ? 'Endereço selecionado. Confira e ajuste os campos se necessário.' : 'Endereço selecionado; a busca não retornou CEP. Você pode preencher o CEP manualmente.')
    setResults([])
  }

  return <section className="users-page deliverers-page" aria-labelledby="deliverers-title">
    <header className="account-heading users-heading"><div><span className="section-label"><i /> ADMINISTRAÇÃO</span><h1 id="deliverers-title">Cadastro de entregadores</h1><p>Cadastre e consulte os endereços dos entregadores.</p></div><span className="users-heading-icon" aria-hidden="true">⌖</span></header>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
    <div className="deliverer-toolbar"><label className="users-search">Pesquisar por nome ou CPF<input type="search" placeholder="Ex.: Ana ou 123.456.789-00" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && refresh(query)} /></label><button className="submit-button account-submit" type="button" onClick={startNew}>＋ Novo entregador</button></div>
    {loading ? <div className="account-loading"><span className="spinner" /> Carregando entregadores...</div> : items.length === 0 ? <div className="users-empty"><span aria-hidden="true">⌕</span><h2>{query ? 'Nenhum entregador encontrado' : 'Nenhum entregador cadastrado'}</h2><p>{query ? 'Tente pesquisar por outro nome ou CPF.' : 'Cadastre o primeiro entregador para começar.'}</p></div> : <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Nome</th><th>CPF</th><th>Endereço</th><th>Ações</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td data-label="Nome"><span className="user-name-cell"><span className="user-mini-avatar">{item.nome.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>{item.nome}</span></td><td data-label="CPF">{item.cpf ? cpfMask(item.cpf) : 'Não informado'}</td><td data-label="Endereço">{[item.endereco, item.numero, item.setor].filter(Boolean).join(', ')}</td><td data-label="Ações"><button className="edit-user-button" type="button" onClick={() => viewDetails(item)}>Ver</button> <button className="edit-user-button" type="button" onClick={() => startEdit(item)}>Editar</button></td></tr>)}</tbody></table></div>}
    {formOpen && <div className="user-modal-backdrop" role="presentation"><section className="user-modal deliverer-modal" role="dialog" aria-modal="true" aria-labelledby="deliverer-form-title"><header className="account-heading"><div><span className="section-label">DADOS DO ENTREGADOR</span><h2 id="deliverer-form-title">{selected ? 'Consultar / editar cadastro' : 'Novo entregador'}</h2><p>Campos marcados com * são obrigatórios.</p></div><button className="modal-close" type="button" aria-label="Fechar" onClick={closeForm}>×</button></header>
      <form onSubmit={save} noValidate><div className="deliverer-fields">
        <label className="account-field">Nome completo *<input autoComplete="name" maxLength={150} required value={form.nome} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></label>
        <label className="account-field">CPF (opcional)<input inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={cpfMask(form.cpf)} onChange={(event) => setForm({ ...form, cpf: cpfMask(event.target.value) })} /></label>
        <label className="account-field">Cidade *<input autoComplete="address-level2" maxLength={100} required value={form.cidade} onChange={(event) => { setForm({ ...form, cidade: event.target.value }); setResults([]) }} /></label>
        <label className="account-field">Estado / UF *<select autoComplete="address-level1" required value={form.estado} onChange={(event) => { setForm({ ...form, estado: event.target.value }); setResults([]) }}><option value="">Selecione</option>{states.map((uf) => <option key={uf} value={uf}>{uf}</option>)}</select></label>
        <label className="account-field">CEP<input inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" value={cepMask(form.cep)} onChange={(event) => setForm({ ...form, cep: cepMask(event.target.value) })} />{cepLoading && <small><span className="spinner" /> Consultando CEP...</small>}{cepMessage && <small role="status">{cepMessage}</small>}</label>
        <label className="account-field">Rua / Logradouro *<input autoComplete="address-line1" maxLength={255} required value={form.endereco} onChange={(event) => { setForm({ ...form, endereco: event.target.value }); setResults([]) }} />{streetLoading && <small><span className="spinner" /> Pesquisando endereços...</small>}{streetMessage && <small role="status">{streetMessage}</small>}{results.length > 0 && <ul className="address-results">{results.map((result) => <li key={result.place_id}><button type="button" onClick={() => chooseAddress(result)}>{result.display_name}{result.address?.postcode && <small>CEP: {result.address.postcode}</small>}</button></li>)}</ul>}</label>
        <label className="account-field">Quadra<input maxLength={50} value={form.quadra} onChange={(event) => setForm({ ...form, quadra: event.target.value })} /></label>
        <label className="account-field">Lote<input maxLength={50} value={form.lote} onChange={(event) => setForm({ ...form, lote: event.target.value })} /></label>
        <label className="account-field">Número (manual)<input autoComplete="address-line2" maxLength={30} value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} /></label>
        <label className="account-field">Setor / bairro<input autoComplete="address-level3" maxLength={120} value={form.setor} onChange={(event) => setForm({ ...form, setor: event.target.value })} /></label>
      </div>
      {error && <p className="error-message" role="alert">{error}</p>}<div className="account-actions"><button className="secondary-button" type="button" disabled={saving} onClick={closeForm}>Cancelar</button><button className="submit-button account-submit" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Salvando...</> : selected ? 'Salvar alterações' : 'Cadastrar entregador'}</button></div></form>
    </section></div>}
  </section>
}
