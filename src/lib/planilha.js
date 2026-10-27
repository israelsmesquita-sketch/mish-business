// Leitura de relatórios exportados (CSV, XLSX ou "XLS" em HTML) como uma matriz de células,
// sem dependências: o XLSX é um ZIP com XML, lido com zlib.
const zlib = require('node:zlib');

function decodificarTexto(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const xmlTexto = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTIDADES[e.toLowerCase()] ?? m;
  });

// ---------- CSV ----------

function lerCsv(texto) {
  const primeira = texto.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].sort((a, b) => primeira.split(b).length - primeira.split(a).length)[0];
  const linhas = [];
  let linha = [];
  let campo = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (aspas) {
      if (ch === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (ch === '"') aspas = false;
      else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) {
      linha.push(campo);
      campo = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
    } else campo += ch;
  }
  if (campo || linha.length) linhas.push([...linha, campo]);
  return linhas.map((l) => l.map((c) => c.trim()));
}

// ---------- HTML (muitos sistemas exportam "Excel" como tabela HTML) ----------

function lerHtml(texto) {
  const linhas = [];
  for (const [, tr] of texto.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const celulas = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(([, c]) => xmlTexto(c.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim());
    if (celulas.length) linhas.push(celulas);
  }
  return linhas;
}

// ---------- XLSX ----------

function lerZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Arquivo XLSX inválido');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const arquivos = new Map();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamanho = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);
    arquivos.set(nome, () => {
      const inicio = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const dados = buf.subarray(inicio, inicio + tamanho);
      return (metodo === 8 ? zlib.inflateRawSync(dados) : dados).toString('utf8');
    });
    p += 46 + nomeLen + extraLen + comLen;
  }
  return arquivos;
}

const colunaIndice = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

function lerXlsx(buf) {
  const zip = lerZip(buf);
  const strings = zip.has('xl/sharedStrings.xml')
    ? [...zip.get('xl/sharedStrings.xml')().matchAll(/<si>([\s\S]*?)<\/si>/g)].map(([, si]) => xmlTexto([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')))
    : [];
  const planilha = [...zip.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0];
  if (!planilha) throw new Error('Planilha não encontrada no arquivo XLSX');
  const linhas = [];
  for (const [, row] of zip.get(planilha)().matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const linha = [];
    for (const [, attrs, corpo] of row.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      const tipo = attrs.match(/t="(\w+)"/)?.[1];
      const v = corpo?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let valor = '';
      if (tipo === 's') valor = strings[Number(v)] ?? '';
      else if (tipo === 'inlineStr') valor = xmlTexto([...(corpo || '').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else if (v !== undefined) valor = tipo === 'str' ? xmlTexto(v) : v;
      linha[ref ? colunaIndice(ref) : linha.length] = String(valor).trim();
    }
    linhas.push(Array.from(linha, (c) => c ?? ''));
  }
  return linhas;
}

/** Converte o conteúdo de um arquivo em matriz de células, detectando o formato. */
function lerPlanilha(buf, nome = '') {
  if (buf[0] === 0x50 && buf[1] === 0x4b) return lerXlsx(buf);
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('Formato .xls antigo não suportado: salve o relatório como .xlsx ou .csv');
  const texto = decodificarTexto(buf);
  if (/^\s*</.test(texto) || /\.html?$/i.test(nome)) return lerHtml(texto);
  return lerCsv(texto);
}

module.exports = { lerPlanilha, lerCsv, lerHtml, lerXlsx };
