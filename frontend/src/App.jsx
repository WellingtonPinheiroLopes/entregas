import { useCallback, useEffect, useState } from 'react'
import Deliverers from './Deliverers.jsx'
import './App.css'

const api = async (path, options = {}) => {
  let response
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    })
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Verifique se a API está funcionando.')
  }
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.erro || 'Ocorreu um erro. Tente novamente.')
  return payload
}

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 12.5 9.2 17 20 6" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
    <span className="brand-name">Rota<span>Verde</span></span>
  </div>
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!email.trim() || !senha) { setError('Preencha o e-mail e a senha.'); return }
    setLoading(true)
    try {
      const { csrfToken } = await api('/auth/csrf')
      const result = await api('/auth/login', {
        method: 'POST', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ email, senha }),
      })
      onLogin(result.usuario, result.csrfToken)
    } catch (requestError) { setError(requestError.message) }
    finally { setLoading(false) }
  }

  return <main className="login-page">
    <div className="login-decoration" aria-hidden="true"><span /><span /><span /></div>
    <section className="login-layout" aria-labelledby="login-title">
      <div className="login-intro">
        <Brand />
        <div className="intro-copy">
          <span className="intro-kicker"><i /> OPERAÇÃO EM MOVIMENTO</span>
          <h1>Uma entrega<br />de cada vez.</h1>
          <p>Seu espaço de trabalho para acompanhar a operação com clareza e confiança.</p>
        </div>
        <div className="intro-bottom"><span className="route-line" aria-hidden="true"><i /><i /><i /></span><span>Gestão simples. Rotas mais eficientes.</span></div>
      </div>
      <div className="login-card">
        <div className="mobile-brand"><Brand /></div>
        <div className="form-heading"><span className="section-label">ACESSO À PLATAFORMA</span><h2 id="login-title">Boas-vindas</h2><p>Entre com seus dados para continuar.</p></div>
        <form onSubmit={submit} noValidate>
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="username" placeholder="voce@empresa.com" value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} />
          <label htmlFor="password">Senha</label>
          <div className="password-wrap"><input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Digite sua senha" value={senha} onChange={(event) => setSenha(event.target.value)} disabled={loading} />
            <button className="show-password" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} disabled={loading}>{showPassword ? 'Ocultar' : 'Mostrar'}</button>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={loading}>{loading ? <><span className="spinner" aria-hidden="true" /> Entrando...</> : <>Entrar <span aria-hidden="true">→</span></>}</button>
        </form>
        <p className="secure-note"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 7V5a4 4 0 0 1 8 0v2m-9 0h10v7H3V7Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg> Conexão segura e protegida</p>
      </div>
    </section>
    <footer className="login-footer"><span>ROTA VERDE</span><span>Gestão de entregas</span></footer>
  </main>
}

function Account({ csrfToken, onExpired, onUserUpdate }) {
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api('/account').then(({ usuario }) => {
      if (active) { setAccount(usuario); setName(usuario.nome) }
    }).catch((requestError) => {
      if (active) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    }).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [onExpired, onUserUpdate])

  async function saveName(event) {
    event.preventDefault(); setError(''); setNotice(''); setSavingName(true)
    try {
      const result = await api('/account', { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ nome: name }) })
      setAccount(result.usuario); setName(result.usuario.nome); setEditing(false); setNotice(result.mensagem); onUserUpdate(result.usuario)
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setSavingName(false) }
  }

  if (loading) return <section className="account-card account-loading" aria-label="Carregando conta"><span className="spinner" /> Carregando seus dados...</section>
  if (!account) return <section className="account-card"><p className="error-message" role="alert">{error || 'Não foi possível carregar sua conta.'}</p></section>
  const access = account.acesso === 'administrador' ? 'Administrador' : account.acesso === 'entregador' ? 'Entregador' : 'Convidado'
  return <div className="account-layout">
    <section className="account-card" aria-labelledby="account-title">
      <header className="account-heading"><div><span className="section-label"><i /> SEUS DADOS</span><h1 id="account-title">Minha conta</h1><p>Consulte e atualize as informações do seu perfil.</p></div><span className="account-avatar" aria-hidden="true">{account.nome.trim().split(/\s+/).slice(0,2).map((part) => part[0]).join('').toUpperCase()}</span></header>
      <form onSubmit={saveName}>
        <div className="account-details">
          <label className="account-field">Nome completo<input value={editing ? name : account.nome} onChange={(event) => setName(event.target.value)} disabled={!editing || savingName} maxLength={150} autoComplete="name" /></label>
          <label className="account-field">E-mail cadastrado<input value={account.email} readOnly /></label>
          <div className="account-field"><span>Perfil de acesso</span><div className="account-readonly"><span className="access-badge"><i />{access}</span></div></div>
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
        <div className="account-actions">{editing ? <><button className="secondary-button" type="button" disabled={savingName} onClick={() => { setName(account.nome); setEditing(false); setError('') }}>Cancelar</button><button className="submit-button account-submit" type="submit" disabled={savingName}>{savingName ? <><span className="spinner" /> Salvando...</> : 'Salvar alterações'}</button></> : <button className="submit-button account-submit" type="button" onClick={() => { setEditing(true); setError(''); setNotice('') }}>Editar</button>}</div>
      </form>
    </section>
  </div>
}

