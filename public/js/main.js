import { $, api, esc, toast, initModal, openModal, field, formData, setUnauthorizedHandler } from './ui.js';
import { estado, isEquipe, isAdmin, selecionarEmpresa, empresaSalva, limparCadastros } from './estado.js';
import { renderCarteira } from './pages/carteira.js';
import { renderBi } from './pages/bi.js';
import { renderLancamentos } from './pages/lancamentos.js';
import { renderConciliacao } from './pages/conciliacao.js';
import { renderRelatorios } from './pages/relatorios.js';
import { renderCadastros } from './pages/cadastros.js';
import { renderEmpresas } from './pages/empresas.js';
import { renderUsuarios } from './pages/usuarios.js';

// [rota, título, render, visível?, precisa de empresa selecionada?]
const ROTAS = [
  ['carteira', 'Carteira BPO', renderCarteira, isEquipe, false],
  ['bi', 'B.I. — Painel financeiro', renderBi, () => true, true],
  ['lancamentos', 'Contas a pagar e receber', renderLancamentos, () => true, true],
  ['conciliacao', 'Conciliação bancária', renderConciliacao, () => true, true],
  ['relatorios', 'Relatórios', renderRelatorios, () => true, true],
  ['cadastros', 'Plano de contas e bancos', renderCadastros, () => true, true],
  ['empresas', 'Empresas clientes', renderEmpresas, isEquipe, false],
  ['usuarios', 'Usuários e acessos', renderUsuarios, isAdmin, false],
];

const MENU_LABEL = {
  carteira: 'Carteira',
  bi: 'B.I.',
  lancamentos: 'Pagar e receber',
  conciliacao: 'Conciliação',
  relatorios: 'Relatórios',
  cadastros: 'Cadastros',
  empresas: 'Empresas',
  usuarios: 'Usuários',
};

const view = $('#view');

function mostrarLogin() {
  estado.user = null;
  $('#shell').hidden = true;
  $('#login').hidden = false;
  $('#login-form [name=email]').focus();
}

async function iniciarSessao(user) {
  estado.user = user;
  estado.empresas = await api('/empresas');
  const salva = empresaSalva();
  const padrao = user.empresa_id || (estado.empresas.some((e) => e.id === salva) ? salva : estado.empresas[0]?.id);
  selecionarEmpresa(padrao);

  $('#login').hidden = true;
  $('#shell').hidden = false;
  $('#user-name').textContent = `${user.nome} · ${{ admin: 'Administrador', analista: 'Analista BPO', cliente: 'Cliente' }[user.papel]}`;
  montarMenu();
  montarSeletorEmpresa();
  if (!location.hash) location.hash = isEquipe() ? '#/carteira' : '#/bi';
  router();
}

function montarMenu() {
  $('#menu').innerHTML = ROTAS.filter((r) => r[3]())
    .map(([rota]) => `<a href="#/${rota}" data-route="${rota}">${MENU_LABEL[rota]}</a>`)
    .join('');
}

function montarSeletorEmpresa() {
  const sel = $('#empresa-select');
  sel.innerHTML = estado.empresas.length
    ? estado.empresas.map((e) => `<option value="${e.id}" ${e.id === estado.empresaId ? 'selected' : ''}>${esc(e.nome_fantasia || e.razao_social)}</option>`).join('')
    : '<option value="">Nenhuma empresa cadastrada</option>';
  sel.disabled = !isEquipe() || !estado.empresas.length;
}

async function router() {
  if (!estado.user) return;
  const nome = location.hash.replace('#/', '').split('?')[0];
  const rota = ROTAS.find((r) => r[0] === nome && r[3]()) || ROTAS.find((r) => r[3]());
  const [id, titulo, render, , precisaEmpresa] = rota;
  $('#page-title').textContent = titulo;
  montarSeletorEmpresa();
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('active', a.dataset.route === id));
  $('#empresa-select').parentElement.classList.toggle('hide-empresa', !precisaEmpresa);

  if (precisaEmpresa && !estado.empresaId) {
    view.innerHTML = `<div class="panel empty">Nenhuma empresa cadastrada. ${isEquipe() ? '<a href="#/empresas">Cadastre a primeira empresa cliente.</a>' : ''}</div>`;
    return;
  }
  view.innerHTML = '<p class="empty">Carregando...</p>';
  try {
    await render(view);
  } catch (err) {
    view.innerHTML = `<div class="panel empty">Erro ao carregar: ${esc(err.message)}</div>`;
  }
}

// ---------- Eventos ----------

initModal();
setUnauthorizedHandler(mostrarLogin);

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  $('#login-error').textContent = '';
  try {
    const user = await api('/auth/login', { method: 'POST', body: formData(e.target) });
    e.target.reset();
    await iniciarSessao(user);
  } catch (err) {
    $('#login-error').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('#btn-sair').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  limparCadastros();
  location.hash = '';
  mostrarLogin();
});

$('#btn-senha').addEventListener('click', () =>
  openModal(
    'Alterar senha',
    `${field('Senha atual', 'senha_atual', '', 'type="password" required autocomplete="current-password"')}
     ${field('Nova senha (mín. 8 caracteres)', 'nova_senha', '', 'type="password" minlength="8" required autocomplete="new-password"')}`,
    async (form) => {
      await api('/auth/senha', { method: 'POST', body: formData(form) });
      toast('Senha alterada com sucesso');
    }
  )
);

$('#empresa-select').addEventListener('change', (e) => {
  selecionarEmpresa(e.target.value);
  router();
});

window.addEventListener('hashchange', router);

api('/auth/me').then(iniciarSessao, mostrarLogin);
