'use strict';

const DELIVERY_STATUSES = ['na_farmacia', 'em_transito', 'concluida', 'cancelada'];
const STATUS_LABELS = { na_farmacia: 'Na farmácia', em_transito: 'Em trânsito', concluida: 'Concluída', cancelada: 'Cancelada' };
const DELIVERY_SELECT = `SELECT e.id, e.cliente_id, e.entregador_id, e.descricao, e.status,
  e.cep_destino, e.endereco_destino, e.quadra_destino, e.lote_destino, e.numero_destino,
  e.setor_destino, e.cidade_destino, e.estado_destino, e.observacoes, e.motivo_cancelamento,
  e.cancelada_em, e.cancelada_por, e.criado_em, e.atualizado_em,
  c.nome AS cliente_nome, c.cpf AS cliente_cpf,
  en.nome AS entregador_nome, en.cpf AS entregador_cpf
  FROM entregas e JOIN clientes c ON c.id = e.cliente_id
  JOIN entregadores en ON en.id = e.entregador_id`;
const DESTINATION_FIELDS = ['cep_destino', 'endereco_destino', 'quadra_destino', 'lote_destino', 'numero_destino', 'setor_destino', 'cidade_destino', 'estado_destino'];
const OPTIONAL_LENGTHS = { endereco_destino: 255, quadra_destino: 50, lote_destino: 50, numero_destino: 30, setor_destino: 120, cidade_destino: 100, observacoes: 5000 };
const BRAZILIAN_STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));

