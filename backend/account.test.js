'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { createApp } = require('./app');
const account = { id: 31, nome: 'Pessoa de Teste', email: 'pessoa@example.com', acesso: 'administrador', criado_em: '2026-01-01', atualizado_em: '2026-01-01' };
let passwordHash, server, baseUrl, cookie = '', idForSession = account.id;
const db = {
  async execute(sql, params = []) {
    if (sql.includes('WHERE email')) return [params[0] === account.email ? [{ ...account, senha_hash: passwordHash }] : []];
    if (sql.includes('SELECT senha_hash')) return [[{ senha_hash: passwordHash }]];
    if (sql.includes('UPDATE usuarios SET senha_hash')) { passwordHash = params[0]; return [{ affectedRows: 1 }]; }
    if (sql.includes('UPDATE usuarios SET nome')) { account.nome = params[0]; return [{ affectedRows: 1 }]; }
    if (sql.includes('FROM usuarios WHERE id')) return [params[0] === idForSession ? [{ ...account }] : []];
    return [[]];
  }, async query() { return [[]]; }
};
async function request(path, options = {}) {
  const headers = { Origin: 'http://localhost:5173', ...(cookie ? { Cookie: cookie } : {}), ...(options.headers || {}) };
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.startsWith('entregas.sid=;') ? '' : setCookie.split(';')[0];
  return { response, body: response.status === 204 ? null : await response.json() };
}
async function csrf() { return (await request('/api/auth/csrf')).body.csrfToken; }
async function login(senha = 'senha-atual-segura') {
  const token = await csrf();
  return request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ email: account.email, senha }) });
}
async function patch(path, payload, token) {
  return request(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(payload) });
}
before(async () => {
  passwordHash = await bcrypt.hash('senha-atual-segura', 4);
  const app = createApp({ db, sessionStore: new session.MemoryStore(), testing: true });
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));
test('conta exige autenticação e retorna somente os dados do usuário da sessão', async () => {
  cookie = ''; assert.equal((await request('/api/account')).response.status, 401); await login();
  const { response, body } = await request('/api/account'); assert.equal(response.status, 200); assert.equal(body.usuario.id, account.id);
  assert.equal(JSON.stringify(body).includes(passwordHash), false); idForSession = 999;
  assert.equal((await request('/api/account')).response.status, 401); idForSession = account.id;
});
test('perfil altera somente nome e bloqueia campos protegidos', async () => {
  cookie = ''; await login(); const token = (await request('/api/auth/me')).body.csrfToken;
  const result = await patch('/api/account', { nome: 'Nome Atualizado' }, token);
  assert.equal(result.response.status, 200); assert.equal(result.body.usuario.nome, 'Nome Atualizado');
  for (const campo of ['acesso', 'email', 'id', 'senha_hash']) assert.equal((await patch('/api/account', { nome: 'Outro Nome', [campo]: 'adulterado' }, token)).response.status, 400);
  assert.equal((await patch('/api/account', { nome: 'Alterado sem token' }, '')).response.status, 403);
});
test('senha rejeita senha atual incorreta, confirmação divergente, vazia e acima de 10 caracteres', async () => {
  cookie = ''; await login(); const token = (await request('/api/auth/me')).body.csrfToken;
  assert.equal((await patch('/api/account/password', { senhaAtual: 'incorreta', novaSenha: 'abc', confirmarSenha: 'abc' }, token)).response.status, 400);
  assert.equal((await patch('/api/account/password', { senhaAtual: 'senha-atual-segura', novaSenha: 'abc', confirmarSenha: 'diferente' }, token)).response.status, 400);
  for (const senha of ['', '12345678901']) {
    const rejected = await patch('/api/account/password', { senhaAtual: 'senha-atual-segura', novaSenha: senha, confirmarSenha: senha }, token);
    assert.equal(rejected.response.status, 400);
    assert.match(rejected.body.erro, /1 a 10 caracteres/);
  }
});
test('senhas com 1 e 10 caracteres geram hashes bcrypt e permitem login', async () => {
  let currentPassword = 'senha-atual-segura';
  for (const nextPassword of ['x', '1234567890']) {
    cookie = '';
    assert.equal((await login(currentPassword)).response.status, 200);
    const token = (await request('/api/auth/me')).body.csrfToken;
    const changed = await patch('/api/account/password', { senhaAtual: currentPassword, novaSenha: nextPassword, confirmarSenha: nextPassword }, token);
    assert.equal(changed.response.status, 200);
    assert.match(passwordHash, /^\$2[aby]\$/);
    assert.equal(await bcrypt.compare(nextPassword, passwordHash), true);
    assert.equal(JSON.stringify(changed.body).includes(passwordHash), false);
    assert.equal((await request('/api/account')).response.status, 401);
    cookie = '';
    const authenticated = await login(nextPassword);
    assert.equal(authenticated.response.status, 200);
    assert.equal(JSON.stringify(authenticated.body).includes(passwordHash), false);
    currentPassword = nextPassword;
  }
});
