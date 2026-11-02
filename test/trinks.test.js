const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { iniciar, cliente } = require('./helpers');
const { lerPlanilha } = require('../src/lib/planilha');
const { interpretarRelatorio, lerData, lerValor } = require('../src/lib/trinks');
const { hoje, addDays } = require('../src/lib/datas');

const ontem = addDays(hoje(), -1);
const br = (iso) => iso.split('-').reverse().join('/');

const CSV = `Relatório de atendimentos por profissional
Data;Profissional;Cliente;Serviço;Tipo;Valor
${br(ontem)} 10:00;Rafael Souza;João Lima;Corte;Serviço;R$ 55,00
${br(ontem)} 10:00;Rafael Souza;João Lima;Pomada modeladora;Produto;49,00
${br(ontem)} 11:00;Rafael Souza;Ana Dias;Corte + Barba;Serviço;"1.085,00"
${br(ontem)} 11:30;Bruno Lima;Ana Dias;Barba;Serviço;40
;;;Total;;1.229,00
`;

/** Minimal XLSX (stored ZIP) to exercise the reader without external tools. */
function xlsx(linhas) {
  const strings = [];
  const idx = (s) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1);
  const rows = linhas
    .map((l, r) => `<row r="${r + 1}">${l.map((v, c) => {
      const ref = String.fromCharCode(65 + c) + (r + 1);
      return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${idx(v)}</v></c>`;
    }).join('')}</row>`)
    .join('');
  const arquivos = {
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${rows}</sheetData></worksheet>`,
    'xl/sharedStrings.xml': `<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`,
  };
  const locais = [];
  const central = [];
  let offset = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const dados = zlib.deflateRawSync(Buffer.from(conteudo));
    const n = Buffer.from(nome);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(8, 8); h.writeUInt32LE(dados.length, 18); h.writeUInt16LE(n.length, 26);
    locais.push(h, n, dados);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(8, 10); c.writeUInt32LE(dados.length, 20); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + dados.length;
  }
  const cd = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(2, 10); fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, cd, fim]);
}

let ctx;
let api;
let emp;
before(async () => {
  ctx = await iniciar();
  api = cliente(ctx.base);
  await api.login('admin@teste.com');
  emp = (await api('/empresas', 'POST', { razao_social: 'Mish Barber LTDA', nome_fantasia: 'Mish Barber' })).body;
  await api(`/empresas/${emp.id}/contas`, 'POST', { descricao: 'Conta', saldo_inicial: 0 });
});
after(() => ctx.server.close());

test('datas e valores no formato brasileiro', () => {
  assert.equal(lerData('27/10/2026 14:30'), '2026-10-27');
  assert.equal(lerData('2026-10-27'), '2026-10-27');
  assert.equal(lerData('46322'), '2026-10-27');
  assert.equal(lerData('31/02/2026'), null);
  assert.equal(lerValor('R$ 1.234,56'), 1234.56);
  assert.equal(lerValor('49.9'), 49.9);
});

test('relatório CSV: acha o cabeçalho, ignora totais e reconhece produtos', () => {
  const { itens, ignoradas } = interpretarRelatorio(lerPlanilha(Buffer.from(CSV)));
  assert.equal(itens.length, 4);
  assert.equal(ignoradas, 1);
  assert.deepEqual(itens.map((i) => i.tipo), ['servico', 'produto', 'servico', 'servico']);
  assert.equal(itens[2].valor, 1085);
});

test('relatório XLSX e HTML são lidos', () => {
  const linhas = lerPlanilha(xlsx([['Data', 'Profissional', 'Serviço', 'Valor'], ['27/10/2026', 'Camila', 'Escova & corte', 60.5]]));
  assert.deepEqual(linhas[1], ['27/10/2026', 'Camila', 'Escova & corte', '60.5']);
  const html = lerPlanilha(Buffer.from('<table><tr><th>Data</th><th>Valor</th></tr><tr><td>01/10/2026</td><td>R$&nbsp;10,00</td></tr></table>'));
  assert.deepEqual(html[1], ['01/10/2026', 'R$ 10,00']);
  assert.throws(() => interpretarRelatorio([['Nome', 'Telefone']]), /colunas/);
});

