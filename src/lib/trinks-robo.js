// Robô de navegador que entra no Trinks de cada salão, baixa o relatório de atendimentos
// e importa no Mish Business. Usa o Playwright (instalado à parte: veja o README).
//
// A configuração fica em config/trinks.json (modelo em config/trinks.exemplo.json).
// Logins e senhas NUNCA vão no arquivo: use "env:NOME_DA_VARIAVEL".
const fs = require('node:fs');
const path = require('node:path');
const { hoje, addDays } = require('./datas');
const { lerPlanilha } = require('./planilha');
const { interpretarRelatorio, importarAtendimentos, registrarSync, normalizar } = require('./trinks');

const CONFIG_PADRAO = path.join(__dirname, '..', '..', 'config', 'trinks.json');
const PASTA_DADOS = path.join(__dirname, '..', '..', 'data', 'trinks');

function carregarConfig(arquivo = process.env.TRINKS_CONFIG || CONFIG_PADRAO) {
  if (!fs.existsSync(arquivo)) return null;
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

const segredo = (v) => (typeof v === 'string' && v.startsWith('env:') ? process.env[v.slice(4)] : v);

const formatar = (iso, formato) => {
  const [a, m, d] = iso.split('-');
  return formato === 'aaaa-mm-dd' ? iso : `${d}/${m}/${a}`;
};

function encontrarEmpresa(db, salao) {
  if (salao.empresa_id) return db.prepare('SELECT * FROM empresas WHERE id = ?').get(salao.empresa_id);
  const alvo = normalizar(salao.empresa);
  return db.prepare('SELECT * FROM empresas').all().find((e) => normalizar(e.nome_fantasia) === alvo || normalizar(e.razao_social) === alvo);
}

function carregarPlaywright() {
  try {
    return require('playwright');
  } catch {
    throw new Error('Playwright não instalado. Rode: npm install playwright && npx playwright install chromium');
  }
}

/** Executa os passos configurados (preencher datas, escolher filtros) e devolve o arquivo baixado. */
async function baixarRelatorio(page, config, salao, periodo) {
  const sel = { ...config.seletores, ...salao.seletores };
  const troca = (s) => String(s ?? '').replaceAll('{inicio}', formatar(periodo.inicio, config.formatoData)).replaceAll('{fim}', formatar(periodo.fim, config.formatoData));

  // No navegador com perfil salvo, o Trinks pode já estar logado: só faz login se a tela pedir.
  await page.goto(config.urlLogin, { waitUntil: 'domcontentloaded' });
  if (await page.locator(sel.senha).first().isVisible({ timeout: 5000 }).catch(() => false)) {
    if (!segredo(salao.usuario) || !segredo(salao.senha)) throw new Error('Trinks pediu login e o usuário/senha deste salão não estão configurados');
    await page.locator(sel.usuario).first().fill(segredo(salao.usuario));
    await page.locator(sel.senha).first().fill(segredo(salao.senha));
    await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), page.locator(sel.entrar).first().click()]);
    if (await page.locator(sel.senha).first().isVisible().catch(() => false)) throw new Error('Login no Trinks não foi aceito (confira usuário e senha)');
  }

  if (salao.urlRelatorio) await page.goto(troca(salao.urlRelatorio), { waitUntil: 'networkidle' });
  for (const passo of salao.passos || config.passos || []) {
    const alvo = passo.seletor ? page.locator(troca(passo.seletor)).first() : null;
    if (passo.acao === 'ir') await page.goto(troca(passo.url), { waitUntil: 'networkidle' });
    else if (passo.acao === 'clicar') await alvo.click();
    else if (passo.acao === 'preencher') await alvo.fill(troca(passo.valor));
    else if (passo.acao === 'selecionar') await alvo.selectOption({ label: troca(passo.valor) });
    else if (passo.acao === 'esperar') await (alvo ? alvo.waitFor() : page.waitForTimeout(Number(passo.valor) || 1000));
  }

  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.locator(troca(sel.exportar)).first().click()]);
  const destino = path.join(PASTA_DADOS, `${normalizar(salao.empresa || salao.empresa_id).replace(/\s+/g, '-')}-${periodo.fim}-${download.suggestedFilename()}`);
  await download.saveAs(destino);
  return { buf: fs.readFileSync(destino), nome: download.suggestedFilename() };
}

/**
 * Abre o navegador. Com `perfilNavegador` (pasta), é sempre o MESMO navegador: cookies e login do
 * Trinks ficam salvos entre um dia e outro. Com TRINKS_CDP, usa um Chrome já aberto
 * (chrome --remote-debugging-port=9222).
 */
