import { $, api, esc, money, dateBR, table, qs, badge, select, field, formData, openModal, toast, tentar, confirmar } from '../ui.js';
import { empresaUrl, isEquipe, cadastros } from '../estado.js';

// Brazilian bank exports are often Windows-1252; fall back to it when the file is not valid UTF-8.
async function lerArquivo(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export async function renderConciliacao(view) {
  const { categorias, contas } = await cadastros(api);
  const editavel = isEquipe();
  let status = 'pendente';

  view.innerHTML = `
    <div id="resumo" class="cards"></div>
    ${
      editavel
        ? `<div class="panel import-panel">
            <h3>Importar extrato bancário</h3>
            <p class="hint">Formatos aceitos: <strong>OFX</strong> (exportado pelo internet banking) e <strong>CSV</strong> com colunas data, descrição e valor. Transações já importadas são ignoradas.</p>
            <form id="form-import" class="import-form">
              ${select('Conta bancária', 'conta_id', contas.map((c) => [c.id, `${c.descricao}${c.banco ? ' — ' + c.banco : ''}`]), contas[0]?.id, 'required')}
              <label>Arquivo<input type="file" name="arquivo" accept=".ofx,.csv,.txt" required /></label>
              <button class="btn primary" type="submit">Importar</button>
              <button class="btn ghost" type="button" id="btn-auto">Conciliar automaticamente</button>
            </form>
          </div>`
        : ''
    }
    <div class="toolbar">
      <div class="tabs" id="tabs">
        <button class="tab active" data-status="pendente">Pendentes</button>
        <button class="tab" data-status="conciliado">Conciliadas</button>
        <button class="tab" data-status="">Todas</button>
      </div>
      <select id="f-conta" aria-label="Conta"><option value="">Todas as contas</option>${contas.map((c) => `<option value="${c.id}">${esc(c.descricao)}</option>`).join('')}</select>
    </div>
    <div id="lista"></div>`;

  async function loadResumo() {
    const r = await api(empresaUrl('/conciliacao/resumo'));
    $('#resumo').innerHTML = r.length
      ? r
          .map(
            (c) => `<div class="card">
              <div class="label">${esc(c.descricao)}${c.banco ? ' · ' + esc(c.banco) : ''}</div>
              <div class="value">${money(c.saldo_extrato)}</div>
              <div class="sub">saldo pelo extrato · ${c.pendentes ? `<span class="badge warn">${c.pendentes} pendente(s)</span>` : '<span class="badge ok">tudo conciliado</span>'}
              ${c.ultima_data ? ` · até ${dateBR(c.ultima_data)}` : ''}</div>
            </div>`
          )
          .join('')
      : `<div class="panel empty">Cadastre uma conta bancária em <a href="#/ajustes?aba=cadastros">Ajustes › Plano de contas e bancos</a> para importar extratos.</div>`;
  }

  async function load() {
    const itens = await api(empresaUrl('/conciliacao') + qs({ status, conta_id: $('#f-conta').value }));
    $('#lista').innerHTML = table(
      [{ label: 'Data' }, { label: 'Descrição no banco' }, { label: 'Conta' }, { label: 'Valor', num: true }, { label: 'Situação' }, { label: '' }],
      itens.map((t) => {
        let situacao;
        let acoes = '';
        if (t.lancamento_id) {
          situacao = `${badge('conciliado')}<br/><small class="muted">${esc(t.lancamento_descricao)}${t.lancamento_contraparte ? ' · ' + esc(t.lancamento_contraparte) : ''}</small>`;
          if (editavel) acoes = `<button class="btn ghost small" data-action="desfazer" data-id="${t.id}">Desfazer</button>`;
        } else {
          const s = t.sugestoes || [];
          situacao = s.length
            ? `${badge('pendente')}<br/><small class="muted">${s.length} sugestão(ões): ${esc(s[0].descricao)} (venc. ${dateBR(s[0].vencimento)})</small>`
            : `${badge('pendente')}<br/><small class="muted">Sem lançamento correspondente</small>`;
          if (editavel) {
            if (s.length) acoes += `<button class="btn primary small" data-action="vincular" data-id="${t.id}" data-lanc="${s[0].id}">Conciliar</button> `;
            if (s.length > 1) acoes += `<button class="btn ghost small" data-action="escolher" data-id="${t.id}">Escolher</button> `;
            acoes += `<button class="btn ghost small" data-action="criar" data-id="${t.id}">Criar lançamento</button> `;
            acoes += `<button class="btn danger small" data-action="excluir" data-id="${t.id}" title="Excluir transação importada">✕</button>`;
          }
        }
        return `<tr>
          <td>${dateBR(t.data)}</td>
          <td class="wrap">${esc(t.descricao)}</td>
          <td>${esc(t.conta_nome)}</td>
          <td class="num ${t.valor >= 0 ? 'pos' : 'neg'}">${money(t.valor)}</td>
          <td class="wrap">${situacao}</td>
          <td class="actions">${acoes}</td>
        </tr>`;
      }),
      status === 'pendente' ? 'Nenhuma transação pendente de conciliação. 🎉' : 'Nenhuma transação encontrada.'
    );
    $('#lista').itens = itens;
  }

  const recarregar = () => Promise.all([load(), loadResumo()]);

  function criarLancamento(t) {
    const tipo = t.valor >= 0 ? 'receita' : 'despesa';
    openModal(
      'Criar lançamento a partir do extrato',
      `<p>${dateBR(t.data)} · ${esc(t.descricao)} · <strong class="${tipo === 'receita' ? 'pos' : 'neg'}">${money(t.valor)}</strong></p>
       ${select('Categoria *', 'categoria_id', categorias.filter((c) => c.tipo === tipo).map((c) => [c.id, c.nome]), '', 'required')}
       ${field('Descrição', 'descricao', t.descricao)}
       ${field('Cliente / fornecedor', 'contraparte', '')}`,
      async (form) => {
        await api(empresaUrl(`/conciliacao/${t.id}/criar-lancamento`), { method: 'POST', body: formData(form) });
        toast('Lançamento criado e conciliado');
        await recarregar();
      },
      { submitLabel: 'Criar e conciliar' }
    );
  }

  function escolher(t) {
    openModal(
      'Escolher lançamento',
      `<p>${dateBR(t.data)} · ${esc(t.descricao)} · <strong>${money(t.valor)}</strong></p>
       ${t.sugestoes
         .map(
           (l, i) => `<label class="radio"><input type="radio" name="lancamento_id" value="${l.id}" ${i === 0 ? 'checked' : ''} />
             ${esc(l.descricao)} · ${esc(l.contraparte || '')} · venc. ${dateBR(l.vencimento)} · ${money(l.valor)}</label>`
         )
         .join('')}`,
      async (form) => {
        await api(empresaUrl(`/conciliacao/${t.id}/vincular`), { method: 'POST', body: { lancamento_id: Number(formData(form).lancamento_id) } });
        toast('Transação conciliada');
        await recarregar();
      },
      { submitLabel: 'Conciliar' }
    );
  }

  $('#lista').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const t = $('#lista').itens.find((x) => x.id === Number(btn.dataset.id));
    tentar(async () => {
      switch (btn.dataset.action) {
        case 'vincular':
          await api(empresaUrl(`/conciliacao/${t.id}/vincular`), { method: 'POST', body: { lancamento_id: Number(btn.dataset.lanc) } });
          toast('Transação conciliada');
          return recarregar();
        case 'escolher':
          return escolher(t);
        case 'criar':
          return criarLancamento(t);
        case 'desfazer':
          if (!confirmar('Desfazer a conciliação? O lançamento voltará a ficar em aberto.')) return;
          await api(empresaUrl(`/conciliacao/${t.id}/desfazer`), { method: 'POST' });
          toast('Conciliação desfeita');
          return recarregar();
        case 'excluir':
          if (!confirmar('Excluir esta transação importada do extrato?')) return;
          await api(empresaUrl(`/conciliacao/${t.id}`), { method: 'DELETE' });
          return recarregar();
      }
    });
  });

  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    status = tab.dataset.status;
    document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    tentar(load);
  });
  $('#f-conta').addEventListener('change', () => tentar(load));

  if (editavel && contas.length) {
    $('#form-import').addEventListener('submit', (e) => {
      e.preventDefault();
      tentar(async () => {
        const form = e.target;
        const file = form.elements.arquivo.files[0];
        const conteudo = await lerArquivo(file);
        const formato = /\.ofx$/i.test(file.name) || /<OFX>/i.test(conteudo) ? 'ofx' : 'csv';
        const r = await api(empresaUrl('/conciliacao/importar'), {
          method: 'POST',
          body: { conta_id: Number(form.elements.conta_id.value), formato, conteudo },
        });
        form.elements.arquivo.value = '';
        const auto = await api(empresaUrl('/conciliacao/automatica'), { method: 'POST', body: { conta_id: Number(form.elements.conta_id.value) } });
        toast(`${r.importadas} transação(ões) importada(s)${r.duplicadas ? `, ${r.duplicadas} já existiam` : ''}. ${auto.conciliadas} conciliada(s) automaticamente.`);
        await recarregar();
      });
    });
    $('#btn-auto').addEventListener('click', () =>
      tentar(async () => {
        const r = await api(empresaUrl('/conciliacao/automatica'), { method: 'POST', body: {} });
        toast(`${r.conciliadas} de ${r.analisadas} transação(ões) conciliada(s) automaticamente.`);
        await recarregar();
      })
    );
  } else if (editavel) {
    $('#form-import').querySelectorAll('input, select, button').forEach((el) => (el.disabled = true));
  }

  await recarregar();
}