test('importação cria profissionais, gera receita diária e não duplica', async () => {
  const arquivo = Buffer.from(CSV).toString('base64');
  const r = await api(`/empresas/${emp.id}/trinks/importar`, 'POST', { arquivo, nome: 'relatorio.csv' });
  assert.equal(r.status, 200);
  assert.equal(r.body.novos, 4);
  assert.deepEqual(r.body.colaboradores_criados, ['Rafael Souza', 'Bruno Lima']);

  const de_novo = await api(`/empresas/${emp.id}/trinks/importar`, 'POST', { arquivo, nome: 'relatorio.csv' });
  assert.equal(de_novo.body.novos, 0);

  // Financeiro: uma receita de serviços e uma de produtos no dia, iguais à soma das vendas.
  const receitas = (await api(`/empresas/${emp.id}/lancamentos?tipo=receita&inicio=${ontem}&fim=${ontem}`)).body;
  assert.deepEqual(receitas.map((l) => l.valor).sort((a, b) => a - b), [49, 1180]);
  assert.ok(receitas.every((l) => l.status === 'pago'));

  // Substituir o dia: um cancelamento no Trinks some daqui também.
  const corrigido = CSV.split('\n').filter((l) => !l.includes('Bruno')).join('\n');
  await api(`/empresas/${emp.id}/trinks/importar`, 'POST', { arquivo: Buffer.from(corrigido).toString('base64'), nome: 'r.csv', substituir: true });
  const servicos = (await api(`/empresas/${emp.id}/lancamentos?tipo=receita&inicio=${ontem}&fim=${ontem}`)).body.find((l) => l.documento.endsWith('servico'));
  assert.equal(servicos.valor, 1140);

  const hist = (await api(`/empresas/${emp.id}/trinks`)).body;
  assert.equal(hist.length, 3);
  assert.equal((await api(`/empresas/${emp.id}/trinks/importar`, 'POST', { arquivo: Buffer.from('a;b\n1;2').toString('base64') })).status, 400);
});

test('pessoas: indicadores, perfil, avaliação dos pilares e ações', async () => {
  const p = { inicio: addDays(hoje(), -5), fim: hoje() };
  const lista = (await api(`/empresas/${emp.id}/pessoas?inicio=${p.inicio}&fim=${p.fim}`)).body;
  const rafael = lista.equipe.find((c) => c.nome === 'Rafael Souza');
  assert.equal(rafael.faturamento, 1189);
  assert.equal(rafael.atendimentos, 2); // João e Ana: 3 itens, 2 visitas
  assert.equal(rafael.ticket_medio, 594.5);
  assert.equal(lista.pilares.length, 5);

  const pilares = (await api('/pilares')).body;
  const mes = hoje().slice(0, 7);
  const av = await api(`/empresas/${emp.id}/pessoas/${rafael.id}/avaliacao`, 'PUT', { mes, notas: { [pilares[0].id]: 9, [pilares[3].id]: 5 } });
  assert.equal(av.status, 204);
  assert.equal((await api(`/empresas/${emp.id}/pessoas/${rafael.id}/avaliacao`, 'PUT', { mes, notas: { [pilares[0].id]: 11 } })).status, 400);

  const perfil = (await api(`/empresas/${emp.id}/pessoas/${rafael.id}?inicio=${p.inicio}&fim=${p.fim}`)).body;
  assert.equal(perfil.colaborador.nota, 7);
  assert.equal(perfil.servicos[0].item, 'Corte + Barba');
  assert.ok(perfil.alertas.some((a) => a.indicador === `Pilar: ${pilares[3].nome}`));
  assert.equal(perfil.mensal.length, 12);

  const acao = await api(`/empresas/${emp.id}/acoes`, 'POST', { colaborador_id: rafael.id, indicador: 'Vendas', descricao: 'Treinar indicação de produtos' });
  assert.equal(acao.status, 201);
  assert.equal(acao.body.status, 'aberta');

  const painel = (await api(`/painel?inicio=${p.inicio}&fim=${p.fim}`)).body;
  assert.equal(painel.saloes.length, 1);
  // 1.229 importados − 40 do atendimento cancelado no Trinks = 1.189, igual no financeiro.
  assert.equal(painel.totais.faturamento, 1189);
  assert.equal(painel.totais.receitas, 1189);
  assert.equal(painel.totais.acoes_abertas, 1);
});

test('dono do salão avalia e cria ações, mas não altera o financeiro', async () => {
  const { hashSenha } = require('../src/lib/auth');
  ctx.db.prepare("INSERT INTO usuarios (nome, email, senha_hash, papel, empresa_id) VALUES ('Dono', 'dono@teste.com', ?, 'cliente', ?)").run(hashSenha('senha-forte-123'), emp.id);
  const dono = cliente(ctx.base);
  await dono.login('dono@teste.com');
  const colab = (await dono(`/empresas/${emp.id}/colaboradores`)).body[0];
  assert.equal((await dono(`/empresas/${emp.id}/acoes`, 'POST', { descricao: 'Feedback semanal', colaborador_id: colab.id })).status, 201);
  assert.equal((await dono(`/empresas/${emp.id}/lancamentos`, 'POST', { tipo: 'despesa', descricao: 'X', valor: 1, vencimento: hoje() })).status, 403);
  assert.equal((await dono(`/empresas/${emp.id}/colaboradores`, 'POST', { nome: 'Novo' })).status, 403);
  assert.equal((await dono('/trinks/status')).status, 403);
});
