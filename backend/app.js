'use strict';

const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const MySQLSessionStore = require('./src/mysql-session-store');

const SESSION_MS = Number(process.env.SESSION_MAX_AGE_MS) || 8 * 60 * 60 * 1000;
const PUBLIC_USER = 'id, nome, email, acesso, criado_em, atualizado_em';

function createApp({ db, sessionStore = new MySQLSessionStore(db), testing = false } = {}) {
  if (!db) throw new Error('A conexão com o banco de dados é obrigatória.');
  const app = express();
  const secureCookie = process.env.NODE_ENV === 'production';
  const allowedOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const sessionSecret = process.env.SESSION_SECRET || (testing ? 'test-session-secret-at-least-32-characters' : '');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET deve conter pelo menos 32 caracteres.');

  app.disable('x-powered-by');
  if (secureCookie || process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(express.json({ limit: '10kb' }));
  app.use(session({
    name: 'entregas.sid',
    secret: sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
      maxAge: SESSION_MS
    }
  }));

  const csrfGuard = (req, res, next) => {
    const origin = req.get('origin');
    if (origin !== allowedOrigin) {
      return res.status(403).json({ erro: 'Origem da requisição não autorizada.' });
    }
    const token = req.get('x-csrf-token');
    const suppliedToken = Buffer.from(token || '');
    const expectedToken = Buffer.from(req.session.csrfToken || '');
    if (!suppliedToken.length || suppliedToken.length !== expectedToken.length ||
        !crypto.timingSafeEqual(suppliedToken, expectedToken)) {
      return res.status(403).json({ erro: 'Token de segurança inválido. Atualize a página e tente novamente.' });
    }
    next();
  };

  app.get('/api/auth/csrf', (req, res) => {
    req.session.csrfToken ||= crypto.randomBytes(32).toString('hex');
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: req.session.csrfToken });
  });

  const loginLimiter = rateLimit({
    windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS) || 15 * 60 * 1000,
    limit: Number(process.env.LOGIN_RATE_LIMIT) || 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' }
  });

  app.post('/api/auth/login', csrfGuard, loginLimiter, async (req, res, next) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !senha || Buffer.byteLength(senha, 'utf8') > 72) {
      return res.status(400).json({ erro: 'Informe um e-mail válido e uma senha.' });
    }

    try {
      const [rows] = await db.execute(
        `SELECT ${PUBLIC_USER}, senha_hash FROM usuarios WHERE email = ? LIMIT 1`,
        [email]
      );
      const user = rows[0];
      const valid = user && await bcrypt.compare(senha, user.senha_hash);
      if (!valid) return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });

      req.session.regenerate((error) => {
        if (error) return next(error);
        req.session.userId = user.id;
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
        req.session.save((saveError) => {
          if (saveError) return next(saveError);
          const { senha_hash, ...publicUser } = user;
          res.set('Cache-Control', 'no-store').status(200).json({ usuario: publicUser, csrfToken: req.session.csrfToken });
        });
      });
    } catch (error) {
      next(error);
    }
  });

  function authenticate(req, res, next) {
    if (!req.session.userId) return res.status(401).json({ erro: 'Autenticação necessária.' });
    db.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1`, [req.session.userId])
      .then(([rows]) => {
        if (!rows[0]) return req.session.destroy(() => res.status(401).json({ erro: 'Sessão inválida.' }));
        req.user = rows[0];
        next();
      })
      .catch(next);
  }

  const requireAccess = (...levels) => (req, res, next) => {
    if (!req.user || !levels.includes(req.user.acesso)) {
      return res.status(403).json({ erro: 'Você não tem permissão para esta ação.' });
    }
    next();
  };
  app.locals.authenticate = authenticate;
  app.locals.requireAccess = requireAccess;

  app.get('/api/auth/me', authenticate, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ usuario: req.user, csrfToken: req.session.csrfToken });
  });

  app.get('/api/account', authenticate, (req, res) => {
    res.set('Cache-Control', 'no-store').json({ usuario: req.user });
  });

  app.patch('/api/account', csrfGuard, authenticate, async (req, res, next) => {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => key !== 'nome')) return res.status(400).json({ erro: 'Altere somente o nome da conta.' });
    const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
    if (!nome || nome.length > 150) return res.status(400).json({ erro: 'Informe um nome com até 150 caracteres.' });
    try {
      await db.execute('UPDATE usuarios SET nome = ? WHERE id = ?', [nome, req.session.userId]);
      const [rows] = await db.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1`, [req.session.userId]);
      if (!rows[0]) return res.status(401).json({ erro: 'Sessão inválida.' });
      res.set('Cache-Control', 'no-store').json({ usuario: rows[0], mensagem: 'Nome atualizado com sucesso.' });
    } catch (error) { next(error); }
  });

  app.patch('/api/account/password', csrfGuard, authenticate, async (req, res, next) => {
    const { senhaAtual, novaSenha, confirmarSenha } = req.body || {};
    if ([senhaAtual, novaSenha, confirmarSenha].some((value) => typeof value !== 'string' || !value)) return res.status(400).json({ erro: 'Preencha todos os campos de senha.' });
    if (Buffer.byteLength(senhaAtual, 'utf8') > 72 || Buffer.byteLength(novaSenha, 'utf8') > 72) return res.status(400).json({ erro: 'A senha não pode exceder 72 bytes.' });
    if (novaSenha.length < 12) return res.status(400).json({ erro: 'A nova senha deve ter pelo menos 12 caracteres.' });
    if (novaSenha !== confirmarSenha) return res.status(400).json({ erro: 'A confirmação não corresponde à nova senha.' });
    try {
      const [rows] = await db.execute('SELECT senha_hash FROM usuarios WHERE id = ? LIMIT 1', [req.session.userId]);
      if (!rows[0]) return res.status(401).json({ erro: 'Sessão inválida.' });
      if (!(await bcrypt.compare(senhaAtual, rows[0].senha_hash))) return res.status(400).json({ erro: 'A senha atual está incorreta.' });
      const senhaHash = await bcrypt.hash(novaSenha, 12);
      await db.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, req.session.userId]);
      if (typeof sessionStore.destroyUserSessions === 'function') {
        await new Promise((resolve, reject) => sessionStore.destroyUserSessions(req.session.userId, (error) => error ? reject(error) : resolve()));
      }
      await new Promise((resolve, reject) => req.session.destroy((error) => error ? reject(error) : resolve()));
      res.clearCookie('entregas.sid', { httpOnly: true, sameSite: 'lax', secure: secureCookie });
      res.set('Cache-Control', 'no-store').json({ mensagem: 'Senha alterada. Entre novamente com sua nova senha.' });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', csrfGuard, authenticate, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('entregas.sid', { httpOnly: true, sameSite: 'lax', secure: secureCookie });
      res.status(204).end();
    });
  });

  app.get('/api/health', (req, res) => res.json({ status: 'ok', message: 'Backend funcionando!' }));
  app.get('/api/health/db', async (req, res) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ok', message: 'Conexão com MySQL funcionando!' });
    } catch (error) {
      console.error('Erro na conexão com MySQL:', error.code || 'erro');
      res.status(503).json({ status: 'error', message: 'Banco de dados indisponível.' });
    }
  });

  app.get('/api/usuarios', authenticate, requireAccess('administrador'), async (req, res, next) => {
    try {
      const [usuarios] = await db.execute(`SELECT ${PUBLIC_USER} FROM usuarios ORDER BY id DESC`);
      res.json(usuarios);
    } catch (error) {
      next(error);
    }
  });

  app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.', caminho: req.path }));
  app.use((error, req, res, next) => {
    console.error('Erro interno:', error.code || 'erro inesperado');
    if (res.headersSent) return next(error);
    res.status(500).json({ erro: 'Ocorreu um erro interno no servidor.' });
  });
  return app;
}

module.exports = { createApp };
