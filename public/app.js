'use strict';

// ---------- Utilitários ----------

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (n) => brl.format(Number(n) || 0);
const dateBR = (s) => (s ? new Date(s.replace(' ', 'T') + (s.length > 10 ? 'Z' : 'T00:00:00')).toLocaleDateString('pt-BR') : '');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const FORMAS = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  cartao_credito: 'Cartão de crédito',
  cartao_debito: 'Cartão de débito',
  boleto: 'Boleto',
};

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || 'Erro inesperado');
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2800);
}

function table(headers, rows, emptyMsg = 'Nenhum registro encontrado.') {
  const head = headers.map((h) => `<th class="${h.num ? 'num' : ''}">${esc(h.label)}</th>`).join('');
  const body = rows.length ? rows.join('') : `<tr><td colspan="${headers.length}" class="empty">${esc(emptyMsg)}</td></tr>`;
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------- Modal de formulário ----------

const modal = $('#modal');
$('#modal-cancel').addEventListener('click', () => modal.close());

/**
 * Opens the modal with `html` as body. `onSubmit(form)` may throw to show an error;
 * when it resolves the modal closes.
 */
function openModal(title, html, onSubmit, { submitLabel = 'Salvar', onOpen } = {}) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-error').textContent = '';
  $('#modal-submit').textContent = submitLabel;
  const form = $('#modal-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await onSubmit(form);
      modal.close();
    } catch (err) {
      $('#modal-error').textContent = err.message;
    }
  };
  if (onOpen) onOpen(form);
  modal.showModal();
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

function field(label, name, value = '', attrs = '') {
  return `<label>${esc(label)}<input name="${name}" value="${esc(value)}" ${attrs} /></label>`;
}

// ---------- Painel ----------

async function renderDashboard() {
  const d = await api('/dashboard');
  const saldoClass = d.financeiro_mes.saldo >= 0 ? 'pos' : 'neg';
  view.innerHTML = `
    <div class="cards">
      <div class="card"><div class="label">Vendas no mês</div><div class="value">${money(d.vendas_mes.total)}</div></div>
      <div class="card"><div class="label">Nº de vendas / ticket médio</div><div class="value">${d.vendas_mes.quantidade} · ${money(d.vendas_mes.ticket_medio)}</div></div>
      <div class="card"><div class="label">Saldo do mês</div><div class="value ${saldoClass}">${money(d.financeiro_mes.saldo)}</div></div>
      <div class="card"><div class="label">Clientes / Produtos</div><div class="value">${d.clientes} / ${d.produtos}</div></div>
    </div>
    <div class="grid-2">
      <div class="panel"><h3>Estoque baixo</h3>
        ${table(
          [{ label: 'Produto' }, { label: 'Estoque', num: true }, { label: 'Mínimo', num: true }],
          d.estoque_baixo.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num"><span class="badge ${p.estoque === 0 ? 'danger' : 'warn'}">${p.estoque}</span></td><td class="num">${p.estoque_minimo}</td></tr>`),
          'Nenhum produto com estoque baixo.'
        )}
      </div>
      <div class="panel"><h3>Mais vendidos</h3>
        ${table(
          [{ label: 'Produto' }, { label: 'Qtd.', num: true }, { label: 'Faturamento', num: true }],
          d.mais_vendidos.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${p.quantidade}</td><td class="num">${money(p.faturamento)}</td></tr>`),
          'Ainda não há vendas.'
        )}
      </div>
      <div class="panel"><h3>Últimas vendas</h3>
        ${table(
          [{ label: '#' }, { label: 'Cliente' }, { label: 'Data' }, { label: 'Total', num: true }],
          d.ultimas_vendas.map((v) => `<tr><td>${v.id}</td><td>${esc(v.cliente_nome || 'Consumidor final')}</td><td>${dateBR(v.data)}</td><td class="num">${money(v.total)}</td></tr>`),
          'Ainda não há vendas.'
        )}
      </div>
      <div class="panel"><h3>Financeiro do mês</h3>
        <p>Receitas: <strong class="pos">${money(d.financeiro_mes.receitas)}</strong></p>
        <p>Despesas: <strong class="neg">${money(d.financeiro_mes.despesas)}</strong></p>
      </div>
    </div>`;
}

// ---------- Listas genéricas (clientes, produtos, financeiro) ----------

function listPage({ resource, newLabel, headers, row, form, toBody = (d) => d, extraToolbar = '' }) {
  return async function render() {
    view.innerHTML = `
      <div class="toolbar">
        <input type="search" id="busca" placeholder="Buscar..." />
        <div>${extraToolbar}<button class="btn primary" id="novo">${esc(newLabel)}</button></div>
      </div>
      <div id="lista"></div>`;

    const load = async () => {
      const q = $('#busca').value.trim();
      const items = await api(`/${resource}` + (q ? `?q=${encodeURIComponent(q)}` : ''));
      $('#lista').innerHTML = table(headers, items.map(row));
    };

    const edit = (item) =>
      openModal(item ? 'Editar' : newLabel, form(item || {}), async (f) => {
        const body = toBody(formData(f));
        if (item) await api(`/${resource}/${item.id}`, { method: 'PUT', body });
        else await api(`/${resource}`, { method: 'POST', body });
        toast('Salvo com sucesso');
        await load();
      });

    let timer;
    $('#busca').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    });
    $('#novo').addEventListener('click', () => edit(null));
    $('#lista').addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      const id = btn.dataset.id;
      try {
        if (btn.dataset.action === 'edit') edit(await api(`/${resource}/${id}`));
        if (btn.dataset.action === 'delete' && confirm('Deseja realmente excluir este registro?')) {
          await api(`/${resource}/${id}`, { method: 'DELETE' });
          toast('Registro excluído');
          await load();
        }
      } catch (err) {
        toast(err.message, true);
      }
    });

    await load();
  };
}

