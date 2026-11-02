// Utilitários compartilhados pelas páginas.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (n) => brl.format(Number(n) || 0);
export const num = (n, d = 1) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: d });
export const pct = (n) => `${num(n)}%`;
export const dateBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
export const mesBR = (ym) => {
  const [a, m] = ym.split('-');
  return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1] + '/' + a.slice(2);
};

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hoje = () => isoDate();
export const inicioMes = () => hoje().slice(0, 8) + '01';
export const fimMes = () => {
  const d = new Date();
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => (onUnauthorized = fn);

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Requested-With': 'mish' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
  if (!res.ok) throw new Error(data.erro || 'Erro inesperado');
  return data;
}

export const qs = (obj) => {
  const p = new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v != null));
  const s = p.toString();
  return s ? '?' + s : '';
};

let toastTimer;
export function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3200);
}

/** Runs an async action and shows its error as a toast. */
export async function tentar(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
  }
}

export function table(headers, rows, emptyMsg = 'Nenhum registro encontrado.', foot = '') {
  const head = headers.map((h) => `<th class="${h.num ? 'num' : ''}">${esc(h.label)}</th>`).join('');
  const body = rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty">${esc(emptyMsg)}</td></tr>`;
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot ? `<tfoot>${foot}</tfoot>` : ''}</table></div>`;
}

export function badge(status) {
  const map = {
    pago: ['ok', 'Pago'],
    aberto: ['info', 'Em aberto'],
    atrasado: ['danger', 'Atrasado'],
    receita: ['ok', 'Receita'],
    despesa: ['danger', 'Despesa'],
    conciliado: ['ok', 'Conciliado'],
    pendente: ['warn', 'Pendente'],
  };
  const [cls, label] = map[status] || ['', status];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// ---------- Formulários ----------

export function field(label, name, value = '', attrs = '') {
  return `<label>${esc(label)}<input name="${name}" value="${esc(value)}" ${attrs} /></label>`;
}

export function select(label, name, options, value = '', attrs = '') {
  const opts = options
    .map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(t)}</option>`)
    .join('');
  return `<label>${esc(label)}<select name="${name}" ${attrs}>${opts}</select></label>`;
}

export const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ---------- Modal ----------

const modal = () => $('#modal');

/**
 * Opens the modal with `html` as body. If `onSubmit(form)` throws, the error is shown
 * inside the modal; when it resolves the modal closes.
 */
export function openModal(title, html, onSubmit, { submitLabel = 'Salvar', onOpen, hideCancel = false } = {}) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-error').textContent = '';
  $('#modal-submit').textContent = submitLabel;
  $('#modal-cancel').hidden = hideCancel;
  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('#modal-submit');
    btn.disabled = true;
    try {
      await onSubmit(form);
      modal().close();
    } catch (err) {
      $('#modal-error').textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  if (onOpen) onOpen(form);
  modal().showModal();
}

export function initModal() {
  $('#modal-cancel').addEventListener('click', () => modal().close());
}

export function confirmar(msg) {
  return window.confirm(msg);
}

/** Period filter (início/fim) with quick presets; calls onChange({inicio, fim}). */
export function periodoHtml(id, { inicio = inicioMes(), fim = fimMes() } = {}) {
  return `<div class="periodo" id="${id}">
    <select data-preset aria-label="Período rápido">
      <option value="mes">Este mês</option>
      <option value="mes-1">Mês passado</option>
      <option value="tri">Últimos 3 meses</option>
      <option value="ano">Este ano</option>
      <option value="12m">Últimos 12 meses</option>
      <option value="custom">Personalizado</option>
    </select>
    <input type="date" data-inicio value="${inicio}" aria-label="Início" />
    <span>até</span>
    <input type="date" data-fim value="${fim}" aria-label="Fim" />
  </div>`;
}

export function bindPeriodo(id, onChange) {
  const root = $('#' + id);
  const ini = $('[data-inicio]', root);
  const fim = $('[data-fim]', root);
  const preset = $('[data-preset]', root);
  preset.addEventListener('change', () => {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth();
    const range = {
      mes: [new Date(y, m, 1), new Date(y, m + 1, 0)],
      'mes-1': [new Date(y, m - 1, 1), new Date(y, m, 0)],
      tri: [new Date(y, m - 2, 1), new Date(y, m + 1, 0)],
      ano: [new Date(y, 0, 1), new Date(y, 11, 31)],
      '12m': [new Date(y, m - 11, 1), new Date(y, m + 1, 0)],
    }[preset.value];
    if (!range) return;
    ini.value = isoDate(range[0]);
    fim.value = isoDate(range[1]);
    onChange(get());
  });
  const get = () => ({ inicio: ini.value, fim: fim.value });
  for (const el of [ini, fim]) {
    el.addEventListener('change', () => {
      preset.value = 'custom';
      if (ini.value && fim.value) onChange(get());
    });
  }
  return get;
}

// ---------- Blocos do painel de gestão ----------

