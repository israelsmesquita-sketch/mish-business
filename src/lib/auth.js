const crypto = require('node:crypto');
const { unauthorized, forbidden } = require('../errors');

const COOKIE = 'mish_sessao';
const SESSAO_MS = 12 * 60 * 60 * 1000;

function hashSenha(senha) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verificarSenha(senha, armazenado) {
  const [alg, saltHex, hashHex] = String(armazenado).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const esperado = Buffer.from(hashHex, 'hex');
  const hash = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), esperado.length);
  return crypto.timingSafeEqual(hash, esperado);
}

function validarSenha(senha) {
  return typeof senha === 'string' && senha.length >= 8;
}

// Only the SHA-256 of the token is stored, so a leaked database cannot be used to hijack sessions.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function criarSessao(db, usuarioId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(Date.now());
  db.prepare('INSERT INTO sessoes (token_hash, usuario_id, expira_em) VALUES (?, ?, ?)').run(hashToken(token), usuarioId, Date.now() + SESSAO_MS);
  return token;
}

function encerrarSessao(db, token) {
  if (token) db.prepare('DELETE FROM sessoes WHERE token_hash = ?').run(hashToken(token));
}

function lerCookie(req, nome) {
  const header = req.headers.cookie || '';
  for (const parte of header.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nome) return decodeURIComponent(v.join('='));
  }
  return null;
}

function cookieSessao(token, req) {
  const secure = req.secure || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = token ? Math.floor(SESSAO_MS / 1000) : 0;
  return `${COOKIE}=${token || ''}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, empresa_id: u.empresa_id });

/** Attaches req.user when a valid session cookie is present. */
function carregarUsuario(db) {
  return (req, res, next) => {
    const token = lerCookie(req, COOKIE);
    req.sessionToken = token;
    if (token) {
      const row = db
        .prepare(
          `SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
            WHERE s.token_hash = ? AND s.expira_em > ? AND u.ativo = 1`
        )
        .get(hashToken(token), Date.now());
      if (row) req.user = publico(row);
    }
    next();
  };
}

function exigirLogin(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

const exigirPapel = (...papeis) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!papeis.includes(req.user.papel)) return next(forbidden());
  next();
};

const isEquipe = (user) => user && (user.papel === 'admin' || user.papel === 'analista');

/** Simple in-memory brute-force protection for the login endpoint. */
function limitadorLogin({ max = 10, janelaMs = 15 * 60 * 1000 } = {}) {
  const tentativas = new Map();
  return {
    bloqueado(chave) {
      const t = tentativas.get(chave);
      if (!t || Date.now() - t.inicio > janelaMs) return false;
      return t.falhas >= max;
    },
    falhou(chave) {
      const t = tentativas.get(chave);
      if (!t || Date.now() - t.inicio > janelaMs) tentativas.set(chave, { inicio: Date.now(), falhas: 1 });
      else t.falhas++;
    },
    limpar(chave) {
      tentativas.delete(chave);
    },
  };
}

module.exports = {
  hashSenha,
  verificarSenha,
  validarSenha,
  criarSessao,
  encerrarSessao,
  cookieSessao,
  carregarUsuario,
  exigirLogin,
  exigirPapel,
  isEquipe,
  limitadorLogin,
  publico,
};
