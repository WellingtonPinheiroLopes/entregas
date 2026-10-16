'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { createApp } = require('../app');

const user = {
  id: 7, nome: 'Conta Teste', email: 'teste@example.com', acesso: 'convidado',
  criado_em: '2026-01-01T00:00:00.000Z', atualizado_em: '2026-01-01T00:00:00.000Z'
};
const admin = { ...user, id: 8, nome: 'Administradora', email: 'admin@example.com', acesso: 'administrador' };
const deliverer = { ...user, id: 9, nome: 'Entregador Teste', email: 'entregador@example.com', acesso: 'entregador' };
const emailOptional = { ...user, id: 10, nome: 'Sem Email', email: null, acesso: 'entregador' };
let passwordHash;
let adminHash;
let delivererHash;
let server;
let baseUrl;
let cookie = '';
let currentAccess = 'convidado';
let emailLookups = 0;

const db = {
  async execute(sql, params = []) {
    const accounts = [user, admin, deliverer, emailOptional];
    if (sql.includes('FROM usuarios WHERE email')) {
      emailLookups += 1;
      const account = accounts.find((item) => item.email === params[0]);
      return [account ? [{ ...account, acesso: account.id === user.id ? currentAccess : account.acesso, senha_hash: account.id === user.id ? passwordHash : account.id === admin.id ? adminHash : delivererHash }] : []];
    }
    if (sql.includes('FROM usuarios WHERE nome')) {
      const matches = accounts.filter((item) => item.nome === params[0]);
      return [matches.map((account) => ({ ...account, senha_hash: account.id === user.id ? passwordHash : account.id === admin.id ? adminHash : delivererHash }))];
    }
    if (sql.includes('FROM usuarios WHERE id')) {
      const account = accounts.find((item) => item.id === Number(params[0]));
      return [account ? [{ ...account, acesso: account.id === user.id ? currentAccess : account.acesso }] : []];
    }
    if (sql.includes('FROM usuarios ORDER')) return [accounts.map((account) => ({ ...account, acesso: account.id === user.id ? currentAccess : account.acesso }))];
    return [[]];
  },
  async query() { return [[]]; }
};

async function request(path, options = {}) {
  const headers = { Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

async function getCsrf() {
  const { body } = await request('/api/auth/csrf');
  return body.csrfToken;
}

async function login(identifier = user.email, senha = 'senha-segura') {
  const csrfToken = await getCsrf();
  return request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ identificador: identifier, senha })
  });
}

async function tabRequest(tab, path, options = {}) {
  const headers = {
    Origin: 'http://localhost:5173',
    ...(tab.credential ? { 'X-Tab-Session': tab.credential } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
}

async function bootstrapTab(tab) {
  const { body } = await tabRequest(tab, '/api/auth/csrf');
  tab.credential = body.sessionCredential;
  tab.csrfToken = body.csrfToken;
}

async function loginTab(tab, identifier) {
  await bootstrapTab(tab);
  const result = await tabRequest(tab, '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': tab.csrfToken },
    body: JSON.stringify({ identificador: identifier, senha: 'senha-segura' }),
  });
  if (result.body.sessionCredential) tab.credential = result.body.sessionCredential;
  if (result.body.csrfToken) tab.csrfToken = result.body.csrfToken;
  return result;
}

before(async () => {
  process.env.LOGIN_RATE_LIMIT = '100';
  passwordHash = await bcrypt.hash('senha-segura', 4);
  adminHash = await bcrypt.hash('senha-segura', 4);
  delivererHash = await bcrypt.hash('senha-segura', 4);
  const app = createApp({ db, sessionStore: new session.MemoryStore(), testing: true });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => new Promise((resolve) => server.close(resolve)));

test('login válido cria sessão e retorna dados públicos sem hash', async () => {
  cookie = '';
  const { response, body } = await login();
  assert.equal(response.status, 200);
  assert.equal(body.usuario.email, user.email);
  assert.equal(body.usuario.acesso, 'convidado');
  assert.equal(JSON.stringify(body).includes(passwordHash), false);
  assert.ok(body.csrfToken);
});

test('admin e entregador entram com e-mail ou nome, e o perfil carregado é o da conta', async () => {
  for (const account of [admin, deliverer]) {
    for (const identifier of [account.email, account.nome]) {
      cookie = '';
      const { response, body } = await login(identifier);
      assert.equal(response.status, 200);
      assert.equal(body.usuario.id, account.id);
      assert.equal(body.usuario.acesso, account.acesso);
      assert.equal((await request('/api/auth/me')).body.usuario.acesso, account.acesso);
    }
  }
});

test('usuário sem e-mail entra pelo nome e mantém perfil e sessão', async () => {
  cookie = '';
  const { response, body } = await login(emailOptional.nome);
  assert.equal(response.status, 200); assert.equal(body.usuario.id, emailOptional.id);
  assert.equal(body.usuario.email, null); assert.equal(body.usuario.acesso, 'entregador');
  assert.equal((await request('/api/auth/me')).body.usuario.acesso, 'entregador');
  assert.equal((await request('/api/usuarios')).response.status, 403);
});

test('identificação vazia é recusada sem consultar e-mail', async () => {
  const token = await getCsrf();
  for (const identificador of ['', '   ']) {
    const before = emailLookups;
    const result = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ identificador, senha: 'senha-segura' }) });
    assert.equal(result.response.status, 400); assert.equal(emailLookups, before);
  }
});

