'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

function registerAuthRoutes(app, { db, csrfGuard, loginLimiter, sessionCredential, PUBLIC_USER, authenticate }) {
  app.get('/api/auth/csrf', (req, res) => {
    req.session.csrfToken ||= crypto.randomBytes(32).toString('hex');
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: req.session.csrfToken, sessionCredential: sessionCredential(req) });
  });

  app.post('/api/auth/login', csrfGuard, loginLimiter, async (req, res, next) => {
    const identification = typeof req.body?.identificador === 'string'
      ? req.body.identificador.trim()
      : typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identification);

    // Increased limit to 100 for UX, BCrypt will handle via truncation at 72 bytes.
    if (!identification || identification.length > (isEmail ? 254 : 150) || !senha || Buffer.byteLength(senha, 'utf8') > 100) {
      return res.status(400).json({ erro: 'Informe um e-mail ou nome de usuário e uma senha.' });
    }

    try {
      const normalized = isEmail ? identification.toLowerCase() : identification;
      const [rows] = await db.execute(isEmail
        ? `SELECT ${PUBLIC_USER}, senha_hash FROM usuarios WHERE email = ? LIMIT 1`
        : `SELECT ${PUBLIC_USER}, senha_hash FROM usuarios WHERE nome = ? LIMIT 2`,
      [normalized]);

      const user = rows.length === 1 ? rows[0] : null;
      const valid = user && await bcrypt.compare(senha, user.senha_hash);
      if (!valid) return res.status(401).json({ erro: 'Identificação ou senha inválidos.' });

      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.userId = user.id;
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        req.session.save((saveError) => {
          if (saveError) return next(saveError);
          const { senha_hash, ...publicUser } = user;
          res.set('Cache-Control', 'no-store').status(200).json({ usuario: publicUser, csrfToken: req.session.csrfToken, sessionCredential: sessionCredential(req) });
        });
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/auth/me', authenticate, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ usuario: req.user, csrfToken: req.session.csrfToken, sessionCredential: sessionCredential(req) });
  });

  app.post('/api/auth/logout', csrfGuard, authenticate, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('entregas.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.status(204).end();
    });
  });
}

module.exports = { registerAuthRoutes };
