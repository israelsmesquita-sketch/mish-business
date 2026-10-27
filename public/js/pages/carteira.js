import { $, api, esc, money, dateBR, table, qs, periodoHtml, bindPeriodo } from '../ui.js';
import { selecionarEmpresa } from '../estado.js';

export async function renderCarteira(view) {
  view.innerHTML = `
    <div class="toolbar">${periodoHtml('per-carteira')}</div>
    <div id="carteira"></div>`;

  const load = async (p) => {
    const d = await api('/bi/carteira' + qs(p));
    const t = d.totais;
    $('#carteira').innerHTML = `
      <div class="cards">
        <div class="card"><div class="label">Empresas ativas</div><div class="value">${t.empresas}</div></div>
        <div class="card"><div class="label">Receitas realizadas (carteira)</div><div class="value pos">${money(t.receitas)}</div></div>
        <div class="card"><div class="label">Despesas realizadas (carteira)</div><div class="value neg">${money(t.despesas)}</div></div>
        <div class="card"><div class="label">Pendências</div><div class="value">${t.atrasados} <small>atrasados</small> · ${t.extrato_pendente} <small>a conciliar</small></div></div>
      </div>
      <div class="panel">
        <h3>Situação por empresa</h3>
        <p class="hint">Clique em uma empresa para abrir o painel dela.</p>
        ${table(
          [
            { label: 'Empresa' },
            { label: 'Receitas', num: true },
            { label: 'Despesas', num: true },
            { label: 'Resultado', num: true },
            { label: 'Receber vencido', num: true },
            { label: 'Pagar vencido', num: true },
            { label: 'Vence 7 dias', num: true },
            { label: 'A conciliar', num: true },
            { label: 'Últ. extrato' },
          ],
          d.empresas.map(
            (e) => `<tr class="clickable${e.ativo ? '' : ' inativo'}" data-id="${e.id}">
              <td><strong>${esc(e.nome_fantasia || e.razao_social)}</strong>${e.ativo ? '' : ' <span class="badge">Inativa</span>'}</td>
              <td class="num">${money(e.receitas)}</td>
              <td class="num">${money(e.despesas)}</td>
              <td class="num ${e.resultado >= 0 ? 'pos' : 'neg'}">${money(e.resultado)}</td>
              <td class="num ${e.receber_atrasado ? 'neg' : ''}">${money(e.receber_atrasado)}</td>
              <td class="num ${e.pagar_atrasado ? 'neg' : ''}">${money(e.pagar_atrasado)}</td>
              <td class="num">${e.vencendo_7d}</td>
              <td class="num">${e.extrato_pendente ? `<span class="badge warn">${e.extrato_pendente}</span>` : '<span class="badge ok">0</span>'}</td>
              <td>${e.ultima_importacao ? dateBR(e.ultima_importacao) : '—'}</td>
            </tr>`
          ),
          'Nenhuma empresa cadastrada.'
        )}
      </div>`;
  };

  $('#carteira').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    selecionarEmpresa(tr.dataset.id);
    location.hash = '#/bi';
  });

  const get = bindPeriodo('per-carteira', load);
  await load(get());
}
