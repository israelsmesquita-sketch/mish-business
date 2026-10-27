import { $, api, esc, money, dateBR, table, field, select, formData, openModal, toast, tentar, confirmar } from '../ui.js';
import { empresaUrl, isEquipe, limparCadastros } from '../estado.js';

const GRUPOS = [
  ['receita_operacional', 'Receita operacional'],
  ['deducoes', 'Deduções / impostos sobre vendas'],
  ['custos', 'Custos'],
  ['despesas_operacionais', 'Despesas operacionais'],
  ['receitas_financeiras', 'Receitas financeiras'],
  ['despesas_financeiras', 'Despesas financeiras'],
  ['outros', 'Outros'],
];
const nomeGrupo = Object.fromEntries(GRUPOS);

export async function renderCadastros(view) {
  const editavel = isEquipe();
  view.innerHTML = `<div id="cad">
    <div class="panel">
      <div class="panel-head"><h3>Contas bancárias</h3>${editavel ? '<button class="btn primary small" id="nova-conta">Nova conta</button>' : ''}</div>
      <div id="contas"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Plano de contas (categorias)</h3>${editavel ? '<button class="btn primary small" id="nova-cat">Nova categoria</button>' : ''}</div>
      <p class="hint">O grupo define em qual linha da DRE a categoria aparece.</p>
      <div id="categorias"></div>
    </div></div>`;

  const acoes = (tipo, id) =>
    editavel
      ? `<td class="actions"><button class="btn ghost small" data-tipo="${tipo}" data-action="editar" data-id="${id}">Editar</button>
         <button class="btn danger small" data-tipo="${tipo}" data-action="excluir" data-id="${id}">Excluir</button></td>`
      : '<td></td>';

  async function load() {
    limparCadastros();
    const [contas, categorias] = await Promise.all([api(empresaUrl('/contas')), api(empresaUrl('/categorias'))]);
    $('#contas').innerHTML = table(
      [{ label: 'Descrição' }, { label: 'Banco' }, { label: 'Agência' }, { label: 'Conta' }, { label: 'Saldo inicial', num: true }, { label: 'Data do saldo' }, { label: '' }],
      contas.map(
        (c) => `<tr><td>${esc(c.descricao)}</td><td>${esc(c.banco)}</td><td>${esc(c.agencia)}</td><td>${esc(c.conta)}</td>
          <td class="num">${money(c.saldo_inicial)}</td><td>${dateBR(c.data_saldo_inicial)}</td>${acoes('contas', c.id)}</tr>`
      ),
      'Nenhuma conta bancária cadastrada.'
    );
    $('#categorias').innerHTML = table(
      [{ label: 'Categoria' }, { label: 'Tipo' }, { label: 'Grupo (DRE)' }, { label: '' }],
      categorias.map(
        (c) => `<tr><td>${esc(c.nome)}</td><td><span class="badge ${c.tipo === 'receita' ? 'ok' : 'danger'}">${c.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td>
          <td>${esc(nomeGrupo[c.grupo])}</td>${acoes('categorias', c.id)}</tr>`
      )
    );
  }

  const FORMS = {
    contas: (c = {}) => `
      ${field('Descrição *', 'descricao', c.descricao, 'required placeholder="Ex.: Conta corrente Itaú"')}
      <div class="row">${field('Banco', 'banco', c.banco)}${field('Agência', 'agencia', c.agencia)}</div>
      ${field('Conta', 'conta', c.conta)}
      <div class="row">${field('Saldo inicial (R$)', 'saldo_inicial', c.saldo_inicial ?? 0, 'type="number" step="0.01"')}${field('Data do saldo inicial', 'data_saldo_inicial', c.data_saldo_inicial || '', 'type="date"')}</div>`,
    categorias: (c = {}) => `
      ${field('Nome *', 'nome', c.nome, 'required')}
      <div class="row">${select('Tipo *', 'tipo', [['despesa', 'Despesa'], ['receita', 'Receita']], c.tipo)}${select('Grupo na DRE *', 'grupo', GRUPOS, c.grupo || 'despesas_operacionais')}</div>`,
  };

  function editar(tipo, item) {
    openModal(item ? 'Editar' : tipo === 'contas' ? 'Nova conta bancária' : 'Nova categoria', FORMS[tipo](item || {}), async (form) => {
      const body = formData(form);
      if (item) await api(empresaUrl(`/${tipo}/${item.id}`), { method: 'PUT', body });
      else await api(empresaUrl(`/${tipo}`), { method: 'POST', body });
      toast('Salvo com sucesso');
      await load();
    });
  }

  $('#cad').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const { tipo, action, id } = btn.dataset;
    tentar(async () => {
      if (action === 'editar') editar(tipo, await api(empresaUrl(`/${tipo}/${id}`)));
      if (action === 'excluir' && confirmar('Excluir este registro? Lançamentos vinculados ficarão sem esta referência.')) {
        await api(empresaUrl(`/${tipo}/${id}`), { method: 'DELETE' });
        toast('Registro excluído');
        await load();
      }
    });
  });
  if (editavel) {
    $('#nova-conta').addEventListener('click', () => editar('contas', null));
    $('#nova-cat').addEventListener('click', () => editar('categorias', null));
  }

  await load();
}
