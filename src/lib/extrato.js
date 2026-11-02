const crypto = require('node:crypto');
const { isIsoDate } = require('./datas');

/**
 * Parsers de extrato bancário. Cada um devolve [{ data, descricao, valor, fitid }],
 * com valor positivo para créditos e negativo para débitos.
 */

// OFX 1.x is SGML: closing tags for leaf elements are optional, so read each value up to the next "<".
function tag(bloco, nome) {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

function dataOfx(valor) {
  const m = String(valor).match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function parseOfx(conteudo) {
  const blocos = String(conteudo).match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) || [];
  return blocos.map((bloco, i) => {
    const data = dataOfx(tag(bloco, 'DTPOSTED'));
    const valor = Number(tag(bloco, 'TRNAMT').replace(',', '.'));
    if (!data || !Number.isFinite(valor)) throw new Error(`Transação ${i + 1} do OFX está inválida`);
    const descricao = [tag(bloco, 'NAME'), tag(bloco, 'MEMO')].filter(Boolean).join(' - ') || 'Sem descrição';
    const fitid = tag(bloco, 'FITID') || hashTransacao(data, descricao, valor, i);
    return { data, descricao, valor: arred(valor), fitid };
  });
}

/** Converte "1.234,56", "-1234.56", "R$ 10,00" ou "(10,00)" em número. */
function numeroBR(texto) {
  let s = String(texto).trim().replace(/R\$\s?/i, '').replace(/\s/g, '');
  let negativo = false;
  if (/^\(.*\)$/.test(s)) {
    negativo = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negativo = true;
    s = s.slice(0, -1);
  }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  if (s === '' || !Number.isFinite(n)) return NaN;
  return negativo ? -Math.abs(n) : n;
}

function dataBR(texto) {
  const s = String(texto).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    return isIsoDate(iso) ? iso : null;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    return isIsoDate(iso) ? iso : null;
  }
  return null;
}

function splitCsvLinha(linha, sep) {
  const campos = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      campos.push(atual);
      atual = '';
    } else atual += c;
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

/**
 * CSV com colunas data, descrição e valor (cabeçalho opcional). Detecta ";" ou ",",
 * datas DD/MM/AAAA ou AAAA-MM-DD e valores no formato brasileiro ou internacional.
 * Se houver colunas separadas de crédito e débito, elas são combinadas.
 */
function parseCsv(conteudo) {
  const linhas = String(conteudo).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';

  let idx = { data: 0, descricao: 1, valor: 2, credito: -1, debito: -1 };
  let inicio = 0;
  const cab = splitCsvLinha(linhas[0], sep).map((c) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (!dataBR(cab[0]) && cab.some((c) => c.includes('data'))) {
    const achar = (...nomes) => cab.findIndex((c) => nomes.some((n) => c.includes(n)));
    idx = {
      data: achar('data'),
      descricao: achar('descri', 'historico', 'lancamento', 'memo'),
      valor: achar('valor', 'quantia', 'montante'),
      credito: achar('credito', 'entrada'),
      debito: achar('debito', 'saida'),
    };
    inicio = 1;
    if (idx.data < 0 || (idx.valor < 0 && idx.credito < 0 && idx.debito < 0)) {
      throw new Error('Cabeçalho do CSV precisa das colunas "data" e "valor" (ou "crédito"/"débito")');
    }
  }

  const resultado = [];
  for (let i = inicio; i < linhas.length; i++) {
    const campos = splitCsvLinha(linhas[i], sep);
    const data = dataBR(campos[idx.data]);
    let valor;
    if (idx.valor >= 0 && campos[idx.valor]) valor = numeroBR(campos[idx.valor]);
    else {
      const cred = idx.credito >= 0 && campos[idx.credito] ? Math.abs(numeroBR(campos[idx.credito])) : 0;
      const deb = idx.debito >= 0 && campos[idx.debito] ? Math.abs(numeroBR(campos[idx.debito])) : 0;
      valor = cred - deb;
    }
    if (!data || !Number.isFinite(valor)) throw new Error(`Linha ${i + 1} do CSV está inválida: "${linhas[i]}"`);
    if (valor === 0) continue;
    const descricao = (idx.descricao >= 0 && campos[idx.descricao]) || 'Sem descrição';
    resultado.push({ data, descricao, valor: arred(valor), fitid: hashTransacao(data, descricao, valor, i) });
  }
  return resultado;
}

function hashTransacao(data, descricao, valor, ordem) {
  return 'h' + crypto.createHash('sha1').update(`${data}|${descricao}|${valor}|${ordem}`).digest('hex').slice(0, 20);
}

const arred = (n) => Math.round(n * 100) / 100;

function parseExtrato(formato, conteudo) {
  if (formato === 'ofx') return parseOfx(conteudo);
  if (formato === 'csv') return parseCsv(conteudo);
  throw new Error('Formato não suportado (use "ofx" ou "csv")');
}

module.exports = { parseOfx, parseCsv, parseExtrato, numeroBR, dataBR };
