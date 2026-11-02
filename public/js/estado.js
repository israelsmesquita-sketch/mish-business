// Estado global da sessão: usuário logado, empresas acessíveis e empresa selecionada.

const pad = (n) => String(n).padStart(2, '0');
const hojeD = new Date();
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const estado = {
  user: null,
  empresas: [],
  empresaId: null,
  // Período global (barra do topo), usado por todas as telas. Padrão: mês atual.
  periodo: { inicio: iso(new Date(hojeD.getFullYear(), hojeD.getMonth(), 1)), fim: iso(new Date(hojeD.getFullYear(), hojeD.getMonth() + 1, 0)) },
};

export const isEquipe = () => estado.user && estado.user.papel !== 'cliente';
export const isAdmin = () => estado.user && estado.user.papel === 'admin';
export const nomeEmpresa = (e) => (e ? e.nome_fantasia || e.razao_social : '');
export const empresaAtual = () => estado.empresas.find((e) => e.id === estado.empresaId);
export const empresaUrl = (path = '') => `/empresas/${estado.empresaId}${path}`;

export function selecionarEmpresa(id) {
  estado.empresaId = Number(id) || null;
  try {
    localStorage.setItem('mish.empresa', String(estado.empresaId));
  } catch {
    /* storage indisponível */
  }
}

export async function recarregarEmpresas(api) {
  estado.empresas = await api('/empresas');
  if (!estado.empresas.some((e) => e.id === estado.empresaId)) selecionarEmpresa(estado.empresas[0]?.id);
}

export function empresaSalva() {
  try {
    return Number(localStorage.getItem('mish.empresa')) || null;
  } catch {
    return null;
  }
}

// Cache de cadastros da empresa atual (categorias e contas) usado em formulários e filtros.
const cache = new Map();
export async function cadastros(api) {
  const key = estado.empresaId;
  if (!cache.has(key)) {
    cache.set(
      key,
      Promise.all([api(empresaUrl('/categorias')), api(empresaUrl('/contas'))]).then(([categorias, contas]) => ({ categorias, contas }))
    );
  }
  try {
    return await cache.get(key);
  } catch (err) {
    cache.delete(key);
    throw err;
  }
}
export const limparCadastros = () => cache.clear();
