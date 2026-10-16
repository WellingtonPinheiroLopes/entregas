'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { createApp } = require('./app');

const users = [
  { id: 1, nome: 'Admin', email: 'admin@example.com', acesso: 'administrador', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
  { id: 2, nome: 'Convidado', email: 'guest@example.com', acesso: 'convidado', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
];
const clients = [{ id: 101, nome: 'Cliente Teste', cpf: '52998224725', cep: '01001000', endereco: 'Rua Original', numero: '55', quadra: 'Q1', lote: 'L2', setor: 'Centro', cidade: 'São Paulo', estado: 'SP' }];
const deliverers = [{ id: 201, nome: 'Entregador Teste', cpf: '11122233344', email: 'driver@example.com' }];
let deliveries = [];
let history = [];
let nextDeliveryId = 1;
let nextHistoryId = 1;
let failDeliveryQuery = false;
const clone = (value) => structuredClone(value);
const mockDb = {
  async execute(sql, params = []) {
    if (sql.includes('FROM usuarios WHERE email')) return [[...users.filter((user) => user.email === params[0])]];
    if (sql.includes('FROM usuarios WHERE id')) return [[...users.filter((user) => String(user.id) === String(params[0]))]];
    if (sql.includes('FROM clientes WHERE id')) return [[...clients.filter((client) => String(client.id) === String(params[0]))]];
    if (sql.includes('FROM entregadores WHERE id')) return [[...deliverers.filter((item) => String(item.id) === String(params[0]))]];
    if (sql.includes('FROM entregas e JOIN')) {
      if (failDeliveryQuery) { const error = new Error('db offline'); error.code = 'ECONNREFUSED'; throw error; }
      let selected = [...deliveries];
      if (sql.includes('WHERE e.id = ?')) selected = selected.filter((item) => String(item.id) === String(params[0]));
      else if (sql.includes('WHERE')) {
        let index = 0;
        if (sql.includes('e.status = ?')) { selected = selected.filter((item) => item.status === params[index]); index++; }
        if (sql.includes('e.cliente_id = ?')) { selected = selected.filter((item) => String(item.cliente_id) === String(params[index])); index++; }
        if (sql.includes('e.entregador_id = ?')) { selected = selected.filter((item) => String(item.entregador_id) === String(params[index])); index++; }
        if (sql.includes('e.criado_em >= ?')) index++;
        if (sql.includes('e.criado_em < DATE_ADD')) index++;
        if (sql.includes('e.descricao LIKE ?')) { const q = params[index].slice(1, -1).toLowerCase(); selected = selected.filter((item) => item.descricao.toLowerCase().includes(q) || clients.find((c) => c.id === item.cliente_id)?.nome.toLowerCase().includes(q) || deliverers.find((d) => d.id === item.entregador_id)?.nome.toLowerCase().includes(q)); }
      }
      const projected = selected.map((item) => ({ ...item, cliente_nome: clients.find((client) => client.id === item.cliente_id)?.nome, cliente_cpf: clients.find((client) => client.id === item.cliente_id)?.cpf, entregador_nome: deliverers.find((deliverer) => deliverer.id === item.entregador_id)?.nome || null, entregador_cpf: deliverers.find((deliverer) => deliverer.id === item.entregador_id)?.cpf || null }));
      return [sql.includes('ORDER BY e.criado_em DESC') ? projected.reverse() : projected];
    }
    if (sql.includes('FROM historico_status_entregas h')) return [[...history.filter((event) => String(event.entrega_id) === String(params[0])).reverse().map((event) => ({ ...event, usuario_nome: users.find((user) => user.id === event.usuario_id)?.nome || null }))]];
    if (sql.includes('GROUP BY status')) return [[...['na_farmacia', 'em_transito', 'concluida', 'cancelada'].flatMap((status) => { const total = deliveries.filter((item) => item.status === status).length; return total ? [{ status, total }] : []; })]];
    if (sql.includes('FROM entregas WHERE id')) return [[...deliveries.filter((item) => String(item.id) === String(params[0])).map(({ id, status }) => ({ id, status }))]];
    if (sql.startsWith('INSERT INTO entregas')) {
      const fields = sql.match(/\(([^)]+)\)/)[1].split(', ');
      const item = Object.fromEntries(fields.map((field, index) => [field, params[index]]));
      Object.assign(item, { id: nextDeliveryId++, status: 'na_farmacia', cancelada_em: null, cancelada_por: null, motivo_cancelamento: null, criado_em: '2026-10-15 10:00:00', atualizado_em: '2026-10-15 10:00:00' });
      deliveries.push(item); return [{ insertId: item.id }];
    }
    if (sql.startsWith('INSERT INTO historico_status_entregas')) {
      const fields = sql.match(/historico_status_entregas \(([^)]+)\)/)[1].split(', ');
      const event = sql.includes('VALUES (?, NULL, ?, ?)')
        ? { entrega_id: params[0], status_anterior: null, status_novo: params[1], usuario_id: params[2] }
        : Object.fromEntries(fields.map((field, index) => [field, params[index]]));
      Object.assign(event, { id: nextHistoryId++, criado_em: '2026-10-15 10:00:00' }); history.push(event); return [{ insertId: event.id }];
    }
    if (sql.startsWith('UPDATE entregas SET')) {
      const id = String(params.at(-1)); const item = deliveries.find((delivery) => String(delivery.id) === id);
      if (!item) return [{ affectedRows: 0 }];
      const fields = [...sql.matchAll(/([a-z_]+) = \?/g)].map((match) => match[1]).filter((field) => field !== 'id');
      fields.forEach((field, index) => { item[field] = params[index]; });
      if (sql.includes('cancelada_em = CURRENT_TIMESTAMP')) item.cancelada_em = '2026-10-15 10:00:00';
      item.atualizado_em = '2026-10-15 10:00:00'; return [{ affectedRows: 1 }];
    }
    return [[]];
  },
  async query() { return [[]]; },
  async getConnection() {
    let snapshot;
    return {
      execute: (...args) => mockDb.execute(...args),
      async beginTransaction() { snapshot = { deliveries: clone(deliveries), history: clone(history), nextDeliveryId, nextHistoryId }; },
      async commit() {},
      async rollback() { if (snapshot) { deliveries = snapshot.deliveries; history = snapshot.history; nextDeliveryId = snapshot.nextDeliveryId; nextHistoryId = snapshot.nextHistoryId; } },
      release() {},
    };
  },
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
async function createDelivery(overrides = {}) {
  return mutate('POST', '/api/deliveries', { cliente_id: 101, entregador_id: 201, descricao: 'Levar pedido', status: 'concluida', ...overrides });
}

before(async () => {
  users[0].senha_hash = await bcrypt.hash('admin-password', 4); users[1].senha_hash = await bcrypt.hash('guest-password', 4);
  const app = createApp({ db: mockDb, sessionStore: new session.MemoryStore(), testing: true });
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { deliveries = []; history = []; nextDeliveryId = 1; nextHistoryId = 1; failDeliveryQuery = false; Object.assign(clients[0], { cep: '01001000', endereco: 'Rua Original', numero: '55', quadra: 'Q1', lote: 'L2', setor: 'Centro', cidade: 'São Paulo', estado: 'SP' }); cookie = ''; });
after(async () => new Promise((resolve) => server.close(resolve)));

test('API de entregas exige autenticação, autorização administrativa e CSRF', async () => {
  assert.equal((await request('/api/deliveries')).response.status, 401);
  await login('guest@example.com');
  assert.equal((await request('/api/deliveries')).response.status, 403);
  assert.equal((await request('/api/deliveries/summary')).response.status, 403);
  assert.equal((await request('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).response.status, 403);
  cookie = ''; await login('admin@example.com');
  assert.equal((await request('/api/deliveries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).response.status, 403);
});

test('cria com vínculos válidos, valida obrigatórios e força status inicial com snapshot do endereço', async () => {
  await login('admin@example.com');
  assert.equal((await createDelivery({ cliente_id: 999 })).response.status, 404);
  assert.equal((await createDelivery({ entregador_id: 999 })).response.status, 404);
  assert.equal((await createDelivery({ descricao: ' ' })).response.status, 400);
  const created = await createDelivery({ endereco_destino: 'Rua ajustada', quadra_destino: 'Q8', observacoes: 'Ligar na chegada' });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.entrega.status, 'na_farmacia');
  assert.equal(created.body.entrega.endereco_destino, 'Rua ajustada');
  assert.equal(created.body.entrega.cep_destino, '01001000');
  assert.equal(created.body.entrega.numero_destino, '55');
  assert.equal(created.body.entrega.quadra_destino, 'Q8');
  assert.equal(created.body.entrega.lote_destino, 'L2');
  assert.equal(created.body.entrega.setor_destino, 'Centro'); assert.equal(created.body.entrega.cidade_destino, 'São Paulo'); assert.equal(created.body.entrega.estado_destino, 'SP');
  assert.equal(history.length, 1); assert.equal(history[0].status_novo, 'na_farmacia'); assert.equal(history[0].usuario_id, 1);
  clients[0].endereco = 'Rua nova do cadastro';
  clients[0].numero = '99';
  clients[0].setor = 'Bairro novo'; clients[0].cidade = 'Cidade nova'; clients[0].estado = 'RJ';
  const historical = (await request('/api/deliveries/1')).body.entrega;
  assert.equal(historical.endereco_destino, 'Rua ajustada'); assert.equal(historical.setor_destino, 'Centro');
  assert.equal(historical.numero_destino, '55');
  assert.equal(historical.cidade_destino, 'São Paulo'); assert.equal(historical.estado_destino, 'SP');
});

test('cria entrega sem entregador, lista e detalha como aguardando, permite atribuir e remover', async () => {
  await login('admin@example.com');
  const created = await createDelivery({ entregador_id: undefined });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.entrega.entregador_id, null);
  assert.equal(created.body.entrega.entregador_nome, null);
  assert.equal(created.body.entrega.status, 'na_farmacia');

  const listed = await request('/api/deliveries');
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.length, 1);
  assert.equal(listed.body[0].entregador_id, null);
  const detail = await request('/api/deliveries/1');
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.entrega.entregador_id, null);
  const summary = await request('/api/deliveries/summary');
  assert.equal(summary.body.total, 1);
  assert.equal(summary.body.statuses.na_farmacia, 1);

  assert.equal((await mutate('PATCH', '/api/deliveries/1', { entregador_id: 999 })).response.status, 404);
  const assigned = await mutate('PATCH', '/api/deliveries/1', { entregador_id: 201 });
  assert.equal(assigned.response.status, 200);
  assert.equal(assigned.body.entrega.entregador_id, 201);
  assert.equal(assigned.body.entrega.entregador_nome, 'Entregador Teste');
  const unassigned = await mutate('PATCH', '/api/deliveries/1', { entregador_id: '' });
  assert.equal(unassigned.response.status, 200);
  assert.equal(unassigned.body.entrega.entregador_id, null);
  assert.equal((await mutate('PATCH', '/api/deliveries/1', { entregador_id: null })).body.entrega.entregador_id, null);
});

test('lista com filtros, retorna detalhes e histórico, aplica transições permitidas', async () => {
  await login('admin@example.com');
  await createDelivery({ descricao: 'Medicamento A' });
  const second = await createDelivery({ descricao: 'Medicamento B', entregador_id: 201 }); assert.equal(second.response.status, 201);
  const filtered = await request('/api/deliveries?status=na_farmacia&cliente_id=101&entregador_id=201');
  assert.equal(filtered.response.status, 200); assert.equal(filtered.body.length, 2);
  const summary = await request('/api/deliveries/summary'); assert.equal(summary.body.total, 2); assert.equal(summary.body.statuses.na_farmacia, 2);
  assert.equal((await request('/api/deliveries?status=invalid')).response.status, 400);
  assert.equal((await request('/api/deliveries/abc')).response.status, 400);
  const detail = await request('/api/deliveries/1'); assert.equal(detail.response.status, 200); assert.equal(detail.body.historico.length, 1);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'concluida' })).response.status, 409);
  const transit = await mutate('PATCH', '/api/deliveries/1/status', { status: 'em_transito' });
  assert.equal(transit.response.status, 200); assert.equal(transit.body.entrega.status, 'em_transito');
  const returnToPharmacy = await mutate('PATCH', '/api/deliveries/1/status', { status: 'na_farmacia' });
  assert.equal(returnToPharmacy.response.status, 200); assert.equal(returnToPharmacy.body.entrega.status, 'na_farmacia');
  assert.equal(history.at(-1).status_anterior, 'em_transito'); assert.equal(history.at(-1).status_novo, 'na_farmacia'); assert.equal(history.at(-1).usuario_id, 1);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'concluida' })).response.status, 409);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'cancelada' })).response.status, 400);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'em_transito' })).response.status, 200);
  const completed = await mutate('PATCH', '/api/deliveries/1/status', { status: 'concluida' });
  assert.equal(completed.response.status, 200); assert.equal(completed.body.entrega.status, 'concluida');
  assert.equal((await mutate('PATCH', '/api/deliveries/1', { descricao: 'Não editar concluída' })).response.status, 409);
  assert.equal((await request('/api/deliveries/1')).body.historico.length, 5);
  const refreshedSummary = await request('/api/deliveries/summary');
  assert.equal(refreshedSummary.body.statuses.concluida, 1); assert.equal(refreshedSummary.body.statuses.na_farmacia, 1);
});

