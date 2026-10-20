'use strict';

const bcrypt = require('bcrypt');

function registerUserRoutes(app, { db, csrfGuard, authenticate, requireAccess, PUBLIC_USER, sessionStore, secureCookie }) {
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
    if ([...novaSenha].length < 1 || [...novaSenha].length > 100) return res.status(400).json({ erro: 'A nova senha deve ter de 1 a 100 caracteres.' });
    if (!senhaAtual || !confirmarSenha) return res.status(400).json({ erro: 'Preencha todos os campos de senha.' });
    if (Buffer.byteLength(senhaAtual, 'utf8') > 100) return res.status(400).json({ erro: 'A senha atual excede o limite permitido.' });
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
    if ([...novaSenha].length < 1 || [...novaSenha].length > 100) return res.status(400).json({ erro: 'A nova senha deve ter de 1 a 100 caracteres.' });
    try {
      const [rows] = await db.execute('SELECT id FROM usuarios WHERE id = ? LIMIT 1', [req.params.id]);
      if (!rows[0]) return res.status(404).json({ erro: 'Usuário não encontrado.' });
      const senhaHash = await bcrypt.hash(novaSenha, 12);
      await db.execute('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [senhaHash, req.params.id]);
      res.set('Cache-Control', 'no-store').json({ mensagem: 'Senha atualizada com sucesso. As sessões existentes continuam ativas.' });
    } catch (error) { next(error); }
  });
}

module.exports = { registerUserRoutes };
