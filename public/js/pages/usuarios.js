import { $, api, esc, dateBR, table, field, select, formData, openModal, toast, tentar, confirmar } from '../ui.js';
import { estado } from '../estado.js';

const PAPEIS = [
  ['analista', 'Analista BPO — opera todos os salões'],
  ['admin', 'Administrador — acesso total e gestão de usuários'],
  ['cliente', 'Dono(a) do salão — vê o próprio salão, avalia a equipe e cuida do plano de ação'],
];
const nomePapel = { admin: 'Administrador', analista: 'Analista BPO', cliente: 'Dono(a) do salão' };

export async function renderUsuarios(view) {
  view.innerHTML = `
    <div class="toolbar"><span class="hint">Donos(as) acessam somente o próprio salão: consultam o financeiro e cuidam das pessoas e do plano de ação.</span><button class="btn primary" id="novo">Novo usuário</button></div>
    <div id="lista"></div>`;

  async function load() {
    const usuarios = await api('/usuarios');
    $('#lista').innerHTML = table(
      [{ label: 'Nome' }, { label: 'E-mail' }, { label: 'Perfil' }, { label: 'Salão' }, { label: 'Situação' }, { label: 'Último acesso' }, { label: '' }],
      usuarios.map(
        (u) => `<tr><td>${esc(u.nome)}</td><td>${esc(u.email)}</td><td>${nomePapel[u.papel]}</td><td>${esc(u.empresa_nome || '—')}</td>
          <td>${u.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge">Inativo</span>'}</td>
          <td>${u.ultimo_acesso ? dateBR(u.ultimo_acesso) : 'nunca'}</td>
          <td class="actions"><button class="btn ghost small" data-action="editar" data-id="${u.id}">Editar</button>
          ${u.id !== estado.user.id ? `<button class="btn danger small" data-action="excluir" data-id="${u.id}">Excluir</button>` : ''}</td></tr>`
      )
    );
  }

  const form = (u = {}) => `
    ${field('Nome *', 'nome', u.nome, 'required')}
    ${field('E-mail *', 'email', u.email, 'type="email" required')}
    ${select('Perfil *', 'papel', PAPEIS, u.papel || 'analista')}
    <div id="campo-empresa">${select('Salão (para perfil dono)', 'empresa_id', [['', '—'], ...estado.empresas.map((e) => [e.id, e.nome_fantasia || e.razao_social])], u.empresa_id)}</div>
    ${u.id ? select('Situação', 'ativo', [['1', 'Ativo'], ['0', 'Inativo']], u.ativo === 0 ? '0' : '1') : ''}
    ${field(u.id ? 'Nova senha (deixe em branco para manter)' : 'Senha * (mín. 8 caracteres)', 'senha', '', `type="password" minlength="8" autocomplete="new-password" ${u.id ? '' : 'required'}`)}`;

  function editar(u) {
    openModal(
      u ? 'Editar usuário' : 'Novo usuário',
      form(u || {}),
      async (f) => {
        const body = formData(f);
        if (body.ativo !== undefined) body.ativo = body.ativo === '1';
        if (!body.senha) delete body.senha;
        if (u) await api(`/usuarios/${u.id}`, { method: 'PUT', body });
        else await api('/usuarios', { method: 'POST', body });
        toast('Usuário salvo');
        await load();
      },
      {
        onOpen(f) {
          const sync = () => ($('#campo-empresa').hidden = f.elements.papel.value !== 'cliente');
          f.elements.papel.addEventListener('change', sync);
          sync();
        },
      }
    );
  }

  $('#lista').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    tentar(async () => {
      const usuarios = await api('/usuarios');
      const u = usuarios.find((x) => x.id === Number(btn.dataset.id));
      if (btn.dataset.action === 'editar') editar(u);
      if (btn.dataset.action === 'excluir' && confirmar(`Excluir o usuário ${u.nome}?`)) {
        await api(`/usuarios/${u.id}`, { method: 'DELETE' });
        toast('Usuário excluído');
        await load();
      }
    });
  });
  $('#novo').addEventListener('click', () => editar(null));

  await load();
}
