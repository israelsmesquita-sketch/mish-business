// Financeiro 100% receitas e despesas: visão geral, listas e DRE. O período é o da barra do topo.
import { $, api, esc, money, pct, mesBR, dateBR, qs, table, kpi, tile, bindTiles, delta, tentar } from '../ui.js';
import { estado, empresaUrl, empresaAtual, nomeEmpresa } from '../estado.js';
import { columnChart, barList } from '../charts.js';
import { renderLancamentos } from './lancamentos.js';

const ABAS = [
  ['visao', 'Visão geral'],
  ['receitas', 'Receitas'],
  ['despesas', 'Despesas'],
  ['dre', 'DRE'],
];

export async function renderFinanceiro(view, params) {
  const aba = ABAS.some(([k]) => k === params.get('aba')) ? params.get('aba') : 'visao';
  view.innerHTML = `
    <nav class="segmented no-print" aria-label="Seções do financeiro">${ABAS.map(([k, v]) => `<a href="#/financeiro?aba=${k}" class="${k === aba ? 'active' : ''}">${v}</a>`).join('')}</nav>
    <div id="fin"></div>`;
  const alvo = $('#fin');
  if (aba === 'receitas') return renderLancamentos(alvo, { tipo: 'receita', categoria: params.get('cat') });
  if (aba === 'despesas') return renderLancamentos(alvo, { tipo: 'despesa', categoria: params.get('cat') });
  if (aba === 'dre') return renderDre(alvo);
  return renderVisao(alvo);
}

async function renderVisao(alvo) {
  const [d, ant, aPagar, categorias] = await Promise.all([
    api(empresaUrl('/bi') + qs(estado.periodo)),
    // Mesmo indicador no período anterior para mostrar a variação.
    api(empresaUrl('/bi') + qs(periodoAnterior(estado.periodo))),
    api(empresaUrl('/lancamentos') + qs({ tipo: 'despesa', status: 'pendente', fim: proximaSemana() })),
    api(empresaUrl('/categorias')),
  ]);
  const k = d.kpis;
  const v = (a, b) => (b ? ((a - b) / b) * 100 : null);
  const catId = Object.fromEntries(categorias.map((c) => [`${c.tipo}|${c.nome}`, c.id]));
  const linkCat = (tipo) => (it) => ({ ...it, href: catId[`${tipo}|${it.categoria}`] ? `#/financeiro?aba=${tipo === 'receita' ? 'receitas' : 'despesas'}&cat=${catId[`${tipo}|${it.categoria}`]}` : '' });
  const fluxo = d.fluxo_mensal.map((m) => ({ ...m, label: mesBR(m.mes) }));
  const maiorDespesa = d.despesas_por_categoria[0];
  const vencidas = aPagar.filter((l) => l.status === 'atrasado');

  alvo.innerHTML = `
    <div class="cards kpis">
      ${kpi({ label: 'Receitas', value: money(k.receitas), cls: 'pos', sub: delta(v(k.receitas, ant.kpis.receitas)), href: '#/financeiro?aba=receitas' })}
      ${kpi({ label: 'Despesas', value: money(k.despesas), cls: 'neg', sub: delta(v(k.despesas, ant.kpis.despesas), { inverso: true }), href: '#/financeiro?aba=despesas' })}
      ${kpi({ label: 'Resultado', value: money(k.resultado), cls: k.resultado >= 0 ? 'pos' : 'neg', sub: `margem ${pct(k.margem)}` })}
      ${kpi({ label: 'A pagar até 7 dias', value: money(aPagar.reduce((s, l) => s + l.valor, 0)), sub: vencidas.length ? `<span class="neg">${vencidas.length} vencida(s)</span>` : 'nada vencido', href: '#/financeiro?aba=despesas' })}
    </div>
    <div class="tiles" id="tiles-fin">
      ${tile({
        id: 'despesas-cat', troca: true,
        titulo: 'Para onde vai o dinheiro (despesas)',
        w: 6,
        mini: maiorDespesa ? `<strong>${esc(maiorDespesa.categoria)}</strong> ${money(maiorDespesa.valor)}` : '',
        body: barList(d.despesas_por_categoria.slice(0, 6).map(linkCat('despesa')), { labelKey: 'categoria', valueKey: 'valor', cls: 'bar-out' }),
        extra: `<h4>Todas as categorias</h4>${barList(d.despesas_por_categoria.map(linkCat('despesa')), { labelKey: 'categoria', valueKey: 'valor', cls: 'bar-out' })}<h4>Maiores fornecedores</h4>${barList(d.maiores_fornecedores, { labelKey: 'contraparte', valueKey: 'valor', cls: 'bar-out' })}`,
      })}
      ${tile({
        id: 'receitas-cat',
        titulo: 'De onde vem o dinheiro (receitas)',
        w: 6,
        mini: `<strong>${money(k.receitas)}</strong>`,
        body: barList(d.receitas_por_categoria.map(linkCat('receita')), { labelKey: 'categoria', valueKey: 'valor', cls: 'bar-in' }),
      })}
      ${tile({
        id: 'fluxo',
        titulo: 'Receitas × despesas — 12 meses',
        w: 8,
        mini: `<strong class="${k.resultado >= 0 ? 'pos' : 'neg'}">${money(k.resultado)}</strong>`,
        body: columnChart(fluxo, {
          labelKey: 'label',
          series: [{ key: 'receitas', label: 'Receitas', cls: 'bar-in' }, { key: 'despesas', label: 'Despesas', cls: 'bar-out' }],
          line: { key: 'resultado', label: 'Resultado', cls: 'line-res' },
        }),
        extra: table(
          [{ label: 'Mês' }, { label: 'Receitas', num: true }, { label: 'Despesas', num: true }, { label: 'Resultado', num: true }],
          fluxo.map((m) => `<tr><td>${m.label}</td><td class="num pos">${money(m.receitas)}</td><td class="num neg">${money(m.despesas)}</td><td class="num ${m.resultado >= 0 ? 'pos' : 'neg'}">${money(m.resultado)}</td></tr>`)
        ),
      })}
      ${tile({
        id: 'a-pagar',
        titulo: 'Contas a pagar (vencidas e 7 dias)',
        w: 4,
        mini: `<strong>${aPagar.length}</strong> conta(s)`,
        body: aPagar.length
          ? `<ul class="contas">${aPagar
              .slice(0, 8)
              .map((l) => `<li class="${l.status === 'atrasado' ? 'neg' : ''}"><span>${dateBR(l.vencimento)} · ${esc(l.descricao)}</span><strong>${money(l.valor)}</strong></li>`)
              .join('')}</ul><a href="#/financeiro?aba=despesas">Ver todas as despesas →</a>`
          : '<p class="empty">Nada a pagar nos próximos 7 dias.</p>',
      })}
    </div>`;
  bindTiles(alvo);
}

