const express = require('express');
const { badRequest, unauthorized, HttpError } = require('../errors');
const {
  verificarSenha,
  hashSenha,
  validarSenha,
  criarSessao,
  encerrarSessao,
  cookieSessao,
  exigirLogin,
  limitadorLogin,
  publico,
} = require('../lib/auth');

function authRouter(db) {
  const router = express.Router();
  const limitador = limitadorLogin();

  router.post('/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const senha = String(req.body?.senha || '');
    if (!email || !senha) throw badRequest('Informe e-mail e senha');

    const chave = `${req.ip}|${email}`;
    if (limitador.bloqueado(chave)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');

    const usuario = db.prepare('SELECT * FROM usuarios WHERE email = ? AND ativo = 1').get(email);
    if (!usuario || !verificarSenha(senha, usuario.senha_hash)) {
      limitador.falhou(chave);
      throw unauthorized('E-mail ou senha inválidos');
    }
    limitador.limpar(chave);

    db.prepare("UPDATE usuarios SET ultimo_acesso = datetime('now') WHERE id = ?").run(usuario.id);
    res.setHeader('Set-Cookie', cookieSessao(criarSessao(db, usuario.id), req));
    res.json(publico(usuario));
  });

  router.post('/logout', (req, res) => {
    encerrarSessao(db, req.sessionToken);
    res.setHeader('Set-Cookie', cookieSessao(null, req));
    res.status(204).end();
  });

  router.get('/me', exigirLogin, (req, res) => res.json(req.user));

  router.post('/senha', exigirLogin, (req, res) => {
    const { senha_atual, nova_senha } = req.body || {};
    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.user.id);
    if (!verificarSenha(String(senha_atual || ''), usuario.senha_hash)) throw badRequest('Senha atual incorreta');
    if (!validarSenha(nova_senha)) throw badRequest('A nova senha deve ter pelo menos 8 caracteres');
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(nova_senha), usuario.id);
    // Invalidate other sessions after a password change.
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(usuario.id);
    res.setHeader('Set-Cookie', cookieSessao(criarSessao(db, usuario.id), req));
    res.status(204).end();
  });

  return router;
}

module.exports = { authRouter };