test('edita campos permitidos e cancela com motivo auditado em transação', async () => {
  await login('admin@example.com'); await createDelivery();
  const edited = await mutate('PATCH', '/api/deliveries/1', { descricao: 'Descrição editada', endereco_destino: 'Rua corrigida' });
  assert.equal(edited.response.status, 200); assert.equal(edited.body.entrega.endereco_destino, 'Rua corrigida');
  assert.equal((await mutate('PATCH', '/api/deliveries/1', { status: 'concluida' })).response.status, 400);
  assert.equal((await mutate('POST', '/api/deliveries/1/cancel', { motivo: ' ' })).response.status, 400);
  const cancelled = await mutate('POST', '/api/deliveries/1/cancel', { motivo: 'Cliente indisponível no endereço' });
  assert.equal(cancelled.response.status, 200); assert.equal(cancelled.body.entrega.status, 'cancelada');
  assert.equal(cancelled.body.entrega.motivo_cancelamento, 'Cliente indisponível no endereço');
  assert.equal(cancelled.body.entrega.cancelada_por, 1); assert.equal(history.at(-1).motivo, 'Cliente indisponível no endereço');
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'concluida' })).response.status, 409);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'na_farmacia' })).response.status, 409);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'em_transito' })).response.status, 409);
  assert.equal((await mutate('POST', '/api/deliveries/1/cancel', { motivo: 'Tentar outra vez' })).response.status, 409);
});

test('filtra datas, trata entrega inexistente e erro de banco sem expor detalhes', async () => {
  await login('admin@example.com');
  assert.equal((await request('/api/deliveries?de=inválida')).response.status, 400);
  assert.equal((await request('/api/deliveries?de=2026-12-01&ate=2026-01-01')).response.status, 400);
  assert.equal((await mutate('PATCH', '/api/deliveries/999/status', { status: 'em_transito' })).response.status, 404);
  failDeliveryQuery = true;
  const failed = await request('/api/deliveries');
  assert.equal(failed.response.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /ECONNREFUSED|db offline/);
});