/** Variação vs. período anterior. `inverso` para indicadores em que subir é ruim (despesas). */
export function delta(v, { inverso = false } = {}) {
  if (v === null || v === undefined) return '<span class="delta">— sem base</span>';
  const bom = inverso ? v <= 0 : v >= 0;
  if (Math.abs(v) < 0.5) return '<span class="delta" title="vs. período anterior">= estável</span>';
  return `<span class="delta ${bom ? 'up' : 'down'}" title="vs. período anterior">${v >= 0 ? '▲' : '▼'} ${num(Math.abs(v), 0)}%</span>`;
}

/** Cartão de indicador. Com `href`, o cartão inteiro vira link para o detalhe. */
export function kpi({ label, value, sub = '', cls = '', href = '' }) {
  const inner = `<div class="label">${esc(label)}</div><div class="value ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
  return href ? `<a class="card kpi link" href="${href}">${inner}</a>` : `<div class="card kpi">${inner}</div>`;
}

/**
 * Painel expansível. Clicar em ⤢ (ou num painel recolhido) amplia este painel e recolhe os demais
 * em uma faixa com o número principal de cada um (`mini`). `extra` só aparece quando ampliado.
 */
export function tile({ id, titulo, mini = '', body, extra = '', w = 6, troca = false }) {
  // troca: ampliado, o conteúdo `extra` substitui o `body` em vez de vir abaixo dele.
  return `<section class="tile w${w}${troca ? ' troca' : ''}" data-tile="${id}">
    <header class="tile-head">
      <h3>${esc(titulo)}</h3>
      <div class="tile-mini">${mini}</div>
      <button class="tile-btn" type="button" data-expandir aria-label="Ampliar ${esc(titulo)}" title="Ampliar / recolher">⤢</button>
    </header>
    <div class="tile-body">${body}</div>
    ${extra ? `<div class="tile-extra">${extra}</div>` : ''}
  </section>`;
}

export function bindTiles(root) {
  const focar = (alvo) => {
    const aplicar = () => {
      const atual = $('.tile.focused', root);
      const novo = alvo && alvo !== atual ? alvo : null;
      $$('.tile', root).forEach((t) => {
        t.classList.toggle('focused', t === novo);
        $('[data-expandir]', t).textContent = t === novo ? '⤡' : '⤢';
      });
      root.classList.toggle('has-focus', Boolean(novo));
      if (novo) novo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    // Animação suave entre os dois layouts quando o navegador suporta.
    if (document.startViewTransition) document.startViewTransition(aplicar);
    else aplicar();
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t) return;
    if (e.target.closest('[data-expandir]')) return focar(t);
    // Painel recolhido: qualquer clique nele amplia (links internos continuam funcionando).
    if (root.classList.contains('has-focus') && !t.classList.contains('focused') && !e.target.closest('a, button')) focar(t);
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('has-focus')) focar(null);
  });
}

/** Barra de progresso (meta). Em SVG porque a CSP não permite estilos inline. */
export function progresso(p, { titulo = '' } = {}) {
  if (p === null || p === undefined) return '<span class="muted">sem meta</span>';
  const w = Math.max(0, Math.min(100, p));
  const cls = p >= 100 ? 'g-ok' : p >= 80 ? 'g-warn' : 'g-bad';
  return `<span class="progresso" title="${esc(titulo)}"><svg viewBox="0 0 100 8" preserveAspectRatio="none"><rect class="track" width="100" height="8" rx="4" /><rect class="${cls}" width="${w}" height="8" rx="4" /></svg><small>${num(p, 0)}%</small></span>`;
}

export function notaPill(n) {
  if (n === null || n === undefined) return '<span class="nota vazia" title="Sem avaliação">—</span>';
  return `<span class="nota ${n >= 8 ? 'ok' : n >= 7 ? 'warn' : 'bad'}" title="Nota média dos pilares">${num(n, 1)}</span>`;
}

/** Link para o perfil do profissional (troca o salão selecionado se for preciso). */
export const linkPessoa = (empresaId, id, nome) => `<a class="pessoa-link" href="#/pessoas/${empresaId}/${id}">${esc(nome)}</a>`;

const NIVEL = { alerta: ['danger', 'Agir'], atencao: ['warn', 'Atenção'], positivo: ['ok', 'Positivo'] };
/** Lista de alertas; cada um tem o botão "Criar ação" com a sugestão já preenchida. */
export function alertasHtml(alertas, { limite = Infinity, vazio = 'Nenhum alerta no período. 👏' } = {}) {
  if (!alertas.length) return `<p class="empty">${esc(vazio)}</p>`;
  return `<ul class="alertas">${alertas
    .slice(0, limite)
    .map((a, i) => {
      const [cls, rotulo] = NIVEL[a.nivel];
      const quem = a.colaborador_id && a.empresa_id ? linkPessoa(a.empresa_id, a.colaborador_id, a.colaborador) + ' · ' : '';
      return `<li class="alerta ${cls}">
        <span class="badge ${cls}">${rotulo}</span>
        <div><div>${esc(a.texto)}</div><small class="muted">${quem}${esc(a.indicador)} → sugestão: ${esc(a.acao)}</small></div>
        ${a.nivel !== 'positivo' ? `<button class="btn ghost small" data-criar-acao="${i}">Criar ação</button>` : ''}
      </li>`;
    })
    .join('')}</ul>${alertas.length > limite ? `<p class="hint">+ ${alertas.length - limite} alerta(s). Amplie o painel para ver todos.</p>` : ''}`;
}
