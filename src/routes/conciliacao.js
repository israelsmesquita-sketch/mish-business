const express = require('express');
const { transaction } = require('../db');
const { badRequest, notFound } = require('../errors');
const { addDays, isIsoDate } = require('../lib/datas');
const { parseExtrato } = require('../lib/extrato');
const { parseFields, insert } = require('./crud');

// A bank transaction matches an open entry with the same amount and direction whose
// due date is within this many days of the transaction date.
const JANELA_DIAS = 7;

function conciliacaoRouter(db) {
  const router = express.Router({ mergeParams: true });

  function findTransacao(empresaId, id) {
    const row = db.prepare('SELECT * FROM extrato WHERE id = ? AND empresa_id = ?').get(id, empresaId);
    if (!row) throw notFound('Transação do extrato não encontrada');
    return row;
  }

  function contaDaEmpresa(empresaId, contaId) {
    const conta = db.prepare('SELECT * FROM contas_bancarias WHERE id = ? AND empresa_id = ?').get(contaId, empresaId);
    if (!conta) throw badRequest('Selecione uma conta bancária válida');
    return conta;
  }

  /** Candidate entries for a bank transaction, closest due date first. */
  function sugestoes(t) {
    return db
      .prepare(
        `SELECT l.*, c.nome AS categoria_nome
           FROM lancamentos l
           LEFT JOIN categorias c ON c.id = l.categoria_id
          WHERE l.empresa_id = :empresa
            AND l.tipo = :tipo
            AND ABS(l.valor - :valor) < 0.005
            AND (l.conta_id IS NULL OR l.conta_id = :conta)
            AND l.vencimento BETWEEN :de AND :ate
            AND NOT EXISTS (SELECT 1 FROM extrato x WHERE x.lancamento_id = l.id)
            AND (l.pagamento IS NULL OR l.pagamento = :data)
          ORDER BY ABS(julianday(l.vencimento) - julianday(:data)), l.id
          LIMIT 5`
      )
      .all({
        empresa: t.empresa_id,
        tipo: t.valor > 0 ? 'receita' : 'despesa',
        valor: Math.abs(t.valor),
        conta: t.conta_id,
        data: t.data,
        de: addDays(t.data, -JANELA_DIAS),
        ate: addDays(t.data, JANELA_DIAS),
      });
  }

  function vincular(t, lancamentoId) {
    db.prepare('UPDATE lancamentos SET pagamento = ?, conta_id = ? WHERE id = ?').run(t.data, t.conta_id, lancamentoId);
    db.prepare('UPDATE extrato SET lancamento_id = ? WHERE id = ?').run(lancamentoId, t.id);
  }

  router.get('/resumo', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT cb.id AS conta_id, cb.descricao, cb.banco,
                  COUNT(x.id) AS transacoes,
                  COUNT(x.id) - COUNT(x.lancamento_id) AS pendentes,
                  MAX(x.data) AS ultima_data,
                  cb.saldo_inicial + COALESCE(SUM(x.valor), 0) AS saldo_extrato
             FROM contas_bancarias cb
             LEFT JOIN extrato x ON x.conta_id = cb.id
            WHERE cb.empresa_id = ?
            GROUP BY cb.id ORDER BY cb.descricao`
        )
        .all(req.empresa.id)
    );
  });

  router.get('/', (req, res) => {
    const where = ['x.empresa_id = :empresa'];
    const params = { empresa: req.empresa.id };
    if (req.query.conta_id) {
      where.push('x.conta_id = :conta');
      params.conta = Number(req.query.conta_id);
    }
    if (req.query.status === 'pendente') where.push('x.lancamento_id IS NULL');
    if (req.query.status === 'conciliado') where.push('x.lancamento_id IS NOT NULL');
    if (isIsoDate(req.query.inicio)) {
      where.push('x.data >= :inicio');
      params.inicio = req.query.inicio;
    }
    if (isIsoDate(req.query.fim)) {
      where.push('x.data <= :fim');
      params.fim = req.query.fim;
    }

    const rows = db
      .prepare(
        `SELECT x.*, cb.descricao AS conta_nome, l.descricao AS lancamento_descricao, l.contraparte AS lancamento_contraparte
           FROM extrato x
           JOIN contas_bancarias cb ON cb.id = x.conta_id
           LEFT JOIN lancamentos l ON l.id = x.lancamento_id
          WHERE ${where.join(' AND ')}
          ORDER BY x.data DESC, x.id DESC LIMIT 1000`
      )
      .all(params);
    for (const r of rows) if (!r.lancamento_id) r.sugestoes = sugestoes(r);
    res.json(rows);
  });

  router.post('/importar', (req, res) => {
    const { conta_id, formato, conteudo } = req.body || {};
    contaDaEmpresa(req.empresa.id, conta_id);
    if (!conteudo || typeof conteudo !== 'string') throw badRequest('Envie o conteúdo do arquivo de extrato');

    let transacoes;
    try {
      transacoes = parseExtrato(formato, conteudo);
    } catch (err) {
      throw badRequest(err.message);
    }
    if (!transacoes.length) throw badRequest('Nenhuma transação encontrada no arquivo');

    const resultado = transaction(db, () => {
      const ins = db.prepare(
        'INSERT OR IGNORE INTO extrato (empresa_id, conta_id, data, descricao, valor, fitid) VALUES (?, ?, ?, ?, ?, ?)'
      );
      let importadas = 0;
      for (const t of transacoes) importadas += Number(ins.run(req.empresa.id, conta_id, t.data, t.descricao, t.valor, t.fitid).changes);
      return { total: transacoes.length, importadas, duplicadas: transacoes.length - importadas };
    });
    res.status(201).json(resultado);
  });

  // Matches every pending transaction that has exactly one candidate entry.
  router.post('/automatica', (req, res) => {
    const params = [req.empresa.id];
    let filtro = '';
    if (req.body?.conta_id) {
      filtro = 'AND conta_id = ?';
      params.push(Number(req.body.conta_id));
    }
    const pendentes = db.prepare(`SELECT * FROM extrato WHERE empresa_id = ? AND lancamento_id IS NULL ${filtro} ORDER BY data`).all(...params);

    const conciliadas = transaction(db, () => {
      let n = 0;
      const usados = new Set();
      for (const t of pendentes) {
        const candidatos = sugestoes(t).filter((l) => !usados.has(l.id));
        if (candidatos.length === 1) {
          vincular(t, candidatos[0].id);
          usados.add(candidatos[0].id);
          n++;
        }
      }
      return n;
    });
    res.json({ analisadas: pendentes.length, conciliadas, pendentes: pendentes.length - conciliadas });
  });

  router.post('/:id/vincular', (req, res) => {
    const t = findTransacao(req.empresa.id, req.params.id);
    if (t.lancamento_id) throw badRequest('Esta transação já está conciliada');
    const l = db.prepare('SELECT * FROM lancamentos WHERE id = ? AND empresa_id = ?').get(req.body?.lancamento_id, req.empresa.id);
    if (!l) throw badRequest('Lançamento não encontrado');
    if (db.prepare('SELECT 1 FROM extrato WHERE lancamento_id = ?').get(l.id)) throw badRequest('Este lançamento já está conciliado com outra transação');
    if ((t.valor > 0) !== (l.tipo === 'receita')) throw badRequest('Créditos só podem ser conciliados com receitas e débitos com despesas');
    if (Math.abs(Math.abs(t.valor) - l.valor) >= 0.005) throw badRequest('O valor do lançamento é diferente do valor da transação');

    transaction(db, () => vincular(t, l.id));
    res.json(findTransacao(req.empresa.id, t.id));
  });

  // Creates an already-paid entry from the bank transaction (e.g. bank fees) and links it.
  router.post('/:id/criar-lancamento', (req, res) => {
    const t = findTransacao(req.empresa.id, req.params.id);
    if (t.lancamento_id) throw badRequest('Esta transação já está conciliada');
    const data = parseFields(
      db,
      {
        descricao: { label: 'descrição' },
        contraparte: {},
        categoria_id: { required: true, type: 'ref', ref: 'categorias', label: 'categoria' },
      },
      req.body || {},
      { empresaId: req.empresa.id }
    );
    const tipo = t.valor > 0 ? 'receita' : 'despesa';
    const cat = db.prepare('SELECT tipo FROM categorias WHERE id = ?').get(data.categoria_id);
    if (cat.tipo !== tipo) throw badRequest(`Escolha uma categoria de ${tipo}`);

    transaction(db, () => {
      const id = insert(db, 'lancamentos', {
        empresa_id: req.empresa.id,
        tipo,
        descricao: data.descricao || t.descricao,
        contraparte: data.contraparte ?? null,
        categoria_id: data.categoria_id,
        conta_id: t.conta_id,
        valor: Math.abs(t.valor),
        competencia: t.data,
        vencimento: t.data,
        pagamento: t.data,
      });
      db.prepare('UPDATE extrato SET lancamento_id = ? WHERE id = ?').run(id, t.id);
    });
    res.status(201).json(findTransacao(req.empresa.id, t.id));
  });

  router.post('/:id/desfazer', (req, res) => {
    const t = findTransacao(req.empresa.id, req.params.id);
    if (!t.lancamento_id) throw badRequest('Esta transação não está conciliada');
    transaction(db, () => {
      db.prepare('UPDATE extrato SET lancamento_id = NULL WHERE id = ?').run(t.id);
      db.prepare('UPDATE lancamentos SET pagamento = NULL WHERE id = ?').run(t.lancamento_id);
    });
    res.json(findTransacao(req.empresa.id, t.id));
  });

  router.delete('/:id', (req, res) => {
    const t = findTransacao(req.empresa.id, req.params.id);
    if (t.lancamento_id) throw badRequest('Desfaça a conciliação antes de excluir a transação');
    db.prepare('DELETE FROM extrato WHERE id = ?').run(t.id);
    res.status(204).end();
  });

  return router;
}

module.exports = { conciliacaoRouter };
