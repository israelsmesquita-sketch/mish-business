const express = require('express');
const { exigirPapel } = require('../lib/auth');
const { hoje, periodo, addMonths, inicioDoMes, fimDoMes, addDays } = require('../lib/datas');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Book balance per bank account: opening balance plus paid entries linked to it. */
function saldosPorConta(db, empresaId) {
  return db
    .prepare(
      `SELECT cb.id, cb.descricao, cb.banco,
              cb.saldo_inicial
                + COALESCE(SUM(CASE WHEN l.tipo = 'receita' THEN l.valor ELSE -l.valor END), 0) AS saldo
         FROM contas_bancarias cb
         LEFT JOIN lancamentos l ON l.conta_id = cb.id AND l.pagamento IS NOT NULL
        WHERE cb.empresa_id = ?
        GROUP BY cb.id ORDER BY cb.descricao`
    )
    .all(empresaId)
    .map((c) => ({ ...c, saldo: r2(c.saldo) }));
}

function aging(db, empresaId, tipo, ref) {
  const faixas = [
    ['A vencer', null, null],
    ['1–30 dias', 1, 30],
    ['31–60 dias', 31, 60],
    ['61–90 dias', 61, 90],
    ['Mais de 90 dias', 91, null],
  ];
  return faixas.map(([faixa, de, ate]) => {
    let where;
    const params = { empresa: empresaId, tipo };
    if (de === null) {
      where = 'vencimento >= :ref';
      params.ref = ref;
    } else {
      where = 'vencimento <= :de' + (ate ? ' AND vencimento >= :ate' : '');
      params.de = addDays(ref, -de);
      if (ate) params.ate = addDays(ref, -ate);
    }
    const row = db
      .prepare(
        `SELECT COUNT(*) AS quantidade, COALESCE(SUM(valor), 0) AS valor FROM lancamentos
          WHERE empresa_id = :empresa AND tipo = :tipo AND pagamento IS NULL AND ${where}`
      )
      .get(params);
    return { faixa, quantidade: row.quantidade, valor: r2(row.valor) };
  });
}

