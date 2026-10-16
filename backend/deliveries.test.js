'use strict';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { createApp } = require('./app');

const users = [
  { id: 1, nome: 'Admin', email: 'admin@example.com', acesso: 'administrador', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
  { id: 2, nome: 'Convidado', email: 'guest@example.com', acesso: 'convidado', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
  { id: 3, nome: 'Entregador Teste', email: 'driver@example.com', acesso: 'entregador', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
  { id: 4, nome: 'Entregador Outro', email: 'driver2@example.com', acesso: 'entregador', criado_em: '2026-01-01', atualizado_em: '2026-01-01', senha_hash: '' },
];
const clients = [{ id: 101, nome: 'Cliente Teste', cpf: '52998224725', cep: '01001000', endereco: 'Rua Original', numero: '55', quadra: 'Q1', lote: 'L2', setor: 'Centro', cidade: 'São Paulo', estado: 'SP' }];
const deliverers = [{ id: 201, nome: 'Entregador Teste', cpf: '11122233344', email: 'driver@example.com', usuario_id: 3 }, { id: 202, nome: 'Entregador Outro', cpf: '11122233345', email: 'driver2@example.com', usuario_id: 4 }];
let deliveries = [];
let history = [];
let notifications = [];
let nextDeliveryId = 1;
let nextHistoryId = 1;
let nextNotificationId = 1;
let failDeliveryQuery = false;
let failCommit = false;
const clone = (value) => structuredClone(value);
const mockDb = {
  async execute(sql, params = []) {
    if (sql.startsWith('INSERT INTO notificacoes')) {
      const delivery = deliveries.find((item) => String(item.id) === String(params[3]));
      for (const user of users.filter((item) => item.acesso === 'entregador' && deliverers.some((entry) => String(entry.usuario_id) === String(item.id)) && delivery?.status === 'na_farmacia' && delivery?.entregador_id == null)) {
        if (!notifications.some((item) => String(item.usuario_id) === String(user.id) && item.tipo === params[0] && String(item.entrega_id) === String(params[2]))) {
          notifications.push({ id: nextNotificationId++, usuario_id: user.id, tipo: params[0], mensagem: params[1], entrega_id: params[2], criado_em: '2026-10-15 10:00:00', lida_em: null });
        }
      }
      return [{ affectedRows: 2 }];
    }
    const isVisibleNotification = (item) => item.tipo !== 'nova_entrega' || deliveries.some((delivery) => String(delivery.id) === String(item.entrega_id) && delivery.entregador_id == null && delivery.status === 'na_farmacia');
    if (sql.includes('FROM notificacoes n LEFT JOIN entregas d') && sql.includes('ORDER BY')) return [[...notifications.filter((item) => String(item.usuario_id) === String(params[0]) && isVisibleNotification(item)).sort((a, b) => b.id - a.id).slice(0, 50).map(({ id, tipo, mensagem, criado_em, lida_em }) => ({ id, tipo, mensagem, criado_em, lida_em }))]];
    if (sql.includes('COUNT(*) AS total FROM notificacoes')) return [[{ total: notifications.filter((item) => String(item.usuario_id) === String(params[0]) && item.lida_em == null && isVisibleNotification(item)).length }]];
    if (sql.startsWith('UPDATE notificacoes n LEFT JOIN entregas d') && sql.includes('n.usuario_id = ?') && !sql.includes('n.id = ?')) {
      const changed = notifications.filter((item) => String(item.usuario_id) === String(params[0]) && item.lida_em == null && isVisibleNotification(item));
      changed.forEach((item) => { item.lida_em = '2026-10-15 11:00:00'; });
      return [{ affectedRows: changed.length }];
    }
    if (sql.startsWith('UPDATE notificacoes n LEFT JOIN entregas d') && sql.includes('n.id = ?')) {
      const item = notifications.find((entry) => String(entry.id) === String(params[0]) && String(entry.usuario_id) === String(params[1]) && entry.lida_em == null && isVisibleNotification(entry));
      if (item) item.lida_em = '2026-10-15 11:00:00';
      return [{ affectedRows: item ? 1 : 0 }];
    }
    if (sql.includes('FROM notificacoes n LEFT JOIN entregas d') && sql.includes('n.id = ?')) return [[...notifications.filter((item) => String(item.id) === String(params[0]) && String(item.usuario_id) === String(params[1]) && isVisibleNotification(item)).map(({ id }) => ({ id }))]];
    if (sql.includes('FROM usuarios WHERE email')) return [[...users.filter((user) => user.email === params[0])]];
    if (sql.includes('FROM usuarios WHERE id')) return [[...users.filter((user) => String(user.id) === String(params[0]))]];
    if (sql.includes('FROM clientes WHERE id')) return [[...clients.filter((client) => String(client.id) === String(params[0]))]];
    if (sql.includes('FROM entregadores WHERE id')) return [[...deliverers.filter((item) => String(item.id) === String(params[0]))]];
    if (sql.includes('FROM entregadores WHERE usuario_id')) return [[...deliverers.filter((item) => String(item.usuario_id) === String(params[0]))]];
    if (sql.startsWith('SELECT id, status, descricao, criado_em FROM entregas')) {
      let selected = deliveries.filter((item) => item.status === 'na_farmacia' && item.entregador_id == null);
      if (sql.includes('WHERE id = ?')) selected = selected.filter((item) => String(item.id) === String(params[0]));
      if (sql.includes('descricao LIKE ?')) { const q = params.at(-1).slice(1, -1).toLowerCase(); selected = selected.filter((item) => item.descricao.toLowerCase().includes(q)); }
      return [selected.map(({ id, status, descricao, criado_em }) => ({ id, status, descricao, criado_em })).reverse()];
    }
    if (sql.includes('FROM entregas e JOIN')) {
      if (failDeliveryQuery) { const error = new Error('db offline'); error.code = 'ECONNREFUSED'; throw error; }
      let selected = [...deliveries];
      if (sql.includes('WHERE e.id = ?')) selected = selected.filter((item) => String(item.id) === String(params[0]) && (!sql.includes('AND e.entregador_id = ?') || String(item.entregador_id) === String(params[1])));
      else if (sql.includes('WHERE e.entregador_id = ?')) {
        selected = selected.filter((item) => String(item.entregador_id) === String(params[0]));
        let index = 1;
        if (sql.includes('AND e.status = ?')) { selected = selected.filter((item) => item.status === params[index]); index++; }
        if (sql.includes('AND (e.descricao LIKE ? OR c.nome LIKE ?)')) { const q = params[index].slice(1, -1).toLowerCase(); selected = selected.filter((item) => item.descricao.toLowerCase().includes(q) || clients.find((c) => c.id === item.cliente_id)?.nome.toLowerCase().includes(q)); }
      } else if (sql.includes('WHERE')) {
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
    if (sql.includes("WHERE (status = 'na_farmacia' AND (entregador_id IS NULL OR entregador_id = ?))")) return [[...['na_farmacia', 'em_transito', 'concluida', 'cancelada'].flatMap((status) => { const total = deliveries.filter((item) => item.status === status && (status === 'na_farmacia' ? item.entregador_id == null || String(item.entregador_id) === String(params[0]) : String(item.entregador_id) === String(params[1]))).length; return total ? [{ status, total }] : []; })]];
    if (sql.includes('GROUP BY status')) return [[...['na_farmacia', 'em_transito', 'concluida', 'cancelada'].flatMap((status) => { const total = deliveries.filter((item) => item.status === status).length; return total ? [{ status, total }] : []; })]];
    if (sql.includes('FROM entregas WHERE id')) return [[...deliveries.filter((item) => String(item.id) === String(params[0]) && (!sql.includes('AND entregador_id = ?') || String(item.entregador_id) === String(params[1]))).map(({ id, status, entregador_id }) => ({ id, status, entregador_id }))]];
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
      async beginTransaction() { snapshot = { deliveries: clone(deliveries), history: clone(history), notifications: clone(notifications), nextDeliveryId, nextHistoryId, nextNotificationId }; },
      async commit() { if (failCommit) { const error = new Error('commit failed'); error.code = 'ECONNREFUSED'; throw error; } },
      async rollback() { if (snapshot) { deliveries = snapshot.deliveries; history = snapshot.history; notifications = snapshot.notifications; nextDeliveryId = snapshot.nextDeliveryId; nextHistoryId = snapshot.nextHistoryId; nextNotificationId = snapshot.nextNotificationId; } },
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
  return request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, body: JSON.stringify({ email, senha: email.startsWith('admin') ? 'admin-password' : email.startsWith('driver') ? 'driver-password' : 'guest-password' }) });
}
async function mutate(method, path, payload) {
  const token = (await request('/api/auth/me')).body.csrfToken;
  return request(path, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
}
async function createDelivery(overrides = {}) {
  return mutate('POST', '/api/deliveries', { cliente_id: 101, entregador_id: 201, descricao: 'Levar pedido', status: 'concluida', ...overrides });
}

before(async () => {
  process.env.LOGIN_RATE_LIMIT = '100';
  users[0].senha_hash = await bcrypt.hash('admin-password', 4); users[1].senha_hash = await bcrypt.hash('guest-password', 4); users[2].senha_hash = await bcrypt.hash('driver-password', 4); users[3].senha_hash = await bcrypt.hash('driver-password', 4);
  const app = createApp({ db: mockDb, sessionStore: new session.MemoryStore(), testing: true });
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { deliveries = []; history = []; notifications = []; nextDeliveryId = 1; nextHistoryId = 1; nextNotificationId = 1; failDeliveryQuery = false; failCommit = false; Object.assign(clients[0], { cep: '01001000', endereco: 'Rua Original', numero: '55', quadra: 'Q1', lote: 'L2', setor: 'Centro', cidade: 'São Paulo', estado: 'SP' }); cookie = ''; });
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

test('entregador vê prévia da farmácia e somente os detalhes e ações das próprias entregas', async () => {
  await login('admin@example.com');
  await createDelivery({ descricao: 'Atribuída ao primeiro', entregador_id: 201 });
  await createDelivery({ descricao: 'Atribuída ao segundo', entregador_id: 202 });
  await createDelivery({ descricao: 'Sem atribuição', entregador_id: null, observacoes: 'Privado' });
  await createDelivery({ descricao: 'Na farmácia atribuída a outro', entregador_id: 202 });
  await createDelivery({ descricao: 'Na farmácia do primeiro', entregador_id: 201 });
  await createDelivery({ descricao: 'Concluída do primeiro', entregador_id: 201 });
  await createDelivery({ descricao: 'Cancelada do primeiro', entregador_id: 201 });
  await createDelivery({ descricao: 'Concluída do segundo', entregador_id: 202 });
  await createDelivery({ descricao: 'Cancelada do segundo', entregador_id: 202 });
  deliveries[0].status = 'em_transito';
  deliveries[1].status = 'em_transito';
  deliveries[2].observacoes = 'Privado';
  deliveries[5].status = 'concluida'; deliveries[6].status = 'cancelada';
  deliveries[7].status = 'concluida'; deliveries[8].status = 'cancelada';
  assert.deepEqual((await request('/api/deliveries')).body.map((item) => item.id).sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual((await request('/api/deliveries/summary')).body.statuses, { na_farmacia: 3, em_transito: 2, concluida: 2, cancelada: 2 });
  cookie = ''; await login('driver@example.com');

  assert.equal((await request('/api/deliveries/summary')).response.status, 200);
  const summary = (await request('/api/deliveries/summary')).body;
  assert.deepEqual(summary.statuses, { na_farmacia: 2, em_transito: 1, concluida: 1, cancelada: 1 });
  assert.equal(summary.total, 5);
  const list = (await request('/api/deliveries')).body;
  assert.deepEqual(list.map((item) => item.id).sort(), [1, 3, 5, 6, 7]);
  assert.equal(list.find((item) => item.id === 3).observacoes, undefined);
  assert.equal(list.find((item) => item.id === 3).cliente_cpf, undefined);
  assert.equal(list.find((item) => item.id === 3).endereco_destino, undefined);
  assert.equal(list.find((item) => item.id === 3).cliente_nome, undefined);
  assert.equal(list.find((item) => item.id === 3).atribuida_a_mim, false);
  assert.equal((await request('/api/deliveries/4')).response.status, 404);
  assert.equal((await request('/api/deliveries/2')).response.status, 404);
  const own = await request('/api/deliveries/1');
  assert.equal(own.response.status, 200); assert.equal(own.body.entrega.atribuida_a_mim, true);

  assert.equal((await mutate('PATCH', '/api/deliveries/1', { endereco_destino: 'Tentativa' })).response.status, 403);
  assert.equal((await mutate('PATCH', '/api/deliveries/3/status', { status: 'em_transito' })).response.status, 404);
  assert.equal((await mutate('POST', '/api/deliveries/3/cancel', { motivo: 'Não atribuída' })).response.status, 404);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'na_farmacia' })).response.status, 403);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'concluida' })).response.status, 403);
  assert.equal((await mutate('PATCH', '/api/deliveries/1/status', { status: 'em_transito' })).response.status, 403);
  assert.equal(deliveries[0].status, 'em_transito');
  deliveries[0].entregador_id = 202;
  assert.equal((await request('/api/deliveries/1')).response.status, 404);
  cookie = ''; await login('driver2@example.com');
  const driverBList = (await request('/api/deliveries')).body;
  assert.deepEqual(driverBList.map((item) => item.id).sort(), [1, 2, 3, 4, 8, 9]);
  const driverBSummary = (await request('/api/deliveries/summary')).body;
  assert.deepEqual(driverBSummary.statuses, { na_farmacia: 2, em_transito: 2, concluida: 1, cancelada: 1 });
  assert.equal(driverBSummary.total, 6);
});

