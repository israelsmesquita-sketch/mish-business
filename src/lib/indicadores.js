// Indicadores de gestão: faturamento por salão e por profissional, comparação com o período
// anterior e os alertas que viram sugestões de ação.
const { hoje, addDays, addMonths, inicioDoMes, fimDoMes } = require('./datas');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const variacao = (atual, anterior) => (anterior ? r2(((atual - anterior) / anterior) * 100) : null);

const dias = (inicio, fim) => Math.round((new Date(fim + 'T00:00:00') - new Date(inicio + 'T00:00:00')) / 864e5) + 1;

// Dias do período que já passaram (o mês corrente ainda não terminou).
const fimEfetivo = ({ inicio, fim }) => (inicio <= hoje() && fim > hoje() ? hoje() : fim);

/**
 * Período de comparação. Meses fechados comparam com os mesmos dias dos meses anteriores
 * (1 a 27/out × 1 a 27/set); outros intervalos, com o mesmo número de dias logo antes.
 */
function periodoAnterior(p) {
  const f = fimEfetivo(p);
  if (p.inicio.endsWith('-01') && p.fim === fimDoMes(p.fim)) {
    const meses = (Number(p.fim.slice(0, 4)) - Number(p.inicio.slice(0, 4))) * 12 + Number(p.fim.slice(5, 7)) - Number(p.inicio.slice(5, 7)) + 1;
    return { inicio: addMonths(p.inicio, -meses), fim: addMonths(f, -meses) };
  }
  const n = dias(p.inicio, f);
  return { inicio: addDays(p.inicio, -n), fim: addDays(p.inicio, -1) };
}

// Um atendimento é a visita do cliente: mesma data e mesmo cliente contam uma vez, mesmo com vários itens.
const VISITA = "a.data || '|' || COALESCE(a.cliente, 'item' || a.id)";

function vendas(db, empresaId, { inicio, fim }) {
  const v = db
    .prepare(
      `SELECT COALESCE(SUM(a.valor), 0) AS faturamento,
              COALESCE(SUM(CASE WHEN a.tipo = 'produto' THEN a.valor END), 0) AS produtos,
              COALESCE(SUM(CASE WHEN a.tipo = 'servico' THEN 1 END), 0) AS servicos,
              COUNT(DISTINCT ${VISITA}) AS atendimentos,
              COUNT(DISTINCT a.cliente) AS clientes
         FROM atendimentos a WHERE a.empresa_id = ? AND a.data BETWEEN ? AND ?`
    )
    .get(empresaId, inicio, fim);
  return {
    faturamento: r2(v.faturamento),
    produtos: r2(v.produtos),
    servicos: v.servicos,
    atendimentos: v.atendimentos,
    clientes: v.clientes,
    ticket_medio: v.atendimentos ? r2(v.faturamento / v.atendimentos) : 0,
  };
}

