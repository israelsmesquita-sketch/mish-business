// Gráficos em SVG puro (sem dependências). As cores vêm de classes CSS, então seguem o tema claro/escuro.
import { esc, money } from './ui.js';

const compact = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e3) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};

function niceStep(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

/**
 * Grouped columns with an optional line, e.g. receitas × despesas per month with resultado.
 * series: [{ key, label, cls }], line: { key, label, cls }
 */
export function columnChart(data, { labelKey, series, line, height = 260 }) {
  const width = 720;
  const m = { top: 16, right: 12, bottom: 28, left: 56 };
  const w = width - m.left - m.right;
  const h = height - m.top - m.bottom;

  const values = data.flatMap((d) => [...series.map((s) => d[s.key]), line ? d[line.key] : 0]);
  // Axis ticks share one "nice" step so labels stay round on both sides of zero.
  const dataMax = Math.max(0, ...values);
  const dataMin = Math.min(0, ...values);
  const step = niceStep((dataMax - dataMin) / 4 || 1);
  const max = Math.ceil(dataMax / step) * step || step;
  const min = Math.floor(dataMin / step) * step;
  const y = (v) => m.top + h - ((v - min) / (max - min)) * h;

  const band = w / data.length;
  const barW = Math.min(22, (band * 0.75) / series.length);
  let svg = '';

  for (let v = min; v <= max + step / 2; v += step) {
    svg += `<line class="grid" x1="${m.left}" x2="${width - m.right}" y1="${y(v)}" y2="${y(v)}" />`;
    svg += `<text class="axis" x="${m.left - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  if (min < 0) svg += `<line class="zero" x1="${m.left}" x2="${width - m.right}" y1="${y(0)}" y2="${y(0)}" />`;

  data.forEach((d, i) => {
    const x0 = m.left + band * i + (band - barW * series.length) / 2;
    series.forEach((s, j) => {
      const v = d[s.key] || 0;
      const top = y(Math.max(v, 0));
      const hh = Math.max(Math.abs(y(v) - y(0)), v ? 1 : 0);
      svg += `<rect class="${s.cls}" x="${x0 + j * barW}" y="${top}" width="${barW - 2}" height="${hh}" rx="2"><title>${esc(d[labelKey])} · ${esc(s.label)}: ${money(v)}</title></rect>`;
    });
    svg += `<text class="axis" x="${m.left + band * i + band / 2}" y="${height - 8}" text-anchor="middle">${esc(d[labelKey])}</text>`;
  });

  if (line) {
    const pts = data.map((d, i) => `${m.left + band * i + band / 2},${y(d[line.key] || 0)}`).join(' ');
    svg += `<polyline class="${line.cls}" points="${pts}" />`;
    data.forEach((d, i) => {
      svg += `<circle class="${line.cls}-dot" cx="${m.left + band * i + band / 2}" cy="${y(d[line.key] || 0)}" r="3.5"><title>${esc(d[labelKey])} · ${esc(line.label)}: ${money(d[line.key])}</title></circle>`;
    });
  }

  const legend = [...series, ...(line ? [line] : [])]
    .map((s) => `<span class="legend-item"><i class="sw ${s.cls}"></i>${esc(s.label)}</span>`)
    .join('');
  return `<div class="legend">${legend}</div><svg class="chart" viewBox="0 0 ${width} ${height}" role="img" preserveAspectRatio="xMidYMid meet">${svg}</svg>`;
}

/** Horizontal bars ranked by value (categorias, contrapartes). Items with `href` link to the detail. */
export function barList(items, { labelKey, valueKey, cls = 'bar-a', empty = 'Sem dados no período.', showPct = true, format = money, max: maxFixo }) {
  if (!items.length) return empty ? `<p class="empty">${esc(empty)}</p>` : '';
  const max = maxFixo || Math.max(...items.map((i) => i[valueKey]), 1);
  const total = items.reduce((s, i) => s + i[valueKey], 0) || 1;
  return `<div class="barlist">${items
    .map((it) => {
      const w = Math.max((it[valueKey] / max) * 100, it[valueKey] ? 1 : 0);
      return `<div class="barlist-row">
        <div class="barlist-label"><span>${it.href ? `<a href="${esc(it.href)}">${esc(it[labelKey])}</a>` : esc(it[labelKey])}</span><span class="barlist-value">${format(it[valueKey])}${showPct ? ` <small>${((it[valueKey] / total) * 100).toFixed(0)}%</small>` : ''}</span></div>
        <svg class="barlist-track" viewBox="0 0 100 6" preserveAspectRatio="none"><rect class="track" width="100" height="6" rx="3" /><rect class="${cls}" width="${w}" height="6" rx="3" /></svg>
      </div>`;
    })
    .join('')}</div>`;
}

/** Donut gauge for a percentage (e.g. % do extrato conciliado). */
export function gauge(value, label) {
  const v = Math.max(0, Math.min(100, value));
  const r = 40;
  const c = 2 * Math.PI * r;
  return `<svg class="gauge" viewBox="0 0 100 100" role="img" aria-label="${esc(label)}: ${v.toFixed(0)}%">
    <circle class="track" cx="50" cy="50" r="${r}" />
    ${v > 0 ? `<circle class="${v >= 90 ? 'g-ok' : v >= 60 ? 'g-warn' : 'g-bad'}" cx="50" cy="50" r="${r}" stroke-dasharray="${(v / 100) * c} ${c}" transform="rotate(-90 50 50)" />` : ''}
    <text x="50" y="55" text-anchor="middle">${v.toFixed(0)}%</text>
  </svg>`;
}
