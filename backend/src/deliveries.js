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
  LEFT JOIN entregadores en ON en.id = e.entregador_id`;
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
  const adminOrDeliverer = requireAccess('administrador', 'entregador');
  const DELIVERY_FIELDS = ['descricao', ...DESTINATION_FIELDS, 'observacoes'];

  async function authenticatedDelivererId(req) {
    if (req.user?.acesso !== 'entregador') return null;
    const [rows] = await db.execute('SELECT id FROM entregadores WHERE usuario_id = ? LIMIT 1', [req.user.id]);
    return rows[0]?.id ?? false;
  }

  function limitedPharmacyDelivery(row, ownId) {
    return {
      id: row.id, status: row.status, cliente_id: row.cliente_id, cliente_nome: row.cliente_nome,
      descricao: row.descricao, cep_destino: row.cep_destino, endereco_destino: row.endereco_destino,
      quadra_destino: row.quadra_destino, lote_destino: row.lote_destino, numero_destino: row.numero_destino,
      setor_destino: row.setor_destino, cidade_destino: row.cidade_destino, estado_destino: row.estado_destino,
      criado_em: row.criado_em, atribuida_a_mim: String(row.entregador_id) === String(ownId),
    };
  }

  function ownDelivery(row) {
    const { cliente_cpf, entregador_cpf, cancelada_por, ...safe } = row;
    return safe;
  }

  app.get('/api/deliveries/summary', authenticate, adminOrDeliverer, async (req, res, next) => {
    try {
      const totals = Object.fromEntries(DELIVERY_STATUSES.map((status) => [status, 0]));
      if (req.user.acesso === 'administrador') {
        const [rows] = await db.execute('SELECT status, COUNT(*) AS total FROM entregas GROUP BY status');
        for (const row of rows) if (Object.hasOwn(totals, row.status)) totals[row.status] = Number(row.total);
      } else {
        const ownId = await authenticatedDelivererId(req);
        if (ownId === false) return res.status(403).json({ erro: 'A conta não está vinculada a um entregador.' });
        const [rows] = await db.execute(`SELECT status, COUNT(*) AS total FROM entregas
          WHERE status = 'na_farmacia' OR (entregador_id = ? AND status IN ('em_transito', 'concluida', 'cancelada')) GROUP BY status`, [ownId]);
        for (const row of rows) if (Object.hasOwn(totals, row.status)) totals[row.status] = Number(row.total);
      }
      res.set('Cache-Control', 'no-store').json({ total: Object.values(totals).reduce((sum, amount) => sum + amount, 0), statuses: totals, labels: STATUS_LABELS });
    } catch (error) { next(error); }
  });

  app.get('/api/deliveries', authenticate, adminOrDeliverer, async (req, res, next) => {
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
      const isDeliverer = req.user.acesso === 'entregador';
      const ownId = isDeliverer ? await authenticatedDelivererId(req) : null;
      if (ownId === false) return res.status(403).json({ erro: 'A conta não está vinculada a um entregador.' });
      if (isDeliverer && (cliente_id !== undefined || entregador_id !== undefined || de !== undefined || ate !== undefined)) return res.status(403).json({ erro: 'Filtro não permitido.' });
      const where = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
      const driverWhere = isDeliverer ? ` WHERE (e.status = 'na_farmacia' OR e.entregador_id = ?)${status ? ' AND e.status = ?' : ''}${q?.trim() ? ' AND (e.descricao LIKE ? OR c.nome LIKE ?)' : ''}` : where;
      const driverValues = isDeliverer ? [ownId, ...(status ? [status] : []), ...(q?.trim() ? [`%${q.trim()}%`, `%${q.trim()}%`] : [])] : values;
      const [rows] = await db.execute(`${DELIVERY_SELECT}${isDeliverer ? driverWhere : where} ORDER BY e.criado_em DESC, e.id DESC`, isDeliverer ? driverValues : values);
      const visible = isDeliverer ? rows.filter((row) => row.status === 'na_farmacia' || String(row.entregador_id) === String(ownId)).map((row) => row.status === 'na_farmacia' ? limitedPharmacyDelivery(row, ownId) : { ...ownDelivery(row), atribuida_a_mim: true }) : rows;
      res.set('Cache-Control', 'no-store').json(visible);
    } catch (error) { next(error); }
  });

  app.get('/api/deliveries/:id', authenticate, adminOrDeliverer, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [rows] = await db.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Entrega não encontrada.' });
      const isDeliverer = req.user.acesso === 'entregador';
      const ownId = isDeliverer ? await authenticatedDelivererId(req) : null;
      if (ownId === false) return res.status(403).json({ erro: 'A conta não está vinculada a um entregador.' });
      const row = rows[0];
      const mine = isDeliverer && String(row.entregador_id) === String(ownId);
      if (isDeliverer && !mine && row.status !== 'na_farmacia') return res.status(404).json({ erro: 'Entrega não encontrada.' });
      const [history] = await db.execute(`SELECT h.id, h.status_anterior, h.status_novo, h.motivo, h.usuario_id, h.criado_em, u.nome AS usuario_nome
        FROM historico_status_entregas h LEFT JOIN usuarios u ON u.id = h.usuario_id
        WHERE h.entrega_id = ? ORDER BY h.criado_em DESC, h.id DESC`, [req.params.id]);
      if (isDeliverer && !mine) return res.set('Cache-Control', 'no-store').json({ entrega: limitedPharmacyDelivery(row, ownId), historico: [] });
      res.set('Cache-Control', 'no-store').json({ entrega: isDeliverer ? { ...ownDelivery(row), atribuida_a_mim: true } : row, historico: isDeliverer ? history.map(({ usuario_id, usuario_nome, ...event }) => event) : history });
    } catch (error) { next(error); }
  });

  app.post('/api/deliveries', csrfGuard, authenticate, admin, async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const allowed = new Set(['cliente_id', 'entregador_id', 'descricao', 'status', ...DESTINATION_FIELDS, 'observacoes']);
    if (Object.keys(body).some((key) => !allowed.has(key))) return res.status(400).json({ erro: 'Envie somente os campos permitidos da entrega.' });
    if (!validId(body.cliente_id)) return res.status(400).json({ erro: 'Selecione um cliente válido.' });
    const entregadorId = body.entregador_id == null || (typeof body.entregador_id === 'string' && !body.entregador_id.trim())
      ? null : body.entregador_id;
    if (entregadorId !== null && !validId(entregadorId)) return res.status(400).json({ erro: 'Selecione um entregador válido.' });
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
      if (entregadorId !== null) {
        const [delivererRows] = await connection.execute('SELECT id FROM entregadores WHERE id = ? LIMIT 1 FOR UPDATE', [entregadorId]);
        if (!delivererRows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Entregador selecionado não encontrado.' }); }
      }
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
      const params = [body.cliente_id, entregadorId, descricao, 'na_farmacia', ...DESTINATION_FIELDS.map((field) => snapshot[field]), snapshot.observacoes];
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
    const hasDeliverer = Object.hasOwn(body, 'entregador_id');
    const entregadorId = !hasDeliverer || body.entregador_id == null || (typeof body.entregador_id === 'string' && !body.entregador_id.trim())
      ? null : body.entregador_id;
    if (hasDeliverer && entregadorId !== null && !validId(entregadorId)) return res.status(400).json({ erro: 'Selecione um entregador válido.' });
    try {
      const [currentRows] = await db.execute('SELECT id, status FROM entregas WHERE id = ? LIMIT 1', [req.params.id]);
      if (!currentRows[0]) return res.status(404).json({ erro: 'Entrega não encontrada.' });
      if (['concluida', 'cancelada'].includes(currentRows[0].status)) return res.status(409).json({ erro: 'Entregas concluídas ou canceladas não podem ser editadas.' });
      if (hasDeliverer && entregadorId !== null) {
        const [deliverers] = await db.execute('SELECT id FROM entregadores WHERE id = ? LIMIT 1', [entregadorId]);
        if (!deliverers[0]) return res.status(404).json({ erro: 'Entregador selecionado não encontrado.' });
      }
      if (hasDeliverer) parsed.value.entregador_id = entregadorId;
      const fields = Object.keys(parsed.value);
      await db.execute(`UPDATE entregas SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map((field) => parsed.value[field]), req.params.id]);
      const [rows] = await db.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [req.params.id]);
      res.json({ entrega: rows[0], mensagem: 'Entrega atualizada com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_NO_REFERENCED_ROW_2') return res.status(409).json({ erro: 'O entregador selecionado não está mais disponível.' });
      next(error);
    }
  });

  app.patch('/api/deliveries/:id/status', csrfGuard, authenticate, adminOrDeliverer, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(body).length !== 1 || !['na_farmacia', 'em_transito', 'concluida'].includes(body.status)) return res.status(400).json({ erro: 'Status inválido. Use a ação de cancelamento para cancelar uma entrega.' });
    const isDeliverer = req.user.acesso === 'entregador';
    let ownId = null;
    if (isDeliverer) {
      try { ownId = await authenticatedDelivererId(req); }
      catch (error) { return next(error); }
      if (ownId === false) return res.status(403).json({ erro: 'A conta não está vinculada a um entregador.' });
      if (body.status !== 'em_transito') return res.status(403).json({ erro: 'Ação não permitida para entregadores.' });
    }
    let connection;
    try {
      connection = await db.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT status, entregador_id FROM entregas WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Entrega não encontrada.' }); }
      const current = rows[0].status; const next = body.status;
      if (isDeliverer && (String(rows[0].entregador_id) !== String(ownId) || current !== 'na_farmacia')) { await connection.rollback(); return res.status(403).json({ erro: 'Esta entrega não está atribuída a você ou não pode ser colocada em trânsito.' }); }
      const allowed = (current === 'na_farmacia' && next === 'em_transito') || (current === 'em_transito' && ['na_farmacia', 'concluida'].includes(next));
      if (!allowed) { await connection.rollback(); return res.status(409).json({ erro: 'Esta mudança de status não é permitida.' }); }
      await connection.execute('UPDATE entregas SET status = ? WHERE id = ?', [next, req.params.id]);
      await connection.execute('INSERT INTO historico_status_entregas (entrega_id, status_anterior, status_novo, usuario_id) VALUES (?, ?, ?, ?)', [req.params.id, current, next, req.user?.id || null]);
      const [updated] = await connection.execute(`${DELIVERY_SELECT} WHERE e.id = ? LIMIT 1`, [req.params.id]);
      await connection.commit();
      res.json({ entrega: updated[0], mensagem: `Status alterado para ${STATUS_LABELS[next]}.` });
    } catch (error) { if (connection) await connection.rollback(); next(error); }
    finally { if (connection) connection.release(); }
  });

  app.post('/api/deliveries/:id/cancel', csrfGuard, authenticate, adminOrDeliverer, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : '';
    if (Object.keys(body).some((key) => key !== 'motivo') || motivo.length < 3 || motivo.length > 2000) return res.status(400).json({ erro: 'Informe o motivo do cancelamento (de 3 a 2000 caracteres).' });
    const isDeliverer = req.user.acesso === 'entregador';
    let ownId = null;
    if (isDeliverer) {
      try { ownId = await authenticatedDelivererId(req); }
      catch (error) { return next(error); }
      if (ownId === false) return res.status(403).json({ erro: 'A conta não está vinculada a um entregador.' });
    }
    let connection;
    try {
      connection = await db.getConnection(); await connection.beginTransaction();
      const [rows] = await connection.execute('SELECT status, entregador_id FROM entregas WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
      if (!rows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Entrega não encontrada.' }); }
      const current = rows[0].status;
      if (isDeliverer && (String(rows[0].entregador_id) !== String(ownId) || !['na_farmacia', 'em_transito'].includes(current))) { await connection.rollback(); return res.status(403).json({ erro: 'Esta entrega não está atribuída a você ou não pode ser cancelada.' }); }
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
