'use strict';

const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const { rateLimit } = require('express-rate-limit');
const MySQLSessionStore = require('./src/mysql-session-store');

const SESSION_MS = Number(process.env.SESSION_MAX_AGE_MS) || 8 * 60 * 60 * 1000;
const PUBLIC_USER = 'id, nome, email, acesso, criado_em, atualizado_em';

function createApp({ db, sessionStore = new MySQLSessionStore(db), testing = false, fetchImpl = globalThis.fetch } = {}) {
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

  const addressCache = new Map();
  let lastGeocodeRequestAt = 0;
  const geocodingUrl = process.env.GEOCODING_URL || 'https://nominatim.openstreetmap.org/search';
  app.get('/api/address/street', authenticate, requireAccess('administrador'), async (req, res) => {
    const street = typeof req.query.street === 'string' ? req.query.street.trim() : '';
    const city = typeof req.query.city === 'string' ? req.query.city.trim() : '';
    const state = typeof req.query.state === 'string' ? req.query.state.trim() : '';
    if (!street || street.length > 150 || city.length > 100 || state.length > 100) {
      return res.status(400).json({ erro: 'Informe uma rua com até 150 caracteres; cidade e estado são opcionais.' });
    }
    const cacheKey = `${street.toLocaleLowerCase()}|${city.toLocaleLowerCase()}|${state.toLocaleLowerCase()}`;
    const cached = addressCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.set('Cache-Control', 'private, max-age=300').json({ resultados: cached.results });
    if (Date.now() - lastGeocodeRequestAt < 1000) return res.status(429).json({ erro: 'A busca de endereços está temporariamente limitada. Aguarde um segundo e tente novamente.' });
    lastGeocodeRequestAt = Date.now();
    const stateNames = { AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais', PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins' };
    const params = new URLSearchParams({ street, country: 'Brasil', format: 'jsonv2', addressdetails: '1', limit: '8' });
    if (city) params.set('city', city);
    if (state) params.set('state', stateNames[state.toLocaleUpperCase('pt-BR')] || state);
    try {
      const response = await fetchImpl(`${geocodingUrl}?${params}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'ProjetoEntregas/1.0 (admin address lookup)' },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) return res.status(502).json({ erro: 'A busca de endereços está indisponível. Tente novamente mais tarde.' });
      const results = await response.json();
      if (!Array.isArray(results)) return res.status(502).json({ erro: 'O serviço de endereços retornou uma resposta inválida.' });
      addressCache.set(cacheKey, { results, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
      if (addressCache.size > 200) addressCache.delete(addressCache.keys().next().value);
      res.set('Cache-Control', 'private, max-age=300').json({ resultados: results });
    } catch {
      res.status(502).json({ erro: 'A busca de endereços está indisponível. Tente novamente mais tarde.' });
    }
  });

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
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const acesso = body.acesso;
    if (!nome || nome.length > 150) return res.status(400).json({ erro: 'Informe um nome com até 150 caracteres.' });
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: 'Informe um e-mail válido.' });
    if (!['administrador', 'convidado'].includes(acesso)) return res.status(400).json({ erro: 'Tipo de acesso inválido.' });
    try {
      const connection = typeof db.getConnection === 'function' ? await db.getConnection() : null;
      if (connection) await connection.beginTransaction();
      const executor = connection || db;
      try {
        const [targetRows] = await executor.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1 FOR UPDATE`, [req.params.id]);
        const target = targetRows[0];
        if (!target) { if (connection) await connection.rollback(); return res.status(404).json({ erro: 'Usuário não encontrado.' }); }
        if (target.acesso === 'administrador' && acesso !== 'administrador') {
          const [admins] = await executor.execute("SELECT id FROM usuarios WHERE acesso = 'administrador' FOR UPDATE");
          if (admins.length <= 1) { if (connection) await connection.rollback(); return res.status(409).json({ erro: 'Não é possível rebaixar o último administrador ativo.' }); }
        }
        await executor.execute('UPDATE usuarios SET nome = ?, email = ?, acesso = ? WHERE id = ?', [nome, email, acesso, req.params.id]);
        if (connection) await connection.commit();
        const [rows] = await db.execute(`SELECT ${PUBLIC_USER} FROM usuarios WHERE id = ? LIMIT 1`, [req.params.id]);
        res.set('Cache-Control', 'no-store').json({ usuario: rows[0], mensagem: 'Usuário atualizado com sucesso.' });
      } catch (error) { if (connection) await connection.rollback(); throw error; }
      finally { if (connection) connection.release(); }
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um usuário com este e-mail.' });
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
  const DELIVERER_COLUMNS = 'id, nome, cpf, cidade, estado, cep, endereco, quadra, lote, numero, setor, criado_em, atualizado_em';
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
    if (Object.keys(body).some((key) => !DELIVERER_FIELDS.includes(key))) return { error: 'Envie somente os campos do cadastro de entregador.' };
    if (partial && Object.keys(body).length === 0) return { error: 'Informe ao menos um campo para atualizar.' };
    const result = {};
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
        ? await db.execute(`SELECT ${DELIVERER_COLUMNS} FROM entregadores WHERE nome LIKE ? OR cpf LIKE ? ORDER BY id DESC`, [`%${query}%`, `%${digits || query}%`])
        : await db.execute(`SELECT ${DELIVERER_COLUMNS} FROM entregadores ORDER BY id DESC`);
      res.set('Cache-Control', 'no-store').json(rows);
    } catch (error) { next(error); }
  });

  app.get('/api/deliverers/:id', authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    try {
      const [rows] = await db.execute(`SELECT ${DELIVERER_COLUMNS} FROM entregadores WHERE id = ? LIMIT 1`, [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Entregador não encontrado.' });
      res.set('Cache-Control', 'no-store').json({ entregador: rows[0] });
    } catch (error) { next(error); }
  });

  app.post('/api/deliverers', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    const parsed = parseDeliverer(req.body);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    try {
      const fields = DELIVERER_FIELDS;
      const [result] = await db.execute(`INSERT INTO entregadores (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`, fields.map((field) => parsed.value[field]));
      const [rows] = await db.execute(`SELECT ${DELIVERER_COLUMNS} FROM entregadores WHERE id = ? LIMIT 1`, [result.insertId]);
      res.status(201).json({ entregador: rows[0], mensagem: 'Entregador cadastrado com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um entregador cadastrado com este CPF.' });
      next(error);
    }
  });

  app.patch('/api/deliverers/:id', csrfGuard, authenticate, requireAccess('administrador'), async (req, res, next) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) < 1) return res.status(400).json({ erro: 'Identificador inválido.' });
    const parsed = parseDeliverer(req.body, true);
    if (parsed.error) return res.status(400).json({ erro: parsed.error });
    try {
      const fields = Object.keys(parsed.value);
      const [result] = await db.execute(`UPDATE entregadores SET ${fields.map((field) => `${field} = ?`).join(', ')} WHERE id = ?`, [...fields.map((field) => parsed.value[field]), req.params.id]);
      if (!result.affectedRows) {
        const [existing] = await db.execute('SELECT id FROM entregadores WHERE id = ? LIMIT 1', [req.params.id]);
        if (!existing[0]) return res.status(404).json({ erro: 'Entregador não encontrado.' });
      }
      const [rows] = await db.execute(`SELECT ${DELIVERER_COLUMNS} FROM entregadores WHERE id = ? LIMIT 1`, [req.params.id]);
      res.json({ entregador: rows[0], mensagem: 'Entregador atualizado com sucesso.' });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ erro: 'Já existe um entregador cadastrado com este CPF.' });
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