test('entregador pode mover sua entrega da farmácia ao trânsito e cancelar com motivo; não pode editar ou reativar', async () => {
  await login('admin@example.com');
  await createDelivery({ entregador_id: 201 });
  await createDelivery({ entregador_id: 201, descricao: 'Cancelar' });
  await createDelivery({ entregador_id: 201, descricao: 'Concluída' });
  deliveries[2].status = 'concluida';
  cookie = ''; await login('driver@example.com');
  assert.equal((await mutate('POST', '/api/deliveries/2/cancel', {})).response.status, 400);
  const transit = await mutate('PATCH', '/api/deliveries/1/status', { status: 'em_transito' });
  assert.equal(transit.response.status, 200); assert.equal(transit.body.entrega.status, 'em_transito');
  assert.equal((await mutate('POST', '/api/deliveries/2/cancel', { motivo: 'Cliente ausente' })).response.status, 200);
  assert.equal(deliveries[1].status, 'cancelada');
  assert.equal(history.at(-1).motivo, 'Cliente ausente');
  assert.equal((await mutate('PATCH', '/api/deliveries/2/status', { status: 'na_farmacia' })).response.status, 403);
  assert.equal((await mutate('PATCH', '/api/deliveries/3/status', { status: 'em_transito' })).response.status, 403);
  assert.equal((await mutate('PATCH', '/api/deliveries/3', { descricao: 'Tentativa' })).response.status, 403);
});

