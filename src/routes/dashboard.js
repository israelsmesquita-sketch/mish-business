const express = require('express');

function dashboardRouter(db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const one = (sql, ...params) => db.prepare(sql).get(...params);

    const financeiro = one(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor END), 0) AS receitas,
              COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor END), 0) AS despesas
         FROM lancamentos
        WHERE strftime('%Y-%m', data) = strftime('%Y-%m', 'now')`
    );

    const vendasMes = one(
      `SELECT COUNT(*) AS quantidade, COALESCE(SUM(total), 0) AS total
         FROM vendas
        WHERE status = 'concluida' AND strftime('%Y-%m', data) = strftime('%Y-%m', 'now')`
    );

    res.json({
      clientes: one('SELECT COUNT(*) AS n FROM clientes').n,
      produtos: one('SELECT COUNT(*) AS n FROM produtos').n,
      vendas_mes: {
        quantidade: vendasMes.quantidade,
        total: vendasMes.total,
        ticket_medio: vendasMes.quantidade ? Math.round((vendasMes.total / vendasMes.quantidade) * 100) / 100 : 0,
      },
      financeiro_mes: { ...financeiro, saldo: Math.round((financeiro.receitas - financeiro.despesas) * 100) / 100 },
      estoque_baixo: db
        .prepare('SELECT id, nome, estoque, estoque_minimo FROM produtos WHERE estoque <= estoque_minimo ORDER BY estoque ASC LIMIT 10')
        .all(),
      mais_vendidos: db
        .prepare(
          `SELECT p.id, p.nome, SUM(i.quantidade) AS quantidade, SUM(i.quantidade * i.preco_unitario) AS faturamento
             FROM venda_itens i
             JOIN vendas v ON v.id = i.venda_id AND v.status = 'concluida'
             JOIN produtos p ON p.id = i.produto_id
            GROUP BY p.id ORDER BY quantidade DESC LIMIT 5`
        )
        .all(),
      ultimas_vendas: db
        .prepare(
          `SELECT v.id, v.total, v.status, v.data, c.nome AS cliente_nome
             FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
            ORDER BY v.id DESC LIMIT 5`
        )
        .all(),
    });
  });

  return router;
}

module.exports = { dashboardRouter };
