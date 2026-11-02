// Pessoas: faturamento e indicadores de cada profissional, pilares e plano de ação do salão.
import { $, api, esc, money, num, qs, table, tile, bindTiles, delta, progresso, notaPill, linkPessoa, alertasHtml, field, formData, openModal, toast, tentar } from '../ui.js';
import { estado, empresaUrl, isEquipe } from '../estado.js';
import { barList } from '../charts.js';
import { abrirAcao, acoesHtml, bindAcoes, bindAlertas } from './acoes.js';

export async function renderPessoas(view, params) {
  const empresaId = estado.empresaId;
  view.innerHTML = `
    <div class="toolbar">
      <span class="hint">Clique no nome do profissional para ver faturamento, serviços, notas dos pilares e ações.</span>
      <div>${isEquipe() ? '<button class="btn ghost" id="novo-prof">Novo profissional</button> ' : ''}<button class="btn primary" id="nova-acao">Nova ação</button></div>
    </div>
    <div id="pessoas"></div>`;
  let d;
  let acoes = [];

  async function load() {
    [d, acoes] = await Promise.all([api(empresaUrl('/pessoas') + qs(estado.periodo)), api(empresaUrl('/acoes'))]);
    const alertas = d.alertas.map((a) => ({ ...a, empresa_id: empresaId }));
    d.alertas = alertas;
    const ativos = d.equipe.filter((c) => c.ativo);
    const nomes = new Map(d.equipe.map((c) => [c.id, c.nome]));
    const abertas = acoes.filter((a) => a.status === 'aberta');
    const pilaresComNota = d.pilares.filter((p) => p.media !== null);
    const pior = [...pilaresComNota].sort((a, b) => a.media - b.media)[0];

    $('#pessoas').innerHTML = `
      <div class="tiles">
        ${tile({
          id: 'equipe',
          titulo: 'Equipe — faturamento e indicadores',
          w: 12,
          mini: `<strong>${ativos.length}</strong> profissionais`,
          body: table(
            [
              { label: 'Profissional' },
              { label: 'Faturamento', num: true },
              { label: 'Atendimentos', num: true },
              { label: 'Serviços', num: true },
              { label: 'Ticket médio', num: true },
              { label: 'Produtos', num: true },
              { label: 'Meta do período' },
              { label: 'Pilares', num: true },
              { label: 'Ações', num: true },
            ],
            d.equipe.map(
              (c) => `<tr class="clickable${c.ativo ? '' : ' inativo'}" data-href="#/pessoas/${empresaId}/${c.id}">
                <td>${linkPessoa(empresaId, c.id, c.nome)}<br/><small class="muted">${esc(c.funcao || '')}${c.ativo ? '' : ' · inativo'}</small></td>
                <td class="num"><strong>${money(c.faturamento)}</strong><br/>${delta(c.variacao)}</td>
                <td class="num">${c.atendimentos}</td>
                <td class="num">${c.servicos}</td>
                <td class="num">${money(c.ticket_medio)}</td>
                <td class="num">${num(c.produtos_pct, 1)}%</td>
                <td>${progresso(c.meta_pct, { titulo: c.projecao_pct !== null ? `Projeção no ritmo atual: ${num(c.projecao_pct, 0)}%` : '' })}</td>
                <td class="num">${notaPill(c.nota)}</td>
                <td class="num">${c.acoes_abertas ? `<span class="badge warn">${c.acoes_abertas}</span>` : '—'}</td>
              </tr>`
            ),
            'Nenhum profissional ainda. Eles são criados automaticamente na primeira coleta do Trinks.'
          ),
        })}
        ${tile({
          id: 'pilares',
          titulo: 'Pilares da equipe (média do mês)',
          w: 6,
          mini: pior ? `menor: <strong>${esc(pior.nome)}</strong> ${num(pior.media, 1)}` : '',
          body: pilaresComNota.length
            ? barList(
                d.pilares.map((p) => ({ ...p, valor: p.media ?? 0 })),
                { labelKey: 'nome', valueKey: 'valor', cls: 'bar-a', showPct: false, max: 10, format: (n) => (n ? num(n, 1) : '—') }
              )
            : '<p class="empty">Nenhuma avaliação no mês. Abra um profissional e clique em "Avaliar pilares".</p>',
        })}
        ${tile({
          id: 'alertas',
          titulo: 'Indicadores → ações sugeridas',
          w: 6,
          mini: `<strong>${alertas.filter((a) => a.nivel !== 'positivo').length}</strong> para tratar`,
          body: `<div id="lista-alertas">${alertasHtml(alertas, { limite: 5 })}</div>`,
          extra: '',
        })}
        ${tile({
          id: 'acoes',
          titulo: 'Plano de ação do salão',
          w: 12,
          mini: `<strong>${abertas.length}</strong> abertas`,
          body: `<div id="acoes-lista">${acoesHtml(abertas, empresaId, nomes)}</div>`,
          extra: `<h4>Concluídas</h4>${acoesHtml(acoes.filter((a) => a.status === 'concluida'), empresaId, nomes)}`,
        })}
      </div>`;

    const tAlertas = $('[data-tile="alertas"]');
    new MutationObserver(() => {
      $('#lista-alertas').innerHTML = alertasHtml(alertas, { limite: tAlertas.classList.contains('focused') ? Infinity : 5 });
    }).observe(tAlertas, { attributes: true, attributeFilter: ['class'] });
    if (params.get('aba') === 'acoes') $('[data-tile="acoes"] [data-expandir]').click();
  }

  const root = $('#pessoas');
  bindTiles(root);
  bindAlertas(root, () => d.alertas, load, empresaId);
  bindAcoes(root, empresaId, () => acoes, load);
  root.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-href]');
    if (tr && !e.target.closest('a')) location.hash = tr.dataset.href;
  });
  $('#nova-acao').addEventListener('click', () => tentar(() => abrirAcao(empresaId, {}, load)));
  if (isEquipe()) $('#novo-prof').addEventListener('click', () => editarProfissional(empresaId, null, load));
  await load();
}

/** Cadastro do profissional. "Nome no Trinks" liga a pessoa às linhas do relatório. */
export function editarProfissional(empresaId, c, onSalvo) {
  openModal(
    c ? 'Editar profissional' : 'Novo profissional',
    `${field('Nome *', 'nome', c?.nome, 'required')}
     <div class="row">${field('Função', 'funcao', c?.funcao, 'placeholder="Ex.: Barbeiro"')}${field('Nome como aparece no Trinks', 'apelido_trinks', c?.apelido_trinks)}</div>
     <div class="row">${field('Meta mensal de faturamento (R$)', 'meta_mensal', c?.meta_mensal ?? 0, 'type="number" step="0.01" min="0"')}
       <label>Situação<select name="ativo"><option value="1" ${c?.ativo === 0 ? '' : 'selected'}>Ativo</option><option value="0" ${c?.ativo === 0 ? 'selected' : ''}>Inativo</option></select></label></div>`,
    async (form) => {
      const body = formData(form);
      if (c) await api(`/empresas/${empresaId}/colaboradores/${c.id}`, { method: 'PUT', body });
      else await api(`/empresas/${empresaId}/colaboradores`, { method: 'POST', body });
      toast('Profissional salvo');
      await onSalvo();
    }
  );
}
