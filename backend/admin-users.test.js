'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { createApp } = require('./app');

const users = [
  { id: 1, nome: 'Admin', email: 'admin@example.com', acesso: 'administrador', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
  { id: 2, nome: 'Convidado', email: 'guest@example.com', acesso: 'convidado', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
];
const publicRow = ({ senha_hash, ...user }) => ({ ...user });
const db = {
  async execute(sql, params = []) {
    if (sql.includes('SELECT id FROM usuarios WHERE nome = ? AND id <> ?')) return [[...users.filter((user) => user.nome === params[0] && String(user.id) !== String(params[1])).map(({ id }) => ({ id }))]];
    if (sql.includes('SELECT id FROM usuarios WHERE email = ? AND id <> ?')) return [[...users.filter((user) => user.email === params[0] && String(user.id) !== String(params[1])).map(({ id }) => ({ id }))]];
    if (sql.includes('FROM usuarios WHERE nome')) return [[...users.filter((user) => user.nome === params[0])]];
    if (sql.includes('FROM usuarios WHERE email')) return [[...users.filter((user) => user.email === params[0])]];
    if (sql.includes("SELECT id FROM usuarios WHERE acesso = 'administrador'")) return [[...users.filter((user) => user.acesso === 'administrador').map(({ id }) => ({ id }))]];
    if (sql.includes('SELECT id FROM usuarios WHERE id')) return [[...users.filter((user) => String(user.id) === String(params[0])).map(({ id }) => ({ id }))]];
    if (sql.includes('FROM usuarios WHERE id')) return [[...users.filter((user) => String(user.id) === String(params[0])).map(publicRow)]];
    if (sql.includes('FROM usuarios ORDER')) return [[...users].map(publicRow)];
    if (sql.includes('UPDATE usuarios SET nome')) {
      const user = users.find((item) => String(item.id) === String(params[3]));
      if (users.some((item) => params[1] != null && item.email === params[1] && item !== user)) { const error = new Error('Duplicate'); error.code = 'ER_DUP_ENTRY'; throw error; }
      if (users.some((item) => item.nome === params[0] && item !== user)) { const error = new Error('Duplicate'); error.code = 'ER_DUP_ENTRY'; throw error; }
      Object.assign(user, { nome: params[0], email: params[1], acesso: params[2] }); return [{ affectedRows: 1 }];
    }
    if (sql.includes('UPDATE usuarios SET senha_hash')) { users.find((user) => String(user.id) === String(params[1])).senha_hash = params[0]; return [{ affectedRows: 1 }]; }
    return [[]];
  },
  async query() { return [[]]; },
};
let server, baseUrl, cookie = '';
async function request(path, options = {}) {
  const headers = { Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
  return { response, body: response.status === 204 ? null : await response.json() };
}
async function csrf() { return (await request('/api/auth/csrf')).body.csrfToken; }
async function login(email, password = 'admin-password') {
  const token = await csrf();
  return request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ email, senha: password }) });
}
async function patch(path, payload) {
  const token = (await request('/api/auth/me')).body.csrfToken;
  return request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(payload) });
}
before(async () => {
  process.env.LOGIN_RATE_LIMIT = '100';
  users[0].senha_hash = await bcrypt.hash('admin-password', 4);
  users[1].senha_hash = await bcrypt.hash('guest-password', 4);
  const app = createApp({ db, sessionStore: new session.MemoryStore(), testing: true });
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));

test('lista e detalhe administrativos nunca retornam hashes', async () => {
  cookie = ''; await login('admin@example.com');
  const list = await request('/api/usuarios');
  assert.equal(list.response.status, 200); assert.equal(list.body.length, 2);
  const detail = await request('/api/usuarios/2'); assert.equal(detail.response.status, 200);
  assert.equal(JSON.stringify([list.body, detail.body]).includes(users[0].senha_hash), false);
  assert.equal(JSON.stringify([list.body, detail.body]).includes('senha_hash'), false);
});

test('convidado não pode listar nem alterar usuários', async () => {
  cookie = ''; await login('guest@example.com', 'guest-password');
  assert.equal((await request('/api/usuarios')).response.status, 403);
  assert.equal((await patch('/api/usuarios/2', { nome: 'Invadido', email: 'guest@example.com', acesso: 'administrador' })).response.status, 403);
});

