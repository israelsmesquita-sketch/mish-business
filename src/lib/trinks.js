// Importação dos relatórios de atendimentos do Trinks: reconhece as colunas pelo nome,
// grava cada serviço/produto por profissional e gera a receita diária no financeiro.
const crypto = require('node:crypto');
const { transaction } = require('../db');
const { isIsoDate } = require('./datas');

const normalizar = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Nomes de coluna aceitos (já normalizados). O primeiro que aparecer no cabeçalho é usado.
const COLUNAS = {
  data: ['data', 'data do atendimento', 'data atendimento', 'data da venda', 'data/hora', 'data e hora', 'dia'],
  profissional: ['profissional', 'colaborador', 'funcionario', 'barbeiro', 'cabeleireiro', 'responsavel', 'profissional responsavel'],
  cliente: ['cliente', 'nome do cliente', 'nome cliente'],
  item: ['servico', 'servico/produto', 'item', 'descricao', 'produto', 'descricao do item', 'nome do servico', 'servicos'],
  tipo: ['tipo', 'tipo do item', 'categoria do item', 'tipo item'],
  valor: ['valor', 'valor total', 'total', 'valor pago', 'valor final', 'valor liquido', 'preco', 'valor r', 'valor do servico', 'valor cobrado'],
  id: ['id', 'codigo', 'id do atendimento', 'id atendimento', 'comanda', 'n comanda', 'numero da comanda', 'id item'],
};

function mapearCabecalho(linha) {
  const nomes = linha.map(normalizar);
  const mapa = {};
  for (const [campo, aliases] of Object.entries(COLUNAS)) {
    for (const a of aliases) {
      const i = nomes.indexOf(a);
      if (i >= 0 && !Object.values(mapa).includes(i)) {
        mapa[campo] = i;
        break;
      }
    }
  }
  return mapa;
}

/** "dd/mm/aaaa [hh:mm]", "aaaa-mm-dd" ou número de série do Excel → AAAA-MM-DD. */
function lerData(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return isIsoDate(iso) ? iso : null;
  }
  m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return isIsoDate(m[1]) ? m[1] : null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 864e5);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

