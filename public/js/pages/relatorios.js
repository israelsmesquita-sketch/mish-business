import { $, api, esc, money, dateBR, mesBR, table, qs, badge, pct, periodoHtml, bindPeriodo } from '../ui.js';
import { empresaUrl, empresaAtual } from '../estado.js';

const RELATORIOS = {
  dre: 'DRE gerencial',
  'fluxo-caixa': 'Fluxo de caixa',
  contas: 'Contas a pagar e receber',
  conciliacao: 'Conciliação bancária',
};

export async function renderRelatorios(view) {
  let atual = 'dre';

  view.innerHTML = `
    <div class="toolbar no-print">
      <div class="tabs" id="tabs">${Object.entries(RELATORIOS)
        .map(([k, v], i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-rel="${k}">${v}</button>`)
        .join('')}</div>
    </div>
    <div class="toolbar no-print">
      <div class="filters">
        ${periodoHtml('per-rel')}
        <span id="opcoes"></span>
      </div>
      <div>
        <a class="btn ghost" id="btn-csv" href="#">Exportar CSV (Excel)</a>
        <button class="btn ghost" id="btn-print">Imprimir / PDF</button>
      </div>
    </div>
    <div class="panel report" id="relatorio"></div>`;

  const getPeriodo = bindPeriodo('per-rel', () => load());

  function opcoes() {
    const html = {
      dre: `<select id="o-regime" aria-label="Regime"><option value="caixa">Regime de caixa</option><option value="competencia">Regime de competência</option></select>`,
      'fluxo-caixa': `<select id="o-agrupar" aria-label="Agrupar"><option value="mes">Mensal</option><option value="dia">Diário</option></select>`,
      contas: `<select id="o-tipo" aria-label="Tipo"><option value="">Pagar e receber</option><option value="receita">A receber</option><option value="despesa">A pagar</option></select>
               <select id="o-status" aria-label="Status"><option value="">Todos</option><option value="pendente">Pendentes</option><option value="atrasado">Atrasados</option><option value="pago">Pagos</option></select>`,
      conciliacao: '',
    }[atual];
    $('#opcoes').innerHTML = html;
    $('#opcoes').querySelectorAll('select').forEach((s) => s.addEventListener('change', load));
  }

  const params = () => {
    const p = getPeriodo();
    const v = (id) => $(id)?.value || '';
    return { ...p, regime: v('#o-regime'), agrupar: v('#o-agrupar'), tipo: v('#o-tipo'), status: v('#o-status') };
  };

  const cabecalho = (titulo, p, extra = '') => {
    const e = empresaAtual();
    return `<div class="report-head">
      <div><h2>${esc(titulo)}</h2><div class="muted">${esc(e.razao_social)}${e.cnpj ? ' · CNPJ ' + esc(e.cnpj) : ''}</div></div>
      <div class="muted right">Período: ${dateBR(p.inicio)} a ${dateBR(p.fim)}${extra}<br/>Emitido em ${new Date().toLocaleString('pt-BR')}</div>
    </div>`;
  };

  async function load() {
    const p = params();
    const url = empresaUrl(`/relatorios/${atual}`) + qs(p);
    $('#btn-csv').href = '/api' + url + (url.includes('?') ? '&' : '?') + 'formato=csv';
    const d = await api(url);
    $('#relatorio').innerHTML = RENDER[atual](d, p);
  }

  const RENDER = {
    dre(d, p) {
      const meses = d.meses.length <= 12 ? d.meses : [];
      const cols = [{ label: 'Conta' }, ...meses.map((m) => ({ label: mesBR(m), num: true })), { label: 'Total', num: true }, { label: 'AV%', num: true }];
      const receita = d.linhas[0].valores.total || 0;
      const cel = (v) => `<td class="num ${v < 0 ? 'neg' : ''}">${money(v)}</td>`;
      const av = (v) => `<td class="num muted">${receita ? pct((v / receita) * 100) : '—'}</td>`;
      const rows = [];
      for (const l of d.linhas) {
        rows.push(`<tr class="${l.total ? 'total-row' : 'group-row'}"><td>${esc(l.titulo)}</td>${meses.map((m) => cel(l.valores[m])).join('')}${cel(l.valores.total)}${av(l.valores.total)}</tr>`);
        for (const c of l.categorias) {
          rows.push(`<tr class="detail-row"><td>${esc(c.nome)}</td>${meses.map((m) => cel(c.valores[m])).join('')}${cel(c.valores.total)}${av(c.valores.total)}</tr>`);
        }
      }
      return (
        cabecalho('DRE gerencial', p, ` · regime de ${d.regime === 'competencia' ? 'competência' : 'caixa'}`) +
        table(cols, rows) +
        `<p class="report-foot">Margem líquida: <strong>${pct(d.margem_liquida)}</strong> · AV% = análise vertical sobre a receita bruta.</p>`
      );
    },

    'fluxo-caixa'(d, p) {
      return (
        cabecalho('Fluxo de caixa realizado', p) +
        `<div class="cards">
          <div class="card"><div class="label">Saldo inicial</div><div class="value">${money(d.saldo_inicial)}</div></div>
          <div class="card"><div class="label">Entradas</div><div class="value pos">${money(d.total_entradas)}</div></div>
          <div class="card"><div class="label">Saídas</div><div class="value neg">${money(d.total_saidas)}</div></div>
          <div class="card"><div class="label">Saldo final</div><div class="value">${money(d.saldo_final)}</div></div>
        </div>` +
        table(
          [{ label: d.agrupar === 'dia' ? 'Dia' : 'Mês' }, { label: 'Entradas', num: true }, { label: 'Saídas', num: true }, { label: 'Líquido', num: true }, { label: 'Saldo', num: true }],
          d.linhas.map(
            (l) => `<tr><td>${d.agrupar === 'dia' ? dateBR(l.periodo) : mesBR(l.periodo)}</td><td class="num pos">${money(l.entradas)}</td>
              <td class="num neg">${money(l.saidas)}</td><td class="num ${l.liquido >= 0 ? 'pos' : 'neg'}">${money(l.liquido)}</td><td class="num">${money(l.saldo)}</td></tr>`
          ),
          'Sem movimentação no período.'
        )
      );
    },

    contas(d, p) {
      const t = d.totais;
      return (
        cabecalho('Contas a pagar e receber', p, ' · por vencimento') +
        table(
          [{ label: 'Vencimento' }, { label: 'Tipo' }, { label: 'Descrição' }, { label: 'Cliente/Fornecedor' }, { label: 'Categoria' }, { label: 'Status' }, { label: 'Pagamento' }, { label: 'Valor', num: true }],
          d.linhas.map(
            (l) => `<tr><td>${dateBR(l.vencimento)}</td><td>${badge(l.tipo)}</td><td>${esc(l.descricao)}</td><td>${esc(l.contraparte)}</td>
              <td>${esc(l.categoria || '—')}</td><td>${badge(l.status)}</td><td>${dateBR(l.pagamento)}</td><td class="num">${money(l.valor)}</td></tr>`
          ),
          'Nenhum lançamento no período.'
        ) +
        `<p class="report-foot">Total: <strong>${money(t.total)}</strong> · pago ${money(t.pago)} · a vencer ${money(t.aberto)} · atrasado <span class="neg">${money(t.atrasado)}</span></p>`
      );
    },

    conciliacao(d, p) {
      return (
        cabecalho('Relatório de conciliação bancária', p) +
        table(
          [{ label: 'Conta' }, { label: 'Transações', num: true }, { label: 'Conciliadas', num: true }, { label: 'Pendentes', num: true }, { label: 'Saldo extrato', num: true }, { label: 'Saldo sistema', num: true }, { label: 'Diferença', num: true }],
          d.contas.map(
            (c) => `<tr><td>${esc(c.descricao)}</td><td class="num">${c.transacoes}</td><td class="num">${c.conciliadas}</td><td class="num">${c.pendentes}</td>
              <td class="num">${money(c.saldo_extrato)}</td><td class="num">${money(c.saldo_sistema)}</td><td class="num ${Math.abs(c.diferenca) >= 0.01 ? 'neg' : 'pos'}">${money(c.diferenca)}</td></tr>`
          ),
          'Nenhuma conta bancária.'
        ) +
        `<h3>Transações pendentes no período</h3>` +
        table(
          [{ label: 'Data' }, { label: 'Conta' }, { label: 'Descrição' }, { label: 'Valor', num: true }],
          d.pendentes.map((t) => `<tr><td>${dateBR(t.data)}</td><td>${esc(t.conta)}</td><td>${esc(t.descricao)}</td><td class="num ${t.valor >= 0 ? 'pos' : 'neg'}">${money(t.valor)}</td></tr>`),
          'Nenhuma pendência. Extrato 100% conciliado no período.'
        ) +
        `<p class="report-foot">Diferença = saldo pelo extrato importado − saldo pelos lançamentos pagos no sistema. Diferença zero indica conta conciliada.</p>`
      );
    },
  };

  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    atual = tab.dataset.rel;
    document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    opcoes();
    load();
  });
  $('#btn-print').addEventListener('click', () => window.print());

  opcoes();
  await load();
}