test('atribuição e desatribuição administrativa alteram imediatamente o escopo por entregador sem mudar status', async () => {
  await login('admin@example.com');
  await createDelivery({ entregador_id: null, descricao: 'Disponível' });
  await createDelivery({ entregador_id: 201, descricao: 'Em trânsito' });
  await mutate('PATCH', '/api/deliveries/2/status', { status: 'em_transito' });
  const assigned = await mutate('PATCH', '/api/deliveries/1', { entregador_id: 201 });
  assert.equal(assigned.response.status, 200); assert.equal(assigned.body.entrega.status, 'na_farmacia');

  cookie = ''; await login('driver2@example.com');
  assert.deepEqual((await request('/api/deliveries')).body, []);
  assert.deepEqual((await request('/api/deliveries/summary')).body.statuses, { na_farmacia: 0, em_transito: 0, concluida: 0, cancelada: 0 });
  assert.equal((await request('/api/deliveries/1')).response.status, 404);

  cookie = ''; await login('admin@example.com');
  const unassigned = await mutate('PATCH', '/api/deliveries/1', { entregador_id: null });
  assert.equal(unassigned.response.status, 200); assert.equal(unassigned.body.entrega.status, 'na_farmacia');
  await mutate('PATCH', '/api/deliveries/2', { entregador_id: null });
  cookie = ''; await login('driver2@example.com');
  assert.deepEqual((await request('/api/deliveries')).body.map((item) => item.id), [1]);
  assert.equal((await request('/api/deliveries/2')).response.status, 404);
});

