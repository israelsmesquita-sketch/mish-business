const express = require('express');
const { badRequest } = require('../errors');
const { exigirPapel } = require('../lib/auth');
const { lerPlanilha } = require('../lib/planilha');
const { interpretarRelatorio, importarAtendimentos, registrarSync } = require('../lib/trinks');
const { carregarConfig, sincronizarUmaVez, sincronizando } = require('../lib/trinks-robo');

/** Rotas por salão: envio manual do relatório do Trinks e histórico de coletas. */
function trinksEmpresaRouter(db) {
  const router = express.Router({ mergeParams: true });

  router.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM trinks_sync WHERE empresa_id = ? ORDER BY id DESC LIMIT 30').all(req.empresa.id));
  });

  // { arquivo: base64, nome, substituir } — substituir troca os itens do Trinks no intervalo de datas do arquivo.
  router.post('/importar', (req, res) => {
    const { arquivo, nome = '', substituir = false } = req.body || {};
    if (typeof arquivo !== 'string' || !arquivo) throw badRequest('Envie o arquivo do relatório');
    let itens;
    let ignoradas;
    try {
      ({ itens, ignoradas } = interpretarRelatorio(lerPlanilha(Buffer.from(arquivo, 'base64'), nome)));
    } catch (err) {
      registrarSync(db, { empresaId: req.empresa.id, origem: 'arquivo', status: 'erro', mensagem: `${nome}: ${err.message}` });
      throw badRequest(err.message);
    }
    if (!itens.length) throw badRequest('Nenhum atendimento encontrado no arquivo');
    const datas = itens.map((i) => i.data).sort();
    const periodo = { inicio: datas[0], fim: datas[datas.length - 1] };
    const r = importarAtendimentos(db, req.empresa.id, itens, { origem: 'arquivo', substituir: substituir === true ? periodo : undefined });
    const mensagem = `${nome}: ${r.lidos} itens${ignoradas ? `, ${ignoradas} linhas ignoradas` : ''}${r.colaboradores_criados.length ? `; novos profissionais: ${r.colaboradores_criados.join(', ')}` : ''}`;
    registrarSync(db, { empresaId: req.empresa.id, origem: 'arquivo', status: 'ok', ...periodo, lidos: r.lidos, novos: r.novos, mensagem });
    res.json({ ...r, ignoradas, periodo });
  });

  return router;
}

/** Rotas gerais: situação do robô e coleta sob demanda. */
function trinksRouter(db) {
  const router = express.Router();

  router.get('/status', exigirPapel('admin', 'analista'), (req, res) => {
    const config = carregarConfig();
    res.json({
      configurado: Boolean(config),
      saloes: (config?.saloes || []).map((s) => s.empresa || s.empresa_id),
      horario: process.env.TRINKS_HORARIO || null,
      sincronizando: sincronizando(),
      historico: db
        .prepare(
          `SELECT t.*, COALESCE(e.nome_fantasia, e.razao_social) AS empresa FROM trinks_sync t
             LEFT JOIN empresas e ON e.id = t.empresa_id ORDER BY t.id DESC LIMIT 30`
        )
        .all(),
    });
  });

  router.post('/sincronizar', exigirPapel('admin', 'analista'), (req, res) => {
    if (!carregarConfig()) throw badRequest('Robô do Trinks não configurado: crie config/trinks.json (veja o README)');
    sincronizarUmaVez(db).catch((err) => console.error('[trinks]', err.message));
    res.status(202).json({ mensagem: 'Coleta iniciada. Acompanhe o histórico em alguns minutos.' });
  });

  return router;
}

module.exports = { trinksEmpresaRouter, trinksRouter };
