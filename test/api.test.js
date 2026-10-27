const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;

before(async () => {
  server = createApp(openDatabase(':memory:')).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

async function call(path, method = 'GET', body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

test('health check', async () => {
  const { status, body } = await call('/health');
  assert.equal(status, 200);
  assert.equal(body.versao, '1.0.0');
});

test('CRUD de clientes com busca e validação', async () => {
  assert.equal((await call('/clientes', 'POST', { email: 'x@y.com' })).status, 400);

  const { status, body: cliente } = await call('/clientes', 'POST', { nome: 'Maria Teste', email: 'maria@teste.com' });
  assert.equal(status, 201);
  assert.equal(cliente.nome, 'Maria Teste');

  const busca = await call('/clientes?q=maria');
  assert.equal(busca.body.length, 1);

  const editado = await call(`/clientes/${cliente.id}`, 'PUT', { telefone: '1199999' });
  assert.equal(editado.body.telefone, '1199999');
  assert.equal(editado.body.nome, 'Maria Teste');

  assert.equal((await call(`/clientes/${cliente.id}`, 'DELETE')).status, 204);
  assert.equal((await call(`/clientes/${cliente.id}`)).status, 404);
});

test('produtos rejeitam valores negativos e SKU duplicado', async () => {
  assert.equal((await call('/produtos', 'POST', { nome: 'X', preco: -1 })).status, 400);
  assert.equal((await call('/produtos', 'POST', { nome: 'A', sku: 'DUP', preco: 1 })).status, 201);
  assert.equal((await call('/produtos', 'POST', { nome: 'B', sku: 'DUP', preco: 1 })).status, 409);
});

test('venda baixa estoque, gera receita e cancelamento reverte', async () => {
  const { body: produto } = await call('/produtos', 'POST', { nome: 'Caneca', preco: 25, custo: 10, estoque: 10 });
  const { body: cliente } = await call('/clientes', 'POST', { nome: 'João' });

  const { status, body: venda } = await call('/vendas', 'POST', {
    cliente_id: cliente.id,
    itens: [{ produto_id: produto.id, quantidade: 3 }],
    desconto: 5,
    forma_pagamento: 'pix',
  });
  assert.equal(status, 201);
  assert.equal(venda.total, 70);
  assert.equal(venda.itens.length, 1);
  assert.equal((await call(`/produtos/${produto.id}`)).body.estoque, 7);

  const receitas = (await call('/lancamentos')).body.filter((l) => l.venda_id === venda.id);
  assert.equal(receitas.length, 1);
  assert.equal(receitas[0].valor, 70);

  const dash = await call('/dashboard');
  assert.equal(dash.body.vendas_mes.total, 70);
  assert.equal(dash.body.mais_vendidos[0].nome, 'Caneca');

  const cancelada = await call(`/vendas/${venda.id}/cancelar`, 'POST');
  assert.equal(cancelada.body.status, 'cancelada');
  assert.equal((await call(`/produtos/${produto.id}`)).body.estoque, 10);
  assert.equal((await call('/lancamentos')).body.filter((l) => l.venda_id === venda.id).length, 0);
  assert.equal((await call(`/vendas/${venda.id}/cancelar`, 'POST')).status, 400);
});

test('venda falha sem estoque suficiente e não altera nada', async () => {
  const { body: produto } = await call('/produtos', 'POST', { nome: 'Raro', preco: 100, estoque: 1 });
  const res = await call('/vendas', 'POST', { itens: [{ produto_id: produto.id, quantidade: 2 }] });
  assert.equal(res.status, 400);
  assert.match(res.body.erro, /Estoque insuficiente/);
  assert.equal((await call(`/produtos/${produto.id}`)).body.estoque, 1);
});

test('produto vendido não pode ser excluído', async () => {
  const { body: produto } = await call('/produtos', 'POST', { nome: 'Vendido', preco: 5, estoque: 5 });
  await call('/vendas', 'POST', { itens: [{ produto_id: produto.id, quantidade: 1 }] });
  assert.equal((await call(`/produtos/${produto.id}`, 'DELETE')).status, 409);
});