test('nome duplicado não autentica conta ambígua', async () => {
  const duplicate = { ...deliverer, id: 10 };
  const originalExecute = db.execute;
  db.execute = async (sql, params = []) => sql.includes('FROM usuarios WHERE nome') && params[0] === duplicate.nome
    ? [[{ ...deliverer, senha_hash: delivererHash }, { ...duplicate, senha_hash: delivererHash }]]
    : originalExecute(sql, params);
  cookie = '';
  const result = await login(duplicate.nome);
  assert.equal(result.response.status, 401);
  db.execute = originalExecute;
});

test('senha incorreta e usuário inexistente recebem erro genérico', async () => {
  cookie = '';
  const wrongPassword = await login(user.email, 'incorreta');
  assert.equal(wrongPassword.response.status, 401);
  const missingEmail = await login('ausente@example.com');
  assert.equal(missingEmail.response.status, 401);
  assert.deepEqual(wrongPassword.body, missingEmail.body);
});

test('entradas inválidas são recusadas', async () => {
  cookie = '';
  const csrfToken = await getCsrf();
  const { response, body } = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ email: 'inválido', senha: '' })
  });
  assert.equal(response.status, 400);
  assert.match(body.erro, /e-mail ou nome/i);
});

test('sessão válida atende /me; sessão inexistente recebe 401', async () => {
  cookie = '';
  const unauthenticated = await request('/api/auth/me');
  assert.equal(unauthenticated.response.status, 401);
  cookie = 'entregas.sid=not-a-valid-session';
  const invalidSession = await request('/api/auth/me');
  assert.equal(invalidSession.response.status, 401);
  cookie = '';
  const { response } = await login();
  assert.equal(response.status, 200);
  const me = await request('/api/auth/me');
  assert.equal(me.response.status, 200);
  assert.equal(me.body.usuario.id, user.id);
});

test('convidado não acessa recurso administrativo', async () => {
  cookie = '';
  await login();
  const { response } = await request('/api/usuarios');
  assert.equal(response.status, 403);
});

test('administrador autorizado pode acessar recurso administrativo', async () => {
  cookie = '';
  currentAccess = 'administrador';
  await login();
  const { response, body } = await request('/api/usuarios');
  assert.equal(response.status, 200);
  assert.equal(body[0].acesso, 'administrador');
  currentAccess = 'convidado';
});

test('logout invalida sessão e o cookie anterior deixa de autenticar', async () => {
  cookie = '';
  await login();
  const oldCookie = cookie;
  const csrfToken = (await request('/api/auth/me')).body.csrfToken;
  const logout = await request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrfToken } });
  assert.equal(logout.response.status, 204);
  cookie = oldCookie;
  const me = await request('/api/auth/me');
  assert.equal(me.response.status, 401);
});

test('mutação sem token CSRF é bloqueada', async () => {
  cookie = '';
  const { response } = await request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, senha: 'senha-segura' })
  });
  assert.equal(response.status, 403);
});

