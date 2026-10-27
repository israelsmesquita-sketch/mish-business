const express = require('express');
const { transaction } = require('../db');
const { badRequest, notFound } = require('../errors');

const FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto'];

const round2 = (n) => Math.round(n * 100) / 100;

function vendasRouter(db) {
  const router = express.Router();

  function findVenda(id) {
    const venda = db
      .prepare(
        `SELECT v.*, c.nome AS cliente_nome
           FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
          WHERE v.id = ?`
      )
      .get(id);
    if (!venda) throw notFound('Venda não encontrada');
    venda.itens = db
      .prepare(
        `SELECT i.*, p.nome AS produto_nome
           FROM venda_itens i JOIN produtos p ON p.id = i.produto_id
          WHERE i.venda_id = ?`
      )
      .all(id);
    return venda;
  }

  router.get('/', (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT v.*, c.nome AS cliente_nome,
                  (SELECT COALESCE(SUM(quantidade), 0) FROM venda_itens WHERE venda_id = v.id) AS itens_qtd
             FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
            ORDER BY v.id DESC`
        )
        .all()
    );
  });

  router.get('/:id', (req, res) => res.json(findVenda(req.params.id)));

  // Creates the sale, decrements stock and records the revenue in a single transaction.
  router.post('/', (req, res) => {
    const { cliente_id, itens, desconto = 0, forma_pagamento = 'dinheiro' } = req.body || {};

    if (!Array.isArray(itens) || itens.length === 0) throw badRequest('A venda precisa de pelo menos um item');
    if (!FORMAS_PAGAMENTO.includes(forma_pagamento)) throw badRequest('Forma de pagamento inválida');
    const descontoNum = Number(desconto);
    if (!Number.isFinite(descontoNum) || descontoNum < 0) throw badRequest('Desconto inválido');

    const id = transaction(db, () => {
      if (cliente_id != null && cliente_id !== '') {
        if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(cliente_id)) throw badRequest('Cliente não encontrado');
      }

      let subtotal = 0;
      const linhas = itens.map((item) => {
        const quantidade = Number(item.quantidade);
        if (!Number.isInteger(quantidade) || quantidade <= 0) throw badRequest('Quantidade inválida');
        const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(item.produto_id);
        if (!produto) throw badRequest(`Produto ${item.produto_id} não encontrado`);
        if (produto.estoque < quantidade) throw badRequest(`Estoque insuficiente para "${produto.nome}" (disponível: ${produto.estoque})`);
        subtotal += produto.preco * quantidade;
        return { produto, quantidade };
      });

      if (descontoNum > subtotal) throw badRequest('O desconto não pode ser maior que o subtotal');
      const total = round2(subtotal - descontoNum);

      const { lastInsertRowid: vendaId } = db
        .prepare('INSERT INTO vendas (cliente_id, total, desconto, forma_pagamento) VALUES (?, ?, ?, ?)')
        .run(cliente_id || null, total, round2(descontoNum), forma_pagamento);

      const insertItem = db.prepare('INSERT INTO venda_itens (venda_id, produto_id, quantidade, preco_unitario) VALUES (?, ?, ?, ?)');
      const baixaEstoque = db.prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?');
      for (const { produto, quantidade } of linhas) {
        insertItem.run(vendaId, produto.id, quantidade, produto.preco);
        baixaEstoque.run(quantidade, produto.id);
      }

      if (total > 0) {
        db.prepare("INSERT INTO lancamentos (tipo, descricao, categoria, valor, venda_id) VALUES ('receita', ?, 'Vendas', ?, ?)")
          .run(`Venda #${vendaId}`, total, vendaId);
      }
      return vendaId;
    });

    res.status(201).json(findVenda(id));
  });

  // Cancelling returns items to stock and removes the linked revenue entry.
  router.post('/:id/cancelar', (req, res) => {
    const venda = findVenda(req.params.id);
    if (venda.status === 'cancelada') throw badRequest('Esta venda já foi cancelada');

    transaction(db, () => {
      const devolve = db.prepare('UPDATE produtos SET estoque = estoque + ? WHERE id = ?');
      for (const item of venda.itens) devolve.run(item.quantidade, item.produto_id);
      db.prepare("UPDATE vendas SET status = 'cancelada' WHERE id = ?").run(venda.id);
      db.prepare('DELETE FROM lancamentos WHERE venda_id = ?').run(venda.id);
    });

    res.json(findVenda(venda.id));
  });

  return router;
}

module.exports = { vendasRouter, FORMAS_PAGAMENTO };