test('filtra datas, trata entrega inexistente e erro de banco sem expor detalhes', async () => {
  assert.equal((await login('admin@example.com')).response.status, 200);
  assert.equal((await request('/api/deliveries?de=inválida')).response.status, 400);
  assert.equal((await request('/api/deliveries?de=2026-12-01&ate=2026-01-01')).response.status, 400);
  assert.equal((await mutate('PATCH', '/api/deliveries/999/status', { status: 'em_transito' })).response.status, 404);
  failDeliveryQuery = true;
  const failed = await request('/api/deliveries');
  assert.equal(failed.response.status, 500); assert.doesNotMatch(JSON.stringify(failed.body), /ECONNREFUSED|db offline/);
});

test('notifica todos os entregadores autorizados somente para entregas disponíveis na criação', async () => {
  await login('admin@example.com');
  assert.equal((await createDelivery({ entregador_id: 201 })).response.status, 201);
  assert.equal((await createDelivery({ entregador_id: null })).response.status, 201);
  assert.equal(notifications.length, 2);
  for (const userId of [3, 4]) {
    const personal = notifications.filter((item) => item.usuario_id === userId);
    assert.equal(personal.length, 1);
    assert.ok(personal.every((item) => item.tipo === 'nova_entrega' && item.mensagem === 'Há uma nova entrega disponível.' && item.lida_em === null));
  }
  assert.equal(notifications.filter((item) => item.entrega_id === 1).length, 0);
  assert.equal(notifications.filter((item) => item.entrega_id === 2).length, 2);
  assert.equal((await request('/api/notifications')).body.notifications.length, 0, 'administrador não recebe a notificação específica de entregador');
});

