// Popula o banco com dados de demonstração: `npm run seed`.
// Cria os dois salões (Mish Barber e Espaço GP), profissionais fictícios, 12 meses de atendimentos
// no formato do Trinks, despesas, notas dos pilares e um plano de ação.
const { openDatabase, criarPlanoDeContas } = require('./db');
const { hashSenha } = require('./lib/auth');
const { hoje, addDays, addMonths, inicioDoMes, isoDate } = require('./lib/datas');
const { importarAtendimentos, registrarSync } = require('./lib/trinks');

const db = openDatabase();

if (db.prepare('SELECT COUNT(*) AS n FROM empresas').get().n > 0) {
  console.log('O banco já possui dados — seed ignorado.');
  process.exit(0);
}

// Deterministic pseudo-random numbers so the demo always looks the same.
let semente = 42;
const rand = () => ((semente = (semente * 16807) % 2147483647) - 1) / 2147483646;
const entre = (min, max) => Math.round((min + rand() * (max - min)) * 100) / 100;
const escolher = (lista) => lista[Math.floor(rand() * lista.length)];

const SENHA_DEMO = 'mish12345';
const NOMES = ['Ana', 'Bruno', 'Carla', 'Daniel', 'Eduardo', 'Felipe', 'Gabriel', 'Helena', 'Igor', 'João', 'Karen', 'Leonardo', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Renato', 'Sofia', 'Tiago', 'Vinícius'];
const SOBRENOMES = ['Almeida', 'Barbosa', 'Costa', 'Dias', 'Ferreira', 'Gomes', 'Lima', 'Moura', 'Nunes', 'Pereira', 'Ramos', 'Santos', 'Teixeira', 'Vieira'];

// [nome, função, meta mensal, atendimentos/dia, fator de ticket, chance de vender produto, tendência nos últimos 2 meses]
const SALOES = [
  {
    razao_social: 'Mish Barber LTDA',
    nome_fantasia: 'Mish Barber',
    responsavel: 'Sócio Mish Barber',
    servicos: [['Corte', 55], ['Barba', 40], ['Corte + Barba', 85], ['Pigmentação', 50], ['Sobrancelha', 20], ['Hidratação', 35]],
    produtos: [['Pomada modeladora', 49], ['Óleo para barba', 45], ['Shampoo antiqueda', 39]],
    equipe: [
      ['Rafael Souza', 'Barbeiro master', 14000, 9, 1.15, 0.22, 1.05],
      ['Bruno Lima', 'Barbeiro', 11000, 8, 1.0, 0.15, 1.0],
      ['Diego Martins', 'Barbeiro', 10000, 8, 1.0, 0.02, 1.0],
      ['Lucas Oliveira', 'Barbeiro', 10000, 7, 1.0, 0.12, 0.7],
      ['Thiago Alves', 'Barbeiro júnior', 7000, 7, 0.75, 0.08, 1.1],
    ],
    despesas: [
      ['Aluguel e condomínio', 'Aluguel da loja', 'Imobiliária', 6500, 6500, 10],
      ['Energia, água e internet', 'Energia e internet', 'Concessionárias', 900, 1300, 15],
      ['Custo de mercadorias / insumos', 'Produtos e insumos', 'Distribuidora', 2500, 3500, 12],
      ['Pró-labore', 'Pró-labore sócios', 'Sócios', 5000, 5000, 5],
      ['Marketing', 'Anúncios Instagram', 'Meta Ads', 600, 1500, 20],
      ['Software e assinaturas', 'Assinatura Trinks', 'Trinks', 289, 289, 8],
    ],
  },
  {
    razao_social: 'Espaço GP Beleza LTDA',
    nome_fantasia: 'Espaço GP',
    responsavel: 'Sócia Espaço GP',
    servicos: [['Corte feminino', 90], ['Escova', 60], ['Coloração', 180], ['Manicure', 35], ['Pedicure', 40], ['Progressiva', 250], ['Hidratação', 70]],
    produtos: [['Máscara capilar', 89], ['Óleo reparador', 65]],
    equipe: [
      ['Camila Rocha', 'Cabeleireira', 13000, 5, 1.2, 0.18, 1.0],
      ['Juliana Mendes', 'Colorista', 15000, 4, 1.5, 0.1, 1.1],
      ['Patrícia Gomes', 'Manicure', 6000, 8, 0.45, 0.03, 0.95],
      ['Fernanda Dias', 'Cabeleireira', 10000, 5, 1.0, 0.06, 0.8],
    ],
    despesas: [
      ['Aluguel e condomínio', 'Aluguel do espaço', 'Imobiliária', 7800, 7800, 10],
      ['Energia, água e internet', 'Energia, água e internet', 'Concessionárias', 1200, 1900, 15],
      ['Custo de mercadorias / insumos', 'Coloração e insumos', 'Distribuidora', 3800, 5200, 12],
      ['Pró-labore', 'Pró-labore sócia', 'Sócios', 6000, 6000, 5],
      ['Marketing', 'Anúncios e influenciadoras', 'Meta Ads', 900, 2200, 20],
      ['Software e assinaturas', 'Assinatura Trinks', 'Trinks', 289, 289, 8],
    ],
  },
];

const insUser = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, papel, empresa_id) VALUES (?, ?, ?, ?, ?)');
const senha = hashSenha(SENHA_DEMO);
if (!db.prepare("SELECT 1 FROM usuarios WHERE email = 'admin@mish.local'").get()) insUser.run('Administrador', 'admin@mish.local', senha, 'admin', null);
insUser.run('Ana Analista', 'analista@mish.local', senha, 'analista', null);

