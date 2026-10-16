'use strict';

const NOTICE_TYPE = 'nova_entrega';

function registerNotificationRoutes(app, { db, csrfGuard, authenticate }) {
  app.get('/api/notifications', authenticate, async (req, res, next) => {
    try {
      const [notifications] = await db.execute(`SELECT id, tipo, mensagem, criado_em, lida_em
        FROM notificacoes WHERE usuario_id = ? ORDER BY criado_em DESC, id DESC LIMIT 50`, [req.user.id]);
      const [counts] = await db.execute('SELECT COUNT(*) AS total FROM notificacoes WHERE usuario_id = ? AND lida_em IS NULL', [req.user.id]);
      res.set('Cache-Control', 'no-store').json({ notifications: notifications.map((item) => ({
        id: item.id, tipo: item.tipo, mensagem: item.mensagem, criado_em: item.criado_em,
        lida: item.lida_em != null,
      })), unreadCount: Number(counts[0]?.total || 0) });
    } catch (error) { next(error); }
  });

  app.get('/api/notifications/unread-count', authenticate, async (req, res, next) => {
    try {
      const [counts] = await db.execute('SELECT COUNT(*) AS total FROM notificacoes WHERE usuario_id = ? AND lida_em IS NULL', [req.user.id]);
      res.set('Cache-Control', 'no-store').json({ count: Number(counts[0]?.total || 0) });
    } catch (error) { next(error); }
  });

  app.patch('/api/notifications/read-all', csrfGuard, authenticate, async (req, res, next) => {
    try {
      await db.execute('UPDATE notificacoes SET lida_em = CURRENT_TIMESTAMP WHERE usuario_id = ? AND lida_em IS NULL', [req.user.id]);
      res.set('Cache-Control', 'no-store').json({ unreadCount: 0 });
    } catch (error) { next(error); }
  });

  app.patch('/api/notifications/:id/read', csrfGuard, authenticate, async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) {
      return res.status(400).json({ erro: 'Identificador inválido.' });
    }
    try {
      const [result] = await db.execute('UPDATE notificacoes SET lida_em = CURRENT_TIMESTAMP WHERE id = ? AND usuario_id = ? AND lida_em IS NULL', [req.params.id, req.user.id]);
      if (!result.affectedRows) {
        const [rows] = await db.execute('SELECT id FROM notificacoes WHERE id = ? AND usuario_id = ? LIMIT 1', [req.params.id, req.user.id]);
        if (!rows[0]) return res.status(404).json({ erro: 'Notificação não encontrada.' });
      }
      const [counts] = await db.execute('SELECT COUNT(*) AS total FROM notificacoes WHERE usuario_id = ? AND lida_em IS NULL', [req.user.id]);
      res.set('Cache-Control', 'no-store').json({ unreadCount: Number(counts[0]?.total || 0) });
    } catch (error) { next(error); }
  });
}

async function createNewDeliveryNotifications(connection, deliveryId) {
  await connection.execute(`INSERT INTO notificacoes (usuario_id, tipo, mensagem, entrega_id)
    SELECT u.id, ?, ?, ? FROM usuarios u
    INNER JOIN entregadores e ON e.usuario_id = u.id
    WHERE u.acesso = 'entregador'
    ON DUPLICATE KEY UPDATE mensagem = VALUES(mensagem)`, [NOTICE_TYPE, 'Há uma nova entrega disponível.', deliveryId]);
}

module.exports = { registerNotificationRoutes, createNewDeliveryNotifications, NOTICE_TYPE };
