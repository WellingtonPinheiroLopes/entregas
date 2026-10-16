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
