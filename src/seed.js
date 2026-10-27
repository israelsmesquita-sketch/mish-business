// Popula o banco com dados de demonstração: `npm run seed`.
// Cria usuários, duas empresas clientes, 14 meses de lançamentos e um extrato pendente de conciliação.
const { openDatabase, transaction, criarPlanoDeContas } = require('./db');
const { hashSenha } = require('./lib/auth');
const { hoje, addDays, addMonths, inicioDoMes } = require('./lib/datas');

const db = openDatabase();

if (db.prepare('SELECT COUNT(*) AS n FROM empresas').get().n > 0) {
  console.log('O banco já possui dados — seed ignorado.');
  process.exit(0);
}

// Deterministic pseudo-random numbers so the demo always looks the same.
let semente = 42;
const rand = () => ((semente = (semente * 16807) % 2147483647) - 1) / 2147483646;
const entre = (min, max) => Math.round((min + rand() * (max - min)) * 100) / 100;

const SENHA_DEMO = 'mish12345';

const EMPRESAS = [
  {
    razao_social: 'Padaria Pão Dourado LTDA',
    nome_fantasia: 'Pão Dourado',
    cnpj: '12.345.678/0001-90',
    responsavel: 'Marcos Andrade',
    receitas: [
      ['Venda de produtos', 'Vendas balcão (cartão)', 'Adquirente Cartões', 38000, 46000, 5],
      ['Venda de produtos', 'Encomendas corporativas', 'Café & Cia Eventos', 6000, 9500, 20],
    ],
    despesas: [
      ['Custo de mercadorias / insumos', 'Farinha e insumos', 'Moinho Bom Grão', 14000, 17000, 10],
      ['Folha de pagamento', 'Folha de pagamento', 'Funcionários', 12500, 12500, 5],
      ['Aluguel e condomínio', 'Aluguel da loja', 'Imobiliária Centro', 4800, 4800, 10],
      ['Energia, água e internet', 'Energia elétrica', 'Companhia de Energia', 2100, 3200, 15],
      ['Impostos sobre vendas', 'Simples Nacional (DAS)', 'Receita Federal', 3100, 4100, 20],
      ['Pró-labore', 'Pró-labore sócios', 'Sócios', 6000, 6000, 5],
      ['Marketing', 'Anúncios em redes sociais', 'Meta Ads', 600, 1200, 25],
    ],
  },
  {
    razao_social: 'TechNova Soluções em Software LTDA',
    nome_fantasia: 'TechNova',
    cnpj: '98.765.432/0001-10',
    responsavel: 'Juliana Prado',
    receitas: [
      ['Prestação de serviços', 'Mensalidade SaaS', 'Grupo Alfa Varejo', 18000, 18000, 10],
      ['Prestação de serviços', 'Mensalidade SaaS', 'Rede Beta Saúde', 12500, 12500, 15],
      ['Prestação de serviços', 'Projeto de implantação', 'Construtora Gama', 8000, 22000, 25],
    ],
    despesas: [
      ['Folha de pagamento', 'Folha de pagamento', 'Funcionários', 26000, 26000, 5],
      ['Software e assinaturas', 'Infraestrutura em nuvem', 'Cloud Provider', 3500, 5200, 8],
      ['Serviços de terceiros', 'Contabilidade e BPO financeiro', 'Mish BPO', 1800, 1800, 10],
      ['Aluguel e condomínio', 'Coworking', 'Hub Coworking', 3200, 3200, 10],
      ['Impostos sobre vendas', 'ISS / PIS / COFINS', 'Prefeitura e Receita', 3800, 5600, 20],
      ['Marketing', 'Google Ads', 'Google', 1500, 2800, 18],
    ],
  },
];

