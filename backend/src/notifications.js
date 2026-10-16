'use strict';

const NOTICE_TYPE = 'nova_entrega';
const VISIBLE_DELIVERY = `(n.tipo <> ? OR (d.id IS NOT NULL AND d.entregador_id IS NULL AND d.status = 'na_farmacia'))`;
const VISIBLE_PARAMS = [NOTICE_TYPE];

function registerNotificationRoutes(app, { db, csrfGuard, authenticate }) {
  app.get('/api/notifications', authenticate, async (req, res, next) => {
    try {
      const [notifications] = await db.execute(`SELECT n.id, n.tipo, n.mensagem, n.criado_em, n.lida_em
        FROM notificacoes n LEFT JOIN entregas d ON d.id = n.entrega_id
        WHERE n.usuario_id = ? AND ${VISIBLE_DELIVERY} ORDER BY n.criado_em DESC, n.id DESC LIMIT 50`, [req.user.id, ...VISIBLE_PARAMS]);
      const [counts] = await db.execute(`SELECT COUNT(*) AS total FROM notificacoes n
        LEFT JOIN entregas d ON d.id = n.entrega_id
        WHERE n.usuario_id = ? AND n.lida_em IS NULL AND ${VISIBLE_DELIVERY}`, [req.user.id, ...VISIBLE_PARAMS]);
      res.set('Cache-Control', 'no-store').json({ notifications: notifications.map((item) => ({
        id: item.id, tipo: item.tipo, mensagem: item.mensagem, criado_em: item.criado_em,
        lida: item.lida_em != null,
      })), unreadCount: Number(counts[0]?.total || 0) });
    } catch (error) { next(error); }
  });

  app.get('/api/notifications/unread-count', authenticate, async (req, res, next) => {
    try {
      const [counts] = await db.execute(`SELECT COUNT(*) AS total FROM notificacoes n
        LEFT JOIN entregas d ON d.id = n.entrega_id
        WHERE n.usuario_id = ? AND n.lida_em IS NULL AND ${VISIBLE_DELIVERY}`, [req.user.id, ...VISIBLE_PARAMS]);
      res.set('Cache-Control', 'no-store').json({ count: Number(counts[0]?.total || 0) });
    } catch (error) { next(error); }
  });

  app.patch('/api/notifications/read-all', csrfGuard, authenticate, async (req, res, next) => {
    try {
      await db.execute(`UPDATE notificacoes n LEFT JOIN entregas d ON d.id = n.entrega_id
        SET n.lida_em = CURRENT_TIMESTAMP WHERE n.usuario_id = ? AND n.lida_em IS NULL AND ${VISIBLE_DELIVERY}`, [req.user.id, ...VISIBLE_PARAMS]);
      const [counts] = await db.execute(`SELECT COUNT(*) AS total FROM notificacoes n
        LEFT JOIN entregas d ON d.id = n.entrega_id
        WHERE n.usuario_id = ? AND n.lida_em IS NULL AND ${VISIBLE_DELIVERY}`, [req.user.id, ...VISIBLE_PARAMS]);
      res.set('Cache-Control', 'no-store').json({ unreadCount: Number(counts[0]?.total || 0) });
    } catch (error) { next(error); }
  });

  app.patch('/api/notifications/:id/read', csrfGuard, authenticate, async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) {
      return res.status(400).json({ erro: 'Identificador inválido.' });
    }
    try {
      const [result] = await db.execute(`UPDATE notificacoes n LEFT JOIN entregas d ON d.id = n.entrega_id
        SET n.lida_em = CURRENT_TIMESTAMP WHERE n.id = ? AND n.usuario_id = ? AND n.lida_em IS NULL AND ${VISIBLE_DELIVERY}`, [req.params.id, req.user.id, ...VISIBLE_PARAMS]);
      if (!result.affectedRows) {
        const [rows] = await db.execute(`SELECT n.id FROM notificacoes n LEFT JOIN entregas d ON d.id = n.entrega_id
          WHERE n.id = ? AND n.usuario_id = ? AND ${VISIBLE_DELIVERY} LIMIT 1`, [req.params.id, req.user.id, ...VISIBLE_PARAMS]);
        if (!rows[0]) return res.status(404).json({ erro: 'Notificação não encontrada.' });
      }
      const [counts] = await db.execute(`SELECT COUNT(*) AS total FROM notificacoes n
        LEFT JOIN entregas d ON d.id = n.entrega_id
        WHERE n.usuario_id = ? AND n.lida_em IS NULL AND ${VISIBLE_DELIVERY}`, [req.user.id, ...VISIBLE_PARAMS]);
      res.set('Cache-Control', 'no-store').json({ unreadCount: Number(counts[0]?.total || 0) });
    } catch (error) { next(error); }
  });
}

async function createNewDeliveryNotifications(connection, deliveryId) {
  await connection.execute(`INSERT INTO notificacoes (usuario_id, tipo, mensagem, entrega_id)
    SELECT u.id, ?, ?, ? FROM usuarios u
    INNER JOIN entregadores e ON e.usuario_id = u.id
    WHERE u.acesso = 'entregador'
      AND EXISTS (SELECT 1 FROM entregas d WHERE d.id = ? AND d.entregador_id IS NULL AND d.status = 'na_farmacia')
    ON DUPLICATE KEY UPDATE mensagem = VALUES(mensagem)`, [NOTICE_TYPE, 'Há uma nova entrega disponível.', deliveryId, deliveryId]);
}

module.exports = { registerNotificationRoutes, createNewDeliveryNotifications, NOTICE_TYPE };
