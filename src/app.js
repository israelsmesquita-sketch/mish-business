const path = require('node:path');
const express = require('express');
const { openDatabase } = require('./db');
const { HttpError } = require('./errors');
const { crudRouter } = require('./routes/crud');
const { vendasRouter } = require('./routes/vendas');
const { dashboardRouter } = require('./routes/dashboard');

function createApp(db = openDatabase()) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Mish Business', versao: '1.0.0' }));

  app.use(
    '/api/clientes',
    crudRouter(db, {
      table: 'clientes',
      fields: {
        nome: { required: true },
        email: {},
        telefone: {},
        documento: {},
        endereco: {},
      },
      search: ['nome', 'email', 'documento'],
      orderBy: 'nome COLLATE NOCASE',
    })
  );

  app.use(
    '/api/produtos',
    crudRouter(db, {
      table: 'produtos',
      fields: {
        nome: { required: true },
        sku: {},
        preco: { required: true, type: 'number' },
        custo: { type: 'number' },
        estoque: { type: 'integer' },
        estoque_minimo: { type: 'integer' },
      },
      search: ['nome', 'sku'],
      orderBy: 'nome COLLATE NOCASE',
    })
  );

  app.use(
    '/api/lancamentos',
    crudRouter(db, {
      table: 'lancamentos',
      fields: {
        tipo: { required: true },
        descricao: { required: true },
        categoria: {},
        valor: { required: true, type: 'number' },
        data: {},
      },
      search: ['descricao', 'categoria'],
      orderBy: 'data DESC, id DESC',
    })
  );

  app.use('/api/vendas', vendasRouter(db));
  app.use('/api/dashboard', dashboardRouter(db));

  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido' });
    const msg = String(err.message || '');
    if (msg.includes('UNIQUE constraint failed')) return res.status(409).json({ erro: 'Já existe um registro com esse valor (ex.: SKU duplicado)' });
    if (msg.includes('FOREIGN KEY constraint failed')) return res.status(409).json({ erro: 'Registro em uso por outros dados e não pode ser removido' });
    if (msg.includes('CHECK constraint failed')) return res.status(400).json({ erro: 'Valor inválido para um dos campos' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno do servidor' });
  });

  return app;
}

module.exports = { createApp };
