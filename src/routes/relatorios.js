const express = require('express');
const { badRequest } = require('../errors');
const { hoje, periodo, addMonths, inicioDoMes } = require('../lib/datas');
const { saldosPorConta } = require('./bi');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---------- CSV (padrão Excel Brasil: ";" e vírgula decimal) ----------

function celula(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function enviarCsv(res, nome, cabecalho, linhas) {
  const corpo = [cabecalho, ...linhas].map((l) => l.map(celula).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}.csv"`);
  res.send('﻿' + corpo);
}

// ---------- DRE ----------

const ESTRUTURA_DRE = [
  { chave: 'receita_operacional', titulo: 'Receita operacional bruta', sinal: 1 },
  { chave: 'deducoes', titulo: '(−) Deduções e impostos sobre vendas', sinal: -1 },
  { total: 'receita_liquida', titulo: '= Receita líquida', de: ['receita_operacional', 'deducoes'] },
  { chave: 'custos', titulo: '(−) Custos', sinal: -1 },
  { total: 'lucro_bruto', titulo: '= Lucro bruto', de: ['receita_liquida', 'custos'] },
  { chave: 'despesas_operacionais', titulo: '(−) Despesas operacionais', sinal: -1 },
  { total: 'resultado_operacional', titulo: '= Resultado operacional (EBITDA)', de: ['lucro_bruto', 'despesas_operacionais'] },
  { chave: 'receitas_financeiras', titulo: '(+) Receitas financeiras', sinal: 1 },
  { chave: 'despesas_financeiras', titulo: '(−) Despesas financeiras', sinal: -1 },
  { chave: 'outros', titulo: '(±) Outras receitas e despesas', sinal: 1 },
  { total: 'resultado_liquido', titulo: '= Resultado líquido', de: ['resultado_operacional', 'receitas_financeiras', 'despesas_financeiras', 'outros'] },
];

function mesesEntre(inicio, fim) {
  const meses = [];
  for (let m = inicioDoMes(inicio); m <= fim && meses.length < 24; m = addMonths(m, 1)) meses.push(m.slice(0, 7));
  return meses;
}

function dre(db, empresaId, { inicio, fim, regime }) {
  const campo = regime === 'competencia' ? 'l.competencia' : 'l.pagamento';
  const linhas = db
    .prepare(
      `SELECT COALESCE(c.grupo, 'outros') AS grupo, COALESCE(c.nome, 'Sem categoria') AS categoria,
              l.tipo, substr(${campo}, 1, 7) AS mes, SUM(l.valor) AS valor
         FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
        WHERE l.empresa_id = :e AND ${campo} BETWEEN :i AND :f
        GROUP BY grupo, categoria, l.tipo, mes`
    )
    .all({ e: empresaId, i: inicio, f: fim });

  const meses = mesesEntre(inicio, fim);
  const zeros = () => Object.fromEntries([...meses, 'total'].map((m) => [m, 0]));
  const grupos = {};
  for (const l of linhas) {
    // Signed so that revenue adds and expense subtracts, whatever group it is filed under.
    const v = l.tipo === 'receita' ? l.valor : -l.valor;
    const g = (grupos[l.grupo] ??= { valores: zeros(), categorias: {} });
    const cat = (g.categorias[l.categoria] ??= zeros());
    for (const alvo of [g.valores, cat]) {
      alvo[l.mes] = (alvo[l.mes] || 0) + v;
      alvo.total += v;
    }
  }

  const acumulado = {};
  const resultado = ESTRUTURA_DRE.map((item) => {
    let valores;
    let categorias = [];
    if (item.chave) {
      const g = grupos[item.chave];
      valores = g ? g.valores : zeros();
      categorias = g ? Object.entries(g.categorias).map(([nome, v]) => ({ nome, valores: arredValores(v) })) : [];
      acumulado[item.chave] = valores;
    } else {
      valores = zeros();
      for (const k of item.de) for (const m of Object.keys(valores)) valores[m] += acumulado[k][m];
      acumulado[item.total] = valores;
    }
    return { titulo: item.titulo, total: !!item.total, valores: arredValores(valores), categorias };
  });

  const receita = acumulado.receita_operacional.total;
  return {
    periodo: { inicio, fim },
    regime: regime === 'competencia' ? 'competencia' : 'caixa',
    meses,
    linhas: resultado,
    margem_liquida: receita ? r2((acumulado.resultado_liquido.total / receita) * 100) : 0,
  };
}

function arredValores(v) {
  return Object.fromEntries(Object.entries(v).map(([k, n]) => [k, r2(n)]));
}

// ---------- Fluxo de caixa ----------

function fluxoCaixa(db, empresaId, { inicio, fim, agrupar }) {
  const saldoInicialContas = db.prepare('SELECT COALESCE(SUM(saldo_inicial), 0) AS s FROM contas_bancarias WHERE empresa_id = ?').get(empresaId).s;
  const anterior = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor ELSE -valor END), 0) AS s
         FROM lancamentos WHERE empresa_id = ? AND pagamento < ?`
    )
    .get(empresaId, inicio).s;
  const tamanho = agrupar === 'dia' ? 10 : 7;
  const periodos = db
    .prepare(
      `SELECT substr(pagamento, 1, ${tamanho}) AS periodo,
              SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS entradas,
              SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS saidas
         FROM lancamentos WHERE empresa_id = ? AND pagamento BETWEEN ? AND ?
        GROUP BY periodo ORDER BY periodo`
    )
    .all(empresaId, inicio, fim);

  let saldo = saldoInicialContas + anterior;
  const saldo_inicial = r2(saldo);
  const linhas = periodos.map((p) => {
    saldo += p.entradas - p.saidas;
    return { periodo: p.periodo, entradas: r2(p.entradas), saidas: r2(p.saidas), liquido: r2(p.entradas - p.saidas), saldo: r2(saldo) };
  });
  return {
    periodo: { inicio, fim },
    agrupar: tamanho === 10 ? 'dia' : 'mes',
    saldo_inicial,
    saldo_final: r2(saldo),
    total_entradas: r2(linhas.reduce((s, l) => s + l.entradas, 0)),
    total_saidas: r2(linhas.reduce((s, l) => s + l.saidas, 0)),
    linhas,
  };
}

// ---------- Contas a pagar / receber ----------

function contas(db, empresaId, { tipo, status, inicio, fim }) {
  const where = ['l.empresa_id = :e', 'l.vencimento BETWEEN :i AND :f'];
  const params = { e: empresaId, i: inicio, f: fim, h: hoje() };
  if (tipo === 'receita' || tipo === 'despesa') {
    where.push('l.tipo = :t');
    params.t = tipo;
  }
  if (status === 'pago') where.push('l.pagamento IS NOT NULL');
  if (status === 'pendente') where.push('l.pagamento IS NULL');
  if (status === 'atrasado') where.push('l.pagamento IS NULL AND l.vencimento < :h');
  const linhas = db
    .prepare(
      `SELECT l.id, l.tipo, l.descricao, l.contraparte, c.nome AS categoria, l.documento, l.vencimento, l.pagamento, l.valor,
              CASE WHEN l.pagamento IS NOT NULL THEN 'pago' WHEN l.vencimento < :h THEN 'atrasado' ELSE 'aberto' END AS status
         FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.vencimento, l.id`
    )
    .all(params);
  const soma = (f) => r2(linhas.filter(f).reduce((s, l) => s + l.valor, 0));
  return {
    periodo: { inicio, fim },
    linhas,
    totais: {
      total: soma(() => true),
      pago: soma((l) => l.status === 'pago'),
      aberto: soma((l) => l.status === 'aberto'),
      atrasado: soma((l) => l.status === 'atrasado'),
    },
  };
}

// ---------- Conciliação ----------

function conciliacao(db, empresaId, { inicio, fim }) {
  const saldos = Object.fromEntries(saldosPorConta(db, empresaId).map((c) => [c.id, c.saldo]));
  const porConta = db
    .prepare(
      `SELECT cb.id, cb.descricao, cb.banco, cb.saldo_inicial,
              COUNT(x.id) AS transacoes, COUNT(x.lancamento_id) AS conciliadas,
              (SELECT COALESCE(SUM(valor), 0) FROM extrato WHERE conta_id = cb.id) AS movimento_extrato
         FROM contas_bancarias cb
         LEFT JOIN extrato x ON x.conta_id = cb.id AND x.data BETWEEN :i AND :f
        WHERE cb.empresa_id = :e
        GROUP BY cb.id ORDER BY cb.descricao`
    )
    .all({ e: empresaId, i: inicio, f: fim })
    .map((c) => {
      const saldoExtrato = r2(c.saldo_inicial + c.movimento_extrato);
      return {
        id: c.id,
        descricao: c.descricao,
        banco: c.banco,
        transacoes: c.transacoes,
        conciliadas: c.conciliadas,
        pendentes: c.transacoes - c.conciliadas,
        saldo_extrato: saldoExtrato,
        saldo_sistema: saldos[c.id],
        diferenca: r2(saldoExtrato - saldos[c.id]),
      };
    });
  const pendentes = db
    .prepare(
      `SELECT x.data, cb.descricao AS conta, x.descricao, x.valor FROM extrato x
         JOIN contas_bancarias cb ON cb.id = x.conta_id
        WHERE x.empresa_id = ? AND x.lancamento_id IS NULL AND x.data BETWEEN ? AND ?
        ORDER BY x.data`
    )
    .all(empresaId, inicio, fim);
  return { periodo: { inicio, fim }, contas: porConta, pendentes };
}

// ---------- Rotas ----------

const brData = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

function relatoriosRouter(db) {
  const router = express.Router({ mergeParams: true });
  const csv = (req) => req.query.formato === 'csv';
  const nome = (req, rel) => `${rel}-${req.empresa.id}-${periodo(req.query).inicio}`;

  router.get('/dre', (req, res) => {
    const r = dre(db, req.empresa.id, { ...periodo(req.query), regime: req.query.regime });
    if (!csv(req)) return res.json(r);
    const linhas = [];
    for (const l of r.linhas) {
      linhas.push([l.titulo, ...r.meses.map((m) => l.valores[m]), l.valores.total]);
      for (const c of l.categorias) linhas.push([`    ${c.nome}`, ...r.meses.map((m) => c.valores[m]), c.valores.total]);
    }
    enviarCsv(res, nome(req, 'dre'), ['Conta', ...r.meses, 'Total'], linhas);
  });

  router.get('/fluxo-caixa', (req, res) => {
    const r = fluxoCaixa(db, req.empresa.id, { ...periodo(req.query), agrupar: req.query.agrupar });
    if (!csv(req)) return res.json(r);
    enviarCsv(
      res,
      nome(req, 'fluxo-caixa'),
      ['Período', 'Entradas', 'Saídas', 'Líquido', 'Saldo'],
      [['Saldo inicial', '', '', '', r.saldo_inicial], ...r.linhas.map((l) => [l.periodo, l.entradas, l.saidas, l.liquido, l.saldo])]
    );
  });

  router.get('/contas', (req, res) => {
    const r = contas(db, req.empresa.id, { ...periodo(req.query), tipo: req.query.tipo, status: req.query.status });
    if (!csv(req)) return res.json(r);
    enviarCsv(
      res,
      nome(req, 'contas'),
      ['Tipo', 'Descrição', 'Cliente/Fornecedor', 'Categoria', 'Documento', 'Vencimento', 'Pagamento', 'Status', 'Valor'],
      r.linhas.map((l) => [l.tipo, l.descricao, l.contraparte, l.categoria, l.documento, brData(l.vencimento), brData(l.pagamento), l.status, l.valor])
    );
  });

  router.get('/conciliacao', (req, res) => {
    const r = conciliacao(db, req.empresa.id, periodo(req.query));
    if (!csv(req)) return res.json(r);
    enviarCsv(
      res,
      nome(req, 'conciliacao'),
      ['Conta', 'Transações', 'Conciliadas', 'Pendentes', 'Saldo extrato', 'Saldo sistema', 'Diferença'],
      r.contas.map((c) => [c.descricao, c.transacoes, c.conciliadas, c.pendentes, c.saldo_extrato, c.saldo_sistema, c.diferenca])
    );
  });

  router.get('/:outro', () => {
    throw badRequest('Relatório desconhecido');
  });

  return router;
}

module.exports = { relatoriosRouter, dre, fluxoCaixa };
