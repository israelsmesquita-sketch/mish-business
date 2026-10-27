// Ajustes (equipe Mish): tudo que é configuração fica aqui, fora das telas do dia a dia.
import { $, api, esc, money, dateBR, table, field, formData, openModal, toast, tentar, confirmar } from '../ui.js';
import { estado, isAdmin, empresaUrl, nomeEmpresa, empresaAtual } from '../estado.js';
import { renderEmpresas } from './empresas.js';
import { renderUsuarios } from './usuarios.js';
import { renderCadastros } from './cadastros.js';
import { renderConciliacao } from './conciliacao.js';
import { editarProfissional } from './pessoas.js';

const ABAS = [
  ['trinks', 'Trinks', () => true],
  ['equipe', 'Profissionais', () => true],
  ['pilares', 'Pilares', () => true],
  ['saloes', 'Salões', () => true],
  ['usuarios', 'Usuários', isAdmin],
  ['cadastros', 'Plano de contas e bancos', () => true],
  ['conciliacao', 'Conciliação bancária', () => true],
];

export async function renderAjustes(view, params) {
  const abas = ABAS.filter(([, , pode]) => pode());
  const aba = abas.find(([k]) => k === params.get('aba'))?.[0] || 'trinks';
  view.innerHTML = `
    <nav class="segmented" aria-label="Seções de ajustes">${abas.map(([k, v]) => `<a href="#/ajustes?aba=${k}" class="${k === aba ? 'active' : ''}">${v}</a>`).join('')}</nav>
    <div id="ajuste"></div>`;
  const alvo = $('#ajuste');
  const render = { trinks: renderTrinks, equipe: renderEquipe, pilares: renderPilares, saloes: renderEmpresas, usuarios: renderUsuarios, cadastros: renderCadastros, conciliacao: renderConciliacao }[aba];
  await render(alvo);
}

// ---------- Trinks ----------

const lerBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo'));
    r.readAsDataURL(file);
  });

