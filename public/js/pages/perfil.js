// Perfil do profissional: faturamento, serviços realizados, notas dos pilares e plano de ação, ligados.
import { $, api, esc, money, num, pct, mesBR, dateBR, qs, table, kpi, tile, bindTiles, delta, progresso, notaPill, alertasHtml, openModal, toast, tentar } from '../ui.js';
import { estado, empresaUrl, isEquipe, empresaAtual, nomeEmpresa } from '../estado.js';
import { columnChart, barList } from '../charts.js';
import { abrirAcao, acoesHtml, bindAcoes, bindAlertas } from './acoes.js';
import { editarProfissional } from './pessoas.js';

export async function renderPerfil(view, cid, setTitulo) {
  const empresaId = estado.empresaId;
  view.innerHTML = '<div id="perfil"></div>';
  let d;

  async function load() {
    d = await api(empresaUrl(`/pessoas/${cid}`) + qs(estado.periodo));
    d.alertas = d.alertas.map((a) => ({ ...a, empresa_id: empresaId }));
    const c = d.colaborador;
    setTitulo(c.nome);
    const nomes = new Map([[c.id, c.nome]]);
    const comNota = d.pilares.filter((p) => p.nota !== null);
    const mesAval = mesBR(d.mes_avaliacao);

    $('#perfil').innerHTML = `
      <div class="perfil-head">
        <a href="#/pessoas" class="voltar">← Equipe</a>
        <div class="perfil-id">
          <div class="avatar" aria-hidden="true">${esc(c.nome.split(' ').map((p) => p[0]).slice(0, 2).join(''))}</div>
          <div><h2>${esc(c.nome)}</h2><div class="muted">${esc(c.funcao || 'Profissional')} · ${esc(nomeEmpresa(empresaAtual()))}${d.posicao ? ` · ${d.posicao}º de ${d.equipe_total} em faturamento` : ''}${c.ativo ? '' : ' · <span class="badge">Inativo</span>'}</div></div>
        </div>
        <div class="perfil-acoes">
          <button class="btn ghost" id="avaliar">Avaliar pilares</button>
          <button class="btn primary" id="nova-acao">Nova ação</button>
          ${isEquipe() ? '<button class="btn ghost" id="editar">Editar cadastro</button>' : ''}
        </div>
      </div>

      <div class="cards kpis">
        ${kpi({ label: 'Faturamento', value: money(c.faturamento), sub: delta(c.variacao) })}
        ${kpi({ label: 'Meta do período', value: progresso(c.meta_pct), sub: c.meta ? `${money(c.meta)} · projeção ${c.projecao_pct !== null ? num(c.projecao_pct, 0) + '%' : '—'}` : 'meta não definida' })}
        ${kpi({ label: 'Atendimentos', value: num(c.atendimentos, 0), sub: `${c.servicos} serviços · ${c.clientes} clientes` })}
        ${kpi({ label: 'Ticket médio', value: money(c.ticket_medio), sub: `média do salão ${money(d.media_equipe.ticket_medio)}` })}
        ${kpi({ label: 'Venda de produtos', value: money(c.produtos), sub: `${pct(c.produtos_pct)} do faturamento` })}
        ${kpi({ label: `Nota dos pilares`, value: notaPill(c.nota), sub: c.nota_mes ? `avaliação de ${mesBR(c.nota_mes)}` : 'sem avaliação' })}
      </div>

      <div class="tiles">
        ${tile({
          id: 'fat',
          titulo: 'Faturamento mês a mês',
          w: 8,
          mini: `<strong>${money(c.faturamento)}</strong> ${delta(c.variacao)}`,
          body: columnChart(d.mensal.map((m) => ({ ...m, label: mesBR(m.mes) })), {
            labelKey: 'label',
            series: [{ key: 'faturamento', label: 'Faturamento', cls: 'bar-in' }],
            line: c.meta_mensal ? { key: 'meta', label: 'Meta mensal', cls: 'line-res' } : null,
            height: 230,
          }),
          extra: table(
            [{ label: 'Mês' }, { label: 'Faturamento', num: true }, { label: 'Atendimentos', num: true }, { label: '% da meta', num: true }],
            d.mensal.map((m) => `<tr><td>${mesBR(m.mes)}</td><td class="num">${money(m.faturamento)}</td><td class="num">${m.atendimentos}</td><td class="num">${m.meta ? pct((m.faturamento / m.meta) * 100) : '—'}</td></tr>`)
          ),
        })}
        ${tile({
          id: 'pilares',
          titulo: `Pilares — ${mesAval}`,
          w: 4,
          mini: notaPill(c.nota),
          body: comNota.length
            ? `<ul class="pilares">${d.pilares
                .map((p) => {
                  const dif = p.nota !== null && p.nota_anterior !== null ? p.nota - p.nota_anterior : null;
                  return `<li><span title="${esc(p.descricao || '')}">${esc(p.nome)}</span>${notaPill(p.nota)}${dif ? `<small class="${dif > 0 ? 'pos' : 'neg'}">${dif > 0 ? '▲' : '▼'} ${num(Math.abs(dif), 1)}</small>` : '<small></small>'}</li>`;
                })
                .join('')}</ul>`
            : `<p class="empty">Ainda sem notas em ${mesAval}.<br/><button class="btn ghost small" data-avaliar>Avaliar agora</button></p>`,
          extra: d.historico.length ? `<h4>Média dos últimos meses</h4>${barList(d.historico.map((h) => ({ ...h, label: mesBR(h.mes) })), { labelKey: 'label', valueKey: 'media', cls: 'bar-a', showPct: false, max: 10, format: (n) => num(n, 1) })}` : '',
        })}
        ${tile({
          id: 'servicos',
          titulo: 'Serviços e produtos realizados',
          w: 6,
          troca: true,
          mini: `<strong>${c.servicos}</strong> serviços`,
          body: barList(d.servicos.slice(0, 6).map((s) => ({ ...s, rotulo: `${s.item} · ${s.quantidade}x` })), { labelKey: 'rotulo', valueKey: 'valor', cls: 'bar-in' }),
          extra: table(
            [{ label: 'Item' }, { label: 'Tipo' }, { label: 'Quantidade', num: true }, { label: 'Valor', num: true }, { label: 'Preço médio', num: true }],
            d.servicos.map((s) => `<tr><td>${esc(s.item)}</td><td>${s.tipo === 'produto' ? '<span class="badge info">Produto</span>' : 'Serviço'}</td><td class="num">${s.quantidade}</td><td class="num">${money(s.valor)}</td><td class="num">${money(s.valor / s.quantidade)}</td></tr>`),
            'Nenhum atendimento no período.'
          ),
        })}
        ${tile({
          id: 'acoes',
          titulo: 'Indicadores → plano de ação',
          w: 6,
          mini: `<strong>${d.acoes.filter((a) => a.status === 'aberta').length}</strong> ações abertas`,
          body: `<h4>O que os números indicam</h4>${alertasHtml(d.alertas, { vazio: 'Indicadores dentro do esperado.' })}
                 <h4>Ações combinadas</h4><div id="acoes-lista">${acoesHtml(d.acoes, empresaId, nomes)}</div>`,
        })}
        ${tile({
          id: 'ultimos',
          titulo: 'Últimos atendimentos',
          w: 12,
          mini: `<strong>${d.ultimos.length}</strong> recentes`,
          body: table(
            [{ label: 'Data' }, { label: 'Cliente' }, { label: 'Item' }, { label: 'Valor', num: true }],
            d.ultimos.slice(0, 10).map((u) => `<tr><td>${dateBR(u.data)}</td><td>${esc(u.cliente || '—')}</td><td>${esc(u.item)}${u.tipo === 'produto' ? ' <span class="badge info">Produto</span>' : ''}</td><td class="num">${money(u.valor)}</td></tr>`),
            'Nenhum atendimento no período.'
          ),
          extra: d.ultimos.length > 10 ? table(
            [{ label: 'Data' }, { label: 'Cliente' }, { label: 'Item' }, { label: 'Valor', num: true }],
            d.ultimos.slice(10).map((u) => `<tr><td>${dateBR(u.data)}</td><td>${esc(u.cliente || '—')}</td><td>${esc(u.item)}</td><td class="num">${money(u.valor)}</td></tr>`)
          ) : '',
        })}
      </div>`;

    $('#avaliar').addEventListener('click', avaliar);
    $('[data-avaliar]')?.addEventListener('click', avaliar);
    $('#nova-acao').addEventListener('click', () => tentar(() => abrirAcao(empresaId, { colaborador_id: c.id }, load)));
    $('#editar')?.addEventListener('click', () => editarProfissional(empresaId, c, load));
  }

  function avaliar() {
    openModal(
      `Avaliar ${d.colaborador.nome}`,
      `<label>Mês avaliado<input type="month" name="mes" value="${d.mes_avaliacao}" required /></label>
       <p class="hint">Notas de 0 a 10. Deixe em branco o pilar que não quiser avaliar.</p>
       ${d.pilares
         .map((p) => `<label>${esc(p.nome)}${p.descricao ? ` <small>— ${esc(p.descricao)}</small>` : ''}<input type="number" name="p${p.id}" min="0" max="10" step="0.5" value="${p.nota ?? ''}" /></label>`)
         .join('')}`,
      async (form) => {
        const notas = Object.fromEntries(d.pilares.map((p) => [p.id, form.elements[`p${p.id}`].value]));
        await api(empresaUrl(`/pessoas/${d.colaborador.id}/avaliacao`), { method: 'PUT', body: { mes: form.elements.mes.value, notas } });
        toast('Avaliação salva');
        await load();
      }
    );
  }

  const root = $('#perfil');
  bindTiles(root);
  bindAlertas(root, () => d.alertas, load, empresaId);
  bindAcoes(root, empresaId, () => d.acoes, load);
  await load();
}
