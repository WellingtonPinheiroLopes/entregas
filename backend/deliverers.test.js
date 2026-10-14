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
const records = [];
let nextId = 1;
let failDelete = false;
let restrictDelete = false;
const publicUser = ({ senha_hash, ...user }) => user;
const db = {
  async execute(sql, params = []) {
    if (sql.includes('FROM usuarios WHERE email')) return [[...users.filter((user) => user.email === params[0])]];
    if (sql.includes('FROM usuarios WHERE id')) return [[...users.filter((user) => String(user.id) === String(params[0])).map(publicUser)]];
    if (sql.includes('INSERT INTO entregadores')) {
      const fields = ['nome', 'cpf', 'cidade', 'estado', 'cep', 'endereco', 'quadra', 'lote', 'numero', 'setor'];
      const row = Object.fromEntries(fields.map((field, index) => [field, params[index]]));
      if (row.cpf && records.some((item) => item.cpf === row.cpf)) { const error = new Error('Duplicate'); error.code = 'ER_DUP_ENTRY'; throw error; }
      Object.assign(row, { id: nextId++, criado_em: '2026-01-01', atualizado_em: '2026-01-01' }); records.push(row); return [{ insertId: row.id }];
    }
    if (sql.startsWith('UPDATE entregadores SET')) {
      const id = String(params.at(-1)); const row = records.find((item) => String(item.id) === id);
      if (!row) return [{ affectedRows: 0 }];
      const fields = [...sql.matchAll(/([a-z_]+) = \?/g)].map((match) => match[1]).filter((field) => field !== 'id');
      const values = params.slice(0, -1); const cpf = fields.includes('cpf') ? values[fields.indexOf('cpf')] : row.cpf;
      if (cpf && records.some((item) => item.cpf === cpf && item !== row)) { const error = new Error('Duplicate'); error.code = 'ER_DUP_ENTRY'; throw error; }
      fields.forEach((field, index) => { row[field] = values[index]; }); return [{ affectedRows: 1 }];
    }
    if (sql === 'DELETE FROM entregadores WHERE id = ?') {
      assert.equal(params.length, 1);
      if (failDelete) { const error = new Error('Database unavailable'); error.code = 'ECONNREFUSED'; throw error; }
      if (restrictDelete) { const error = new Error('Related row exists'); error.code = 'ER_ROW_IS_REFERENCED_2'; throw error; }
      const index = records.findIndex((item) => String(item.id) === String(params[0]));
      if (index < 0) return [{ affectedRows: 0 }];
      records.splice(index, 1); return [{ affectedRows: 1 }];
    }
    if (sql.includes('SELECT id FROM entregadores')) return [[...records.filter((item) => String(item.id) === String(params[0])).map(({ id }) => ({ id }))]];
    if (sql.includes('FROM entregadores WHERE id')) return [[...records.filter((item) => String(item.id) === String(params[0]))]];
    if (sql.includes('FROM entregadores WHERE nome LIKE')) return [[...records.filter((item) => item.nome.includes(params[0].slice(1, -1)) || (item.cpf || '').includes(params[1].slice(1, -1)))]];
    if (sql.includes('FROM entregadores ORDER')) return [[...records].reverse()];
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
async function login(email) {
  const token = (await request('/api/auth/csrf')).body.csrfToken;
  return request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ email, senha: email.startsWith('admin') ? 'admin-password' : 'guest-password' }) });
}
async function mutate(method, path, payload) {
  const token = (await request('/api/auth/me')).body.csrfToken;
  return request(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify(payload) });
}
before(async () => {
  users[0].senha_hash = await bcrypt.hash('admin-password', 4); users[1].senha_hash = await bcrypt.hash('guest-password', 4);
  const app = createApp({ db, sessionStore: new session.MemoryStore(), testing: true });
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));

test('endpoints de entregadores exigem autenticação administrativa', async () => {
  cookie = '';
  assert.equal((await request('/api/deliverers')).response.status, 401);
  await login('guest@example.com');
  assert.equal((await request('/api/deliverers')).response.status, 403);
  assert.equal((await mutate('POST', '/api/deliverers', { nome: 'X', endereco: 'Rua A' })).response.status, 403);
  assert.equal((await mutate('DELETE', '/api/deliverers/1')).response.status, 403);
});

