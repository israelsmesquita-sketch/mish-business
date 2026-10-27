const express = require('express');
const { transaction } = require('../db');
const { badRequest, notFound } = require('../errors');
const { hoje, addMonths, isIsoDate } = require('../lib/datas');
const { parseFields, insert, update } = require('./crud');

const STATUS_SQL = `CASE WHEN l.pagamento IS NOT NULL THEN 'pago' WHEN l.vencimento < :hoje THEN 'atrasado' ELSE 'aberto' END`;

const SELECT = `
  SELECT l.*, ${STATUS_SQL} AS status,
         c.nome AS categoria_nome, cb.descricao AS conta_nome,
         x.id AS extrato_id
    FROM lancamentos l
    LEFT JOIN categorias c ON c.id = l.categoria_id
    LEFT JOIN contas_bancarias cb ON cb.id = l.conta_id
    LEFT JOIN extrato x ON x.lancamento_id = l.id`;

const FIELDS = {
  tipo: { required: true, type: 'enum', values: ['receita', 'despesa'] },
  descricao: { required: true, label: 'descrição' },
  contraparte: { label: 'cliente/fornecedor' },
  categoria_id: { type: 'ref', ref: 'categorias', label: 'categoria' },
  conta_id: { type: 'ref', ref: 'contas_bancarias', label: 'conta bancária' },
  valor: { required: true, type: 'number', positive: true },
  competencia: { type: 'date', label: 'competência' },
  vencimento: { required: true, type: 'date' },
  pagamento: { type: 'date' },
  documento: {},
  observacao: { label: 'observação' },
};

function lancamentosRouter(db) {
  const router = express.Router({ mergeParams: true });

  const find = (empresaId, id) => {
    const row = db.prepare(`${SELECT} WHERE l.id = :id AND l.empresa_id = :empresa`).get({ id, empresa: empresaId, hoje: hoje() });
    if (!row) throw notFound('Lançamento não encontrado');
    return row;
  };

  router.get('/', (req, res) => {
    const q = req.query;
    const where = ['l.empresa_id = :empresa'];
    const params = { empresa: req.empresa.id, hoje: hoje() };

    if (q.tipo === 'receita' || q.tipo === 'despesa') {
      where.push('l.tipo = :tipo');
      params.tipo = q.tipo;
    }
    if (q.status === 'pago') where.push('l.pagamento IS NOT NULL');
    else if (q.status === 'pendente') where.push('l.pagamento IS NULL');
    else if (q.status === 'atrasado') where.push('l.pagamento IS NULL AND l.vencimento < :hoje');
    else if (q.status === 'aberto') where.push('l.pagamento IS NULL AND l.vencimento >= :hoje');

    const campoData = q.campo_data === 'pagamento' ? 'l.pagamento' : q.campo_data === 'competencia' ? 'l.competencia' : 'l.vencimento';
    if (isIsoDate(q.inicio)) {
      where.push(`${campoData} >= :inicio`);
      params.inicio = q.inicio;
    }
    if (isIsoDate(q.fim)) {
      where.push(`${campoData} <= :fim`);
      params.fim = q.fim;
    }
    if (q.categoria_id) {
      where.push('l.categoria_id = :categoria');
      params.categoria = Number(q.categoria_id);
    }
    if (q.conta_id) {
      where.push('l.conta_id = :conta');
      params.conta = Number(q.conta_id);
    }
    if (q.q) {
      where.push('(l.descricao LIKE :busca OR l.contraparte LIKE :busca OR l.documento LIKE :busca)');
      params.busca = `%${String(q.q).trim()}%`;
    }

    res.json(db.prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${campoData} ASC, l.id ASC LIMIT 2000`).all(params));
  });

  router.get('/:id', (req, res) => res.json(find(req.empresa.id, req.params.id)));

  // `repetir` creates N monthly installments/recurrences (1 = single entry).
  router.post('/', (req, res) => {
    const body = req.body || {};
    const data = parseFields(db, FIELDS, body, { empresaId: req.empresa.id });
    data.competencia ??= data.vencimento;
    const repetir = body.repetir === undefined ? 1 : Number(body.repetir);
    if (!Number.isInteger(repetir) || repetir < 1 || repetir > 60) throw badRequest('Repetição deve ser entre 1 e 60 meses');

    const ids = transaction(db, () => {
      const criados = [];
      for (let i = 0; i < repetir; i++) {
        criados.push(
          insert(db, 'lancamentos', {
            ...data,
            empresa_id: req.empresa.id,
            descricao: repetir > 1 ? `${data.descricao} (${i + 1}/${repetir})` : data.descricao,
            vencimento: addMonths(data.vencimento, i),
            competencia: addMonths(data.competencia, i),
            pagamento: i === 0 ? data.pagamento ?? null : null,
          })
        );
      }
      return criados;
    });
    const criados = ids.map((id) => find(req.empresa.id, id));
    res.status(201).json(repetir > 1 ? criados : criados[0]);
  });

  router.put('/:id', (req, res) => {
    const atual = find(req.empresa.id, req.params.id);
    const data = parseFields(db, FIELDS, req.body || {}, { partial: true, empresaId: req.empresa.id });
    if (atual.extrato_id) {
      for (const campo of ['valor', 'pagamento', 'tipo', 'conta_id']) {
        if (data[campo] !== undefined && data[campo] !== atual[campo]) {
          throw badRequest('Lançamento conciliado: desfaça a conciliação antes de alterar valor, tipo, conta ou pagamento');
        }
      }
    }
    update(db, 'lancamentos', atual.id, data);
    res.json(find(req.empresa.id, atual.id));
  });

  router.delete('/:id', (req, res) => {
    const atual = find(req.empresa.id, req.params.id);
    if (atual.extrato_id) throw badRequest('Lançamento conciliado: desfaça a conciliação antes de excluir');
    db.prepare('DELETE FROM lancamentos WHERE id = ?').run(atual.id);
    res.status(204).end();
  });

  router.post('/:id/baixar', (req, res) => {
    const atual = find(req.empresa.id, req.params.id);
    if (atual.pagamento) throw badRequest('Este lançamento já está pago');
    const data = parseFields(
      db,
      { pagamento: { required: true, type: 'date', label: 'data de pagamento' }, conta_id: { type: 'ref', ref: 'contas_bancarias', label: 'conta bancária' } },
      { pagamento: hoje(), ...req.body },
      { empresaId: req.empresa.id }
    );
    update(db, 'lancamentos', atual.id, data);
    res.json(find(req.empresa.id, atual.id));
  });

  router.post('/:id/estornar', (req, res) => {
    const atual = find(req.empresa.id, req.params.id);
    if (atual.extrato_id) throw badRequest('Lançamento conciliado: desfaça a conciliação para estornar a baixa');
    update(db, 'lancamentos', atual.id, { pagamento: null });
    res.json(find(req.empresa.id, atual.id));
  });

  return router;
}

module.exports = { lancamentosRouter, STATUS_SQL };
