const express = require('express');
const { transaction } = require('../db');
const { badRequest, notFound } = require('../errors');
const { periodo, addMonths, inicioDoMes, fimDoMes } = require('../lib/datas');
const { r2, indicadoresEquipe, notasPorColaborador, alertasColaborador, alertasPilares, ordenarAlertas } = require('../lib/indicadores');

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function pessoasRouter(db) {
  const router = express.Router({ mergeParams: true });

  // Ranking da equipe com indicadores e a média de cada pilar no mês de referência.
  router.get('/', (req, res) => {
    const p = periodo(req.query);
    const equipe = indicadoresEquipe(db, req.empresa.id, p);
    const notas = notasPorColaborador(db, req.empresa.id, p.fim.slice(0, 7));
    const pilares = db.prepare('SELECT * FROM pilares ORDER BY ordem, nome').all();
    const somas = new Map();
    for (const { notas: ns } of notas.values()) {
      for (const n of ns) {
        const s = somas.get(n.pilar_id) || { soma: 0, n: 0 };
        s.soma += n.nota;
        s.n++;
        somas.set(n.pilar_id, s);
      }
    }
    const alertas = ordenarAlertas(equipe.filter((c) => c.ativo).flatMap((c) => [...alertasColaborador(c, equipe), ...alertasPilares(c, notas.get(c.id))]));
    res.json({
      periodo: p,
      equipe,
      pilares: pilares.map((pl) => ({ ...pl, media: somas.get(pl.id) ? r2(somas.get(pl.id).soma / somas.get(pl.id).n) : null })),
      alertas,
    });
  });

  router.get('/:cid', (req, res) => {
    const p = periodo(req.query);
    const empresaId = req.empresa.id;
    const equipe = indicadoresEquipe(db, empresaId, p);
    const c = equipe.find((e) => e.id === Number(req.params.cid));
    if (!c) throw notFound('Profissional não encontrado');

    const fimMeses = fimDoMes(p.fim);
    const inicioMeses = inicioDoMes(addMonths(fimMeses, -11));
    const porMes = Object.fromEntries(
      db
        .prepare(
          `SELECT substr(data, 1, 7) AS mes, SUM(valor) AS faturamento, COUNT(DISTINCT data || '|' || COALESCE(cliente, 'item' || id)) AS atendimentos
             FROM atendimentos WHERE colaborador_id = ? AND data BETWEEN ? AND ? GROUP BY mes`
        )
        .all(c.id, inicioMeses, fimMeses)
        .map((m) => [m.mes, m])
    );
    const mensal = Array.from({ length: 12 }, (_, i) => {
      const mes = addMonths(inicioMeses, i).slice(0, 7);
      return { mes, faturamento: r2(porMes[mes]?.faturamento), atendimentos: porMes[mes]?.atendimentos || 0, meta: r2(c.meta_mensal) };
    });

    const servicos = db
      .prepare(
        `SELECT item, tipo, COUNT(*) AS quantidade, SUM(valor) AS valor FROM atendimentos
          WHERE colaborador_id = ? AND data BETWEEN ? AND ? GROUP BY item, tipo ORDER BY valor DESC LIMIT 15`
      )
      .all(c.id, p.inicio, p.fim)
      .map((s) => ({ ...s, valor: r2(s.valor) }));

    const ultimos = db
      .prepare('SELECT data, cliente, item, tipo, valor, origem FROM atendimentos WHERE colaborador_id = ? AND data BETWEEN ? AND ? ORDER BY data DESC, id DESC LIMIT 40')
      .all(c.id, p.inicio, p.fim);

    // Notas: mês de referência = mês do fim do período, com o mês anterior para comparar.
    const mes = MES_RE.test(req.query.mes || '') ? req.query.mes : p.fim.slice(0, 7);
    const mesAnt = addMonths(mes + '-01', -1).slice(0, 7);
    const notasDe = (m) => new Map(db.prepare('SELECT pilar_id, nota FROM avaliacoes WHERE colaborador_id = ? AND mes = ?').all(c.id, m).map((n) => [n.pilar_id, n.nota]));
    const atual = notasDe(mes);
    const anterior = notasDe(mesAnt);
    const pilares = db
      .prepare('SELECT * FROM pilares ORDER BY ordem, nome')
      .all()
      .map((pl) => ({ ...pl, nota: atual.get(pl.id) ?? null, nota_anterior: anterior.get(pl.id) ?? null }));
    const historico = db
      .prepare('SELECT mes, AVG(nota) AS media FROM avaliacoes WHERE colaborador_id = ? GROUP BY mes ORDER BY mes DESC LIMIT 6')
      .all(c.id)
      .reverse()
      .map((h) => ({ ...h, media: r2(h.media) }));

    const notas = notasPorColaborador(db, empresaId, p.fim.slice(0, 7));
    const ativos = equipe.filter((e) => e.ativo && e.atendimentos);
    const acoes = db
      .prepare("SELECT * FROM acoes WHERE colaborador_id = ? ORDER BY status = 'concluida', COALESCE(prazo, '9999'), id DESC")
      .all(c.id);

    res.json({
      periodo: p,
      colaborador: c,
      posicao: equipe.filter((e) => e.ativo).findIndex((e) => e.id === c.id) + 1,
      equipe_total: equipe.filter((e) => e.ativo).length,
      media_equipe: {
        faturamento: ativos.length ? r2(ativos.reduce((s, e) => s + e.faturamento, 0) / ativos.length) : 0,
        ticket_medio: ativos.length ? r2(ativos.reduce((s, e) => s + e.faturamento, 0) / (ativos.reduce((s, e) => s + e.atendimentos, 0) || 1)) : 0,
      },
      mensal,
      servicos,
      ultimos,
      mes_avaliacao: mes,
      pilares,
      historico,
      acoes,
      alertas: ordenarAlertas([...alertasColaborador(c, equipe), ...alertasPilares(c, notas.get(c.id))]),
    });
  });

  // Grava as notas dos pilares de um mês: { mes: 'AAAA-MM', notas: { [pilar_id]: nota | null } }.
  router.put('/:cid/avaliacao', (req, res) => {
    const c = db.prepare('SELECT id FROM colaboradores WHERE id = ? AND empresa_id = ?').get(req.params.cid, req.empresa.id);
    if (!c) throw notFound('Profissional não encontrado');
    const { mes, notas } = req.body || {};
    if (!MES_RE.test(mes || '')) throw badRequest('Mês inválido (use AAAA-MM)');
    if (!notas || typeof notas !== 'object') throw badRequest('Informe as notas');
    const pilares = new Set(db.prepare('SELECT id FROM pilares').all().map((p) => p.id));
    transaction(db, () => {
      for (const [pilar, valor] of Object.entries(notas)) {
        if (!pilares.has(Number(pilar))) throw badRequest('Pilar inexistente');
        if (valor === null || valor === '') {
          db.prepare('DELETE FROM avaliacoes WHERE colaborador_id = ? AND pilar_id = ? AND mes = ?').run(c.id, pilar, mes);
          continue;
        }
        const nota = Number(valor);
        if (!Number.isFinite(nota) || nota < 0 || nota > 10) throw badRequest('As notas vão de 0 a 10');
        db.prepare(
          `INSERT INTO avaliacoes (colaborador_id, pilar_id, mes, nota) VALUES (?, ?, ?, ?)
           ON CONFLICT (colaborador_id, pilar_id, mes) DO UPDATE SET nota = excluded.nota`
        ).run(c.id, pilar, mes, r2(nota));
      }
    });
    res.status(204).end();
  });

  return router;
}

module.exports = { pessoasRouter };