test('valida entrada, CPF e normaliza strings ao cadastrar', async () => {
  cookie = ''; await login('admin@example.com');
  const valid = { nome: '  Maria Silva  ', cpf: '529.982.247-25', cidade: 'São Paulo', estado: 'sp', cep: '01001-000', endereco: 'Rua Direita', quadra: 'Q2', lote: 'L4', numero: '15', setor: 'Centro' };
  assert.equal((await mutate('POST', '/api/deliverers', { ...valid, nome: ' ' })).response.status, 400);
  assert.equal((await mutate('POST', '/api/deliverers', { ...valid, endereco: '' })).response.status, 400);
  assert.equal((await mutate('POST', '/api/deliverers', { ...valid, cpf: 'abc' })).response.status, 400);
  assert.equal((await mutate('POST', '/api/deliverers', { ...valid, nome: 123 })).response.status, 400);
  assert.equal((await mutate('POST', '/api/deliverers', { ...valid, cpf: '111.111.111-11' })).response.status, 400);
  assert.equal((await mutate('POST', '/api/deliverers', { ...valid, cpf: '529.982.247-24' })).response.status, 400);
  assert.equal((await mutate('POST', '/api/deliverers', { ...valid, estado: 'XX' })).response.status, 400);
  const created = await mutate('POST', '/api/deliverers', valid);
  assert.equal(created.response.status, 201); assert.equal(created.body.entregador.nome, 'Maria Silva');
  assert.equal(created.body.entregador.cpf, '52998224725'); assert.equal(created.body.entregador.cep, '01001000');
  assert.equal(created.body.entregador.cidade, 'São Paulo'); assert.equal(created.body.entregador.estado, 'SP');
  assert.equal((await mutate('POST', '/api/deliverers', valid)).response.status, 409);
  const withoutCpf = await mutate('POST', '/api/deliverers', { ...valid, nome: 'Sem CPF', cpf: '' });
  assert.equal(withoutCpf.response.status, 201); assert.equal(withoutCpf.body.entregador.cpf, null);
  const manual = await mutate('POST', '/api/deliverers', { nome: 'Cadastro manual', endereco: 'Rua sem consulta' });
  assert.equal(manual.response.status, 201); assert.equal(manual.body.entregador.cidade, null); assert.equal(manual.body.entregador.estado, null);
});

test('consulta, pesquisa, atualiza campos e trata IDs inválidos/inexistentes', async () => {
  cookie = ''; await login('admin@example.com');
  const detail = await request('/api/deliverers/1'); assert.equal(detail.response.status, 200); assert.equal(detail.body.entregador.numero, '15');
  assert.equal((await request('/api/deliverers/abc')).response.status, 400);
  assert.equal((await request('/api/deliverers/999')).response.status, 404);
  assert.equal((await request('/api/deliverers?q=Maria')).body.length, 1);
  const updated = await mutate('PATCH', '/api/deliverers/1', { numero: '22', quadra: 'Q9' });
  assert.equal(updated.response.status, 200); assert.equal(updated.body.entregador.numero, '22'); assert.equal(updated.body.entregador.quadra, 'Q9');
  const addressUpdate = await mutate('PATCH', '/api/deliverers/1', { cidade: 'Campinas', estado: 'mg' });
  assert.equal(addressUpdate.body.entregador.cidade, 'Campinas'); assert.equal(addressUpdate.body.entregador.estado, 'MG');
  assert.equal((await mutate('PATCH', '/api/deliverers/1', { cpf: '123' })).response.status, 400);
  assert.equal((await mutate('PATCH', '/api/deliverers/1', { nome: 'Não permitido', acesso: 'administrador' })).response.status, 400);
});

test('exclusão exige sessão, valida ID, preserva referências e trata falhas do banco', async () => {
  cookie = '';
  const csrfToken = (await request('/api/auth/csrf')).body.csrfToken;
  assert.equal((await request('/api/deliverers/1', { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } })).response.status, 401);

  await login('admin@example.com');
  assert.equal((await request('/api/deliverers/1', { method: 'DELETE' })).response.status, 403);
  assert.equal((await mutate('DELETE', '/api/deliverers/invalido')).response.status, 400);
  assert.equal((await mutate('DELETE', '/api/deliverers/999')).response.status, 404);

  failDelete = true;
  const failed = await mutate('DELETE', '/api/deliverers/1');
  failDelete = false;
  assert.equal(failed.response.status, 500);
  assert.match(failed.body.erro, /erro interno/i);
  assert.equal(records.some((record) => String(record.id) === '1'), true);

  restrictDelete = true;
  const restricted = await mutate('DELETE', '/api/deliverers/1');
  restrictDelete = false;
  assert.equal(restricted.response.status, 409);
  assert.match(restricted.body.erro, /registros relacionados/i);
  assert.equal(records.some((record) => String(record.id) === '1'), true);

  const deleted = await mutate('DELETE', '/api/deliverers/2');
  assert.equal(deleted.response.status, 200);
  assert.match(deleted.body.mensagem, /excluído com sucesso/i);
  assert.equal(records.some((record) => String(record.id) === '2'), false);
  assert.equal(records.some((record) => String(record.id) === '1'), true);
});

test('endpoint exclusivo de pesquisa por rua foi removido', async () => {
  cookie = ''; await login('admin@example.com');
  assert.equal((await request('/api/address/street?street=Rua%20das%20Flores')).response.status, 404);
});