/** "R$ 1.234,56", "1234.56", "-50,00" → número. */
function lerValor(v) {
  let s = String(v ?? '').replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Lê a matriz de células do relatório e devolve os itens.
 * Ignora linhas sem data/valor (subtotais, rodapés) e informa quantas foram descartadas.
 */
function interpretarRelatorio(linhas) {
  const inicio = linhas.findIndex((l) => {
    const m = mapearCabecalho(l);
    return m.data !== undefined && m.valor !== undefined && (m.profissional !== undefined || m.item !== undefined);
  });
  if (inicio < 0) {
    throw new Error('Não encontrei as colunas do relatório. São necessárias ao menos: Data, Profissional (ou Serviço) e Valor.');
  }
  const mapa = mapearCabecalho(linhas[inicio]);
  const itens = [];
  let ignoradas = 0;
  for (const l of linhas.slice(inicio + 1)) {
    const col = (campo) => (mapa[campo] !== undefined ? String(l[mapa[campo]] ?? '').trim() : '');
    const data = lerData(col('data'));
    const valor = lerValor(col('valor'));
    if (!data || valor === null || valor < 0) {
      if (l.some((c) => String(c).trim())) ignoradas++;
      continue;
    }
    const tipoTxt = normalizar(col('tipo'));
    itens.push({
      data,
      profissional: col('profissional') || null,
      cliente: col('cliente') || null,
      item: col('item') || 'Atendimento',
      tipo: tipoTxt.includes('produto') ? 'produto' : 'servico',
      valor,
      id_externo: col('id') || null,
    });
  }
  return { itens, ignoradas };
}

const RECEITA_CATEGORIA = { servico: 'Prestação de serviços', produto: 'Venda de produtos' };

/**
 * Grava os itens no salão. Com `substituir: {inicio, fim}`, os itens do Trinks nesse intervalo
 * são trocados pelos do relatório (assim cancelamentos e correções também chegam).
 * Sem ele, itens já importados são ignorados pela chave.
 */
function importarAtendimentos(db, empresaId, itens, { origem = 'arquivo', substituir } = {}) {
  return transaction(db, () => {
    const colabs = db.prepare('SELECT id, nome, apelido_trinks FROM colaboradores WHERE empresa_id = ?').all(empresaId);
    const porNome = new Map();
    for (const c of colabs) {
      porNome.set(normalizar(c.nome), c.id);
      if (c.apelido_trinks) porNome.set(normalizar(c.apelido_trinks), c.id);
    }
    const novosColaboradores = [];
    const colaborador = (nome) => {
      if (!nome) return null;
      const k = normalizar(nome);
      if (!porNome.has(k)) {
        const id = Number(db.prepare('INSERT INTO colaboradores (empresa_id, nome, apelido_trinks) VALUES (?, ?, ?)').run(empresaId, nome, nome).lastInsertRowid);
        porNome.set(k, id);
        novosColaboradores.push(nome);
      }
      return porNome.get(k);
    };

    if (substituir) {
      db.prepare("DELETE FROM atendimentos WHERE empresa_id = ? AND origem = 'trinks' AND data BETWEEN ? AND ?").run(empresaId, substituir.inicio, substituir.fim);
    }

    const ins = db.prepare(
      `INSERT OR IGNORE INTO atendimentos (empresa_id, colaborador_id, data, cliente, item, tipo, valor, chave, origem)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    // Itens idênticos no mesmo relatório (ex.: dois produtos iguais) são diferenciados pela ocorrência.
    const ocorrencias = new Map();
    const datas = new Set();
    let novos = 0;
    for (const it of itens) {
      const base = [it.data, normalizar(it.profissional), normalizar(it.cliente), normalizar(it.item), it.valor, it.id_externo || ''].join('|');
      const n = (ocorrencias.get(base) || 0) + 1;
      ocorrencias.set(base, n);
      const chave = crypto.createHash('sha1').update(`${base}|${n}`).digest('hex');
      const r = ins.run(empresaId, colaborador(it.profissional), it.data, it.cliente, it.item, it.tipo, it.valor, chave, origem === 'manual' ? 'manual' : 'trinks');
      if (r.changes) novos++;
      datas.add(it.data);
    }
    if (substituir) for (let d = substituir.inicio; d <= substituir.fim; d = proximoDia(d)) datas.add(d);

    atualizarReceitas(db, empresaId, [...datas]);
    return { lidos: itens.length, novos, colaboradores_criados: novosColaboradores };
  });
}

const proximoDia = (iso) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Mantém uma receita por dia e por tipo (serviços/produtos) no financeiro, igual à soma das vendas.
 * Assim o financeiro e o painel de pessoas partem do mesmo número. Receitas já conciliadas com o banco não mudam.
 */
function atualizarReceitas(db, empresaId, datas) {
  const cat = (nome) => db.prepare('SELECT id FROM categorias WHERE empresa_id = ? AND nome = ?').get(empresaId, nome)?.id ?? null;
  const conta = db.prepare('SELECT id FROM contas_bancarias WHERE empresa_id = ? ORDER BY id LIMIT 1').get(empresaId)?.id ?? null;
  const soma = db.prepare('SELECT COALESCE(SUM(valor), 0) AS v FROM atendimentos WHERE empresa_id = ? AND data = ? AND tipo = ?');
  const atual = db.prepare(
    'SELECT l.id, l.valor, x.id AS extrato_id FROM lancamentos l LEFT JOIN extrato x ON x.lancamento_id = l.id WHERE l.empresa_id = ? AND l.documento = ?'
  );
  for (const data of datas) {
    for (const tipo of ['servico', 'produto']) {
      const documento = `TRINKS:${data}:${tipo}`;
      const valor = Math.round(soma.get(empresaId, data, tipo).v * 100) / 100;
      const l = atual.get(empresaId, documento);
      if (l?.extrato_id) continue;
      if (!valor) {
        if (l) db.prepare('DELETE FROM lancamentos WHERE id = ?').run(l.id);
      } else if (l) {
        if (l.valor !== valor) db.prepare('UPDATE lancamentos SET valor = ? WHERE id = ?').run(valor, l.id);
      } else {
        db.prepare(
          `INSERT INTO lancamentos (empresa_id, tipo, descricao, contraparte, categoria_id, conta_id, valor, competencia, vencimento, pagamento, documento)
           VALUES (?, 'receita', ?, 'Clientes (Trinks)', ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          empresaId,
          `Faturamento Trinks — ${tipo === 'servico' ? 'serviços' : 'produtos'} ${data.split('-').reverse().join('/')}`,
          cat(RECEITA_CATEGORIA[tipo]),
          conta,
          valor,
          data,
          data,
          data,
          documento
        );
      }
    }
  }
}

function registrarSync(db, { empresaId, origem, status, inicio = null, fim = null, lidos = 0, novos = 0, mensagem = null }) {
  db.prepare('INSERT INTO trinks_sync (empresa_id, origem, status, inicio, fim, lidos, novos, mensagem) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    empresaId,
    origem,
    status,
    inicio,
    fim,
    lidos,
    novos,
    mensagem
  );
}

module.exports = { interpretarRelatorio, importarAtendimentos, atualizarReceitas, registrarSync, lerData, lerValor, normalizar };
