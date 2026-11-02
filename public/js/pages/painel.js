// Painel de gestão: os salões lado a lado, alertas que viram ações e ranking da equipe.
import { $, api, esc, money, num, pct, mesBR, dateBR, qs, table, delta, kpi, tile, bindTiles, progresso, notaPill, linkPessoa, alertasHtml } from '../ui.js';
import { estado, isEquipe, selecionarEmpresa } from '../estado.js';
import { columnChart } from '../charts.js';
import { bindAlertas } from './acoes.js';

const syncTexto = (s) => {
  if (!s) return '<span class="badge warn">Trinks: sem coleta</span>';
  const quando = `${dateBR(s.criado_em)} ${s.criado_em.slice(11, 16)}`;
  return s.status === 'ok'
    ? `<span class="badge ok" title="${esc(s.mensagem || '')}">Trinks atualizado ${quando}</span>`
    : `<span class="badge danger" title="${esc(s.mensagem || '')}">Trinks: erro em ${quando}</span>`;
};

function salaoTile(s) {
  const v = s.vendas;
  const f = s.financeiro;
  const top = s.equipe.slice(0, 3);
  return tile({
    id: `salao-${s.id}`,
    titulo: s.nome,
    mini: `<strong>${money(v.faturamento)}</strong> ${delta(v.variacao_faturamento)}`,
    body: `
      <div class="mini-kpis">
        <div><span>Faturamento</span><strong>${money(v.faturamento)}</strong>${delta(v.variacao_faturamento)}</div>
        <div><span>Resultado</span><strong class="${f.resultado >= 0 ? 'pos' : 'neg'}">${money(f.resultado)}</strong><small>${pct(f.margem)} margem</small></div>
        <div><span>Ticket médio</span><strong>${money(v.ticket_medio)}</strong>${delta(v.variacao_ticket)}</div>
        <div><span>Atendimentos</span><strong>${num(v.atendimentos, 0)}</strong>${delta(v.variacao_atendimentos)}</div>
      </div>
      <h4>Destaques da equipe</h4>
      <ol class="top-list">${top.map((c) => `<li>${linkPessoa(s.id, c.id, c.nome)}<span>${money(c.faturamento)}</span>${notaPill(c.nota)}</li>`).join('') || '<li class="muted">Sem atendimentos no período</li>'}</ol>
      <div class="tile-foot">${syncTexto(s.ultima_sync)} <a href="#/financeiro" data-salao="${s.id}">Financeiro →</a> <a href="#/pessoas" data-salao="${s.id}">Pessoas →</a></div>`,
    extra: `
      <h4>Receitas × despesas — 12 meses</h4>
      ${columnChart(s.serie.map((m) => ({ ...m, label: mesBR(m.mes) })), {
        labelKey: 'label',
        series: [{ key: 'receitas', label: 'Receitas', cls: 'bar-in' }, { key: 'despesas', label: 'Despesas', cls: 'bar-out' }],
        line: { key: 'resultado', label: 'Resultado', cls: 'line-res' },
        height: 220,
      })}
      <h4>Equipe completa</h4>${equipeTabela(s.equipe.map((c) => ({ ...c, empresa_id: s.id })))}`,
  });
}

function equipeTabela(lista, { salao = false } = {}) {
  return table(
    [{ label: 'Profissional' }, ...(salao ? [{ label: 'Salão' }] : []), { label: 'Faturamento', num: true }, { label: 'Atend.', num: true }, { label: 'Ticket', num: true }, { label: 'Meta' }, { label: 'Pilares', num: true }],
    lista.map(
      (c) => `<tr><td>${linkPessoa(c.empresa_id, c.id, c.nome)}<br/><small class="muted">${esc(c.funcao || '')}</small></td>${salao ? `<td>${esc(c.salao)}</td>` : ''}
        <td class="num">${money(c.faturamento)} ${delta(c.variacao)}</td><td class="num">${c.atendimentos}</td><td class="num">${money(c.ticket_medio)}</td>
        <td>${progresso(c.meta_pct, { titulo: c.projecao_pct !== null ? `Projeção no ritmo atual: ${num(c.projecao_pct, 0)}%` : '' })}</td><td class="num">${notaPill(c.nota)}</td></tr>`
    ),
    'Nenhum profissional cadastrado.'
  );
}

