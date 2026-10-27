// Plano de ação: criar a partir de um alerta, listar e concluir. Usado no painel, em Pessoas e no perfil.
import { api, esc, dateBR, hoje, field, select, formData, openModal, toast, tentar, linkPessoa } from '../ui.js';
import { estado } from '../estado.js';

/** Abre o formulário de ação. `preset` vem do alerta: { colaborador_id, indicador, acao }. */
export async function abrirAcao(empresaId, preset = {}, onSalvo = () => {}, acao = null) {
  const colabs = await api(`/empresas/${empresaId}/colaboradores`);
  const a = acao || { colaborador_id: preset.colaborador_id, indicador: preset.indicador, descricao: preset.acao, responsavel: estado.user.nome };
  openModal(
    acao ? 'Editar ação' : 'Nova ação',
    `${field('O que fazer *', 'descricao', a.descricao, 'required')}
     <div class="row">${select('Profissional', 'colaborador_id', [['', 'Salão todo'], ...colabs.filter((c) => c.ativo || c.id === a.colaborador_id).map((c) => [c.id, c.nome])], a.colaborador_id)}
       ${field('Indicador de origem', 'indicador', a.indicador, 'placeholder="Ex.: Ticket médio"')}</div>
     <div class="row">${field('Responsável', 'responsavel', a.responsavel)}${field('Prazo', 'prazo', a.prazo || '', 'type="date" min="' + (acao ? '' : hoje()) + '"')}</div>
     ${acao ? select('Situação', 'status', [['aberta', 'Aberta'], ['concluida', 'Concluída']], a.status) : ''}`,
    async (form) => {
      const body = formData(form);
      if (acao) await api(`/empresas/${empresaId}/acoes/${acao.id}`, { method: 'PUT', body });
      else await api(`/empresas/${empresaId}/acoes`, { method: 'POST', body });
      toast('Ação salva no plano');
      await onSalvo();
    }
  );
}

/** Tabela de ações com caixa para concluir. `nomes` mapeia colaborador_id → nome. */
export function acoesHtml(acoes, empresaId, nomes = new Map()) {
  if (!acoes.length) return '<p class="empty">Nenhuma ação no plano. Use "Criar ação" nos alertas.</p>';
  const h = hoje();
  return `<ul class="acoes">${acoes
    .map(
      (a) => `<li class="${a.status === 'concluida' ? 'feita' : a.prazo && a.prazo < h ? 'atrasada' : ''}">
        <input type="checkbox" data-concluir="${a.id}" ${a.status === 'concluida' ? 'checked' : ''} aria-label="Concluir ação" />
        <div><div>${esc(a.descricao)}</div>
          <small class="muted">${a.colaborador_id && nomes.get(a.colaborador_id) ? linkPessoa(empresaId, a.colaborador_id, nomes.get(a.colaborador_id)) + ' · ' : ''}${esc(a.indicador || 'Geral')}${a.responsavel ? ' · ' + esc(a.responsavel) : ''}${a.prazo ? ' · prazo ' + dateBR(a.prazo) : ''}${a.status !== 'concluida' && a.prazo && a.prazo < h ? ' · <strong class="neg">atrasada</strong>' : ''}</small></div>
        <button class="btn ghost small" data-editar-acao="${a.id}">Editar</button>
      </li>`
    )
    .join('')}</ul>`;
}

export function bindAcoes(root, empresaId, acoes, recarregar) {
  root.addEventListener('change', (e) => {
    const id = e.target.dataset?.concluir;
    if (!id) return;
    tentar(async () => {
      await api(`/empresas/${empresaId}/acoes/${id}`, { method: 'PUT', body: { status: e.target.checked ? 'concluida' : 'aberta' } });
      toast(e.target.checked ? 'Ação concluída ✓' : 'Ação reaberta');
      await recarregar();
    });
  });
  root.addEventListener('click', (e) => {
    const id = e.target.dataset?.editarAcao;
    if (id) tentar(() => abrirAcao(empresaId, {}, recarregar, acoes().find((a) => a.id === Number(id))));
  });
}

/** Liga os botões "Criar ação" de uma lista de alertas. */
export function bindAlertas(root, alertas, recarregar, empresaPadrao) {
  root.addEventListener('click', (e) => {
    const i = e.target.dataset?.criarAcao;
    if (i === undefined) return;
    const a = alertas()[Number(i)];
    tentar(() => abrirAcao(a.empresa_id || empresaPadrao, a, recarregar));
  });
}
