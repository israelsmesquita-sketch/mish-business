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
