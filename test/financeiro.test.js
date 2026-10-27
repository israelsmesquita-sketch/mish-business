const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, cliente } = require('./helpers');
const { hoje, addDays, inicioDoMes, fimDoMes } = require('../src/lib/datas');

let ctx;
let api;
let emp;
let conta;
let cat;

before(async () => {
  ctx = await iniciar();
  api = cliente(ctx.base);
  await api.login('admin@teste.com');
  emp = (await api('/empresas', 'POST', { razao_social: 'Cliente BPO LTDA' })).body;
  conta = (await api(`/empresas/${emp.id}/contas`, 'POST', { descricao: 'Conta Itaú', banco: 'Itaú', saldo_inicial: 1000 })).body;
  const categorias = (await api(`/empresas/${emp.id}/categorias`)).body;
  cat = Object.fromEntries(categorias.map((c) => [c.nome, c.id]));
});
after(() => ctx.server.close());

const url = (p) => `/empresas/${emp.id}${p}`;

test('nova empresa recebe plano de contas padrão', () => {
  assert.ok(cat['Prestação de serviços']);
  assert.ok(cat['Tarifas bancárias']);
});

test('lançamentos: criação, parcelas, status, baixa e estorno', async () => {
  const atrasado = await api(url('/lancamentos'), 'POST', {
    tipo: 'receita', descricao: 'Serviço antigo', valor: 300, vencimento: addDays(hoje(), -10), categoria_id: cat['Prestação de serviços'],
  });
  assert.equal(atrasado.status, 201);
  assert.equal(atrasado.body.status, 'atrasado');

  const parcelas = await api(url('/lancamentos'), 'POST', {
    tipo: 'despesa', descricao: 'Notebook', valor: 500, vencimento: '2026-01-31', repetir: 3, categoria_id: cat['Outras despesas'],
  });
  assert.equal(parcelas.body.length, 3);
  assert.deepEqual(parcelas.body.map((p) => p.vencimento), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(parcelas.body[2].descricao, 'Notebook (3/3)');

  assert.equal((await api(url('/lancamentos'), 'POST', { tipo: 'receita', descricao: 'X', valor: 0, vencimento: hoje() })).status, 400);
  assert.equal((await api(url('/lancamentos'), 'POST', { tipo: 'receita', descricao: 'X', valor: 10, vencimento: '2026-02-30' })).status, 400);

  const baixa = await api(url(`/lancamentos/${atrasado.body.id}/baixar`), 'POST', { pagamento: hoje(), conta_id: conta.id });
  assert.equal(baixa.body.status, 'pago');
  assert.equal((await api(url('/lancamentos?status=pago'))).body.length, 1);

  const estorno = await api(url(`/lancamentos/${atrasado.body.id}/estornar`), 'POST');
  assert.equal(estorno.body.status, 'atrasado');
});

test('lançamentos de outra empresa não são acessíveis por esta', async () => {
  const outra = (await api('/empresas', 'POST', { razao_social: 'Outra' })).body;
  const l = (await api(`/empresas/${outra.id}/lancamentos`, 'POST', { tipo: 'receita', descricao: 'Y', valor: 1, vencimento: hoje() })).body;
  assert.equal((await api(url(`/lancamentos/${l.id}`))).status, 404);
  // Category from another company is rejected.
  const catOutra = (await api(`/empresas/${outra.id}/categorias`)).body[0];
  assert.equal((await api(url('/lancamentos'), 'POST', { tipo: 'receita', descricao: 'Z', valor: 1, vencimento: hoje(), categoria_id: catOutra.id })).status, 400);
});

test('conciliação: importa OFX, ignora duplicadas, concilia automática e manualmente', async () => {
  const d = (n) => addDays(hoje(), n).replace(/-/g, '');
  const ofx = `<OFX><BANKTRANLIST>
    <STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${d(-2)}120000<TRNAMT>1500.00<FITID>A1<MEMO>PIX RECEBIDO CLIENTE A</STMTTRN>
    <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${d(-1)}<TRNAMT>-800.50<FITID>A2<MEMO>BOLETO FORNECEDOR</STMTTRN>
    <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${d(0)}<TRNAMT>-35.00<FITID>A3<MEMO>TARIFA</STMTTRN>
    <STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${d(0)}<TRNAMT>-200.00<FITID>A4<MEMO>PAGTO DUPLO</STMTTRN>
  </BANKTRANLIST></OFX>`;

  const receber = (await api(url('/lancamentos'), 'POST', { tipo: 'receita', descricao: 'Fatura cliente A', valor: 1500, vencimento: addDays(hoje(), -3), conta_id: conta.id, categoria_id: cat['Prestação de serviços'] })).body;
  const pagar = (await api(url('/lancamentos'), 'POST', { tipo: 'despesa', descricao: 'Fornecedor', valor: 800.5, vencimento: hoje(), categoria_id: cat['Serviços de terceiros'] })).body;
  // Two identical candidates: automatic matching must not guess.
  await api(url('/lancamentos'), 'POST', { tipo: 'despesa', descricao: 'Dup 1', valor: 200, vencimento: hoje() });
  const dup2 = (await api(url('/lancamentos'), 'POST', { tipo: 'despesa', descricao: 'Dup 2', valor: 200, vencimento: hoje() })).body;

  const imp = await api(url('/conciliacao/importar'), 'POST', { conta_id: conta.id, formato: 'ofx', conteudo: ofx });
  assert.equal(imp.status, 201);
  assert.deepEqual(imp.body, { total: 4, importadas: 4, duplicadas: 0 });
  assert.equal((await api(url('/conciliacao/importar'), 'POST', { conta_id: conta.id, formato: 'ofx', conteudo: ofx })).body.duplicadas, 4);

  const pend = (await api(url('/conciliacao?status=pendente'))).body;
  assert.equal(pend.length, 4);
  assert.equal(pend.find((t) => t.fitid === 'A1').sugestoes[0].id, receber.id);

  const auto = (await api(url('/conciliacao/automatica'), 'POST', {})).body;
  assert.equal(auto.conciliadas, 2);
  assert.equal(auto.pendentes, 2);
  const pagarDepois = (await api(url(`/lancamentos/${pagar.id}`))).body;
  assert.equal(pagarDepois.status, 'pago');
  assert.equal(pagarDepois.conta_id, conta.id);

  const restantes = (await api(url('/conciliacao?status=pendente'))).body;
  const tarifa = restantes.find((t) => t.fitid === 'A3');
  const duplo = restantes.find((t) => t.fitid === 'A4');
  assert.equal(duplo.sugestoes.length, 2);

  // Wrong direction / wrong amount are rejected.
  assert.equal((await api(url(`/conciliacao/${duplo.id}/vincular`), 'POST', { lancamento_id: receber.id })).status, 400);
  assert.equal((await api(url(`/conciliacao/${duplo.id}/vincular`), 'POST', { lancamento_id: dup2.id })).status, 200);

  assert.equal((await api(url(`/conciliacao/${tarifa.id}/criar-lancamento`), 'POST', { categoria_id: cat['Prestação de serviços'] })).status, 400);
  const criado = await api(url(`/conciliacao/${tarifa.id}/criar-lancamento`), 'POST', { categoria_id: cat['Tarifas bancárias'] });
  assert.equal(criado.status, 201);
  assert.ok(criado.body.lancamento_id);

  assert.equal((await api(url('/conciliacao?status=pendente'))).body.length, 0);

  // A reconciled entry is locked until reconciliation is undone.
  assert.equal((await api(url(`/lancamentos/${pagar.id}`), 'PUT', { valor: 1 })).status, 400);
  assert.equal((await api(url(`/lancamentos/${pagar.id}`), 'DELETE')).status, 400);
  const tPagar = (await api(url('/conciliacao'))).body.find((t) => t.lancamento_id === pagar.id);
  assert.equal((await api(url(`/conciliacao/${tPagar.id}/desfazer`), 'POST')).status, 200);
  assert.equal((await api(url(`/lancamentos/${pagar.id}`))).body.status, 'aberto');

  const rel = (await api(url('/relatorios/conciliacao'))).body;
  assert.equal(rel.contas[0].pendentes, 1);
});

test('conciliação: importa CSV no formato brasileiro', async () => {
  const csv = `Data;Histórico;Valor\n${hoje().split('-').reverse().join('/')};"DEPÓSITO; LOJA";1.234,56\n`;
  const res = await api(url('/conciliacao/importar'), 'POST', { conta_id: conta.id, formato: 'csv', conteudo: csv });
  assert.equal(res.body.importadas, 1);
  const t = (await api(url('/conciliacao?status=pendente'))).body.find((x) => x.valor === 1234.56);
  assert.equal(t.descricao, 'DEPÓSITO; LOJA');
});

test('BI, DRE, fluxo de caixa e exportação CSV', async () => {
  const empresa = (await api('/empresas', 'POST', { razao_social: 'Empresa DRE' })).body;
  const u = (p) => `/empresas/${empresa.id}${p}`;
  const cats = Object.fromEntries((await api(u('/categorias'))).body.map((c) => [c.nome, c.id]));
  const dia = inicioDoMes();
  const lanc = (tipo, categoria, valor, pago = true) =>
    api(u('/lancamentos'), 'POST', { tipo, descricao: categoria, valor, vencimento: dia, pagamento: pago ? dia : undefined, categoria_id: cats[categoria] });

  await lanc('receita', 'Prestação de serviços', 10000);
  await lanc('despesa', 'Impostos sobre vendas', 600);
  await lanc('despesa', 'Custo de mercadorias / insumos', 2400);
  await lanc('despesa', 'Folha de pagamento', 3000);
  await lanc('despesa', 'Tarifas bancárias', 100);
  await lanc('receita', 'Prestação de serviços', 5000, false);

  const p = `?inicio=${inicioDoMes()}&fim=${fimDoMes()}`;
  const dre = (await api(u(`/relatorios/dre${p}`))).body;
  const linha = (t) => dre.linhas.find((l) => l.titulo.includes(t)).valores.total;
  assert.equal(linha('Receita operacional bruta'), 10000);
  assert.equal(linha('Receita líquida'), 9400);
  assert.equal(linha('Lucro bruto'), 7000);
  assert.equal(linha('Resultado operacional'), 4000);
  assert.equal(linha('Resultado líquido'), 3900);
  assert.equal(dre.margem_liquida, 39);

  const comp = (await api(u(`/relatorios/dre${p}&regime=competencia`))).body;
  assert.equal(comp.linhas[0].valores.total, 15000);

  const bi = (await api(u(`/bi${p}`))).body;
  assert.equal(bi.kpis.receitas, 10000);
  assert.equal(bi.kpis.despesas, 6100);
  assert.equal(bi.kpis.resultado, 3900);
  assert.equal(bi.kpis.a_receber, 5000);
  assert.equal(bi.fluxo_mensal.length, 12);
  assert.equal(bi.fluxo_mensal[11].receitas, 10000);
  assert.equal(bi.despesas_por_categoria[0].categoria, 'Folha de pagamento');

  const fluxo = (await api(u(`/relatorios/fluxo-caixa${p}`))).body;
  assert.equal(fluxo.saldo_final - fluxo.saldo_inicial, 3900);

  const csv = await api(u(`/relatorios/dre${p}&formato=csv`));
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, /Resultado líquido;.*3900/);

  const carteira = (await api(`/bi/carteira${p}`)).body;
  assert.equal(carteira.empresas.find((e) => e.id === empresa.id).resultado, 3900);
});