async function abrirNavegador(chromium, config) {
  const headless = process.env.TRINKS_HEADLESS !== '0';
  if (process.env.TRINKS_CDP) {
    const browser = await chromium.connectOverCDP(process.env.TRINKS_CDP);
    const context = browser.contexts()[0] || (await browser.newContext({ acceptDownloads: true }));
    return { context, fechar: () => browser.close() };
  }
  if (config.perfilNavegador) {
    const pasta = path.resolve(path.join(__dirname, '..', '..'), config.perfilNavegador);
    const context = await chromium.launchPersistentContext(pasta, { headless, acceptDownloads: true, locale: 'pt-BR' });
    return { context, fechar: () => context.close() };
  }
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ acceptDownloads: true, locale: 'pt-BR' });
  return { context, fechar: () => browser.close() };
}

/**
 * Coleta os últimos `diasParaTras` dias (padrão 3) de cada salão, um depois do outro, na ordem
 * do arquivo de configuração (Mish Barber e depois Espaço GP), na mesma janela do navegador.
 * Reimportar dias já coletados é seguro: o período é substituído pelo relatório mais recente.
 */
async function sincronizarTrinks(db, { config = carregarConfig(), log = console.log } = {}) {
  if (!config) throw new Error('Robô do Trinks não configurado: crie config/trinks.json a partir de config/trinks.exemplo.json');
  const { chromium } = carregarPlaywright();
  fs.mkdirSync(PASTA_DADOS, { recursive: true });
  const periodo = { inicio: addDays(hoje(), -(config.diasParaTras ?? 3)), fim: hoje() };
  const resultados = [];
  const { context, fechar } = await abrirNavegador(chromium, config);
  try {
    for (const salao of config.saloes || []) {
      const empresa = encontrarEmpresa(db, salao);
      if (!empresa) {
        log(`[trinks] salão "${salao.empresa}" não existe no Mish Business — pulei`);
        continue;
      }
      const page = await context.newPage();
      try {
        const { buf, nome } = await baixarRelatorio(page, config, salao, periodo);
        const { itens, ignoradas } = interpretarRelatorio(lerPlanilha(buf, nome));
        const r = importarAtendimentos(db, empresa.id, itens, { origem: 'robo', substituir: periodo });
        const msg = `${r.lidos} itens lidos${ignoradas ? `, ${ignoradas} linhas ignoradas` : ''}${r.colaboradores_criados.length ? `; novos profissionais: ${r.colaboradores_criados.join(', ')}` : ''}`;
        registrarSync(db, { empresaId: empresa.id, origem: 'robo', status: 'ok', ...periodo, lidos: r.lidos, novos: r.novos, mensagem: msg });
        log(`[trinks] ${empresa.nome_fantasia || empresa.razao_social}: ${msg}`);
        resultados.push({ empresa_id: empresa.id, status: 'ok', ...r });
      } catch (err) {
        const print = path.join(PASTA_DADOS, `erro-${empresa.id}-${Date.now()}.png`);
        await page.screenshot({ path: print, fullPage: true }).catch(() => {});
        registrarSync(db, { empresaId: empresa.id, origem: 'robo', status: 'erro', ...periodo, mensagem: `${err.message} (tela salva em ${path.relative(process.cwd(), print)})` });
        log(`[trinks] ${empresa.nome_fantasia || empresa.razao_social}: ERRO ${err.message}`);
        resultados.push({ empresa_id: empresa.id, status: 'erro', erro: err.message });
      } finally {
        // Sai da conta antes do próximo salão, quando cada salão tem um login diferente.
        if (salao.sairAoFinal && config.urlSair) await page.goto(config.urlSair).catch(() => {});
        await page.close();
      }
    }
  } finally {
    await fechar();
  }
  return resultados;
}

let rodando = null;
/** Evita duas coletas ao mesmo tempo (agendamento + botão "sincronizar agora"). */
function sincronizarUmaVez(db, opts) {
  if (!rodando) rodando = sincronizarTrinks(db, opts).finally(() => (rodando = null));
  return rodando;
}
const sincronizando = () => Boolean(rodando);

/** Agenda a coleta diária no horário de TRINKS_HORARIO (ex.: "06:30"), no fuso do servidor. */
function agendarTrinks(db, horario = process.env.TRINKS_HORARIO) {
  if (!/^\d{2}:\d{2}$/.test(horario || '')) return null;
  let ultimoDia = null;
  const timer = setInterval(() => {
    const agora = new Date();
    const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    if (hhmm >= horario && ultimoDia !== hoje()) {
      ultimoDia = hoje();
      sincronizarUmaVez(db).catch((err) => console.error('[trinks]', err.message));
    }
  }, 60 * 1000);
  timer.unref();
  console.log(`Coleta diária do Trinks agendada para ${horario}`);
  return timer;
}

module.exports = { carregarConfig, sincronizarTrinks, sincronizarUmaVez, sincronizando, agendarTrinks };
