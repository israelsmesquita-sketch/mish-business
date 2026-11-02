// Datas são guardadas como texto ISO (AAAA-MM-DD) no fuso local do servidor.

const pad = (n) => String(n).padStart(2, '0');

function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const hoje = () => isoDate();

function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !Number.isNaN(d.getTime()) && isoDate(d) === s;
}

function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

function addMonths(iso, months) {
  const d = new Date(iso + 'T00:00:00');
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDate(d);
}

const inicioDoMes = (iso = hoje()) => iso.slice(0, 8) + '01';

function fimDoMes(iso = hoje()) {
  const d = new Date(iso + 'T00:00:00');
  return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

// Lê ?inicio=&fim= da query; o padrão é o mês corrente.
function periodo(query) {
  const inicio = isIsoDate(query.inicio) ? query.inicio : inicioDoMes();
  const fim = isIsoDate(query.fim) ? query.fim : fimDoMes();
  return inicio <= fim ? { inicio, fim } : { inicio: fim, fim: inicio };
}

module.exports = { isoDate, hoje, isIsoDate, addDays, addMonths, inicioDoMes, fimDoMes, periodo };