export async function renderPainel(view) {
  view.innerHTML = '<div id="painel"></div>';
  let dados;

  async function load() {
    dados = await api('/painel' + qs(estado.periodo));
    const t = dados.totais;
    const a = dados.periodo_anterior;
    const lider = dados.ranking[0];

    $('#painel').innerHTML = `
      <p class="hint">Comparação com ${dateBR(a.inicio)} a ${dateBR(a.fim)} · clique em ⤢ para ampliar um painel e recolher os outros.</p>
      <div class="cards kpis">
        ${kpi({ label: 'Faturamento (Trinks)', value: money(t.faturamento), sub: delta(t.variacao_faturamento), href: '#/pessoas' })}
        ${kpi({ label: 'Despesas pagas', value: money(t.despesas), cls: 'neg', sub: delta(t.variacao_despesas, { inverso: true }), href: '#/financeiro?aba=despesas' })}
        ${kpi({ label: 'Resultado', value: money(t.resultado), cls: t.resultado >= 0 ? 'pos' : 'neg', sub: `margem ${pct(t.margem)}`, href: '#/financeiro' })}
        ${kpi({ label: 'Ticket médio', value: money(t.ticket_medio), sub: `${num(t.atendimentos, 0)} atendimentos`, href: '#/pessoas' })}
        ${kpi({ label: 'Plano de ação', value: `${t.acoes_abertas} <small>abertas</small>`, sub: `${dados.alertas.filter((x) => x.nivel === 'alerta').length} alerta(s) para agir`, href: '#/pessoas?aba=acoes' })}
      </div>
      <div class="tiles" id="tiles" tabindex="-1">
        ${dados.saloes.map(salaoTile).join('')}
        ${tile({
          id: 'alertas',
          titulo: 'Alertas → ações',
          w: 6,
          mini: `<strong>${dados.alertas.filter((x) => x.nivel !== 'positivo').length}</strong> para tratar`,
          body: `<div id="lista-alertas">${alertasHtml(dados.alertas, { limite: 5 })}</div>`,
          extra: '',
        })}
        ${tile({
          id: 'ranking', troca: true,
          titulo: 'Ranking de profissionais',
          w: 6,
          mini: lider ? `<strong>${esc(lider.nome.split(' ')[0])}</strong> ${money(lider.faturamento)}` : '',
          body: `<ol class="top-list">${dados.ranking
            .slice(0, 6)
            .map((c) => `<li>${linkPessoa(c.empresa_id, c.id, c.nome)}<small class="muted">${esc(c.salao)}</small><span>${money(c.faturamento)}</span>${notaPill(c.nota)}</li>`)
            .join('')}</ol>`,
          extra: equipeTabela(dados.ranking, { salao: dados.saloes.length > 1 }),
        })}
        ${tile({
          id: 'fluxo',
          titulo: dados.saloes.length > 1 ? 'Receitas × despesas — consolidado 12 meses' : 'Receitas × despesas — 12 meses',
          w: 12,
          mini: `<strong class="${t.resultado >= 0 ? 'pos' : 'neg'}">${money(t.resultado)}</strong>`,
          body: columnChart(dados.serie.map((m) => ({ ...m, label: mesBR(m.mes) })), {
            labelKey: 'label',
            series: [{ key: 'receitas', label: 'Receitas', cls: 'bar-in' }, { key: 'despesas', label: 'Despesas', cls: 'bar-out' }],
            line: { key: 'resultado', label: 'Resultado', cls: 'line-res' },
          }),
        })}
      </div>`;

    // Painel de alertas ampliado mostra a lista completa.
    const tAlertas = $('[data-tile="alertas"]');
    new MutationObserver(() => {
      $('#lista-alertas').innerHTML = alertasHtml(dados.alertas, { limite: tAlertas.classList.contains('focused') ? Infinity : 5 });
    }).observe(tAlertas, { attributes: true, attributeFilter: ['class'] });
  }

  const root = $('#painel');
  bindTiles(root);
  bindAlertas(root, () => dados.alertas, load);
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-salao]');
    if (a) selecionarEmpresa(a.dataset.salao);
  });
  await load();
  if (!isEquipe() && !dados.saloes.length) root.innerHTML = '<div class="panel empty">Seu usuário não está vinculado a um salão.</div>';
}