const actions = (id) =>
  `<td class="actions"><button class="btn ghost small" data-action="edit" data-id="${id}">Editar</button>
   <button class="btn danger small" data-action="delete" data-id="${id}">Excluir</button></td>`;

const renderClientes = listPage({
  resource: 'clientes',
  newLabel: 'Novo cliente',
  headers: [{ label: 'Nome' }, { label: 'E-mail' }, { label: 'Telefone' }, { label: 'CPF/CNPJ' }, { label: '' }],
  row: (c) => `<tr><td>${esc(c.nome)}</td><td>${esc(c.email)}</td><td>${esc(c.telefone)}</td><td>${esc(c.documento)}</td>${actions(c.id)}</tr>`,
  form: (c) => `
    ${field('Nome *', 'nome', c.nome, 'required')}
    <div class="row">${field('E-mail', 'email', c.email, 'type="email"')}${field('Telefone', 'telefone', c.telefone)}</div>
    ${field('CPF/CNPJ', 'documento', c.documento)}
    ${field('Endereço', 'endereco', c.endereco)}`,
});

const renderProdutos = listPage({
  resource: 'produtos',
  newLabel: 'Novo produto',
  headers: [{ label: 'Produto' }, { label: 'SKU' }, { label: 'Preço', num: true }, { label: 'Custo', num: true }, { label: 'Margem', num: true }, { label: 'Estoque', num: true }, { label: '' }],
  row: (p) => {
    const margem = p.preco > 0 ? (((p.preco - p.custo) / p.preco) * 100).toFixed(1) + '%' : '—';
    const cls = p.estoque === 0 ? 'danger' : p.estoque <= p.estoque_minimo ? 'warn' : 'ok';
    return `<tr><td>${esc(p.nome)}</td><td>${esc(p.sku)}</td><td class="num">${money(p.preco)}</td><td class="num">${money(p.custo)}</td>
      <td class="num">${margem}</td><td class="num"><span class="badge ${cls}">${p.estoque}</span></td>${actions(p.id)}</tr>`;
  },
  form: (p) => `
    ${field('Nome *', 'nome', p.nome, 'required')}
    ${field('SKU / código', 'sku', p.sku)}
    <div class="row">${field('Preço de venda (R$) *', 'preco', p.preco ?? '', 'type="number" step="0.01" min="0" required')}${field('Custo (R$)', 'custo', p.custo ?? '', 'type="number" step="0.01" min="0"')}</div>
    <div class="row">${field('Estoque atual', 'estoque', p.estoque ?? 0, 'type="number" step="1" min="0"')}${field('Estoque mínimo', 'estoque_minimo', p.estoque_minimo ?? 0, 'type="number" step="1" min="0"')}</div>`,
});

