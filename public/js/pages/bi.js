import { $, api, esc, money, pct, mesBR, table, qs, periodoHtml, bindPeriodo } from '../ui.js';
import { empresaUrl } from '../estado.js';
import { columnChart, barList, gauge } from '../charts.js';

export async function renderBi(view) {
  view.innerHTML = `
    <div class="toolbar">${periodoHtml('per-bi')}</div>
    <div id="bi"></div>`;

  const load = async (p) => {
    const d = await api(empresaUrl('/bi') + qs(p));
    const k = d.kpis;
    const fluxo = d.fluxo_mensal.map((m) => ({ ...m, label: mesBR(m.mes) }));
    const temPrevisto = fluxo.some((m) => m.receitas_previstas || m.despesas_previstas);

    $('#bi').innerHTML = `
      <div class="cards">
        <div class="card"><div class="label">Receitas realizadas</div><div class="value pos">${money(k.receitas)}</div></div>
        <div class="card"><div class="label">Despesas realizadas</div><div class="value neg">${money(k.despesas)}</div></div>
        <div class="card"><div class="label">Resultado · margem</div><div class="value ${k.resultado >= 0 ? 'pos' : 'neg'}">${money(k.resultado)} <small>${pct(k.margem)}</small></div></div>
        <div class="card"><div class="label">Saldo bancário (sistema)</div><div class="value">${money(k.saldo_bancario)}</div></div>
      </div>
      <div class="cards">
        <div class="card"><div class="label">A receber (em aberto)</div><div class="value">${money(k.a_receber)}</div><div class="sub">vencido: <span class="neg">${money(k.receber_atrasado)}</span></div></div>
        <div class="card"><div class="label">A pagar (em aberto)</div><div class="value">${money(k.a_pagar)}</div><div class="sub">vencido: <span class="neg">${money(k.pagar_atrasado)}</span></div></div>
        <div class="card"><div class="label">Inadimplência</div><div class="value ${k.inadimplencia > 10 ? 'neg' : ''}">${pct(k.inadimplencia)}</div><div class="sub">do total a receber está vencido</div></div>
        <div class="card card-gauge">${gauge(k.conciliacao_percentual, 'Extrato conciliado')}<div><div class="label">Extrato conciliado</div><div class="sub">${k.extrato_pendente} transação(ões) pendente(s)</div></div></div>
      </div>

      <div class="panel">
        <h3>Fluxo de caixa — últimos 12 meses</h3>
        ${columnChart(fluxo, {
          labelKey: 'label',
          series: [
            { key: 'receitas', label: 'Receitas', cls: 'bar-in' },
            { key: 'despesas', label: 'Despesas', cls: 'bar-out' },
            ...(temPrevisto ? [{ key: 'receitas_previstas', label: 'A receber', cls: 'bar-in-prev' }, { key: 'despesas_previstas', label: 'A pagar', cls: 'bar-out-prev' }] : []),
          ],
          line: { key: 'resultado', label: 'Resultado', cls: 'line-res' },
        })}
      </div>

      <div class="grid-2">
        <div class="panel"><h3>Despesas por categoria</h3>${barList(d.despesas_por_categoria, { labelKey: 'categoria', valueKey: 'valor', cls: 'bar-out' })}</div>
        <div class="panel"><h3>Receitas por categoria</h3>${barList(d.receitas_por_categoria, { labelKey: 'categoria', valueKey: 'valor', cls: 'bar-in' })}</div>
        <div class="panel"><h3>Aging — contas a receber</h3>${barList(d.aging_receber, { labelKey: 'faixa', valueKey: 'valor', cls: 'bar-in', showPct: false, empty: 'Nada a receber.' })}</div>
        <div class="panel"><h3>Aging — contas a pagar</h3>${barList(d.aging_pagar, { labelKey: 'faixa', valueKey: 'valor', cls: 'bar-out', showPct: false, empty: 'Nada a pagar.' })}</div>
        <div class="panel"><h3>Maiores clientes</h3>${barList(d.maiores_clientes, { labelKey: 'contraparte', valueKey: 'valor', cls: 'bar-in' })}</div>
        <div class="panel"><h3>Maiores fornecedores</h3>${barList(d.maiores_fornecedores, { labelKey: 'contraparte', valueKey: 'valor', cls: 'bar-out' })}</div>
      </div>

      <div class="panel">
        <h3>Saldos por conta bancária</h3>
        ${table(
          [{ label: 'Conta' }, { label: 'Banco' }, { label: 'Saldo', num: true }],
          d.contas.map((c) => `<tr><td>${esc(c.descricao)}</td><td>${esc(c.banco)}</td><td class="num ${c.saldo >= 0 ? '' : 'neg'}">${money(c.saldo)}</td></tr>`),
          'Nenhuma conta bancária cadastrada.'
        )}
      </div>`;
  };

  const get = bindPeriodo('per-bi', load);
  await load(get());
}