async function renderDre(alvo) {
  const e = empresaAtual();
  alvo.innerHTML = `
    <div class="toolbar no-print">
      <select id="o-regime" aria-label="Regime"><option value="caixa">Regime de caixa (quando pagou/recebeu)</option><option value="competencia">Regime de competência (mês de referência)</option></select>
      <div><a class="btn ghost" id="btn-csv" href="#">Exportar para Excel</a> <button class="btn ghost" id="btn-print">Imprimir / PDF</button></div>
    </div>
    <div class="panel report" id="relatorio"></div>`;

  async function load() {
    const url = empresaUrl('/relatorios/dre') + qs({ ...estado.periodo, regime: $('#o-regime').value });
    $('#btn-csv').href = '/api' + url + '&formato=csv';
    const d = await api(url);
    const meses = d.meses.length <= 12 ? d.meses : [];
    const receita = d.linhas[0].valores.total || 0;
    const cel = (v) => `<td class="num ${v < 0 ? 'neg' : ''}">${money(v)}</td>`;
    const av = (v) => `<td class="num muted">${receita ? pct((v / receita) * 100) : '—'}</td>`;
    const rows = [];
    for (const l of d.linhas) {
      rows.push(`<tr class="${l.total ? 'total-row' : 'group-row'}"><td>${esc(l.titulo)}</td>${meses.map((m) => cel(l.valores[m])).join('')}${cel(l.valores.total)}${av(l.valores.total)}</tr>`);
      for (const c of l.categorias) rows.push(`<tr class="detail-row"><td>${esc(c.nome)}</td>${meses.map((m) => cel(c.valores[m])).join('')}${cel(c.valores.total)}${av(c.valores.total)}</tr>`);
    }
    $('#relatorio').innerHTML = `
      <div class="report-head">
        <div><h2>DRE gerencial</h2><div class="muted">${esc(nomeEmpresa(e))}</div></div>
        <div class="muted right">Período: ${dateBR(estado.periodo.inicio)} a ${dateBR(estado.periodo.fim)}<br/>Emitido em ${new Date().toLocaleString('pt-BR')}</div>
      </div>
      ${table([{ label: 'Conta' }, ...meses.map((m) => ({ label: mesBR(m), num: true })), { label: 'Total', num: true }, { label: '% receita', num: true }], rows)}
      <p class="report-foot">Margem líquida: <strong>${pct(d.margem_liquida)}</strong> · "% receita" mostra quanto cada linha pesa sobre a receita bruta.</p>`;
  }
  $('#o-regime').addEventListener('change', () => tentar(load));
  $('#btn-print').addEventListener('click', () => window.print());
  await load();
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function proximaSemana() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return iso(d);
}
// Mesmos dias do mês anterior para meses fechados; senão, o mesmo número de dias logo antes.
function periodoAnterior({ inicio, fim }) {
  const i = new Date(inicio + 'T00:00:00');
  const f = new Date(fim + 'T00:00:00');
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const fe = f > hoje && i <= hoje ? hoje : f;
  const fimMes = new Date(f.getFullYear(), f.getMonth() + 1, 0).getTime() === f.getTime();
  if (i.getDate() === 1 && fimMes) {
    const meses = (f.getFullYear() - i.getFullYear()) * 12 + f.getMonth() - i.getMonth() + 1;
    const fa = new Date(fe.getFullYear(), fe.getMonth() - meses, 1);
    fa.setDate(Math.min(fe.getDate(), new Date(fa.getFullYear(), fa.getMonth() + 1, 0).getDate()));
    return { inicio: iso(new Date(i.getFullYear(), i.getMonth() - meses, 1)), fim: iso(fa) };
  }
  const n = Math.round((fe - i) / 864e5) + 1;
  const ini = new Date(i);
  ini.setDate(ini.getDate() - n);
  const fimAnt = new Date(i);
  fimAnt.setDate(fimAnt.getDate() - 1);
  return { inicio: iso(ini), fim: iso(fimAnt) };
}
