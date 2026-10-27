import { $, api, esc, money, dateBR, table, qs, badge, field, select, formData, openModal, toast, tentar, confirmar, hoje } from '../ui.js';
import { empresaUrl, isEquipe, cadastros, estado } from '../estado.js';

/** Lista de receitas ou despesas do período global. `tipo` fixa a aba; `categoria` vem do clique no gráfico. */
export async function renderLancamentos(view, { tipo = 'despesa', categoria = '' } = {}) {
  const { categorias, contas } = await cadastros(api);
  const editavel = isEquipe();
  const nomeTipo = tipo === 'receita' ? 'receita' : 'despesa';

  view.innerHTML = `
    <div class="toolbar">
      <div class="filters">
        <select id="f-status" aria-label="Status"><option value="">Todos os status</option><option value="pendente">${tipo === 'receita' ? 'A receber' : 'A pagar'}</option><option value="atrasado">Vencidas</option><option value="pago">${tipo === 'receita' ? 'Recebidas' : 'Pagas'}</option></select>
        <select id="f-cat" aria-label="Categoria"><option value="">Todas as categorias</option>${categorias
          .filter((c) => c.tipo === tipo)
          .map((c) => `<option value="${c.id}" ${String(c.id) === String(categoria) ? 'selected' : ''}>${esc(c.nome)}</option>`)
          .join('')}</select>
        <input type="search" id="f-busca" placeholder="Buscar descrição, ${tipo === 'receita' ? 'cliente' : 'fornecedor'}, documento..." />
      </div>
      ${editavel ? `<button class="btn primary" id="novo">Nova ${nomeTipo}</button>` : ''}
    </div>
    <div id="lista"></div>`;

  async function load() {
    const filtros = {
      ...estado.periodo,
      tipo,
      status: $('#f-status').value,
      categoria_id: $('#f-cat').value,
      q: $('#f-busca').value.trim(),
    };
    const itens = await api(empresaUrl('/lancamentos') + qs(filtros));
    const soma = (f) => itens.filter(f).reduce((s, l) => s + l.valor, 0);
    const receber = soma((l) => l.tipo === 'receita');
    const pagar = soma((l) => l.tipo === 'despesa');

    $('#lista').innerHTML = table(
      [
        { label: 'Vencimento' },
        { label: 'Descrição' },
        { label: tipo === 'receita' ? 'Cliente' : 'Fornecedor' },
        { label: 'Categoria' },
        { label: 'Status' },
        { label: 'Pagamento' },
        { label: 'Valor', num: true },
        { label: '' },
      ],
      itens.map(
        (l) => `<tr>
          <td>${dateBR(l.vencimento)}</td>
          <td class="wrap">${esc(l.descricao)}${l.documento ? `<br/><small class="muted">${esc(l.documento)}</small>` : ''}</td>
          <td>${esc(l.contraparte)}</td>
          <td>${esc(l.categoria_nome || '—')}</td>
          <td>${badge(l.status)}${l.extrato_id ? ' <span class="badge ok" title="Conciliado com o extrato">✓ banco</span>' : ''}</td>
          <td>${dateBR(l.pagamento)}</td>
          <td class="num ${l.tipo === 'receita' ? 'pos' : 'neg'}">${l.tipo === 'despesa' ? '−' : ''}${money(l.valor)}</td>
          <td class="actions">${editavel ? acoes(l) : ''}</td>
        </tr>`
      ),
      `Nenhuma ${nomeTipo} no período.`,
      `<tr><td colspan="6">${itens.length} ${nomeTipo}(s) com vencimento no período</td>
       <td class="num"><strong class="${tipo === 'receita' ? 'pos' : 'neg'}">${money(receber + pagar)}</strong></td><td></td></tr>`
    );
  }

  const acoes = (l) => {
    const b = [];
    if (!l.pagamento) b.push(`<button class="btn ghost small" data-action="baixar" data-id="${l.id}">Baixar</button>`);
    else if (!l.extrato_id) b.push(`<button class="btn ghost small" data-action="estornar" data-id="${l.id}">Estornar</button>`);
    b.push(`<button class="btn ghost small" data-action="editar" data-id="${l.id}">Editar</button>`);
    if (!l.extrato_id) b.push(`<button class="btn danger small" data-action="excluir" data-id="${l.id}">Excluir</button>`);
    return b.join(' ');
  };

  const optsContas = [['', '—'], ...contas.map((c) => [c.id, c.descricao])];
  const optsCategorias = (tipo) => [['', 'Sem categoria'], ...categorias.filter((c) => c.tipo === tipo).map((c) => [c.id, c.nome])];

  function formulario(l = {}) {
    const t = l.tipo || tipo;
    return `
      ${select('Tipo *', 'tipo', [['despesa', 'Despesa (a pagar)'], ['receita', 'Receita (a receber)']], t, l.id ? 'disabled' : '')}
      ${field('Descrição *', 'descricao', l.descricao, 'required')}
      <div class="row">${field('Cliente / fornecedor', 'contraparte', l.contraparte)}${field('Documento (NF, boleto)', 'documento', l.documento)}</div>
      <div class="row">${select('Categoria', 'categoria_id', optsCategorias(t), l.categoria_id)}${select('Conta bancária', 'conta_id', optsContas, l.conta_id)}</div>
      <div class="row">${field('Valor (R$) *', 'valor', l.valor ?? '', 'type="number" step="0.01" min="0.01" required')}${field('Vencimento *', 'vencimento', l.vencimento || hoje(), 'type="date" required')}</div>
      <div class="row">${field('Competência', 'competencia', l.competencia || '', 'type="date"')}${field('Data de pagamento', 'pagamento', l.pagamento || '', 'type="date"')}</div>
      ${l.id ? '' : field('Repetir por quantos meses (parcelas/recorrência)', 'repetir', 1, 'type="number" min="1" max="60" step="1"')}
      ${field('Observação', 'observacao', l.observacao)}`;
  }

  function editar(l) {
    openModal(
      l ? `Editar ${l.tipo}` : `Nova ${nomeTipo}`,
      formulario(l || {}),
      async (form) => {
        const d = formData(form);
        if (l) {
          delete d.tipo;
          await api(empresaUrl(`/lancamentos/${l.id}`), { method: 'PUT', body: d });
        } else {
          await api(empresaUrl('/lancamentos'), { method: 'POST', body: { ...d, repetir: Number(d.repetir) || 1 } });
        }
        toast('Lançamento salvo');
        await load();
      },
      {
        onOpen(form) {
          // Keep the category list in sync with the chosen type.
          form.elements.tipo.addEventListener('change', () => {
            const sel = form.elements.categoria_id;
            sel.innerHTML = optsCategorias(form.elements.tipo.value).map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
          });
        },
      }
    );
  }

  function baixar(l) {
    openModal(
      `Baixar: ${l.descricao}`,
      `<p>${l.tipo === 'receita' ? 'Recebimento' : 'Pagamento'} de <strong>${money(l.valor)}</strong> com vencimento em ${dateBR(l.vencimento)}.</p>
       <div class="row">${field('Data do pagamento', 'pagamento', hoje(), 'type="date" required')}${select('Conta bancária', 'conta_id', optsContas, l.conta_id || contas[0]?.id)}</div>`,
      async (form) => {
        await api(empresaUrl(`/lancamentos/${l.id}/baixar`), { method: 'POST', body: formData(form) });
        toast('Baixa registrada');
        await load();
      },
      { submitLabel: 'Confirmar baixa' }
    );
  }

  $('#lista').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    tentar(async () => {
      const l = await api(empresaUrl(`/lancamentos/${btn.dataset.id}`));
      const acao = btn.dataset.action;
      if (acao === 'editar') editar(l);
      if (acao === 'baixar') baixar(l);
      if (acao === 'estornar' && confirmar('Estornar a baixa deste lançamento?')) {
        await api(empresaUrl(`/lancamentos/${l.id}/estornar`), { method: 'POST' });
        toast('Baixa estornada');
        await load();
      }
      if (acao === 'excluir' && confirmar(`Excluir "${l.descricao}"?`)) {
        await api(empresaUrl(`/lancamentos/${l.id}`), { method: 'DELETE' });
        toast('Lançamento excluído');
        await load();
      }
    });
  });

  if (editavel) $('#novo').addEventListener('click', () => editar(null));
  for (const id of ['#f-status', '#f-cat']) $(id).addEventListener('change', () => tentar(load));
  let timer;
  $('#f-busca').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => tentar(load), 300);
  });

  await load();
}
