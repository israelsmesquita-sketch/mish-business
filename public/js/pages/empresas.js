import { $, api, esc, table, field, select, formData, openModal, toast, tentar, confirmar } from '../ui.js';
import { isAdmin, recarregarEmpresas, selecionarEmpresa } from '../estado.js';

export async function renderEmpresas(view) {
  view.innerHTML = `
    <div class="toolbar"><span class="hint">Cada nova empresa recebe automaticamente um plano de contas padrão.</span><button class="btn primary" id="nova">Nova empresa</button></div>
    <div id="lista"></div>`;

  async function load() {
    const empresas = await api('/empresas');
    $('#lista').innerHTML = table(
      [{ label: 'Razão social' }, { label: 'Nome fantasia' }, { label: 'CNPJ' }, { label: 'Responsável' }, { label: 'Contato' }, { label: 'Situação' }, { label: '' }],
      empresas.map(
        (e) => `<tr><td>${esc(e.razao_social)}</td><td>${esc(e.nome_fantasia)}</td><td>${esc(e.cnpj)}</td><td>${esc(e.responsavel)}</td>
          <td>${esc(e.email)}${e.telefone ? '<br/>' + esc(e.telefone) : ''}</td>
          <td>${e.ativo ? '<span class="badge ok">Ativa</span>' : '<span class="badge">Inativa</span>'}</td>
          <td class="actions"><button class="btn ghost small" data-action="abrir" data-id="${e.id}">Abrir</button>
            <button class="btn ghost small" data-action="editar" data-id="${e.id}">Editar</button>
            ${isAdmin() ? `<button class="btn danger small" data-action="excluir" data-id="${e.id}">Excluir</button>` : ''}</td></tr>`
      ),
      'Nenhuma empresa cadastrada.'
    );
  }

  const form = (e = {}) => `
    ${field('Razão social *', 'razao_social', e.razao_social, 'required')}
    <div class="row">${field('Nome fantasia', 'nome_fantasia', e.nome_fantasia)}${field('CNPJ', 'cnpj', e.cnpj, 'placeholder="00.000.000/0000-00"')}</div>
    <div class="row">${field('E-mail financeiro', 'email', e.email, 'type="email"')}${field('Telefone', 'telefone', e.telefone)}</div>
    <div class="row">${field('Responsável', 'responsavel', e.responsavel)}${select('Situação', 'ativo', [['1', 'Ativa'], ['0', 'Inativa']], e.ativo === 0 ? '0' : '1')}</div>`;

  function editar(e) {
    openModal(e ? 'Editar empresa' : 'Nova empresa cliente', form(e || {}), async (f) => {
      const body = formData(f);
      if (e) await api(`/empresas/${e.id}`, { method: 'PUT', body });
      else selecionarEmpresa((await api('/empresas', { method: 'POST', body })).id);
      await recarregarEmpresas(api);
      toast('Empresa salva');
      await load();
    });
  }

  $('#lista').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-id]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    tentar(async () => {
      if (btn.dataset.action === 'abrir') {
        selecionarEmpresa(id);
        location.hash = '#/bi';
      }
      if (btn.dataset.action === 'editar') editar(await api(`/empresas/${id}`));
      if (btn.dataset.action === 'excluir' && confirmar('Excluir a empresa e TODOS os seus dados financeiros? Esta ação não pode ser desfeita.')) {
        await api(`/empresas/${id}`, { method: 'DELETE' });
        await recarregarEmpresas(api);
        toast('Empresa excluída');
        await load();
      }
    });
  });
  $('#nova').addEventListener('click', () => editar(null));

  await load();
}