transaction(db, () => {
  const insUser = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, empresa_id) VALUES (?, ?, ?, ?, ?)');
  const senha = hashSenha(SENHA_DEMO);
  if (!db.prepare("SELECT 1 FROM usuarios WHERE email = 'admin@mish.local'").get()) {
    insUser.run('Administrador', 'admin@mish.local', senha, 'admin', null);
  }
  insUser.run('Ana Analista', 'analista@mish.local', senha, 'analista', null);

  const ref = hoje();
  const corteConciliacao = addDays(ref, -12);

  for (const [n, emp] of EMPRESAS.entries()) {
    const { lastInsertRowid: empresaId } = db
      .prepare('INSERT INTO empresas (razao_social, nome_fantasia, cnpj, responsavel, email) VALUES (?, ?, ?, ?, ?)')
      .run(emp.razao_social, emp.nome_fantasia, emp.cnpj, emp.responsavel, `financeiro@${emp.nome_fantasia.toLowerCase().replace(/\W/g, '')}.com.br`);
    criarPlanoDeContas(db, empresaId);
    insUser.run(`Cliente ${emp.nome_fantasia}`, `cliente${n + 1}@mish.local`, senha, 'cliente', empresaId);

    const cat = (nome) => db.prepare('SELECT id FROM categorias WHERE empresa_id = ? AND nome = ?').get(empresaId, nome).id;
    const inicio = addMonths(inicioDoMes(ref), -11);
    const { lastInsertRowid: contaId } = db
      .prepare('INSERT INTO contas_bancarias (empresa_id, descricao, banco, agencia, conta, saldo_inicial, data_saldo_inicial) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(empresaId, 'Conta corrente principal', n === 0 ? 'Banco do Brasil' : 'Itaú', '1234-5', `5678${n}-9`, entre(15000, 30000), inicio);

    const insLanc = db.prepare(
      `INSERT INTO lancamentos (empresa_id, tipo, descricao, contraparte, categoria_id, conta_id, valor, competencia, vencimento, pagamento, documento)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insExtrato = db.prepare('INSERT INTO extrato (empresa_id, conta_id, data, descricao, valor, fitid) VALUES (?, ?, ?, ?, ?, ?)');
    let fit = 1;

    // 12 months back and 2 months ahead.
    for (let m = 0; m < 14; m++) {
      const mes = addMonths(inicio, m);
      for (const [tipo, itens] of [['receita', emp.receitas], ['despesa', emp.despesas]]) {
        for (const [idx, [categoria, descricao, contraparte, min, max, dia]] of itens.entries()) {
          const vencimento = mes.slice(0, 8) + String(dia).padStart(2, '0');
          const valor = entre(min, max);
          const mesNome = mes.slice(5, 7) + '/' + mes.slice(0, 4);
          let pagamento = null;
          let extratoData = null;

          if (vencimento < corteConciliacao) {
            // Older entries: already paid (some late receivables stay open to show delinquency).
            const inadimplente = tipo === 'receita' && idx > 0 && rand() < 0.08;
            if (!inadimplente) pagamento = addDays(vencimento, Math.round(rand() * 3));
          } else if (vencimento <= ref) {
            // Recent entries: paid at the bank but not yet reconciled — they show up in the extrato.
            if (rand() < 0.9) extratoData = addDays(vencimento, Math.round(rand() * 2));
          }

          const doc = `NF-${1000 + Math.floor(rand() * 9000)}`;
          insLanc.run(empresaId, tipo, `${descricao} ${mesNome}`, contraparte, cat(categoria), contaId, valor, mes, vencimento, pagamento, doc);
          if (extratoData) {
            const memo = tipo === 'receita' ? `PIX RECEBIDO ${contraparte.toUpperCase()}` : `PAGTO ${contraparte.toUpperCase()}`;
            insExtrato.run(empresaId, contaId, extratoData, memo, tipo === 'receita' ? valor : -valor, `DEMO${empresaId}-${fit++}`);
          }
        }
      }
    }

    // Bank-only items the BPO analyst still needs to classify.
    for (const [d, desc, v] of [
      [-20, 'TARIFA PACOTE SERVICOS', -89.9],
      [-12, 'IOF', -14.37],
      [-5, 'RENDIMENTO APLIC AUTOMATICA', 132.45],
    ]) {
      insExtrato.run(empresaId, contaId, addDays(ref, d), desc, v, `DEMO${empresaId}-${fit++}`);
    }
  }
});

console.log('Dados de demonstração criados. Usuários (senha para todos: ' + SENHA_DEMO + '):');
console.log('  admin@mish.local     — administrador');
console.log('  analista@mish.local  — analista BPO');
console.log('  cliente1@mish.local  — cliente (Pão Dourado)');
console.log('  cliente2@mish.local  — cliente (TechNova)');