test('sessões tab-scoped isolam identidades, permissões e logout; fork da guia duplicada é anônimo', async () => {
  const tabA = {};
  const adminLogin = await loginTab(tabA, admin.email);
  assert.equal(adminLogin.response.status, 200);
  assert.equal(adminLogin.body.usuario.acesso, 'administrador');

  // A duplicate's client coordinator drops its copied tab credential and
  // bootstraps an anonymous session, leaving the original server session intact.
  const tabB = {};
  await bootstrapTab(tabB);
  assert.equal((await tabRequest(tabA, '/api/auth/me')).body.usuario.acesso, 'administrador');
  const delivererLogin = await loginTab(tabB, deliverer.email);
  assert.equal(delivererLogin.response.status, 200);
  assert.equal(delivererLogin.body.usuario.acesso, 'entregador');
  assert.notEqual(tabA.credential, tabB.credential);

  assert.equal((await tabRequest(tabA, '/api/auth/me')).body.usuario.acesso, 'administrador');
  assert.equal((await tabRequest(tabB, '/api/auth/me')).body.usuario.acesso, 'entregador');
  assert.equal((await tabRequest(tabA, '/api/usuarios')).response.status, 200);
  assert.equal((await tabRequest(tabB, '/api/usuarios')).response.status, 403);

  const noCredential = await tabRequest({}, '/api/auth/me');
  assert.equal(noCredential.response.status, 401);
  const badOrigin = await tabRequest(tabB, '/api/auth/logout', {
    method: 'POST', headers: { Origin: 'http://attacker.example', 'X-CSRF-Token': tabB.csrfToken },
  });
  assert.equal(badOrigin.response.status, 403);
  const badCsrf = await tabRequest(tabB, '/api/auth/logout', { method: 'POST' });
  assert.equal(badCsrf.response.status, 403);

  const originalCredential = tabA.credential;
  const logout = await tabRequest(tabA, '/api/auth/logout', {
    method: 'POST', headers: { 'X-CSRF-Token': tabA.csrfToken },
  });
  assert.equal(logout.response.status, 204);
  assert.equal((await tabRequest({ credential: originalCredential }, '/api/auth/me')).response.status, 401);
  assert.equal((await tabRequest(tabB, '/api/auth/me')).body.usuario.id, deliverer.id);

  const tampered = `${tabB.credential.slice(0, -1)}${tabB.credential.endsWith('a') ? 'b' : 'a'}`;
  assert.equal((await tabRequest({ credential: tampered }, '/api/auth/me')).response.status, 401);
});

test('backend da aplicação ignora o cookie compartilhado e exige a credencial da guia', async (t) => {
  const previousSecret = process.env.SESSION_SECRET;
  const previousMaxAge = process.env.SESSION_MAX_AGE_MS;
  process.env.SESSION_SECRET = 'production-like-session-secret-for-tests';
  process.env.SESSION_MAX_AGE_MS = '250';
  class ExpiringMemoryStore extends session.MemoryStore {
    constructor() { super(); this.expirations = new Map(); }
    get(sid, callback) {
      if ((this.expirations.get(sid) || 0) <= Date.now()) return callback(null, null);
      super.get(sid, callback);
    }
    set(sid, stored, callback) { this.expirations.set(sid, Date.now() + 250); super.set(sid, stored, callback); }
    touch(sid, stored, callback) { this.expirations.set(sid, Date.now() + 250); super.touch(sid, stored, callback); }
    destroy(sid, callback) { this.expirations.delete(sid); super.destroy(sid, callback); }
  }
  const app = createApp({ db, sessionStore: new ExpiringMemoryStore() });
  const isolatedServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => isolatedServer.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => isolatedServer.close(resolve));
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
    if (previousMaxAge === undefined) delete process.env.SESSION_MAX_AGE_MS;
    else process.env.SESSION_MAX_AGE_MS = previousMaxAge;
  });

  const url = `http://127.0.0.1:${isolatedServer.address().port}`;
  const call = async (path, options = {}) => {
    const response = await fetch(`${url}${path}`, options);
    return { response, body: response.status === 204 ? null : await response.json() };
  };
  const bootstrap = await call('/api/auth/csrf', { headers: { Cookie: 'entregas.sid=shared-cookie-value' } });
  assert.equal(bootstrap.response.status, 200);
  const loggedIn = await call('/api/auth/login', {
    method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', 'X-Tab-Session': bootstrap.body.sessionCredential, 'X-CSRF-Token': bootstrap.body.csrfToken },
    body: JSON.stringify({ identificador: admin.email, senha: 'senha-segura' }),
  });
  assert.equal(loggedIn.response.status, 200);
  const sharedCookie = loggedIn.response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(sharedCookie);

  const cookieOnly = await call('/api/auth/me', { headers: { Cookie: sharedCookie } });
  assert.equal(cookieOnly.response.status, 401);
  const selectedTab = await call('/api/auth/me', { headers: { Cookie: 'entregas.sid=some-other-tab', 'X-Tab-Session': loggedIn.body.sessionCredential } });
  assert.equal(selectedTab.response.status, 200);
  assert.equal(selectedTab.body.usuario.id, admin.id);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const expired = await call('/api/usuarios', { headers: { 'X-Tab-Session': loggedIn.body.sessionCredential } });
  assert.equal(expired.response.status, 401);
});