test('notificações são privadas por usuário, contador e leitura respeitam o destinatário', async () => {
  await login('admin@example.com'); await createDelivery({ entregador_id: 201 }); await createDelivery({ entregador_id: null });
  cookie = ''; await login('driver@example.com');
  let feed = await request('/api/notifications');
  assert.equal(feed.response.status, 200); assert.equal(feed.body.unreadCount, 1); assert.equal(feed.body.notifications.length, 1);
  assert.ok(feed.body.notifications.every((item) => item.mensagem === 'Há uma nova entrega disponível.' && !item.lida));
  assert.ok(feed.body.notifications.every((item) => !Object.hasOwn(item, 'entrega_id') && !Object.hasOwn(item, 'endereco_destino')));
  assert.equal((await request('/api/notifications/unread-count')).body.count, 1);
  const first = feed.body.notifications[0].id;
  assert.equal((await request(`/api/notifications/${first}/read`, { method: 'PATCH' })).response.status, 403, 'mutação exige CSRF');
  assert.equal((await mutate('PATCH', `/api/notifications/${first}/read`)).response.status, 200);
  assert.equal((await request('/api/notifications/unread-count')).body.count, 0);
  cookie = ''; await login('driver2@example.com');
  const other = await request('/api/notifications');
  assert.equal(other.body.notifications.length, 1); assert.equal(other.body.unreadCount, 1);
  assert.equal((await mutate('PATCH', `/api/notifications/${first}/read`)).response.status, 404, 'não permite ler notificação alheia');
  const second = other.body.notifications[0].id;
  assert.equal((await mutate('PATCH', '/api/notifications/read-all')).response.status, 200);
  assert.equal((await request('/api/notifications/unread-count')).body.count, 0);
  assert.notEqual(notifications.find((item) => item.id === first).lida_em, null, 'a leitura feita pelo próprio usuário permanece');
  assert.notEqual(notifications.find((item) => item.id === second).lida_em, null);
});

