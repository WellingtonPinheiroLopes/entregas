import { useEffect, useState } from 'react'
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

function Dashboard({ user, onLogout, error }) {
  const firstName = user.nome?.trim().split(/\s+/)[0] || 'Olá'
  const initials = user.nome?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'U'
  return <main className="dashboard-page">
    <header className="topbar"><Brand compact /><div className="topbar-right"><span className="topbar-caption">PAINEL DE OPERAÇÕES</span><span className="avatar" aria-label={`Usuário ${user.nome}`}>{initials}</span><button className="logout-button" onClick={onLogout}>Sair <span aria-hidden="true">↗</span></button></div></header>
    <div className="dashboard-content">
      <section className="welcome-card">
        <div className="welcome-copy"><span className="section-label"><i /> ÁREA DE TRABALHO</span><h1>Olá, {firstName}<span className="wave" aria-hidden="true">✳</span></h1><p>Você está conectado ao Projeto Entregas.</p></div>
        <div className="welcome-meta"><span className="meta-caption">PERFIL DE ACESSO</span><span className="access-badge"><i />{user.acesso}</span></div>
      </section>
      {error && <p className="error-message dashboard-error" role="alert">{error}</p>}
      <section className="workspace-card" aria-labelledby="workspace-title">
        <div className="workspace-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="7" y="12" width="34" height="27" rx="5" stroke="currentColor" strokeWidth="2"/><path d="M16 12V9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M7 23h34M19 23v4h10v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="m16 33 3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg></div>
        <span className="section-label">TUDO PRONTO</span><h2 id="workspace-title">Seu espaço de trabalho</h2><p>Acesso confirmado. As ferramentas disponíveis para o seu perfil aparecerão aqui.</p>
      </section>
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
  return user ? <Dashboard user={user} onLogout={logout} error={logoutError} /> : <Login onLogin={(nextUser, nextToken) => { setUser(nextUser); setCsrfToken(nextToken) }} />
}