const renderFinanceiro = listPage({
  resource: 'lancamentos',
  newLabel: 'Novo lançamento',
  headers: [{ label: 'Data' }, { label: 'Descrição' }, { label: 'Categoria' }, { label: 'Tipo' }, { label: 'Valor', num: true }, { label: '' }],
  row: (l) => `<tr><td>${dateBR(l.data)}</td><td>${esc(l.descricao)}</td><td>${esc(l.categoria)}</td>
    <td><span class="badge ${l.tipo === 'receita' ? 'ok' : 'danger'}">${l.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td>
    <td class="num ${l.tipo === 'receita' ? 'pos' : 'neg'}">${l.tipo === 'despesa' ? '−' : ''}${money(l.valor)}</td>
    ${l.venda_id ? `<td class="actions"><small>Venda #${l.venda_id}</small></td>` : actions(l.id)}</tr>`,
  form: (l) => `
    <label>Tipo *<select name="tipo" required>
      <option value="receita" ${l.tipo === 'receita' ? 'selected' : ''}>Receita</option>
      <option value="despesa" ${l.tipo !== 'receita' ? 'selected' : ''}>Despesa</option>
    </select></label>
    ${field('Descrição *', 'descricao', l.descricao, 'required')}
    <div class="row">${field('Categoria', 'categoria', l.categoria)}${field('Valor (R$) *', 'valor', l.valor ?? '', 'type="number" step="0.01" min="0.01" required')}</div>
    ${field('Data', 'data', l.data || new Date().toISOString().slice(0, 10), 'type="date"')}`,
});

// ---------- Vendas ----------

