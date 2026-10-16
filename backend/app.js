'use strict';

const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const MySQLSessionStore = require('./src/mysql-session-store');
const { registerDeliveryRoutes } = require('./src/deliveries');

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
    const identification = typeof req.body?.identificador === 'string'
      ? req.body.identificador.trim()
      : typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identification);
    if (!identification || identification.length > (isEmail ? 254 : 150) || !senha || Buffer.byteLength(senha, 'utf8') > 72) {
      return res.status(400).json({ erro: 'Informe um e-mail ou nome de usuário e uma senha.' });
    }

    try {
      const normalized = isEmail ? identification.toLowerCase() : identification;
      const [rows] = await db.execute(isEmail
        ? `SELECT ${PUBLIC_USER}, senha_hash FROM usuarios WHERE email = ? LIMIT 1`
        : `SELECT ${PUBLIC_USER}, senha_hash FROM usuarios WHERE nome = ? LIMIT 2`,
      [normalized]);
      // A full name is the existing account name. Reject ambiguous matches rather
      // than authenticating the wrong account when legacy data contains duplicates.
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
      const [duplicates] = await db.execute('SELECT id FROM usuarios WHERE nome = ? AND id <> ? LIMIT 1', [nome, req.session.userId]);
      if (duplicates.length) return res.status(409).json({ erro: 'Já existe uma conta com este nome. Escolha um nome diferente para permitir o login.' });
      await db.execute('UPDATE usuarios SET nome = ? WHERE id = ?', [nome, req.session.userId]);
      const [rows] = await db.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1`, [req.session.userId]);
      if (!rows[0]) return res.status(401).json({ erro: 'Sessão inválida.' });
      res.set('Cache-Control', 'no-store').json({ usuario: rows[0], mensagem: 'Nome atualizado com sucesso.' });
    } catch (error) { next(error); }
  });

  app.patch('/api/account/password', csrfGuard, authenticate, async (req, res, next) => {
    const { senhaAtual, novaSenha, confirmarSenha } = req.body || {};
    if ([senhaAtual, novaSenha, confirmarSenha].some((value) => typeof value !== 'string')) return res.status(400).json({ erro: 'Preencha todos os campos de senha.' });
    if ([...novaSenha].length < 1 || [...novaSenha].length > 10) return res.status(400).json({ erro: 'A nova senha deve ter de 1 a 10 caracteres.' });
    if (!senhaAtual || !confirmarSenha) return res.status(400).json({ erro: 'Preencha todos os campos de senha.' });
    if (Buffer.byteLength(senhaAtual, 'utf8') > 72) return res.status(400).json({ erro: 'A senha atual não pode exceder 72 bytes.' });
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

  app.get('/api/usuarios/:id', authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [rows] = await db.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
      res.set('Cache-Control', 'no-store').json({ usuario: rows[0] });
    } catch (error) { next(error); }
  });

  app.patch('/api/usuarios/:id', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => !['nome', 'email', 'acesso'].includes(key))) return res.status(400).json({ erro: 'Envie somente nome, e-mail e tipo de acesso.' });
    const nome = typeof body.nome === 'string' ? body.nome.trim() : '';
    const emailProvided = Object.hasOwn(body, 'email');
    const rawEmail = body.email;
    const email = typeof rawEmail === 'string' ? (rawEmail.trim().toLowerCase() || null) : rawEmail == null ? null : undefined;
    const acesso = body.acesso;
    if (!nome || nome.length > 150) return res.status(400).json({ erro: 'Informe um nome com até 150 caracteres.' });
    if (emailProvided && email === undefined) return res.status(400).json({ erro: 'O e-mail deve ser texto ou nulo.' });
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({ erro: 'Informe um e-mail válido ou deixe o campo em branco.' });
    if (!['administrador', 'convidado', 'entregador'].includes(acesso)) return res.status(400).json({ erro: 'Tipo de acesso inválido.' });
    try {
      const connection = typeof db.getConnection === 'function' ? await db.getConnection() : null;
      if (connection) await connection.beginTransaction();
      const executor = connection || db;
      try {
        const [targetRows] = await executor.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1 FOR UPDATE`, [req.params.id]);
        const target = targetRows[0];
        if (!target) { if (connection) await connection.rollback(); return res.status(404).json({ erro: 'Usuário não encontrado.' }); }
        const currentEmail = typeof target.email === 'string' ? (target.email.trim().toLowerCase() || null) : null;
        const updatedEmail = emailProvided ? email : currentEmail;
        const [nameDuplicates] = await executor.execute('SELECT id FROM usuarios WHERE nome = ? AND id <> ? LIMIT 1', [nome, req.params.id]);
        if (nameDuplicates.length) { if (connection) await connection.rollback(); return res.status(409).json({ erro: 'Já existe uma conta com este nome. Escolha um nome diferente para permitir o login.' }); }
        if (updatedEmail) {
          const [emailDuplicates] = await executor.execute('SELECT id FROM usuarios WHERE email = ? AND id <> ? LIMIT 1', [updatedEmail, req.params.id]);
          if (emailDuplicates.length) { if (connection) await connection.rollback(); return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' }); }
        }
        if (target.acesso === 'administrador' && acesso !== 'administrador') {
          const [admins] = await executor.execute("SELECT id FROM usuarios WHERE acesso = 'administrador' FOR UPDATE");
          if (admins.length <= 1) { if (connection) await connection.rollback(); return res.status(409).json({ erro: 'Não é possível rebaixar o último administrador ativo.' }); }
        }
        await executor.execute('UPDATE usuarios SET nome = ?, email = ?, acesso = ? WHERE id = ?', [nome, updatedEmail, acesso, req.params.id]);
        if (connection) await connection.commit();
        const [rows] = await db.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1`, [req.params.id]);
        res.set('Cache-Control', 'no-store').json({ usuario: rows[0], mensagem: 'Usuário atualizado com sucesso.' });
      } catch (error) { if (connection) await connection.rollback(); throw error; }
      finally { if (connection) connection.release(); }
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um usuário com este e-mail ou nome de login.' });
      next(error);
    }
  });

  app.patch('/api/usuarios/:id/password', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (Object.keys(body).some((key) => key !== 'novaSenha')) return res.status(400).json({ erro: 'Envie somente a nova senha.' });
    const novaSenha = typeof body.novaSenha === 'string' ? body.novaSenha : '';
    if ([...novaSenha].length < 1 || [...novaSenha].length > 10) return res.status(400).json({ erro: 'A nova senha deve ter de 1 a 10 caracteres.' });
    try {
      const [rows] = await db.execute('SELECT id FROM usuarios WHERE id = ? LIMIT 1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
      const senhaHash = await bcrypt.hash(novaSenha, 12);
      await db.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, req.params.id]);
      res.set('Cache-Control', 'no-store').json({ mensagem: 'Senha atualizada com sucesso. As sessões existentes continuam ativas.' });
    } catch (error) { next(error); }
  });

  const DELIVERER_FIELDS = ['nome', 'cpf', 'cidade', 'estado', 'cep', 'endereco', 'quadra', 'lote', 'numero', 'setor'];
  const DELIVERER_COLUMNS = 'd.id, d.nome, d.cpf, d.cidade, d.estado, d.cep, d.endereco, d.quadra, d.lote, d.numero, d.setor, d.usuario_id, u.email, u.acesso, d.criado_em, d.atualizado_em';
  const delivererSelect = `SELECT ${DELIVERER_COLUMNS} FROM entregadores d LEFT JOIN usuarios u ON u.id = d.usuario_id`;
  const delivererSearchSelect = 'SELECT d.id, d.nome, d.cpf, u.email FROM entregadores d LEFT JOIN usuarios u ON u.id = d.usuario_id';
  const validEmail = (value) => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  const BRAZILIAN_STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
  const validCpf = (cpf) => {
    if (!/^\d{11}$/.test(cpf) || /^([0-9])\1{10}$/.test(cpf)) return false;
    const digit = (length) => {
      const sum = [...cpf.slice(0, length)].reduce((total, value, index) => total + Number(value) * (length + 1 - index), 0);
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10]);
  };
  function parseDeliverer(body, partial = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Envie dados válidos do entregador.' };
    if (Object.keys(body).some((key) => ![...DELIVERER_FIELDS, 'email', 'acesso', 'senhaInicial'].includes(key))) return { error: 'Envie somente os campos do cadastro de entregador.' };
    if (partial && Object.hasOwn(body, 'senhaInicial')) return { error: 'A senha inicial só pode ser definida no cadastro de um novo entregador.' };
    if (partial && Object.keys(body).length === 0) return { error: 'Informe ao menos um campo para atualizar.' };
    const result = {};
    if (!partial) {
      if (typeof body.senhaInicial !== 'string' || [...body.senhaInicial].length < 1 || [...body.senhaInicial].length > 10) return { error: 'A senha inicial deve ter de 1 a 10 caracteres.' };
      if (Buffer.byteLength(body.senhaInicial, 'utf8') > 72) return { error: 'A senha inicial excede o limite permitido.' };
      result.senhaInicial = body.senhaInicial;
    }
    if (!partial || Object.hasOwn(body, 'email')) {
      if (body.email != null && typeof body.email !== 'string') return { error: 'O e-mail deve ser texto ou nulo.' };
      const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const email = rawEmail || null;
      if (email && !validEmail(email)) return { error: 'Informe um e-mail válido ou deixe o campo em branco.' };
      result.email = email;
    }
    // The access level is always assigned by the server; client values are ignored.
    for (const field of DELIVERER_FIELDS) {
      if (partial && !Object.hasOwn(body, field)) continue;
      let value = body[field];
      if (value == null) value = '';
      if (typeof value !== 'string') return { error: `O campo ${field} deve ser texto.` };
      value = value.trim();
      const provided = value.length > 0;
      const limits = { nome: 150, cpf: 20, cidade: 100, estado: 2, cep: 12, endereco: 255, quadra: 50, lote: 50, numero: 30, setor: 120 };
      if (value.length > limits[field]) return { error: `O campo ${field} excede o limite permitido.` };
      if (field === 'cpf') value = value.replace(/\D/g, '');
      if (field === 'cep') value = value.replace(/\D/g, '');
      if (field === 'estado') value = value.toLocaleUpperCase('pt-BR');
      if (provided && !value && (field === 'cpf' || field === 'cep')) return { error: `Informe um ${field.toUpperCase()} válido.` };
      result[field] = value || null;
    }
    if (!partial || Object.hasOwn(result, 'nome')) {
      result.nome = typeof body.nome === 'string' ? body.nome.trim() : '';
      if (!result.nome || result.nome.length > 150) return { error: 'Informe o nome completo com até 150 caracteres.' };
    }
    if (!partial || Object.hasOwn(result, 'endereco')) {
      result.endereco = typeof body.endereco === 'string' ? body.endereco.trim() : '';
      if (!result.endereco || result.endereco.length > 255) return { error: 'Informe o logradouro com até 255 caracteres.' };
    }
    if (!partial || Object.hasOwn(result, 'cidade')) {
      const cidade = typeof body.cidade === 'string' ? body.cidade.trim() : '';
      if (cidade.length > 100) return { error: 'A cidade deve ter até 100 caracteres.' };
      result.cidade = cidade || null;
    }
    if (!partial || Object.hasOwn(result, 'estado')) {
      const estado = typeof body.estado === 'string' ? body.estado.trim().toLocaleUpperCase('pt-BR') : '';
      if (estado && !BRAZILIAN_STATES.has(estado)) return { error: 'Informe uma UF brasileira válida.' };
      result.estado = estado || null;
    }
    if (result.cpf && !validCpf(result.cpf)) return { error: 'Informe um CPF válido.' };
    if (result.cep && !/^\d{8}$/.test(result.cep)) return { error: 'Informe um CEP válido com 8 dígitos.' };
    return { value: result };
  }

  app.get('/api/deliverers', authenticate, requireAccess('administrador'), async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const digits = query.replace(/\D/g, '');
      const [rows] = query
        ? await db.execute(`${delivererSearchSelect} WHERE d.nome LIKE ? OR d.cpf LIKE ? OR u.email LIKE ? ORDER BY d.nome ASC, d.id DESC LIMIT 10`, [`%${query}%`, `%${digits || query}%`, `%${query}%`])
        : await db.execute(`${delivererSelect} ORDER BY d.id DESC`);
      res.set('Cache-Control', 'no-store').json(rows);
    } catch (error) { next(error); }
  });

  app.get('/api/deliverers/:id', authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [rows] = await db.execute(`${delivererSelect} WHERE d.id = ? LIMIT 1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Entregador não encontrado.' });
      res.set('Cache-Control', 'no-store').json({ entregador: rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/deliverers', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    const parsed = parseDeliverer(req.body);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    try {
      const connection = await db.getConnection();
      let delivererId;
      try {
        await connection.beginTransaction();
        if (parsed.value.email) {
          const [existing] = await connection.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1 FOR UPDATE', [parsed.value.email]);
          if (existing.length) { await connection.rollback(); return res.status(409).json({ erro: 'Este e-mail já está vinculado a uma conta do sistema.' }); }
        }
        const [nameDuplicates] = await connection.execute('SELECT id FROM usuarios WHERE nome = ? LIMIT 1 FOR UPDATE', [parsed.value.nome]);
        if (nameDuplicates.length) { await connection.rollback(); return res.status(409).json({ erro: 'Já existe uma conta com este nome. Escolha um nome diferente para permitir o login.' }); }
        const passwordHash = await bcrypt.hash(parsed.value.senhaInicial, 12);
        const [userResult] = await connection.execute("INSERT INTO usuarios (nome, email, senha_hash, acesso) VALUES (?, ?, ?, 'entregador')", [parsed.value.nome, parsed.value.email, passwordHash]);
        const fields = DELIVERER_FIELDS;
        const [result] = await connection.execute(`INSERT INTO entregadores (usuario_id, ${fields.join(', ')}) VALUES (?, ${fields.map(() => '?').join(', ')})`, [userResult.insertId, ...fields.map((field) => parsed.value[field])]);
        delivererId = result.insertId;
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
      const [rows] = await db.execute(`${delivererSelect} WHERE d.id = ? LIMIT 1`, [delivererId]);
      res.status(201).json({ entregador: rows[0], mensagem: 'Entregador cadastrado com acesso habilitado.' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: error.message.includes('email') ? 'Este e-mail já está vinculado a uma conta do sistema.' : 'Já existe um entregador cadastrado com este CPF.' });
      next(error);
    }
  });

  app.patch('/api/deliverers/:id', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    const parsed = parseDeliverer(req.body, true);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    try {
      const connection = await db.getConnection();
      let result;
      try {
        await connection.beginTransaction();
        const [currentRows] = await connection.execute('SELECT id, usuario_id FROM entregadores WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
        if (!currentRows[0]) { await connection.rollback(); return res.status(404).json({ erro: 'Entregador não encontrado.' }); }
        const current = currentRows[0];
        if (parsed.value.nome && current.usuario_id) {
          const [nameDuplicates] = await connection.execute('SELECT id FROM usuarios WHERE nome = ? AND id <> ? LIMIT 1 FOR UPDATE', [parsed.value.nome, current.usuario_id]);
          if (nameDuplicates.length) { await connection.rollback(); return res.status(409).json({ erro: 'Já existe uma conta com este nome. Escolha um nome diferente para permitir o login.' }); }
        }
        if (!current.usuario_id && parsed.value.email) {
          const [nameRows] = await connection.execute('SELECT nome FROM entregadores WHERE id = ? LIMIT 1', [req.params.id]);
          const loginName = parsed.value.nome || nameRows[0]?.nome;
          const [nameDuplicates] = await connection.execute('SELECT id FROM usuarios WHERE nome = ? LIMIT 1 FOR UPDATE', [loginName]);
          if (nameDuplicates.length) { await connection.rollback(); return res.status(409).json({ erro: 'Já existe uma conta com este nome. Escolha um nome diferente para permitir o login.' }); }
        }
        if (current.usuario_id && Object.hasOwn(parsed.value, 'email') && parsed.value.email) {
          const [duplicates] = await connection.execute('SELECT id FROM usuarios WHERE email = ? AND id <> ? LIMIT 1', [parsed.value.email, current.usuario_id]);
          if (duplicates.length) { await connection.rollback(); return res.status(409).json({ erro: 'Este e-mail já está vinculado a outra conta do sistema.' }); }
        }
        if (!current.usuario_id && parsed.value.email) {
          const [duplicates] = await connection.execute('SELECT id FROM usuarios WHERE email = ? LIMIT 1', [parsed.value.email]);
          if (duplicates.length) { await connection.rollback(); return res.status(409).json({ erro: 'Este e-mail já está vinculado a uma conta do sistema.' }); }
          const [nameRows] = await connection.execute('SELECT nome FROM entregadores WHERE id = ? LIMIT 1', [req.params.id]);
          const randomPassword = crypto.randomBytes(32).toString('base64url');
          const passwordHash = await bcrypt.hash(randomPassword, 12);
          const [userResult] = await connection.execute("INSERT INTO usuarios (nome, email, senha_hash, acesso) VALUES (?, ?, ?, 'entregador')", [parsed.value.nome || nameRows[0].nome, parsed.value.email, passwordHash]);
          await connection.execute('UPDATE entregadores SET usuario_id = ? WHERE id = ?', [userResult.insertId, req.params.id]);
        } else if (current.usuario_id && Object.hasOwn(parsed.value, 'email')) {
          if (parsed.value.nome) await connection.execute('UPDATE usuarios SET nome = ?, email = ? WHERE id = ?', [parsed.value.nome, parsed.value.email, current.usuario_id]);
          else await connection.execute('UPDATE usuarios SET email = ? WHERE id = ?', [parsed.value.email, current.usuario_id]);
        } else if (current.usuario_id && parsed.value.nome) {
          await connection.execute('UPDATE usuarios SET nome = ? WHERE id = ?', [parsed.value.nome, current.usuario_id]);
        }
        const fields = Object.keys(parsed.value).filter((field) => field !== 'email');
        result = fields.length
          ? (await connection.execute(`UPDATE entregadores SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map((field) => parsed.value[field]), req.params.id]))[0]
          : { affectedRows: 1 };
        await connection.commit();
      } catch (error) { await connection.rollback(); throw error; }
      finally { connection.release(); }
      if (!result.affectedRows) {
        const [existing] = await db.execute('SELECT id FROM entregadores WHERE id = ? LIMIT 1', [req.params.id]);
        if (!existing[0]) return res.status(404).json({ erro: 'Entregador não encontrado.' });
      }
      const [rows] = await db.execute(`${delivererSelect} WHERE d.id = ? LIMIT 1`, [req.params.id]);
      res.json({ entregador: rows[0], mensagem: 'Entregador atualizado com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: /usuarios_email|uk_usuarios_email/i.test(error.message) ? 'Este e-mail já está vinculado a outra conta do sistema.' : 'Já existe um entregador cadastrado com este CPF.' });
      next(error);
    }
  });

  app.delete('/api/deliverers/:id', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [result] = await db.execute('DELETE FROM entregadores WHERE id = ?', [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ erro: 'Entregador não encontrado.' });
      res.status(200).json({ mensagem: 'Entregador excluído com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') {
        return res.status(409).json({ erro: 'Este entregador possui registros relacionados e não pode ser excluído.' });
      }
      next(error);
    }
  });

  const CLIENT_FIELDS = ['nome', 'cpf', 'cep', 'endereco', 'numero', 'quadra', 'lote', 'setor', 'cidade', 'estado', 'observacao'];
  const CLIENT_SELECT = 'id, nome, cpf, cep, endereco, numero, quadra, lote, setor, cidade, estado, observacao, criado_em, atualizado_em';
  const CLIENT_SEARCH_SELECT = 'id, nome, cpf, cep, endereco, numero, quadra, lote, setor, cidade, estado';
  function parseClient(body, partial = false) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Envie dados válidos do cliente.' };
    if (Object.keys(body).some((key) => !CLIENT_FIELDS.includes(key))) return { error: 'Envie somente os campos do cadastro de cliente.' };
    if (partial && Object.keys(body).length === 0) return { error: 'Informe ao menos um campo para atualizar.' };
    const value = {};
    for (const field of CLIENT_FIELDS) {
      if (partial && !Object.hasOwn(body, field)) continue;
      const raw = body[field];
      if (raw != null && typeof raw !== 'string') return { error: `O campo ${field} deve ser texto.` };
      const input = typeof raw === 'string' ? raw.trim() : '';
      if (field === 'nome') {
        if (!input || input.length > 150) return { error: 'Informe o nome completo com até 150 caracteres.' };
        value.nome = input;
      } else if (field === 'cpf') {
        if (!input) value.cpf = null;
        else {
          if (!/^[\d.\-\s]+$/.test(input)) return { error: 'Informe um CPF válido.' };
          const cpf = input.replace(/\D/g, '');
          if (!validCpf(cpf)) return { error: 'Informe um CPF válido.' };
          value.cpf = cpf;
        }
      } else if (field === 'cep') {
        if (!input) value.cep = null;
        else {
          if (!/^[\d\-\s]+$/.test(input)) return { error: 'Informe um CEP válido com 8 dígitos.' };
          const cep = input.replace(/\D/g, '');
          if (!/^\d{8}$/.test(cep)) return { error: 'Informe um CEP válido com 8 dígitos.' };
          value.cep = cep;
        }
      } else if (field === 'estado') {
        if (!input) value.estado = null;
        else {
          const state = input.toLocaleUpperCase('pt-BR');
          if (state.length !== 2 || !BRAZILIAN_STATES.has(state)) return { error: 'Informe uma UF brasileira válida.' };
          value.estado = state;
        }
      } else {
        const limits = { endereco: 255, numero: 30, quadra: 50, lote: 50, setor: 120, cidade: 100, observacao: 5000 };
        if (input.length > limits[field]) return { error: `O campo ${field} excede o limite permitido.` };
        value[field] = input || null;
      }
    }
    return { value };
  }

  app.get('/api/clients', authenticate, requireAccess('administrador'), async (req, res, next) => {
    try {
      const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const digits = query.replace(/\D/g, '');
      const [rows] = query
        ? await db.execute(`SELECT ${CLIENT_SEARCH_SELECT} FROM clientes WHERE nome LIKE ? OR cpf LIKE ? ORDER BY nome ASC, id DESC LIMIT 10`, [`%${query}%`, `%${digits || query}%`])
        : await db.execute(`SELECT ${CLIENT_SELECT} FROM clientes ORDER BY id DESC`);
      res.set('Cache-Control', 'no-store').json(rows);
    } catch (error) { next(error); }
  });

  app.get('/api/clients/:id', authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [rows] = await db.execute(`SELECT ${CLIENT_SELECT} FROM clientes WHERE id = ? LIMIT 1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Cliente não encontrado.' });
      res.set('Cache-Control', 'no-store').json({ cliente: rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/clients', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    const parsed = parseClient(req.body);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    try {
      const fields = Object.keys(parsed.value);
      const [result] = await db.execute(`INSERT INTO clientes (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map((field) => parsed.value[field]));
      const [rows] = await db.execute(`SELECT ${CLIENT_SELECT} FROM clientes WHERE id = ? LIMIT 1`, [result.insertId]);
      res.status(201).json({ cliente: rows[0], mensagem: 'Cliente cadastrado com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um cliente cadastrado com este CPF.' });
      next(error);
    }
  });

  app.patch('/api/clients/:id', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    const parsed = parseClient(req.body, true);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    try {
      const fields = Object.keys(parsed.value);
      const [result] = await db.execute(`UPDATE clientes SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map((field) => parsed.value[field]), req.params.id]);
      if (!result.affectedRows) {
        const [existing] = await db.execute('SELECT id FROM clientes WHERE id = ? LIMIT 1', [req.params.id]);
        if (!existing[0]) return res.status(404).json({ erro: 'Cliente não encontrado.' });
      }
      const [rows] = await db.execute(`SELECT ${CLIENT_SELECT} FROM clientes WHERE id = ? LIMIT 1`, [req.params.id]);
      res.json({ cliente: rows[0], mensagem: 'Cliente atualizado com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um cliente cadastrado com este CPF.' });
      next(error);
    }
  });

  app.delete('/api/clients/:id', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [result] = await db.execute('DELETE FROM clientes WHERE id = ?', [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ erro: 'Cliente não encontrado.' });
      res.json({ mensagem: 'Cliente excluído com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_ROW_IS_REFERENCED') return res.status(409).json({ erro: 'Este cliente possui registros relacionados e não pode ser excluído.' });
      next(error);
    }
  });

  registerDeliveryRoutes(app, { db, csrfGuard, authenticate, requireAccess });

  app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.', caminho: req.path }));
  app.use((error, req, res, next) => {
    const detail = error.code === 'ER_DUP_ENTRY' ? 'violação de unicidade' : (error.message || 'erro inesperado');
    console.error('Erro interno:', error.code || 'erro inesperado', detail);
    if (res.headersSent) return next(error);
    res.status(500).json({ erro: 'Ocorreu um erro interno no servidor.' });
  });
  return app;
}

module.exports = { createApp };
