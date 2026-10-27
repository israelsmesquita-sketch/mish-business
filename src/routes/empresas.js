const express = require('express');
const { transaction, criarPlanoDeContas } = require('../db');
const { forbidden, notFound } = require('../errors');
const { isEquipe, exigirPapel } = require('../lib/auth');
const { parseFields, insert, update, crudEmpresa } = require('./crud');
const { lancamentosRouter } = require('./lancamentos');
const { conciliacaoRouter } = require('./conciliacao');
const { biEmpresaRouter } = require('./bi');
const { relatoriosRouter } = require('./relatorios');

const FIELDS = {
  razao_social: { required: true, label: 'razão social' },
  nome_fantasia: {},
  cnpj: { label: 'CNPJ' },
  email: {},
  telefone: {},
  responsavel: {},
  ativo: { type: 'bool' },
};

function empresasRouter(db) {
  const router = express.Router();

  const find = (id) => {
    const row = db.prepare('SELECT * FROM empresas WHERE id = ?').get(id);
    if (!row) throw notFound('Empresa não encontrada');
    return row;
  };

  router.get('/', (req, res) => {
    if (isEquipe(req.user)) return res.json(db.prepare('SELECT * FROM empresas ORDER BY razao_social COLLATE NOCASE').all());
    res.json(db.prepare('SELECT * FROM empresas WHERE id = ?').all(req.user.empresa_id));
  });

  router.post('/', exigirPapel('admin', 'analista'), (req, res) => {
    const data = parseFields(db, FIELDS, req.body || {});
    const id = transaction(db, () => {
      const novo = insert(db, 'empresas', data);
      criarPlanoDeContas(db, novo);
      return novo;
    });
    res.status(201).json(find(id));
  });

  // Everything below is scoped to one empresa; clients only see their own and are read-only.
  router.use('/:empresaId', (req, res, next) => {
    const empresa = find(req.params.empresaId);
    if (!isEquipe(req.user)) {
      if (req.user.empresa_id !== empresa.id) throw notFound('Empresa não encontrada');
      if (req.method !== 'GET') throw forbidden('Seu perfil permite apenas consulta');
    }
    req.empresa = empresa;
    next();
  });

  router.get('/:empresaId', (req, res) => res.json(req.empresa));

  router.put('/:empresaId', (req, res) => {
    update(db, 'empresas', req.empresa.id, parseFields(db, FIELDS, req.body || {}, { partial: true }));
    res.json(find(req.empresa.id));
  });

  router.delete('/:empresaId', exigirPapel('admin'), (req, res) => {
    db.prepare('DELETE FROM empresas WHERE id = ?').run(req.empresa.id);
    res.status(204).end();
  });

  router.use(
    '/:empresaId/contas',
    crudEmpresa(db, {
      table: 'contas_bancarias',
      fields: {
        descricao: { required: true, label: 'descrição' },
        banco: {},
        agencia: { label: 'agência' },
        conta: {},
        saldo_inicial: { type: 'number', signed: true, label: 'saldo inicial' },
        data_saldo_inicial: { type: 'date', label: 'data do saldo inicial' },
      },
      orderBy: 'descricao COLLATE NOCASE',
    })
  );

  router.use(
    '/:empresaId/categorias',
    crudEmpresa(db, {
      table: 'categorias',
      fields: {
        nome: { required: true },
        tipo: { required: true, type: 'enum', values: ['receita', 'despesa'] },
        grupo: {
          required: true,
          type: 'enum',
          values: ['receita_operacional', 'deducoes', 'custos', 'despesas_operacionais', 'receitas_financeiras', 'despesas_financeiras', 'outros'],
        },
      },
      search: ['nome'],
      orderBy: 'tipo DESC, nome COLLATE NOCASE',
    })
  );

  router.use('/:empresaId/lancamentos', lancamentosRouter(db));
  router.use('/:empresaId/conciliacao', conciliacaoRouter(db));
  router.use('/:empresaId/bi', biEmpresaRouter(db));
  router.use('/:empresaId/relatorios', relatoriosRouter(db));

  return router;
}

module.exports = { empresasRouter };
