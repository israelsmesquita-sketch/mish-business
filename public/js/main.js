import { $, api, esc, toast, initModal, openModal, field, formData, setUnauthorizedHandler, periodoHtml, bindPeriodo } from './ui.js';
import { estado, isEquipe, selecionarEmpresa, empresaSalva, limparCadastros, nomeEmpresa } from './estado.js';
import { renderPainel } from './pages/painel.js';
import { renderFinanceiro } from './pages/financeiro.js';
import { renderPessoas } from './pages/pessoas.js';
import { renderPerfil } from './pages/perfil.js';
import { renderAjustes } from './pages/ajustes.js';

// Só quatro abas. [rota, menu, título, render, visível?, usa o salão selecionado?]
const ROTAS = [
  ['painel', 'Painel', 'Painel de gestão', renderPainel, () => true, false],
  ['financeiro', 'Financeiro', 'Financeiro', renderFinanceiro, () => true, true],
  ['pessoas', 'Pessoas', 'Pessoas', renderPessoas, () => true, true],
  ['ajustes', 'Ajustes', 'Ajustes', renderAjustes, isEquipe, true],
];
const ICONES = { painel: '◧', financeiro: '$', pessoas: '☺', ajustes: '⚙' };

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
  $('#user-name').textContent = `${user.nome} · ${{ admin: 'Administrador', analista: 'Analista BPO', cliente: 'Dono(a)' }[user.papel]}`;
  $('#menu').innerHTML = ROTAS.filter((r) => r[4]())
    .map(([rota, menu]) => `<a href="#/${rota}" data-route="${rota}"><i aria-hidden="true">${ICONES[rota]}</i>${menu}</a>`)
    .join('');
  $('#periodo-global').innerHTML = periodoHtml('per-global', estado.periodo);
  bindPeriodo('per-global', (p) => {
    estado.periodo = p;
    router();
  });
  if (!location.hash) location.hash = '#/painel';
  router();
}

function montarSeletorEmpresa() {
  const sel = $('#empresa-select');
  sel.innerHTML = estado.empresas.length
    ? estado.empresas.map((e) => `<option value="${e.id}" ${e.id === estado.empresaId ? 'selected' : ''}>${esc(nomeEmpresa(e))}</option>`).join('')
    : '<option value="">Nenhum salão cadastrado</option>';
  sel.disabled = !isEquipe() || estado.empresas.length < 2;
}

// Rotas: #/painel, #/financeiro?aba=despesas, #/pessoas, #/pessoas/<salão>/<profissional>, #/ajustes?aba=trinks
async function router() {
  if (!estado.user) return;
  const [caminho, busca = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const [nome, salaoId, pessoaId] = caminho.split('/');
  const params = new URLSearchParams(busca);
  const rota = ROTAS.find((r) => r[0] === nome && r[4]()) || ROTAS[0];
  const [id, , titulo, render, , usaSalao] = rota;

  // Link para um profissional de outro salão: troca o salão selecionado antes de abrir.
  if (id === 'pessoas' && salaoId && estado.empresas.some((e) => e.id === Number(salaoId))) selecionarEmpresa(salaoId);

  $('#page-title').textContent = titulo;
  montarSeletorEmpresa();
  $('#empresa-select').hidden = !usaSalao;
  document.querySelectorAll('#menu a').forEach((a) => a.classList.toggle('active', a.dataset.route === id));

  if (usaSalao && !estado.empresaId) {
    view.innerHTML = `<div class="panel empty">Nenhum salão cadastrado. ${isEquipe() ? '<a href="#/ajustes?aba=saloes">Cadastre o primeiro salão.</a>' : ''}</div>`;
    return;
  }
  view.innerHTML = '<p class="empty">Carregando...</p>';
  try {
    if (id === 'pessoas' && pessoaId) await renderPerfil(view, pessoaId, (t) => ($('#page-title').textContent = t));
    else await render(view, params);
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
  limparCadastros();
  // No perfil de um profissional, trocar de salão volta para a lista da equipe.
  if (/^#\/pessoas\/\d+/.test(location.hash)) location.hash = '#/pessoas';
  else router();
});

window.addEventListener('hashchange', router);

api('/auth/me').then(iniciarSessao, mostrarLogin);
