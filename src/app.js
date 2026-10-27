const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./db');
const { HttpError } = require('./errors');
const { carregarUsuario, exigirLogin } = require('./lib/auth');
const { authRouter } = require('./routes/auth');
const { usuariosRouter } = require('./routes/usuarios');
const { empresasRouter } = require('./routes/empresas');
const { biCarteiraRouter } = require('./routes/bi');

function createApp(db = openDatabase()) {
  const app = express();
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'"
    );
    next();
  });

  // Extratos podem ser grandes, por isso o limite maior que o padrão.
  app.use(express.json({ limit: '10mb' }));

  // CSRF protection: state-changing calls must carry a custom header, which a cross-site page
  // cannot add without a CORS preflight. Combined with the SameSite=Lax cookie this blocks forged requests.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-requested-with'] !== 'mish') {
      return next(new HttpError(403, 'Requisição não autorizada'));
    }
    next();
  });

  app.use(carregarUsuario(db));

  app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Mish Business', versao: '1.0.0' }));
  app.use('/api/auth', authRouter(db));
  app.use('/api/usuarios', exigirLogin, usuariosRouter(db));
  app.use('/api/empresas', exigirLogin, empresasRouter(db));
  app.use('/api/bi', exigirLogin, biCarteiraRouter(db));

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    if (err.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo muito grande' });
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint failed')) return res.status(409).json({ erro: 'Já existe um registro com esses dados' });
    if (msg.includes('FOREIGN KEY constraint failed')) return res.status(409).json({ erro: 'Registro em uso por outros dados e não pode ser removido' });
    if (msg.includes('CHECK constraint failed')) return res.status(400).json({ erro: 'Valor inválido para um dos campos' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  });

  return app;
}

module.exports = { createApp };
