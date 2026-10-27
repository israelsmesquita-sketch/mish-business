const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseOfx, parseCsv, numeroBR, dataBR } = require('../src/lib/extrato');

test('numeroBR entende formatos brasileiros e internacionais', () => {
  assert.equal(numeroBR('1.234,56'), 1234.56);
  assert.equal(numeroBR('-1.234,56'), -1234.56);
  assert.equal(numeroBR('R$ 10,00'), 10);
  assert.equal(numeroBR('(10,00)'), -10);
  assert.equal(numeroBR('25,00-'), -25);
  assert.equal(numeroBR('-99.5'), -99.5);
  assert.ok(Number.isNaN(numeroBR('abc')));
});

test('dataBR valida datas', () => {
  assert.equal(dataBR('31/01/2026'), '2026-01-31');
  assert.equal(dataBR('2026-01-31'), '2026-01-31');
  assert.equal(dataBR('31/02/2026'), null);
});

test('parseOfx lê o arquivo de exemplo', () => {
  const t = parseOfx(fs.readFileSync(path.join(__dirname, '..', 'exemplos', 'extrato-exemplo.ofx'), 'utf8'));
  assert.equal(t.length, 3);
  assert.deepEqual(t[0], { data: '2026-10-05', descricao: 'PIX RECEBIDO CLIENTE EXEMPLO', valor: 4500, fitid: '202610050001' });
  assert.equal(t[1].valor, -1250.75);
  assert.equal(t[2].descricao, 'TARIFA - TARIFA PACOTE SERVICOS');
});

test('parseCsv lê o arquivo de exemplo e colunas de crédito/débito', () => {
  const t = parseCsv(fs.readFileSync(path.join(__dirname, '..', 'exemplos', 'extrato-exemplo.csv'), 'utf8'));
  assert.equal(t.length, 3);
  assert.equal(t[1].valor, -1250.75);

  const cd = parseCsv('data,descricao,credito,debito\n2026-10-01,Venda,100.00,\n2026-10-02,Compra,,40.00\n');
  assert.deepEqual(cd.map((x) => x.valor), [100, -40]);

  const semCabecalho = parseCsv('01/10/2026;Venda;50,00');
  assert.equal(semCabecalho[0].valor, 50);
  assert.throws(() => parseCsv('Data;Valor\nontem;10'), /inválida/);
});