function Users({ csrfToken, onExpired }) {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ nome: '', email: '', acesso: 'convidado', novaSenha: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try { setUsers(await api('/usuarios')) }
    catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setLoading(false) }
  }, [onExpired])
  useEffect(() => { refresh(false) }, [refresh])
  function edit(user) { setSelected(user); setForm({ nome: user.nome, email: user.email, acesso: user.acesso, novaSenha: '' }); setError(''); setNotice('') }
  async function save(event) {
    event.preventDefault(); setError(''); setNotice('')
    if ([...form.novaSenha].length > 10) { setError('A nova senha deve ter de 1 a 10 caracteres.'); return }
    setSaving(true)
    try {
      await api(`/usuarios/${selected.id}`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ nome: form.nome, email: form.email, acesso: form.acesso }) })
      if (form.novaSenha) await api(`/usuarios/${selected.id}/password`, { method: 'PATCH', headers: { 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ novaSenha: form.novaSenha }) })
      setSelected(null); setNotice('Alterações salvas com sucesso.'); await refresh()
    } catch (requestError) { setError(requestError.message); if (/autenticação|sessão inválida/i.test(requestError.message)) onExpired() }
    finally { setSaving(false) }
  }
  const filtered = users.filter((item) => `${item.nome} ${item.email}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  return <section className="users-page" aria-labelledby="users-title">
    <header className="account-heading users-heading"><div><span className="section-label"><i /> ADMINISTRAÇÃO</span><h1 id="users-title">Gerenciamento de usuários</h1><p>Consulte os usuários cadastrados e gerencie seus dados e permissões.</p></div><span className="users-heading-icon" aria-hidden="true">♙</span></header>
    {error && <p className="error-message" role="alert">{error}</p>}{notice && <p className="success-message" role="status">{notice}</p>}
    <label className="users-search">Pesquisar por nome ou e-mail<input type="search" placeholder="Ex.: Maria ou maria@empresa.com" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
    {loading ? <div className="account-loading"><span className="spinner" /> Carregando usuários...</div> : filtered.length === 0 ? <div className="users-empty"><span aria-hidden="true">⌕</span><h2>{query ? 'Nenhum usuário encontrado' : 'Nenhum usuário cadastrado'}</h2><p>{query ? 'Tente pesquisar por outro nome ou e-mail.' : 'Os usuários aparecerão aqui quando forem cadastrados.'}</p></div> : <div className="users-table-wrap"><table className="users-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Senha</th><th>Tipo de acesso</th><th>Ações</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td data-label="Nome"><span className="user-name-cell"><span className="user-mini-avatar">{item.nome.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>{item.nome}</span></td><td data-label="E-mail">{item.email}</td><td data-label="Senha"><span className="protected-password">••••••••</span><small>Senha protegida</small></td><td data-label="Tipo de acesso"><span className={`access-badge ${item.acesso === 'administrador' ? 'admin-badge' : ''}`}><i />{item.acesso === 'administrador' ? 'Administrador' : item.acesso === 'entregador' ? 'Entregador' : 'Convidado'}</span></td><td data-label="Ações"><button className="edit-user-button" onClick={() => edit(item)}><span aria-hidden="true">✎</span> Editar</button></td></tr>)}</tbody></table></div>}
    {selected && <div className="user-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setSelected(null) }}><section className="user-modal" role="dialog" aria-modal="true" aria-labelledby="edit-user-title"><header className="account-heading"><div><span className="section-label">DADOS DA CONTA</span><h2 id="edit-user-title">Editar usuário</h2><p>Atualize as informações e permissões de acesso.</p></div><button className="modal-close" type="button" aria-label="Fechar" disabled={saving} onClick={() => setSelected(null)}>×</button></header><form onSubmit={save} noValidate><label className="account-field">Nome<input autoComplete="name" maxLength={150} required value={form.nome} disabled={saving} onChange={(event) => setForm({ ...form, nome: event.target.value })} /></label><label className="account-field">E-mail<input type="email" autoComplete="email" maxLength={254} required value={form.email} disabled={saving} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label className="account-field">Tipo de acesso<select value={form.acesso} disabled={saving} onChange={(event) => setForm({ ...form, acesso: event.target.value })}><option value="administrador">Administrador</option><option value="convidado">Convidado</option><option value="entregador">Entregador</option></select></label><label className="account-field">Nova senha<input type="password" autoComplete="new-password" minLength={1} maxLength={10} placeholder="Deixe em branco para manter a senha atual" value={form.novaSenha} disabled={saving} onChange={(event) => setForm({ ...form, novaSenha: event.target.value })} /><small>Deixe em branco para manter a senha atual; novas senhas devem ter de 1 a 10 caracteres.</small></label>{error && <p className="error-message" role="alert">{error}</p>}<div className="account-actions"><button className="secondary-button" type="button" disabled={saving} onClick={() => setSelected(null)}>Cancelar</button><button className="submit-button account-submit" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Salvando...</> : 'Salvar alterações'}</button></div></form></section></div>}
  </section>
}

function Dashboard({ user, onLogout, error, csrfToken, onUserUpdate, onExpired }) {
  const [view, setView] = useState('home')
  const firstName = user.nome?.trim().split(/\s+/)[0] || 'Olá'
  const initials = user.nome?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
  return <main className="dashboard-page">
    <header className="topbar"><Brand compact /><div className="topbar-right"><button className={`nav-button ${view === 'home' ? 'active' : ''}`} onClick={() => setView('home')}>Painel</button>{user.acesso === 'administrador' && <><button className={`nav-button ${view === 'users' ? 'active' : ''}`} onClick={() => setView('users')}><span aria-hidden="true">♙ </span>Usuários</button><button className={`nav-button ${view === 'deliverers' ? 'active' : ''}`} onClick={() => setView('deliverers')}><span aria-hidden="true">⌖ </span>Entregadores</button></>}<button className={`nav-button ${view === 'account' ? 'active' : ''}`} onClick={() => setView('account')}>Minha conta</button><span className="topbar-caption">PAINEL DE OPERAÇÕES</span><span className="avatar" aria-label={`Usuário ${user.nome}`}>{initials}</span><button className="logout-button" onClick={onLogout}>Sair <span aria-hidden="true">↗</span></button></div></header>
    <div className="dashboard-content">
      {view === 'account' ? <Account csrfToken={csrfToken} onExpired={onExpired} onUserUpdate={onUserUpdate} /> : view === 'users' && user.acesso === 'administrador' ? <Users csrfToken={csrfToken} onExpired={onExpired} /> : view === 'deliverers' && user.acesso === 'administrador' ? <Deliverers api={api} csrfToken={csrfToken} onExpired={onExpired} /> : <>
        <section className="welcome-card"><div className="welcome-copy"><span className="section-label"><i /> ÁREA DE TRABALHO</span><h1>Olá, {firstName}<span className="wave" aria-hidden="true">✳</span></h1><p>Você está conectado ao Projeto Entregas.</p></div><div className="welcome-meta"><span className="meta-caption">PERFIL DE ACESSO</span><span className="access-badge"><i />{user.acesso === 'administrador' ? 'Administrador' : user.acesso === 'entregador' ? 'Entregador' : 'Convidado'}</span></div></section>
        {error && <p className="error-message dashboard-error" role="alert">{error}</p>}
        <section className="workspace-card" aria-labelledby="workspace-title"><div className="workspace-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="7" y="12" width="34" height="27" rx="5" stroke="currentColor" strokeWidth="2"/><path d="M16 12V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M7 23h34M19 23v4h10v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="m16 33 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div><span className="section-label">TUDO PRONTO</span><h2 id="workspace-title">Seu espaço de trabalho</h2><p>Acesso confirmado. As ferramentas disponíveis para o seu perfil aparecerão aqui.</p></section>
      </>}
      <footer className="dashboard-footer"><Brand compact /><span>Uma operação mais leve começa com uma boa rota.</span></footer>
    </div>
  </main>
}

export default function App() {
  const [user, setUser] = useState(null)
  const [csrfToken, setCsrfToken] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true
    api('/auth/me').then(({ usuario, csrfToken: token }) => { if (active) { setUser(usuario); setCsrfToken(token || '') } }).catch(() => {}).finally(() => active && setChecking(false))
    return () => { active = false }
  }, [])

  async function logout() {
    try { await api('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } }); setUser(null); setCsrfToken(''); setLogoutError('') }
    catch (error) { setLogoutError(error.message) }
  }

  if (checking) return <main className="loading-page" aria-label="Verificando sessão"><Brand /><span className="spinner" /></main>
  return user ? <Dashboard user={user} csrfToken={csrfToken} onUserUpdate={(nextUser) => setUser(nextUser)} onExpired={() => { setUser(null); setCsrfToken('') }} onLogout={logout} error={logoutError} /> : <Login onLogin={(nextUser, nextToken) => { setUser(nextUser); setCsrfToken(nextToken) }} />
}
