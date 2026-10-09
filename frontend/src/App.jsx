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

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!email.trim() || !senha) {
      setError('Preencha o e-mail e a senha.')
      return
    }
    setLoading(true)
    try {
      const { csrfToken } = await api('/auth/csrf')
      const result = await api('/auth/login', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ email, senha }),
      })
      onLogin(result.usuario, result.csrfToken)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">E</div>
        <p className="eyebrow">PROJETO ENTREGAS</p>
        <h1 id="login-title">Boas-vindas</h1>
        <p className="subtitle">Entre com seus dados para acessar o sistema.</p>
        <form onSubmit={submit} noValidate>
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="username" placeholder="voce@empresa.com"
            value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} />
          <label htmlFor="password">Senha</label>
          <div className="password-wrap">
            <input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
              placeholder="Digite sua senha" value={senha} onChange={(event) => setSenha(event.target.value)} disabled={loading} />
            <button className="show-password" type="button" onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} disabled={loading}>
              {showPassword ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button className="submit-button" type="submit" disabled={loading}>
            {loading ? <><span className="spinner" aria-hidden="true" /> Entrando...</> : 'Entrar'}
          </button>
        </form>
        <p className="secure-note"><span aria-hidden="true">●</span> Acesso seguro à sua conta</p>
      </section>
    </main>
  )
}

function Dashboard({ user, onLogout, error }) {
  return (
    <main className="dashboard-page">
      <header className="topbar">
        <div className="brand"><span className="brand-mark small">E</span><span>Entregas</span></div>
        <button className="logout-button" onClick={onLogout}>Sair</button>
      </header>
      <section className="welcome-card">
        <p className="eyebrow">ÁREA DE TRABALHO</p>
        <h1>Olá, {user.nome}</h1>
        <p>Você está conectado ao Projeto Entregas.</p>
        {error && <p className="error-message" role="alert">{error}</p>}
        <span className="access-badge">{user.acesso}</span>
      </section>
      <footer className="dashboard-footer">Projeto Entregas</footer>
    </main>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [csrfToken, setCsrfToken] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let active = true
    api('/auth/me')
      .then(({ usuario, csrfToken: token }) => { if (active) { setUser(usuario); setCsrfToken(token || '') } })
      .catch(() => {})
      .finally(() => active && setChecking(false))
    return () => { active = false }
  }, [])

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } })
      setUser(null)
      setCsrfToken('')
      setLogoutError('')
    } catch (error) {
      setLogoutError(error.message)
    }
  }

  if (checking) return <main className="loading-page" aria-label="Verificando sessão"><span className="spinner" /></main>
  return user
    ? <Dashboard user={user} onLogout={logout} error={logoutError} />
    : <Login onLogin={(nextUser, nextToken) => { setUser(nextUser); setCsrfToken(nextToken) }} />
}