function biEmpresa(db, empresaId, query) {
  const { inicio, fim } = periodo(query);
  const ref = hoje();
  const one = (sql, params) => db.prepare(sql).get(params);

  const realizado = one(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor END), 0) AS receitas,
            COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor END), 0) AS despesas
       FROM lancamentos WHERE empresa_id = :e AND pagamento BETWEEN :i AND :f`,
    { e: empresaId, i: inicio, f: fim }
  );

  const pendente = one(
    `SELECT COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor END), 0) AS a_receber,
            COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor END), 0) AS a_pagar,
            COALESCE(SUM(CASE WHEN tipo = 'receita' AND vencimento < :h THEN valor END), 0) AS receber_atrasado,
            COALESCE(SUM(CASE WHEN tipo = 'despesa' AND vencimento < :h THEN valor END), 0) AS pagar_atrasado
       FROM lancamentos WHERE empresa_id = :e AND pagamento IS NULL`,
    { e: empresaId, h: ref }
  );

  const conc = one(
    'SELECT COUNT(*) AS total, COUNT(lancamento_id) AS conciliadas FROM extrato WHERE empresa_id = :e',
    { e: empresaId }
  );

  // Last 12 months up to the end of the selected period: realized vs. still-open (forecast) amounts.
  const fimMeses = fimDoMes(fim);
  const inicioMeses = inicioDoMes(addMonths(fimMeses, -11));
  const porMes = db
    .prepare(
      `SELECT substr(COALESCE(pagamento, vencimento), 1, 7) AS mes,
              SUM(CASE WHEN tipo = 'receita' AND pagamento IS NOT NULL THEN valor ELSE 0 END) AS receitas,
              SUM(CASE WHEN tipo = 'despesa' AND pagamento IS NOT NULL THEN valor ELSE 0 END) AS despesas,
              SUM(CASE WHEN tipo = 'receita' AND pagamento IS NULL THEN valor ELSE 0 END) AS receitas_previstas,
              SUM(CASE WHEN tipo = 'despesa' AND pagamento IS NULL THEN valor ELSE 0 END) AS despesas_previstas
         FROM lancamentos
        WHERE empresa_id = :e AND COALESCE(pagamento, vencimento) BETWEEN :i AND :f
        GROUP BY mes`
    )
    .all({ e: empresaId, i: inicioMeses, f: fimMeses });
  const mapa = Object.fromEntries(porMes.map((m) => [m.mes, m]));
  const fluxo_mensal = [];
  for (let i = 0; i < 12; i++) {
    const mes = addMonths(inicioMeses, i).slice(0, 7);
    const m = mapa[mes] || {};
    fluxo_mensal.push({
      mes,
      receitas: r2(m.receitas),
      despesas: r2(m.despesas),
      resultado: r2((m.receitas || 0) - (m.despesas || 0)),
      receitas_previstas: r2(m.receitas_previstas),
      despesas_previstas: r2(m.despesas_previstas),
    });
  }

  const porCategoria = (tipo) =>
    db
      .prepare(
        `SELECT COALESCE(c.nome, 'Sem categoria') AS categoria, SUM(l.valor) AS valor, COUNT(*) AS quantidade
           FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
          WHERE l.empresa_id = :e AND l.tipo = :t AND l.pagamento BETWEEN :i AND :f
          GROUP BY categoria ORDER BY valor DESC`
      )
      .all({ e: empresaId, t: tipo, i: inicio, f: fim })
      .map((r) => ({ ...r, valor: r2(r.valor) }));

  const maioresContrapartes = (tipo) =>
    db
      .prepare(
        `SELECT contraparte, SUM(valor) AS valor FROM lancamentos
          WHERE empresa_id = :e AND tipo = :t AND pagamento BETWEEN :i AND :f AND contraparte IS NOT NULL
          GROUP BY contraparte ORDER BY valor DESC LIMIT 5`
      )
      .all({ e: empresaId, t: tipo, i: inicio, f: fim })
      .map((r) => ({ ...r, valor: r2(r.valor) }));

  const contas = saldosPorConta(db, empresaId);
  const resultado = realizado.receitas - realizado.despesas;

  return {
    periodo: { inicio, fim },
    kpis: {
      receitas: r2(realizado.receitas),
      despesas: r2(realizado.despesas),
      resultado: r2(resultado),
      margem: realizado.receitas ? r2((resultado / realizado.receitas) * 100) : 0,
      saldo_bancario: r2(contas.reduce((s, c) => s + c.saldo, 0)),
      a_receber: r2(pendente.a_receber),
      a_pagar: r2(pendente.a_pagar),
      receber_atrasado: r2(pendente.receber_atrasado),
      pagar_atrasado: r2(pendente.pagar_atrasado),
      inadimplencia: pendente.a_receber ? r2((pendente.receber_atrasado / pendente.a_receber) * 100) : 0,
      extrato_pendente: conc.total - conc.conciliadas,
      conciliacao_percentual: conc.total ? r2((conc.conciliadas / conc.total) * 100) : 100,
    },
    fluxo_mensal,
    despesas_por_categoria: porCategoria('despesa'),
    receitas_por_categoria: porCategoria('receita'),
    maiores_clientes: maioresContrapartes('receita'),
    maiores_fornecedores: maioresContrapartes('despesa'),
    aging_receber: aging(db, empresaId, 'receita', ref),
    aging_pagar: aging(db, empresaId, 'despesa', ref),
    contas,
  };
}

function biEmpresaRouter(db) {
  const router = express.Router({ mergeParams: true });
  router.get('/', (req, res) => res.json(biEmpresa(db, req.empresa.id, req.query)));
  return router;
}

/** Portfolio view for the BPO team: one row per client company. */
function biCarteiraRouter(db) {
  const router = express.Router();
  router.get('/carteira', exigirPapel('admin', 'analista'), (req, res) => {
    const { inicio, fim } = periodo(req.query);
    const empresas = db
      .prepare(
        `SELECT e.id, e.razao_social, e.nome_fantasia, e.ativo,
                (SELECT COALESCE(SUM(valor), 0) FROM lancamentos WHERE empresa_id = e.id AND tipo = 'receita' AND pagamento BETWEEN :i AND :f) AS receitas,
                (SELECT COALESCE(SUM(valor), 0) FROM lancamentos WHERE empresa_id = e.id AND tipo = 'despesa' AND pagamento BETWEEN :i AND :f) AS despesas,
                (SELECT COUNT(*) FROM lancamentos WHERE empresa_id = e.id AND pagamento IS NULL AND vencimento < :h) AS atrasados,
                (SELECT COALESCE(SUM(valor), 0) FROM lancamentos WHERE empresa_id = e.id AND pagamento IS NULL AND vencimento < :h AND tipo = 'despesa') AS pagar_atrasado,
                (SELECT COALESCE(SUM(valor), 0) FROM lancamentos WHERE empresa_id = e.id AND pagamento IS NULL AND vencimento < :h AND tipo = 'receita') AS receber_atrasado,
                (SELECT COUNT(*) FROM lancamentos WHERE empresa_id = e.id AND pagamento IS NULL AND vencimento BETWEEN :h AND :h7) AS vencendo_7d,
                (SELECT COUNT(*) FROM extrato WHERE empresa_id = e.id AND lancamento_id IS NULL) AS extrato_pendente,
                (SELECT MAX(importado_em) FROM extrato WHERE empresa_id = e.id) AS ultima_importacao
           FROM empresas e
          ORDER BY e.ativo DESC, e.razao_social COLLATE NOCASE`
      )
      .all({ i: inicio, f: fim, h: hoje(), h7: addDays(hoje(), 7) })
      .map((e) => ({ ...e, receitas: r2(e.receitas), despesas: r2(e.despesas), resultado: r2(e.receitas - e.despesas) }));

    const soma = (k) => r2(empresas.reduce((s, e) => s + e[k], 0));
    res.json({
      periodo: { inicio, fim },
      totais: {
        empresas: empresas.filter((e) => e.ativo).length,
        receitas: soma('receitas'),
        despesas: soma('despesas'),
        resultado: soma('resultado'),
        atrasados: soma('atrasados'),
        extrato_pendente: soma('extrato_pendente'),
      },
      empresas,
    });
  });
  return router;
}

module.exports = { biEmpresaRouter, biCarteiraRouter, biEmpresa, saldosPorConta };