function financeiro(db, empresaId, { inicio, fim }) {
  const f = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN tipo = 'receita' THEN valor END), 0) AS receitas,
              COALESCE(SUM(CASE WHEN tipo = 'despesa' THEN valor END), 0) AS despesas
         FROM lancamentos WHERE empresa_id = ? AND pagamento BETWEEN ? AND ?`
    )
    .get(empresaId, inicio, fim);
  const resultado = f.receitas - f.despesas;
  return {
    receitas: r2(f.receitas),
    despesas: r2(f.despesas),
    resultado: r2(resultado),
    margem: f.receitas ? r2((resultado / f.receitas) * 100) : 0,
  };
}

/** Nota média de cada profissional no mês de referência (ou no último mês avaliado antes dele). */
function notasPorColaborador(db, empresaId, mesRef) {
  const rows = db
    .prepare(
      `SELECT av.colaborador_id, av.mes, av.nota, p.nome AS pilar, p.id AS pilar_id
         FROM avaliacoes av
         JOIN colaboradores c ON c.id = av.colaborador_id
         JOIN pilares p ON p.id = av.pilar_id
        WHERE c.empresa_id = ? AND av.mes <= ?
        ORDER BY av.mes DESC`
    )
    .all(empresaId, mesRef);
  const porColab = new Map();
  for (const r of rows) {
    const atual = porColab.get(r.colaborador_id);
    if (!atual) porColab.set(r.colaborador_id, { mes: r.mes, notas: [r] });
    else if (atual.mes === r.mes) atual.notas.push(r);
  }
  const out = new Map();
  for (const [id, { mes, notas }] of porColab) {
    out.set(id, { mes, media: r2(notas.reduce((s, n) => s + n.nota, 0) / notas.length), notas });
  }
  return out;
}

/** Linha de indicadores de cada profissional do salão no período. */
function indicadoresEquipe(db, empresaId, periodo) {
  const ant = periodoAnterior(periodo);
  const q = db.prepare(
    `SELECT c.id, COALESCE(SUM(a.valor), 0) AS faturamento,
            COALESCE(SUM(CASE WHEN a.tipo = 'produto' THEN a.valor END), 0) AS produtos,
            COALESCE(SUM(CASE WHEN a.tipo = 'servico' THEN 1 END), 0) AS servicos,
            COUNT(DISTINCT CASE WHEN a.id IS NOT NULL THEN ${VISITA} END) AS atendimentos,
            COUNT(DISTINCT a.cliente) AS clientes
       FROM colaboradores c
       LEFT JOIN atendimentos a ON a.colaborador_id = c.id AND a.data BETWEEN ? AND ?
      WHERE c.empresa_id = ?
      GROUP BY c.id`
  );
  const anteriores = new Map(q.all(ant.inicio, ant.fim, empresaId).map((r) => [r.id, r.faturamento]));
  const atuais = new Map(q.all(periodo.inicio, periodo.fim, empresaId).map((r) => [r.id, r]));
  const notas = notasPorColaborador(db, empresaId, periodo.fim.slice(0, 7));
  const acoes = new Map(
    db
      .prepare("SELECT colaborador_id, COUNT(*) AS n FROM acoes WHERE empresa_id = ? AND status = 'aberta' AND colaborador_id IS NOT NULL GROUP BY colaborador_id")
      .all(empresaId)
      .map((r) => [r.colaborador_id, r.n])
  );
  const fatorMeta = dias(periodo.inicio, periodo.fim) / 30.44;
  const decorrido = dias(periodo.inicio, fimEfetivo(periodo)) / dias(periodo.inicio, periodo.fim);

  return db
    .prepare('SELECT * FROM colaboradores WHERE empresa_id = ? ORDER BY ativo DESC, nome COLLATE NOCASE')
    .all(empresaId)
    .map((c) => {
      const v = atuais.get(c.id);
      const meta = r2(c.meta_mensal * fatorMeta);
      const nota = notas.get(c.id);
      return {
        ...c,
        faturamento: r2(v.faturamento),
        produtos: r2(v.produtos),
        servicos: v.servicos,
        atendimentos: v.atendimentos,
        clientes: v.clientes,
        ticket_medio: v.atendimentos ? r2(v.faturamento / v.atendimentos) : 0,
        produtos_pct: v.faturamento ? r2((v.produtos / v.faturamento) * 100) : 0,
        variacao: variacao(v.faturamento, anteriores.get(c.id) || 0),
        meta,
        meta_pct: meta ? r2((v.faturamento / meta) * 100) : null,
        // Projeção para o fim do período no ritmo atual.
        projecao_pct: meta && decorrido > 0 ? r2((v.faturamento / decorrido / meta) * 100) : null,
        nota: nota ? nota.media : null,
        nota_mes: nota ? nota.mes : null,
        acoes_abertas: acoes.get(c.id) || 0,
      };
    })
    .sort((a, b) => b.ativo - a.ativo || b.faturamento - a.faturamento);
}

// ---------- Alertas → sugestões de ação ----------
// nivel: 'alerta' (agir já), 'atencao' (acompanhar) ou 'positivo' (reconhecer).

function alertasColaborador(c, equipe) {
  const out = [];
  const ativos = equipe.filter((e) => e.ativo && e.atendimentos);
  const ticketEquipe = ativos.length ? ativos.reduce((s, e) => s + e.faturamento, 0) / ativos.reduce((s, e) => s + e.atendimentos, 0) : 0;
  const add = (nivel, indicador, texto, acao) => out.push({ nivel, indicador, texto, acao, colaborador_id: c.id, colaborador: c.nome });

  if (c.meta_pct !== null && c.meta_pct >= 100) add('positivo', 'Meta', `${c.nome} bateu ${c.meta_pct.toFixed(0)}% da meta.`, 'Reconhecer o resultado com a equipe');
  else if (c.projecao_pct !== null && c.projecao_pct < 80 && c.atendimentos) {
    add('alerta', 'Meta', `${c.nome} deve fechar em ${c.projecao_pct.toFixed(0)}% da meta no ritmo atual.`, 'Revisar agenda e horários livres para aumentar atendimentos');
  }
  if (c.variacao !== null && c.variacao <= -15) add('alerta', 'Faturamento', `Faturamento de ${c.nome} caiu ${Math.abs(c.variacao).toFixed(0)}% vs. período anterior.`, 'Conversa de alinhamento e plano de recuperação');
  if (ticketEquipe && c.atendimentos >= 5 && c.ticket_medio < ticketEquipe * 0.85) {
    add('atencao', 'Ticket médio', `Ticket médio de ${c.nome} está ${(100 - (c.ticket_medio / ticketEquipe) * 100).toFixed(0)}% abaixo da média do salão.`, 'Oferecer serviços complementares em cada atendimento');
  }
  if (c.atendimentos >= 5 && c.produtos_pct < 5) add('atencao', 'Venda de produtos', `${c.nome} vende pouco produto (${c.produtos_pct.toFixed(1)}% do faturamento).`, 'Treinar indicação de produtos ao final do atendimento');
  return out;
}

function alertasPilares(c, notas) {
  return (notas?.notas || [])
    .filter((n) => n.nota < 7)
    .map((n) => ({
      nivel: n.nota < 5 ? 'alerta' : 'atencao',
      indicador: `Pilar: ${n.pilar}`,
      texto: `${c.nome} tirou ${n.nota.toLocaleString('pt-BR')} em ${n.pilar}.`,
      acao: `Plano de desenvolvimento em ${n.pilar}`,
      colaborador_id: c.id,
      colaborador: c.nome,
    }));
}

function alertasSalao(db, empresaId, nome, periodo, fin, finAnt, vend, vendAnt) {
  const out = [];
  const add = (nivel, indicador, texto, acao) => out.push({ nivel, indicador, texto, acao, empresa_id: empresaId, salao: nome });
  if (fin.receitas && fin.resultado < 0) add('alerta', 'Resultado', `${nome}: despesas maiores que receitas (${fin.margem.toFixed(0)}% de margem).`, 'Revisar as maiores despesas do período');
  else if (fin.receitas && fin.margem < 10) add('atencao', 'Margem', `${nome}: margem de ${fin.margem.toFixed(1)}%, abaixo de 10%.`, 'Rever preços e custos fixos');
  const dv = variacao(vend.faturamento, vendAnt.faturamento);
  if (dv !== null && dv <= -10) add('alerta', 'Faturamento', `${nome}: faturamento caiu ${Math.abs(dv).toFixed(0)}% vs. período anterior.`, 'Campanha de reativação de clientes');
  else if (dv !== null && dv >= 10) add('positivo', 'Faturamento', `${nome}: faturamento cresceu ${dv.toFixed(0)}% vs. período anterior.`, 'Manter o que está funcionando');

  // Categoria de despesa que mais cresceu.
  const q = db.prepare(
    `SELECT COALESCE(c.nome, 'Sem categoria') AS categoria, SUM(l.valor) AS valor FROM lancamentos l LEFT JOIN categorias c ON c.id = l.categoria_id
      WHERE l.empresa_id = ? AND l.tipo = 'despesa' AND l.pagamento BETWEEN ? AND ? GROUP BY categoria`
  );
  const antes = new Map(q.all(empresaId, finAnt.inicio, finAnt.fim).map((r) => [r.categoria, r.valor]));
  const pior = q
    .all(empresaId, periodo.inicio, periodo.fim)
    .map((r) => ({ ...r, cresc: antes.get(r.categoria) ? (r.valor - antes.get(r.categoria)) / antes.get(r.categoria) : 0 }))
    .filter((r) => r.cresc >= 0.2 && r.valor >= 300)
    .sort((a, b) => b.valor - antes.get(b.categoria) - (a.valor - antes.get(a.categoria)))[0];
  if (pior) add('atencao', 'Despesas', `${nome}: "${pior.categoria}" subiu ${(pior.cresc * 100).toFixed(0)}% vs. período anterior.`, `Investigar o aumento em ${pior.categoria}`);

  const vencidas = db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(valor), 0) AS v FROM lancamentos WHERE empresa_id = ? AND tipo = 'despesa' AND pagamento IS NULL AND vencimento < ?")
    .get(empresaId, hoje());
  if (vencidas.n) add('alerta', 'Contas vencidas', `${nome}: ${vencidas.n} conta(s) a pagar vencida(s), R$ ${r2(vencidas.v).toLocaleString('pt-BR')}.`, 'Quitar ou renegociar as contas vencidas');

  const sync = db.prepare("SELECT MAX(criado_em) AS em FROM trinks_sync WHERE empresa_id = ? AND status = 'ok'").get(empresaId).em;
  const temVendas = db.prepare('SELECT 1 FROM atendimentos WHERE empresa_id = ? LIMIT 1').get(empresaId);
  if (temVendas && (!sync || sync.slice(0, 10) < addDays(hoje(), -2))) {
    add('atencao', 'Dados do Trinks', `${nome}: dados do Trinks sem atualização ${sync ? 'desde ' + sync.slice(0, 10).split('-').reverse().join('/') : 'automática'}.`, 'Verificar o robô de coleta do Trinks');
  }
  return out;
}

const ORDEM_NIVEL = { alerta: 0, atencao: 1, positivo: 2 };
const ordenarAlertas = (lista) => lista.sort((a, b) => ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel]);

/** Resumo de um salão para o painel: financeiro, vendas, equipe e alertas. */
function resumoSalao(db, empresa, periodo) {
  const ant = periodoAnterior(periodo);
  const fin = financeiro(db, empresa.id, periodo);
  const finAnt = financeiro(db, empresa.id, ant);
  const vend = vendas(db, empresa.id, periodo);
  const vendAnt = vendas(db, empresa.id, ant);
  const equipe = indicadoresEquipe(db, empresa.id, periodo);
  const notas = notasPorColaborador(db, empresa.id, periodo.fim.slice(0, 7));
  const nome = empresa.nome_fantasia || empresa.razao_social;

  const alertas = ordenarAlertas([
    ...alertasSalao(db, empresa.id, nome, periodo, fin, ant, vend, vendAnt),
    ...equipe.filter((c) => c.ativo).flatMap((c) => [...alertasColaborador(c, equipe), ...alertasPilares(c, notas.get(c.id))]),
  ]);

  const sync = db.prepare('SELECT * FROM trinks_sync WHERE empresa_id = ? ORDER BY id DESC LIMIT 1').get(empresa.id) || null;
  const acoes = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(prazo < ?), 0) AS atrasadas FROM acoes WHERE empresa_id = ? AND status = 'aberta'").get(hoje(), empresa.id);

  return {
    id: empresa.id,
    nome,
    financeiro: { ...fin, variacao_receitas: variacao(fin.receitas, finAnt.receitas), variacao_despesas: variacao(fin.despesas, finAnt.despesas), variacao_resultado: variacao(fin.resultado, finAnt.resultado) },
    vendas: { ...vend, variacao_faturamento: variacao(vend.faturamento, vendAnt.faturamento), variacao_ticket: variacao(vend.ticket_medio, vendAnt.ticket_medio), variacao_atendimentos: variacao(vend.atendimentos, vendAnt.atendimentos) },
    equipe: equipe.filter((c) => c.ativo),
    alertas,
    acoes_abertas: acoes.n,
    acoes_atrasadas: acoes.atrasadas,
    ultima_sync: sync,
  };
}

/** Receitas × despesas pagas por mês nos 12 meses até o fim do período. */
function serieMensal(db, empresaIds, fim) {
  const fimMeses = fimDoMes(fim);
  const inicioMeses = inicioDoMes(addMonths(fimMeses, -11));
  const marcas = empresaIds.map(() => '?').join(',') || 'NULL';
  const fin = db
    .prepare(
      `SELECT substr(pagamento, 1, 7) AS mes,
              SUM(CASE WHEN tipo = 'receita' THEN valor ELSE 0 END) AS receitas,
              SUM(CASE WHEN tipo = 'despesa' THEN valor ELSE 0 END) AS despesas
         FROM lancamentos WHERE empresa_id IN (${marcas}) AND pagamento BETWEEN ? AND ? GROUP BY mes`
    )
    .all(...empresaIds, inicioMeses, fimMeses);
  const fat = db
    .prepare(`SELECT substr(data, 1, 7) AS mes, SUM(valor) AS faturamento FROM atendimentos WHERE empresa_id IN (${marcas}) AND data BETWEEN ? AND ? GROUP BY mes`)
    .all(...empresaIds, inicioMeses, fimMeses);
  const mf = Object.fromEntries(fin.map((m) => [m.mes, m]));
  const mv = Object.fromEntries(fat.map((m) => [m.mes, m.faturamento]));
  return Array.from({ length: 12 }, (_, i) => {
    const mes = addMonths(inicioMeses, i).slice(0, 7);
    const f = mf[mes] || {};
    return { mes, receitas: r2(f.receitas), despesas: r2(f.despesas), resultado: r2((f.receitas || 0) - (f.despesas || 0)), faturamento: r2(mv[mes]) };
  });
}

module.exports = {
  r2,
  variacao,
  periodoAnterior,
  vendas,
  financeiro,
  notasPorColaborador,
  indicadoresEquipe,
  alertasColaborador,
  alertasPilares,
  ordenarAlertas,
  resumoSalao,
  serieMensal,
};