const ref = hoje();
const inicio = addMonths(inicioDoMes(ref), -11);
const pilares = db.prepare('SELECT id, nome FROM pilares ORDER BY ordem').all();

for (const [n, s] of SALOES.entries()) {
  const empresaId = Number(
    db.prepare('INSERT INTO empresas (razao_social, nome_fantasia, responsavel) VALUES (?, ?, ?)').run(s.razao_social, s.nome_fantasia, s.responsavel).lastInsertRowid
  );
  criarPlanoDeContas(db, empresaId);
  insUser.run(`Dono(a) ${s.nome_fantasia}`, `dono${n + 1}@mish.local`, senha, 'cliente', empresaId);
  db.prepare('INSERT INTO contas_bancarias (empresa_id, descricao, banco, saldo_inicial, data_saldo_inicial) VALUES (?, ?, ?, ?, ?)').run(
    empresaId,
    'Conta corrente',
    n === 0 ? 'Inter' : 'Itaú',
    entre(8000, 20000),
    inicio
  );
  for (const [nome, funcao, meta] of s.equipe) {
    db.prepare('INSERT INTO colaboradores (empresa_id, nome, funcao, apelido_trinks, meta_mensal) VALUES (?, ?, ?, ?, ?)').run(empresaId, nome, funcao, nome, meta);
  }

  // Atendimentos no formato que o relatório do Trinks traz: uma linha por serviço/produto.
  const clientes = Array.from({ length: 350 }, () => `${escolher(NOMES)} ${escolher(SOBRENOMES)}`);
  const itens = [];
  const servicosPorMes = new Map();
  const doisMeses = addMonths(inicioDoMes(ref), -1);
  for (let d = inicio; d <= ref; d = addDays(d, 1)) {
    if (new Date(d + 'T00:00:00').getDay() === 0) continue; // domingo fechado
    const sazonal = 1 + 0.15 * Math.sin((Number(d.slice(5, 7)) / 12) * 2 * Math.PI);
    for (const [prof, , , porDia, fatorTicket, chanceProduto, tendencia] of s.equipe) {
      const qtd = Math.round(porDia * sazonal * (d >= doisMeses ? tendencia : 1) * (0.6 + rand() * 0.7));
      for (let i = 0; i < qtd; i++) {
        const cliente = escolher(clientes);
        const [servico, preco] = escolher(s.servicos);
        const valor = Math.round(preco * (0.9 + rand() * 0.2) * fatorTicket);
        itens.push({ data: d, profissional: prof, cliente, item: servico, tipo: 'servico', valor });
        const k = `${d.slice(0, 7)}|${prof}`;
        servicosPorMes.set(k, (servicosPorMes.get(k) || 0) + valor);
        if (rand() < chanceProduto) {
          const [produto, pp] = escolher(s.produtos);
          itens.push({ data: d, profissional: prof, cliente, item: produto, tipo: 'produto', valor: pp });
        }
      }
    }
  }
  importarAtendimentos(db, empresaId, itens, { origem: 'robo' });
  registrarSync(db, { empresaId, origem: 'robo', status: 'ok', inicio: addDays(ref, -3), fim: ref, lidos: itens.filter((i) => i.data >= addDays(ref, -3)).length, mensagem: 'Coleta de demonstração' });

  // Despesas mensais (comissão de 40% sobre serviços, impostos e taxa de cartão sobre o faturamento).
  const cat = (nome) => db.prepare('SELECT id FROM categorias WHERE empresa_id = ? AND nome = ?').get(empresaId, nome).id;
  const insLanc = db.prepare(
    `INSERT INTO lancamentos (empresa_id, tipo, descricao, contraparte, categoria_id, conta_id, valor, competencia, vencimento, pagamento)
     VALUES (?, 'despesa', ?, ?, ?, (SELECT id FROM contas_bancarias WHERE empresa_id = ?), ?, ?, ?, ?)`
  );
  const lancar = (categoria, descricao, contraparte, valor, competencia, vencimento, atrasar = false) => {
    const pago = vencimento <= ref && !atrasar ? vencimento : null;
    insLanc.run(empresaId, descricao, contraparte, cat(categoria), empresaId, Math.round(valor * 100) / 100, competencia, vencimento, pago);
  };
  for (let m = 0; m < 13; m++) {
    const mes = addMonths(inicio, m);
    const rotulo = mes.slice(5, 7) + '/' + mes.slice(0, 4);
    for (const [categoria, descricao, contraparte, min, max, dia] of s.despesas) {
      const venc = mes.slice(0, 8) + String(dia).padStart(2, '0');
      lancar(categoria, `${descricao} ${rotulo}`, contraparte, entre(min, max) * (categoria === 'Marketing' && m >= 11 ? 1.6 : 1), mes, venc, m === 11 && categoria === 'Energia, água e internet');
    }
    // Comissões e impostos do mês anterior vencem no dia 5.
    const anterior = addMonths(mes, -1).slice(0, 7);
    if (anterior < inicio.slice(0, 7)) continue;
    const venc = mes.slice(0, 8) + '05';
    let faturamentoMes = 0;
    for (const [prof] of s.equipe) {
      const base = servicosPorMes.get(`${anterior}|${prof}`) || 0;
      faturamentoMes += base;
      if (base) lancar('Comissões de profissionais', `Comissão ${prof} ${anterior.slice(5)}/${anterior.slice(0, 4)}`, prof, base * 0.4, anterior + '-01', venc);
    }
    lancar('Impostos sobre vendas', `Simples Nacional ${anterior.slice(5)}/${anterior.slice(0, 4)}`, 'Receita Federal', faturamentoMes * 0.06, anterior + '-01', mes.slice(0, 8) + '20');
    lancar('Tarifas bancárias', `Taxas da maquininha ${anterior.slice(5)}/${anterior.slice(0, 4)}`, 'Adquirente', faturamentoMes * 0.025, anterior + '-01', venc);
  }

  // Notas dos pilares dos últimos 3 meses (0 a 10).
  const colabs = db.prepare('SELECT id, nome FROM colaboradores WHERE empresa_id = ?').all(empresaId);
  const insNota = db.prepare('INSERT INTO avaliacoes (colaborador_id, pilar_id, mes, nota) VALUES (?, ?, ?, ?)');
  for (let m = 2; m >= 0; m--) {
    const mes = addMonths(inicioDoMes(ref), -m).slice(0, 7);
    for (const c of colabs) {
      for (const p of pilares) {
        let nota = 7 + rand() * 2.8;
        if (c.nome === 'Diego Martins' && p.nome === 'Vendas') nota = 5 + rand();
        if (c.nome === 'Lucas Oliveira' && p.nome === 'Pontualidade') nota = 6.8 + m * 0.4 - rand();
        if (c.nome === 'Fernanda Dias' && p.nome === 'Atendimento') nota = 6 + rand() * 0.8;
        insNota.run(c.id, p.id, mes, Math.round(Math.min(10, nota) * 2) / 2);
      }
    }
  }

  const insAcao = db.prepare('INSERT INTO acoes (empresa_id, colaborador_id, indicador, descricao, responsavel, prazo, status) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const colab = (nome) => colabs.find((c) => c.nome === nome)?.id ?? null;
  if (n === 0) {
    insAcao.run(empresaId, colab('Diego Martins'), 'Venda de produtos', 'Treinar indicação de pomada e óleo ao final do corte', s.responsavel, addDays(ref, 7), 'aberta');
    insAcao.run(empresaId, colab('Lucas Oliveira'), 'Faturamento', 'Conversa de alinhamento sobre agenda e faltas', s.responsavel, addDays(ref, -2), 'aberta');
    insAcao.run(empresaId, null, 'Marketing', 'Rever retorno dos anúncios do Instagram', 'Ana Analista', addDays(ref, 10), 'aberta');
    insAcao.run(empresaId, colab('Rafael Souza'), 'Meta', 'Reconhecer meta batida na reunião mensal', s.responsavel, addDays(ref, -20), 'concluida');
  } else {
    insAcao.run(empresaId, colab('Fernanda Dias'), 'Pilar: Atendimento', 'Acompanhar atendimentos e dar feedback semanal', s.responsavel, addDays(ref, 5), 'aberta');
    insAcao.run(empresaId, null, 'Contas vencidas', 'Regularizar conta de energia em atraso', 'Ana Analista', addDays(ref, 2), 'aberta');
  }
}

console.log('Dados de demonstração criados. Usuários (senha para todos: ' + SENHA_DEMO + '):');
console.log('  admin@mish.local     — administrador');
console.log('  analista@mish.local  — analista BPO');
console.log('  dono1@mish.local     — dono(a) Mish Barber');
console.log('  dono2@mish.local     — dono(a) Espaço GP');
console.log(`Hoje: ${isoDate()}`);
