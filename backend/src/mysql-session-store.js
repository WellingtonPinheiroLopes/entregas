'use strict';

const session = require('express-session');

// Session store backed by the existing mysql2/promise pool.
class MySQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }

  async get(sid, callback) {
    try {
      const [rows] = await this.pool.execute(
        'SELECT sess FROM sessoes WHERE session_id = ? AND expires_at > CURRENT_TIMESTAMP',
        [sid]
      );
      const value = rows[0]?.sess;
      callback(null, value ? (typeof value === 'string' ? JSON.parse(value) : value) : null);
    } catch (error) {
      callback(error);
    }
  }

  async set(sid, sess, callback = () => {}) {
    try {
      const expiresInSeconds = Math.max(1, Math.ceil(
        sess.cookie?.expires
          ? (new Date(sess.cookie.expires).getTime() - Date.now()) / 1000
          : 8 * 60 * 60
      ));
      await this.pool.execute('DELETE FROM sessoes WHERE expires_at <= CURRENT_TIMESTAMP');
      await this.pool.execute(
        `INSERT INTO sessoes (session_id, sess, expires_at)
         VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE sess = VALUES(sess), expires_at = VALUES(expires_at)`,
        [sid, JSON.stringify(sess), expiresInSeconds]
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async touch(sid, sess, callback = () => {}) {
    try {
      const expiresInSeconds = Math.max(1, Math.ceil(
        sess.cookie?.expires
          ? (new Date(sess.cookie.expires).getTime() - Date.now()) / 1000
          : 8 * 60 * 60
      ));
      await this.pool.execute(
        'UPDATE sessoes SET expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND) WHERE session_id = ?',
        [expiresInSeconds, sid]
      );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sid, callback = () => {}) {
    try {
      await this.pool.execute('DELETE FROM sessoes WHERE session_id = ?', [sid]);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroyUserSessions(userId, callback = () => {}) {
    try {
      await this.pool.execute("DELETE FROM sessoes WHERE CAST(JSON_UNQUOTE(JSON_EXTRACT(sess, '$.userId')) AS UNSIGNED) = ?", [userId]);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

module.exports = MySQLSessionStore;