test('admin edita dados, valida perfil e e-mail duplicado; não pode rebaixar último admin', async () => {
  cookie = ''; await login('admin@example.com');
  const adminUnchanged = await patch('/api/usuarios/1', { nome: 'Admin Atualizado', email: 'admin@example.com', acesso: 'administrador' });
  assert.equal(adminUnchanged.response.status, 200); assert.equal(adminUnchanged.body.usuario.acesso, 'administrador');
  const updated = await patch('/api/usuarios/2', { nome: 'Pessoa Atualizada', email: 'updated@example.com', acesso: 'administrador' });
  assert.equal(updated.response.status, 200); assert.equal(updated.body.usuario.nome, 'Pessoa Atualizada');
  assert.equal(JSON.stringify(updated.body).includes('senha_hash'), false);
  assert.equal((await patch('/api/usuarios/2', { nome: 'Admin Atualizado', email: 'updated@example.com', acesso: 'administrador' })).response.status, 409);
  assert.equal((await patch('/api/usuarios/2', { nome: 'Pessoa Atualizada', email: 'invalido', acesso: 'administrador' })).response.status, 400);
  assert.equal((await patch('/api/usuarios/2', { nome: 'Duplicado', email: 'admin@example.com', acesso: 'convidado' })).response.status, 409);
  assert.equal((await patch('/api/usuarios/2', { nome: 'Inválido', email: 'updated@example.com', acesso: 'root' })).response.status, 400);
  const deliverer = await patch('/api/usuarios/2', { nome: 'Pessoa Atualizada', email: 'updated@example.com', acesso: 'entregador' });
  assert.equal(deliverer.response.status, 200); assert.equal(deliverer.body.usuario.acesso, 'entregador');
  cookie = ''; await login('updated@example.com', 'guest-password');
  assert.equal((await request('/api/auth/me')).response.status, 200);
  assert.equal((await request('/api/usuarios')).response.status, 403);
  assert.equal((await patch('/api/usuarios/2', { nome: 'Escalada', email: 'updated@example.com', acesso: 'administrador' })).response.status, 403);
  cookie = ''; await login('admin@example.com');
  assert.equal((await patch('/api/usuarios/2', { nome: 'Pessoa Atualizada', email: 'updated@example.com', acesso: 'convidado' })).response.status, 200);
  assert.equal((await patch('/api/usuarios/1', { nome: 'Admin', email: 'admin@example.com', acesso: 'convidado' })).response.status, 409);
});

test('edição de usuário aceita e normaliza e-mail ausente, nulo, vazio e espaços', async () => {
  cookie = ''; await login('admin@example.com');
  const originalEmail = users[1].email;
  const preserved = await patch('/api/usuarios/2', { nome: 'Pessoa Atualizada', acesso: 'convidado' });
  assert.equal(preserved.response.status, 200); assert.equal(preserved.body.usuario.email, originalEmail);
  for (const email of [null, '', '   ']) {
    const result = await patch('/api/usuarios/2', { nome: 'Pessoa Atualizada', email, acesso: 'convidado' });
    assert.equal(result.response.status, 200); assert.equal(result.body.usuario.email, null);
  }
  cookie = ''; const loginByName = await login('Pessoa Atualizada', 'guest-password');
  assert.equal(loginByName.response.status, 200); assert.equal(loginByName.body.usuario.email, null);
  assert.equal((await request('/api/usuarios')).response.status, 403);
});

test('senha administrativa aceita 1 a 10 caracteres, rejeita vazia/11 e salva com bcrypt', async () => {
  cookie = ''; await login('admin@example.com');
  for (const senha of ['', '12345678901']) {
    const rejected = await patch('/api/usuarios/2/password', { novaSenha: senha });
    assert.equal(rejected.response.status, 400);
    assert.match(rejected.body.erro, /1 a 10 caracteres/);
  }
  for (const senha of ['x', '1234567890']) {
    const changed = await patch('/api/usuarios/2/password', { novaSenha: senha });
    assert.equal(changed.response.status, 200);
    assert.match(users[1].senha_hash, /^\$2[aby]\$/);
    assert.equal(await bcrypt.compare(senha, users[1].senha_hash), true);
    assert.equal(JSON.stringify(changed.body).includes(users[1].senha_hash), false);
  }
});