test('atribuir ou alterar o status remove disponibilidade e contador sem apagar histórico', async () => {
  await login('admin@example.com'); await createDelivery({ entregador_id: null });
  const original = notifications.length;
  cookie = ''; await login('driver@example.com');
  assert.equal((await request('/api/notifications/unread-count')).body.count, 1);
  cookie = ''; await login('admin@example.com');
  await mutate('PATCH', '/api/deliveries/1', { entregador_id: 201 });
  cookie = ''; await login('driver2@example.com');
  const feed = await request('/api/notifications');
  assert.equal(feed.body.notifications.length, 0);
  assert.equal(feed.body.unreadCount, 0);
  assert.equal((await request('/api/notifications/unread-count')).body.count, 0);
  assert.equal((await mutate('PATCH', `/api/notifications/${notifications.find((item) => item.usuario_id === 4).id}/read`)).response.status, 404);
  assert.equal(notifications.length, original, 'o histórico original permanece');
});

test('entregas em trânsito, concluídas ou canceladas não aparecem como disponíveis', async () => {
  await login('admin@example.com');
  await createDelivery({ entregador_id: null }); await createDelivery({ entregador_id: null }); await createDelivery({ entregador_id: null });
  await mutate('PATCH', '/api/deliveries/1/status', { status: 'em_transito' });
  await mutate('PATCH', '/api/deliveries/2/status', { status: 'em_transito' });
  await mutate('PATCH', '/api/deliveries/2/status', { status: 'concluida' });
  await mutate('POST', '/api/deliveries/3/cancel', { motivo: 'Cancelamento de teste' });
  cookie = ''; await login('driver@example.com');
  assert.equal((await request('/api/notifications')).body.notifications.length, 0);
  assert.equal((await request('/api/notifications/unread-count')).body.count, 0);
  assert.equal(notifications.length, 6, 'histórico de notificações permanece no banco');
});

test('falhas e rollback da criação não deixam notificações ou entregas parciais; edição/status não notificam', async () => {
  await login('admin@example.com');
  failDeliveryQuery = true;
  assert.equal((await createDelivery()).response.status, 500);
  assert.equal(deliveries.length, 0); assert.equal(notifications.length, 0);
  failDeliveryQuery = false; failCommit = true;
  assert.equal((await createDelivery()).response.status, 500);
  assert.equal(deliveries.length, 0); assert.equal(history.length, 0); assert.equal(notifications.length, 0);
  failCommit = false;
  assert.equal((await createDelivery({ entregador_id: null })).response.status, 201);
  assert.equal(notifications.length, 2);
  const initialNotificationIds = notifications.map((item) => item.id);
  await mutate('PATCH', '/api/deliveries/1', { descricao: 'Editada' });
  await mutate('PATCH', '/api/deliveries/1/status', { status: 'em_transito' });
  await mutate('PATCH', '/api/deliveries/1', { entregador_id: 201 });
  assert.equal(notifications.length, 2);
  assert.deepEqual(notifications.map((item) => item.id), initialNotificationIds);
});