async function renderVendas() {
  view.innerHTML = `
    <div class="toolbar"><span></span><button class="btn primary" id="nova-venda">Nova venda</button></div>
    <div id="lista"></div>`;

  const load = async () => {
    const vendas = await api('/vendas');
    $('#lista').innerHTML = table(
      [{ label: '#' }, { label: 'Data' }, { label: 'Cliente' }, { label: 'Pagamento' }, { label: 'Itens', num: true }, { label: 'Total', num: true }, { label: 'Status' }, { label: '' }],
      vendas.map(
        (v) => `<tr><td>${v.id}</td><td>${dateBR(v.data)}</td><td>${esc(v.cliente_nome || 'Consumidor final')}</td>
          <td>${esc(FORMAS[v.forma_pagamento] || v.forma_pagamento)}</td><td class="num">${v.itens_qtd}</td><td class="num">${money(v.total)}</td>
          <td><span class="badge ${v.status === 'concluida' ? 'ok' : 'danger'}">${v.status === 'concluida' ? 'Concluída' : 'Cancelada'}</span></td>
          <td class="actions"><button class="btn ghost small" data-action="ver" data-id="${v.id}">Detalhes</button>
          ${v.status === 'concluida' ? `<button class="btn danger small" data-action="cancelar" data-id="${v.id}">Cancelar</button>` : ''}</td></tr>`
      ),
      'Nenhuma venda registrada.'
    );
  };

  $('#lista').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    try {
      if (btn.dataset.action === 'ver') await showVenda(btn.dataset.id);
      if (btn.dataset.action === 'cancelar' && confirm('Cancelar esta venda? Os itens voltarão ao estoque.')) {
        await api(`/vendas/${btn.dataset.id}/cancelar`, { method: 'POST' });
        toast('Venda cancelada');
        await load();
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('#nova-venda').addEventListener('click', () => novaVenda(load));
  await load();
}

async function showVenda(id) {
  const v = await api(`/vendas/${id}`);
  openModal(
    `Venda #${v.id}`,
    `<p><strong>Cliente:</strong> ${esc(v.cliente_nome || 'Consumidor final')}<br/>
       <strong>Data:</strong> ${dateBR(v.data)} · <strong>Pagamento:</strong> ${esc(FORMAS[v.forma_pagamento])}</p>
     ${table(
       [{ label: 'Produto' }, { label: 'Qtd.', num: true }, { label: 'Unitário', num: true }, { label: 'Subtotal', num: true }],
       v.itens.map((i) => `<tr><td>${esc(i.produto_nome)}</td><td class="num">${i.quantidade}</td><td class="num">${money(i.preco_unitario)}</td><td class="num">${money(i.quantidade * i.preco_unitario)}</td></tr>`)
     )}
     <p class="total-line">Desconto: ${money(v.desconto)} · Total: ${money(v.total)}</p>`,
    async () => {},
    { submitLabel: 'Fechar' }
  );
}

async function novaVenda(onDone) {
  const [clientes, produtos] = await Promise.all([api('/clientes'), api('/produtos')]);
  const disponiveis = produtos.filter((p) => p.estoque > 0);
  if (!disponiveis.length) return toast('Cadastre produtos com estoque antes de vender.', true);

  const produtoOptions = disponiveis
    .map((p) => `<option value="${p.id}" data-preco="${p.preco}">${esc(p.nome)} — ${money(p.preco)} (estoque: ${p.estoque})</option>`)
    .join('');
  const itemLine = () =>
    `<div class="item-line"><select name="produto">${produtoOptions}</select>
     <input name="qtd" type="number" min="1" step="1" value="1" />
     <button type="button" class="btn danger small remover">✕</button></div>`;

  openModal(
    'Nova venda',
    `<label>Cliente<select name="cliente_id"><option value="">Consumidor final</option>
       ${clientes.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join('')}</select></label>
     <div id="itens">${itemLine()}</div>
     <button type="button" class="btn ghost small" id="add-item">+ Adicionar item</button>
     <div class="row" style="margin-top:12px">
       <label>Forma de pagamento<select name="forma_pagamento">
         ${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
       ${field('Desconto (R$)', 'desconto', 0, 'type="number" step="0.01" min="0"')}
     </div>
     <p class="total-line" id="total-venda"></p>`,
    async (form) => {
      const linhas = [...form.querySelectorAll('.item-line')];
      const itens = linhas.map((l) => ({ produto_id: Number(l.querySelector('select').value), quantidade: Number(l.querySelector('input').value) }));
      const d = formData(form);
      await api('/vendas', {
        method: 'POST',
        body: { cliente_id: d.cliente_id ? Number(d.cliente_id) : null, itens, forma_pagamento: d.forma_pagamento, desconto: Number(d.desconto) || 0 },
      });
      toast('Venda registrada!');
      await onDone();
    },
    {
      submitLabel: 'Finalizar venda',
      onOpen(form) {
        const atualizar = () => {
          let subtotal = 0;
          form.querySelectorAll('.item-line').forEach((l) => {
            const opt = l.querySelector('select').selectedOptions[0];
            subtotal += Number(opt.dataset.preco) * (Number(l.querySelector('input').value) || 0);
          });
          const desconto = Number(form.elements.desconto.value) || 0;
          $('#total-venda').textContent = `Subtotal: ${money(subtotal)} · Total: ${money(Math.max(subtotal - desconto, 0))}`;
        };
        $('#add-item').onclick = () => {
          $('#itens').insertAdjacentHTML('beforeend', itemLine());
          atualizar();
        };
        $('#itens').onclick = (e) => {
          if (e.target.classList.contains('remover') && form.querySelectorAll('.item-line').length > 1) {
            e.target.closest('.item-line').remove();
            atualizar();
          }
        };
        form.oninput = atualizar;
        atualizar();
      },
    }
  );
}

// ---------- Roteamento ----------

const routes = {
  dashboard: ['Painel', renderDashboard],
  vendas: ['Vendas', renderVendas],
  produtos: ['Produtos', renderProdutos],
  clientes: ['Clientes', renderClientes],
  financeiro: ['Financeiro', renderFinanceiro],
};

async function router() {
  const name = location.hash.replace('#/', '') || 'dashboard';
  const [title, render] = routes[name] || routes.dashboard;
  $('#page-title').textContent = title;
  document.querySelectorAll('.sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  view.innerHTML = '<p class="empty">Carregando...</p>';
  try {
    await render();
  } catch (err) {
    view.innerHTML = `<p class="empty">Erro ao carregar: ${esc(err.message)}</p>`;
  }
}

window.addEventListener('hashchange', router);
router();
