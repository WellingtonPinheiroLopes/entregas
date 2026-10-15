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
const clients = [];
let nextId = 1;
let failQuery = false;
let failDelete = '';
const publicUser = ({ senha_hash, ...user }) => user;
const db = {
  async execute(sql, params = []) {
    if (sql.includes('FROM usuarios WHERE email')) return [[...users.filter((user) => user.email === params[0])]];
    if (sql.includes('FROM usuarios WHERE id')) return [[...users.filter((user) => String(user.id) === String(params[0])).map(publicUser)]];
    if (sql.startsWith('SELECT') && sql.includes('FROM clientes')) {
      if (failQuery) { const error = new Error('database unavailable'); error.code = 'ECONNREFUSED'; throw error; }
      if (sql.includes('WHERE nome LIKE')) {
        const nameTerm = params[0].slice(1, -1).toLowerCase(); const cpfTerm = params[1].slice(1, -1);
        return [[...clients.filter((client) => client.nome.toLowerCase().includes(nameTerm) || (client.cpf || '').includes(cpfTerm))]];
      }
      if (sql.includes('WHERE id')) return [[...clients.filter((client) => String(client.id) === String(params[0]))]];
      return [[...clients].reverse()];
    }
    if (sql.startsWith('INSERT INTO clientes')) {
      const fields = sql.match(/\(([^)]+)\)/)[1].split(', ');
      const row = Object.fromEntries(fields.map((field, index) => [field, params[index]]));
      if (row.cpf && clients.some((client) => client.cpf === row.cpf)) { const error = new Error("Duplicate entry for key 'uk_clientes_cpf'"); error.code = 'ER_DUP_ENTRY'; throw error; }
      Object.assign(row, { id: nextId++, criado_em: '2026-01-01', atualizado_em: '2026-01-01' }); clients.push(row);
      return [{ insertId: row.id }];
    }
    if (sql.startsWith('UPDATE clientes SET')) {
      const id = String(params.at(-1)); const row = clients.find((client) => String(client.id) === id);
      if (!row) return [{ affectedRows: 0 }];
      const fields = [...sql.matchAll(/([a-z_]+) = \?/g)].map((match) => match[1]).filter((field) => field !== 'id');
      const values = params.slice(0, -1); const cpf = fields.includes('cpf') ? values[fields.indexOf('cpf')] : row.cpf;
      if (cpf && clients.some((client) => client.cpf === cpf && client !== row)) { const error = new Error("Duplicate entry for key 'uk_clientes_cpf'"); error.code = 'ER_DUP_ENTRY'; throw error; }
      fields.forEach((field, index) => { row[field] = values[index]; });
      return [{ affectedRows: 1 }];
    }
    if (sql === 'DELETE FROM clientes WHERE id = ?') {
      if (failDelete) { const error = new Error('delete failed'); error.code = failDelete; throw error; }
      const index = clients.findIndex((client) => String(client.id) === String(params[0]));
      if (index < 0) return [{ affectedRows: 0 }];
      clients.splice(index, 1); return [{ affectedRows: 1 }];
    }
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
  return request(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}
before(async () => {
  users[0].senha_hash = await bcrypt.hash('admin-password', 4); users[1].senha_hash = await bcrypt.hash('guest-password', 4);
  const app = createApp({ db, sessionStore: new session.MemoryStore(), testing: true });
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise((resolve) => server.close(resolve)));

test('rotas de clientes exigem sessão e perfil administrativo', async () => {
  cookie = '';
  assert.equal((await request('/api/clients')).response.status, 401);
  await login('guest@example.com');
  assert.equal((await request('/api/clients')).response.status, 403);
  assert.equal((await mutate('POST', '/api/clients', { nome: 'Cliente' })).response.status, 403);
});

test('cadastra com nome obrigatório, valida CPF e trata CPF duplicado', async () => {
  cookie = ''; await login('admin@example.com');
  assert.equal((await mutate('POST', '/api/clients', { nome: ' ' })).response.status, 400);
  assert.equal((await mutate('POST', '/api/clients', { nome: 'CPF inválido', cpf: '111.111.111-11' })).response.status, 400);
  const payload = { nome: '  Maria Cliente  ', cpf: '529.982.247-25', cep: '01001-000', endereco: 'Praça da Sé', numero: '123 fundos', quadra: 'Q2', lote: 'L4', setor: 'Centro', cidade: 'São Paulo', estado: 'sp', observacao: 'Casa azul, portão lateral' };
  const created = await mutate('POST', '/api/clients', payload);
  assert.equal(created.response.status, 201); assert.equal(created.body.cliente.nome, 'Maria Cliente');
  assert.equal(created.body.cliente.cpf, '52998224725'); assert.equal(created.body.cliente.cep, '01001000');
  assert.equal(created.body.cliente.observacao, payload.observacao);
  assert.equal(created.body.cliente.numero, '123 fundos');
  assert.equal(created.body.cliente.setor, 'Centro'); assert.equal(created.body.cliente.cidade, 'São Paulo'); assert.equal(created.body.cliente.estado, 'SP');
  const duplicate = await mutate('POST', '/api/clients', { nome: 'Outro', cpf: '52998224725' });
  assert.equal(duplicate.response.status, 409);
  assert.equal((await mutate('POST', '/api/clients', { nome: 'UF inválida', estado: 'XX' })).response.status, 400);
  const noCpf = await mutate('POST', '/api/clients', { nome: 'Sem CPF' });
  assert.equal(noCpf.response.status, 201); assert.equal(noCpf.body.cliente.cpf, null);
});

test('pesquisa por nome ou CPF, consulta e atualiza cadastro', async () => {
  cookie = ''; await login('admin@example.com');
  assert.equal((await request('/api/clients?q=Maria')).body.length, 1);
  assert.equal((await request('/api/clients?q=529.982')).body.length, 1);
  assert.equal((await request('/api/clients/abc')).response.status, 400);
  assert.equal((await request('/api/clients/999')).response.status, 404);
  const detail = await request('/api/clients/1'); assert.equal(detail.response.status, 200); assert.equal(detail.body.cliente.quadra, 'Q2');
  assert.equal(detail.body.cliente.numero, '123 fundos');
  assert.equal(detail.body.cliente.setor, 'Centro'); assert.equal(detail.body.cliente.cidade, 'São Paulo'); assert.equal(detail.body.cliente.estado, 'SP');
  const updated = await mutate('PATCH', '/api/clients/1', { nome: 'Maria Atualizada', observacao: 'Entregar após as 18h', setor: 'Bela Vista', cidade: 'São Paulo', estado: 'RJ' });
  assert.equal(updated.response.status, 200, JSON.stringify(updated.body)); assert.equal(updated.body.cliente.nome, 'Maria Atualizada');
  assert.equal(updated.body.cliente.observacao, 'Entregar após as 18h'); assert.equal(updated.body.cliente.quadra, 'Q2');
  assert.equal(updated.body.cliente.numero, '123 fundos');
  assert.equal(updated.body.cliente.setor, 'Bela Vista'); assert.equal(updated.body.cliente.estado, 'RJ');
  const numberUpdated = await mutate('PATCH', '/api/clients/1', { numero: '456 apto 2' });
  assert.equal(numberUpdated.response.status, 200); assert.equal(numberUpdated.body.cliente.numero, '456 apto 2');
  assert.equal((await mutate('PATCH', '/api/clients/999', { nome: 'Ausente' })).response.status, 404);
  assert.equal((await mutate('PATCH', '/api/clients/1', { acesso: 'administrador' })).response.status, 400);
});

test('exclusão trata inexistência, vínculos e erros do banco sem revelar detalhes', async () => {
  cookie = ''; await login('admin@example.com');
  assert.equal((await mutate('DELETE', '/api/clients/invalido')).response.status, 400);
  assert.equal((await mutate('DELETE', '/api/clients/999')).response.status, 404);
  failDelete = 'ER_ROW_IS_REFERENCED_2';
  const linked = await mutate('DELETE', '/api/clients/1');
  assert.equal(linked.response.status, 409, JSON.stringify(linked.body)); assert.match(linked.body.erro, /registros relacionados/);
  failDelete = 'ECONNREFUSED';
  const failed = await mutate('DELETE', '/api/clients/1');
  assert.equal(failed.response.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /ECONNREFUSED|delete failed/);
  failDelete = '';
  assert.equal((await mutate('DELETE', '/api/clients/1')).response.status, 200);
  assert.equal((await request('/api/clients/1')).response.status, 404);
});

test('erros em consultas retornam resposta genérica', async () => {
  cookie = ''; await login('admin@example.com'); failQuery = true;
  const failed = await request('/api/clients'); failQuery = false;
  assert.equal(failed.response.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /ECONNREFUSED|database unavailable/);
});
