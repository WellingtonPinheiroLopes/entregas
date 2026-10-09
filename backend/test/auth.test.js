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
let passwordHash;
let server;
let baseUrl;
let cookie = '';
let currentAccess = 'convidado';

const db = {
  async execute(sql, params = []) {
    if (sql.includes('FROM usuarios WHERE email')) {
      return [params[0] === user.email ? [{ ...user, acesso: currentAccess, senha_hash: passwordHash }] : []];
    }
    if (sql.includes('FROM usuarios WHERE id')) return [params[0] === user.id ? [{ ...user, acesso: currentAccess }] : []];
    if (sql.includes('FROM usuarios ORDER')) return [[{ ...user, acesso: currentAccess }]];
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

async function login(email = user.email, senha = 'senha-segura') {
  const csrfToken = await getCsrf();
  return request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ email, senha })
  });
}

before(async () => {
  passwordHash = await bcrypt.hash('senha-segura', 4);
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
  assert.match(body.erro, /e-mail válido/i);
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