function validId(value) {
  return (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function parseOptionalFields(body, fields) {
  const result = {};
  for (const field of fields) {
    if (!Object.hasOwn(body, field)) continue;
    const input = body[field];
    if (input != null && typeof input !== 'string') return { error: `O campo ${field} deve ser texto.` };
    const value = typeof input === 'string' ? input.trim() : '';
    if (field === 'cep_destino') {
      if (!value) result[field] = null;
      else {
        if (!/^[\d\-\s]+$/.test(value) || value.replace(/\D/g, '').length !== 8) return { error: 'Informe um CEP de destino válido com 8 dígitos.' };
        result[field] = value.replace(/\D/g, '');
      }
    } else if (field === 'estado_destino') {
      const state = value.toLocaleUpperCase('pt-BR');
      if (state && !BRAZILIAN_STATES.has(state)) return { error: 'Informe uma UF de destino válida.' };
      result[field] = state || null;
    } else {
      const limit = OPTIONAL_LENGTHS[field];
      if (limit && value.length > limit) return { error: `O campo ${field} excede o limite de ${limit} caracteres.` };
      result[field] = value || null;
    }
  }
  return { value: result };
}

function registerDeliveryRoutes(app, { db, csrfGuard, authenticate, requireAccess }) {
  const admin = requireAccess('administrador');
  const DELIVERY_FIELDS = ['descricao', ...DESTINATION_FIELDS, 'observacoes'];

  app.get('/api/deliveries/summary', authenticate, admin, async (req, res, next) => {
    try {
      const [rows] = await db.execute('SELECT status, COUNT(*) AS total FROM entregas GROUP BY status');
      const totals = Object.fromEntries(DELIVERY_STATUSES.map((status) => [status, 0]));
      for (const row of rows) if (Object.hasOwn(totals, row.status)) totals[row.status] = Number(row.total);
      res.set('Cache-Control', 'no-store').json({ total: Object.values(totals).reduce((sum, amount) => sum + amount, 0), statuses: totals, labels: STATUS_LABELS });
    } catch (error) { next(error); }
  });

  app.get('/api/deliveries', authenticate, admin, async (req, res, next) => {
    const filters = [];
    const values = [];
    const { status, cliente_id, entregador_id, de, ate, q } = req.query;
    if (status !== undefined) {
      if (!DELIVERY_STATUSES.includes(status)) return res.status(400).json({ erro: 'Status de entrega inválido.' });
      filters.push('e.status = ?'); values.push(status);
    }
    for (const [field, value] of [['e.cliente_id', cliente_id], ['e.entregador_id', entregador_id]]) {
      if (value !== undefined) {
        if (!validId(value)) return res.status(400).json({ erro: 'Filtro de vínculo inválido.' });
        filters.push(`${field} = ?`); values.push(value);
      }
    }
    if (de !== undefined) { if (!validDate(de)) return res.status(400).json({ erro: 'Data inicial inválida.' }); filters.push('e.criado_em >= ?'); values.push(`${de} 00:00:00`); }
    if (ate !== undefined) { if (!validDate(ate)) return res.status(400).json({ erro: 'Data final inválida.' }); filters.push('e.criado_em < DATE_ADD(?, INTERVAL 1 DAY)'); values.push(`${ate} 00:00:00`); }
    if (de && ate && de > ate) return res.status(400).json({ erro: 'O período informado é inválido.' });
    if (typeof q === 'string' && q.trim()) { filters.push('(e.descricao LIKE ? OR c.nome LIKE ? OR en.nome LIKE ?)'); const pattern = `%${q.trim()}%`; values.push(pattern, pattern, pattern); }
    try {
      const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
      const [rows] = await db.execute(`${DELIVERY_SELECT}${where} ORDER BY e.criado_em DESC, e.id DESC`, values);
      res.set('Cache-Control', 'no-store').json(rows);
    } catch (error) { next(error); }
  });

  app.get('/api/deliveries/:id', authenticate, admin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [rows] = await db.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Entrega não encontrada.' });
      const [history] = await db.execute(`SELECT h.id, h.status_anterior, h.status_novo, h.motivo, h.usuario_id, h.criado_em, u.nome AS usuario_nome
        FROM historico_status_entregas h LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.entrega_id = ? ORDER BY h.criado_em DESC, h.id DESC`, [req.params.id]);
      res.set('Cache-Control', 'no-store').json({ entrega: rows[0], historico: history });
    } catch (error) { next(error); }
  });

  app.post('/api/deliveries', csrfGuard, authenticate, admin, async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const allowed = new Set(['cliente_id', 'entregador_id', 'descricao', 'status', ...DESTINATION_FIELDS, 'observacoes']);
    if (Object.keys(body).some((key) => !allowed.has(key))) return res.status(400).json({ erro: 'Envie somente os campos permitidos da entrega.' });
    if (!validId(body.cliente_id)) return res.status(400).json({ erro: 'Selecione um cliente válido.' });
    if (!validId(body.entregador_id)) return res.status(400).json({ erro: 'Selecione um entregador válido.' });
    if (body.status !== undefined && !DELIVERY_STATUSES.includes(body.status)) return res.status(400).json({ erro: 'Status de entrega inválido.' });
    const descricao = typeof body.descricao === 'string' ? body.descricao.trim() : '';
    if (!descricao || descricao.length > 500) return res.status(400).json({ erro: 'Informe uma descrição com até 500 caracteres.' });
    const parsed = parseOptionalFields(body, [...DESTINATION_FIELDS, 'observacoes']);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    let connection;
    try {
      connection = await db.getConnection(); await connection.beginTransaction();
      const [clientRows] = await connection.execute('SELECT id, cep, endereco, numero, quadra, lote, setor, cidade, estado FROM clientes WHERE id = ? LIMIT 1 FOR UPDATE', [body.cliente_id]);
      if (!clientRows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Cliente selecionado não encontrado.' }); }
      const [delivererRows] = await connection.execute('SELECT id FROM entregadores WHERE id = ? LIMIT 1 FOR UPDATE', [body.entregador_id]);
      if (!delivererRows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Entregador selecionado não encontrado.' }); }
      const client = clientRows[0];
      const snapshot = {
        cep_destino: Object.hasOwn(parsed.value, 'cep_destino') ? parsed.value.cep_destino : client.cep,
        endereco_destino: Object.hasOwn(parsed.value, 'endereco_destino') ? parsed.value.endereco_destino : client.endereco,
        quadra_destino: Object.hasOwn(parsed.value, 'quadra_destino') ? parsed.value.quadra_destino : client.quadra,
        lote_destino: Object.hasOwn(parsed.value, 'lote_destino') ? parsed.value.lote_destino : client.lote,
        numero_destino: Object.hasOwn(parsed.value, 'numero_destino') ? parsed.value.numero_destino : client.numero ?? null,
        setor_destino: Object.hasOwn(parsed.value, 'setor_destino') ? parsed.value.setor_destino : client.setor ?? null,
        cidade_destino: Object.hasOwn(parsed.value, 'cidade_destino') ? parsed.value.cidade_destino : client.cidade ?? null,
        estado_destino: Object.hasOwn(parsed.value, 'estado_destino') ? parsed.value.estado_destino : client.estado ?? null,
        observacoes: parsed.value.observacoes ?? null,
      };
      const fields = ['cliente_id', 'entregador_id', 'descricao', 'status', ...DESTINATION_FIELDS, 'observacoes'];
      const params = [body.cliente_id, body.entregador_id, descricao, 'na_farmacia', ...DESTINATION_FIELDS.map((field) => snapshot[field]), snapshot.observacoes];
      const [result] = await connection.execute(`INSERT INTO entregas (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, params);
      await connection.execute('INSERT INTO historico_status_entregas (entrega_id, status_anterior, status_novo, usuario_id) VALUES (?, NULL, ?, ?)', [result.insertId, 'na_farmacia', req.user?.id || null]);
      const [createdRows] = await connection.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [result.insertId]);
      await connection.commit();
      res.status(201).json({ entrega: createdRows[0], mensagem: 'Entrega cadastrada com status Na farmácia.' });
    } catch (error) {
      if (connection) await connection.rollback();
      if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(409).json({ erro: 'O cliente ou entregador selecionado não está mais disponível.' });
      next(error);
    } finally { if (connection) connection.release(); }
  });

  app.patch('/api/deliveries/:id', csrfGuard, authenticate, admin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const allowed = ['entregador_id', 'descricao', ...DESTINATION_FIELDS, 'observacoes'];
    if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.includes(key))) return res.status(400).json({ erro: 'Envie somente os campos permitidos para edição da entrega.' });
    const parsed = parseOptionalFields(body, [...DESTINATION_FIELDS, 'observacoes']);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    if (Object.hasOwn(body, 'descricao')) {
      if (typeof body.descricao !== 'string' || !body.descricao.trim() || body.descricao.trim().length > 500) return res.status(400).json({ erro: 'Informe uma descrição com até 500 caracteres.' });
      parsed.value.descricao = body.descricao.trim();
    }
    if (Object.hasOwn(body, 'entregador_id') && !validId(body.entregador_id)) return res.status(400).json({ erro: 'Selecione um entregador válido.' });
    try {
      const [currentRows] = await db.execute('SELECT id, status FROM entregas WHERE id = ? LIMIT 1', [req.params.id]);
      if (!currentRows[0]) return res.status(404).json({ erro: 'Entrega não encontrada.' });
      if (['concluida', 'cancelada'].includes(currentRows[0].status)) return res.status(409).json({ erro: 'Entregas concluídas ou canceladas não podem ser editadas.' });
      if (Object.hasOwn(body, 'entregador_id')) {
        const [deliverers] = await db.execute('SELECT id FROM entregadores WHERE id = ? LIMIT 1', [body.entregador_id]);
        if (!deliverers[0]) return res.status(404).json({ erro: 'Entregador selecionado não encontrado.' });
        parsed.value.entregador_id = body.entregador_id;
      }
      const fields = Object.keys(parsed.value);
      await db.execute(`UPDATE entregas SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map((field) => parsed.value[field]), req.params.id]);
      const [rows] = await db.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [req.params.id]);
      res.json({ entrega: rows[0], mensagem: 'Entrega atualizada com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(409).json({ erro: 'O entregador selecionado não está mais disponível.' });
      next(error);
    }
  });

  app.patch('/api/deliveries/:id/status', csrfGuard, authenticate, admin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(body).length !== 1 || !['em_transito', 'concluida'].includes(body.status)) return res.status(400).json({ erro: 'Status inválido. Use a ação de cancelamento para cancelar uma entrega.' });
    let connection;
    try {
      connection = await db.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT status FROM entregas WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Entrega não encontrada.' }); }
      const current = rows[0].status; const next = body.status;
      const allowed = (current === 'na_farmacia' && next === 'em_transito') || (current === 'em_transito' && next === 'concluida');
      if (!allowed) { await connection.rollback(); return res.status(409).json({ erro: 'Esta mudança de status não é permitida.' }); }
      await connection.execute('UPDATE entregas SET status = ? WHERE id = ?', [next, req.params.id]);
      await connection.execute('INSERT INTO historico_status_entregas (entrega_id, status_anterior, status_novo, usuario_id) VALUES (?, ?, ?, ?)', [req.params.id, current, next, req.user?.id || null]);
      const [updated] = await connection.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [req.params.id]);
      await connection.commit();
      res.json({ entrega: updated[0], mensagem: `Status alterado para ${STATUS_LABELS[next]}.` });
    } catch (error) { if (connection) await connection.rollback(); next(error); }
    finally { if (connection) connection.release(); }
  });

  app.post('/api/deliveries/:id/cancel', csrfGuard, authenticate, admin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
    if (Object.keys(body).some((key) => key !== 'motivo') || motivo.length < 3 || motivo.length > 2000) return res.status(400).json({ erro: 'Informe o motivo do cancelamento (de 3 a 2000 caracteres).' });
    let connection;
    try {
      connection = await db.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT status FROM entregas WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Entrega não encontrada.' }); }
      const current = rows[0].status;
      if (['concluida', 'cancelada'].includes(current)) { await connection.rollback(); return res.status(409).json({ erro: 'Entrega concluída ou cancelada não pode ser cancelada novamente.' }); }
      await connection.execute('UPDATE entregas SET status = ?, motivo_cancelamento = ?, cancelada_em = CURRENT_TIMESTAMP, cancelada_por = ? WHERE id = ?', ['cancelada', motivo, req.user?.id || null, req.params.id]);
      await connection.execute('INSERT INTO historico_status_entregas (entrega_id, status_anterior, status_novo, motivo, usuario_id) VALUES (?, ?, ?, ?, ?)', [req.params.id, current, 'cancelada', motivo, req.user?.id || null]);
      const [updated] = await connection.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [req.params.id]);
      await connection.commit();
      res.json({ entrega: updated[0], mensagem: 'Entrega cancelada e motivo registrado.' });
    } catch (error) { if (connection) await connection.rollback(); next(error); }
    finally { if (connection) connection.release(); }
  });
}

module.exports = { registerDeliveryRoutes, DELIVERY_STATUSES, STATUS_LABELS };
