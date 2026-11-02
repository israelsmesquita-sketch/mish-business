const express = require('express');
const { isEquipe } = require('../lib/auth');
const { periodo } = require('../lib/datas');
const { r2, variacao, periodoAnterior, resumoSalao, serieMensal, ordenarAlertas, vendas, financeiro } = require('../lib/indicadores');

/** Painel de gestão: todos os salões que o usuário acessa, lado a lado. */
function painelRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const p = periodo(req.query);
    const empresas = isEquipe(req.user)
      ? db.prepare('SELECT * FROM empresas WHERE ativo = 1 ORDER BY razao_social COLLATE NOCASE').all()
      : db.prepare('SELECT * FROM empresas WHERE id = ?').all(req.user.empresa_id);
    const saloes = empresas.map((e) => ({ ...resumoSalao(db, e, p), serie: serieMensal(db, [e.id], p.fim) }));

    const soma = (f) => r2(saloes.reduce((s, x) => s + f(x), 0));
    const ant = periodoAnterior(p);
    const finAnt = empresas.map((e) => financeiro(db, e.id, ant));
    const receitasAnt = finAnt.reduce((s, f) => s + f.receitas, 0);
    const despesasAnt = finAnt.reduce((s, f) => s + f.despesas, 0);
    const faturamentoAnt = empresas.reduce((s, e) => s + vendas(db, e.id, ant).faturamento, 0);
    const receitas = soma((s) => s.financeiro.receitas);
    const despesas = soma((s) => s.financeiro.despesas);
    const faturamento = soma((s) => s.vendas.faturamento);
    const atendimentos = saloes.reduce((s, x) => s + x.vendas.atendimentos, 0);

    res.json({
      periodo: p,
      periodo_anterior: ant,
      totais: {
        receitas,
        despesas,
        resultado: r2(receitas - despesas),
        margem: receitas ? r2(((receitas - despesas) / receitas) * 100) : 0,
        faturamento,
        atendimentos,
        ticket_medio: atendimentos ? r2(faturamento / atendimentos) : 0,
        variacao_receitas: variacao(receitas, receitasAnt),
        variacao_faturamento: variacao(faturamento, faturamentoAnt),
        variacao_despesas: variacao(despesas, despesasAnt),
        acoes_abertas: saloes.reduce((s, x) => s + x.acoes_abertas, 0),
      },
      serie: serieMensal(db, empresas.map((e) => e.id), p.fim),
      saloes,
      ranking: saloes
        .flatMap((s) => s.equipe.map((c) => ({ ...c, empresa_id: s.id, salao: s.nome })))
        .sort((a, b) => b.faturamento - a.faturamento),
      alertas: ordenarAlertas(saloes.flatMap((s) => s.alertas.map((a) => ({ ...a, empresa_id: s.id, salao: s.nome })))),
    });
  });

  return router;
}

module.exports = { painelRouter };