async function renderTrinks(view) {
  const salao = nomeEmpresa(empresaAtual());
  view.innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <h3>Robô diário</h3>
        <div id="robo"></div>
      </div>
      <div class="panel">
        <h3>Enviar relatório manualmente — ${esc(salao)}</h3>
        <p class="hint">Plano B se o robô falhar: no Trinks, exporte o relatório de atendimentos por profissional (Excel ou CSV) e envie aqui. Colunas reconhecidas: Data, Profissional, Cliente, Serviço/Item, Tipo e Valor.</p>
        <form id="form-trinks" class="import-form">
          <label>Arquivo<input type="file" name="arquivo" accept=".xlsx,.csv,.xls,.html,.txt" required /></label>
          <label class="radio"><input type="checkbox" name="substituir" /> Substituir os dias do arquivo (use quando o relatório traz o dia completo)</label>
          <button class="btn primary" type="submit">Importar</button>
        </form>
      </div>
    </div>
    <div class="panel"><h3>Histórico de coletas</h3><div id="historico"></div></div>`;

  async function load() {
    const s = await api('/trinks/status');
    $('#robo').innerHTML = s.configurado
      ? `<p>Salões, nesta ordem: <strong>${s.saloes.map(esc).join(' → ')}</strong></p>
         <p>Horário automático: <strong>${s.horario ? s.horario + ' (todos os dias)' : 'não agendado'}</strong>${s.horario ? '' : ' — defina TRINKS_HORARIO no servidor, ex.: 06:30'}</p>
         <button class="btn primary" id="coletar" ${s.sincronizando ? 'disabled' : ''}>${s.sincronizando ? 'Coletando…' : 'Coletar agora'}</button>`
      : `<p class="hint">O robô ainda não foi configurado no servidor. Quem instala: copie <code>config/trinks.exemplo.json</code> para <code>config/trinks.json</code>, cole a URL do relatório de cada salão e defina os logins como variáveis de ambiente (passo a passo no README).</p>`;
    $('#coletar')?.addEventListener('click', () =>
      tentar(async () => {
        const r = await api('/trinks/sincronizar', { method: 'POST' });
        toast(r.mensagem);
        await load();
      })
    );
    $('#historico').innerHTML = table(
      [{ label: 'Quando' }, { label: 'Salão' }, { label: 'Origem' }, { label: 'Dias coletados' }, { label: 'Itens', num: true }, { label: 'Situação' }, { label: 'Detalhe' }],
      s.historico.map(
        (h) => `<tr><td>${dateBR(h.criado_em)} ${h.criado_em.slice(11, 16)}</td><td>${esc(h.empresa || '—')}</td><td>${h.origem === 'robo' ? 'Robô' : 'Arquivo'}</td>
          <td>${h.inicio ? `${dateBR(h.inicio)} a ${dateBR(h.fim)}` : '—'}</td><td class="num">${h.lidos}</td>
          <td>${h.status === 'ok' ? '<span class="badge ok">OK</span>' : '<span class="badge danger">Erro</span>'}</td><td class="wrap"><small>${esc(h.mensagem || '')}</small></td></tr>`
      ),
      'Nenhuma coleta ainda.'
    );
  }

  $('#form-trinks').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const file = form.elements.arquivo.files[0];
    if (!file) return;
    tentar(async () => {
      const r = await api(empresaUrl('/trinks/importar'), {
        method: 'POST',
        body: { arquivo: await lerBase64(file), nome: file.name, substituir: form.elements.substituir.checked },
      });
      toast(`${r.lidos} itens lidos (${r.novos} novos) de ${dateBR(r.periodo.inicio)} a ${dateBR(r.periodo.fim)}${r.colaboradores_criados.length ? ` · novos profissionais: ${r.colaboradores_criados.join(', ')}` : ''}`);
      form.reset();
      await load();
    });
  });
  await load();
}

// ---------- Profissionais ----------

async function renderEquipe(view) {
  view.innerHTML = `
    <div class="toolbar"><span class="hint">Profissionais de ${esc(nomeEmpresa(empresaAtual()))}. Novos nomes do Trinks entram sozinhos; aqui você define função, meta e o nome usado no Trinks.</span><button class="btn primary" id="novo">Novo profissional</button></div>
    <div id="lista"></div>`;
  async function load() {
    const lista = await api(empresaUrl('/colaboradores'));
    $('#lista').innerHTML = table(
      [{ label: 'Nome' }, { label: 'Função' }, { label: 'Nome no Trinks' }, { label: 'Meta mensal', num: true }, { label: 'Situação' }, { label: '' }],
      lista.map(
        (c) => `<tr class="${c.ativo ? '' : 'inativo'}"><td><a href="#/pessoas/${estado.empresaId}/${c.id}">${esc(c.nome)}</a></td><td>${esc(c.funcao)}</td><td>${esc(c.apelido_trinks)}</td>
          <td class="num">${money(c.meta_mensal)}</td><td>${c.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge">Inativo</span>'}</td>
          <td class="actions"><button class="btn ghost small" data-editar="${c.id}">Editar</button></td></tr>`
      ),
      'Nenhum profissional.'
    );
    $('#lista').onclick = (e) => {
      const id = Number(e.target.dataset.editar);
      if (id) editarProfissional(estado.empresaId, lista.find((c) => c.id === id), load);
    };
  }
  $('#novo').addEventListener('click', () => editarProfissional(estado.empresaId, null, load));
  await load();
}

// ---------- Pilares ----------

async function renderPilares(view) {
  view.innerHTML = `
    <div class="toolbar"><span class="hint">Pilares avaliados todo mês (nota de 0 a 10), iguais para os dois salões. Notas abaixo de 7 geram sugestão de ação.</span><button class="btn primary" id="novo">Novo pilar</button></div>
    <div id="lista"></div>`;
  const form = (p = {}) => `${field('Nome *', 'nome', p.nome, 'required')}${field('O que avalia', 'descricao', p.descricao)}${field('Ordem', 'ordem', p.ordem ?? 0, 'type="number" step="1"')}`;
  async function load() {
    const lista = await api('/pilares');
    $('#lista').innerHTML = table(
      [{ label: 'Ordem', num: true }, { label: 'Pilar' }, { label: 'O que avalia' }, { label: '' }],
      lista.map(
        (p) => `<tr><td class="num">${p.ordem}</td><td><strong>${esc(p.nome)}</strong></td><td class="wrap">${esc(p.descricao)}</td>
          <td class="actions"><button class="btn ghost small" data-editar="${p.id}">Editar</button> <button class="btn danger small" data-excluir="${p.id}">Excluir</button></td></tr>`
      )
    );
    $('#lista').onclick = (e) => {
      const p = lista.find((x) => x.id === Number(e.target.dataset.editar || e.target.dataset.excluir));
      if (!p) return;
      if (e.target.dataset.editar) editar(p);
      else if (confirmar(`Excluir o pilar "${p.nome}" e todas as notas dele?`)) tentar(async () => (await api(`/pilares/${p.id}`, { method: 'DELETE' }), toast('Pilar excluído'), load()));
    };
  }
  const editar = (p) =>
    openModal(p ? 'Editar pilar' : 'Novo pilar', form(p || {}), async (f) => {
      if (p) await api(`/pilares/${p.id}`, { method: 'PUT', body: formData(f) });
      else await api('/pilares', { method: 'POST', body: formData(f) });
      toast('Pilar salvo');
      await load();
    });
  $('#novo').addEventListener('click', () => editar(null));
  await load();
}
