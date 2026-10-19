// Small SVG chart renderers. Each returns markup sized to the measured container width.
// Marks follow one spec: <=24px bars with 4px rounded data ends, 2px lines, hairline grid,
// 2px surface gaps, hover/tap/focus tooltips via data-tip, and a table view for every chart.

import { esc, raw } from './ui.js';

export function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return ticks;
}

/** Bar outline with rounded top corners and a square base (negative values round the bottom). */
function barPath(x, y0, w, h, r = 4) {
  if (h === 0) return '';
  const up = h > 0;
  const hh = Math.abs(h);
  const rr = Math.min(r, w / 2, hh);
  const top = up ? y0 - hh : y0 + hh;
  if (up) return `M${x},${y0}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${y0}Z`;
  return `M${x},${y0}V${top - rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top - rr}V${y0}Z`;
}

const tipAttr = (t) => `data-tip="${esc(t)}" tabindex="0"`;

/**
 * Line chart for a balance over time.
 * points: [{label, value, kind: 'actual'|'forecast', tip}]
 */
export function lineChart({ width, height = 190, points, fmtAxis, ariaLabel }) {
  const m = { l: 52, r: 14, t: 14, b: 26 };
  const w = Math.max(160, width) - m.l - m.r;
  const h = height - m.t - m.b;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0];
  const hi = ticks.at(-1);
  const x = (i) => m.l + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v) => m.t + h - ((v - lo) / (hi - lo || 1)) * h;
  const grid = ticks.map((t) => `<line class="grid${t === 0 ? ' zero' : ''}" x1="${m.l}" x2="${m.l + w}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmtAxis(t))}</text>`).join('');
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(Math.max(lo, 0))}L${x(0).toFixed(1)},${y(Math.max(lo, 0))}Z`;
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const bands = points.map((p, i) => `<rect class="hit" x="${(x(i) - step / 2).toFixed(1)}" y="${m.t}" width="${step.toFixed(1)}" height="${h}" ${tipAttr(p.tip)}/>`).join('');
  const labelIdx = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const xlabels = labelIdx.map((i) => `<text class="axis" x="${x(i)}" y="${height - 8}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}">${esc(points[i].label)}</text>`).join('');
  const last = points.length - 1;
  return `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel || 'Line chart')}">
    ${grid}
    <path class="area s1" d="${area}"/>
    <path class="line s1 dashed" d="${line}"/>
    <circle class="dot s1" cx="${x(0)}" cy="${y(points[0].value)}" r="5"/>
    <circle class="dot s1 hollow" cx="${x(last)}" cy="${y(points[last].value)}" r="4.5"/>
    ${xlabels}
    ${bands}
  </svg>`;
}

/**
 * Column chart, grouped or stacked.
 * categories: [{label, tip}]; series: [{name, cls: 's1'|'s2'..., values}]
 */
export function columnChart({ width, height = 200, categories, series, stacked = false, fmtAxis, ariaLabel }) {
  const m = { l: 52, r: 8, t: 12, b: 26 };
  const w = Math.max(160, width) - m.l - m.r;
  const h = height - m.t - m.b;
  const totals = categories.map((_, i) => (stacked ? series.reduce((t, s) => t + Math.max(0, s.values[i]), 0) : Math.max(...series.map((s) => s.values[i]))));
  const ticks = niceTicks(0, Math.max(1, ...totals));
  const hi = ticks.at(-1);
  const y = (v) => m.t + h - (v / hi) * h;
  const band = w / categories.length;
  const gap = 2;
  const groupW = stacked ? Math.min(24, band * 0.6) : Math.min(24 * series.length + gap * (series.length - 1), band * 0.72);
  const barW = stacked ? groupW : (groupW - gap * (series.length - 1)) / series.length;
  const grid = ticks.map((t) => `<line class="grid${t === 0 ? ' zero' : ''}" x1="${m.l}" x2="${m.l + w}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmtAxis(t))}</text>`).join('');
  let bars = '';
  categories.forEach((c, i) => {
    const gx = m.l + band * i + (band - groupW) / 2;
    if (stacked) {
      let base = y(0);
      const visible = series.filter((s) => s.values[i] > 0);
      visible.forEach((s, k) => {
        const hgt = (s.values[i] / hi) * h - (k > 0 ? gap : 0);
        if (hgt <= 0) return;
        const yb = base - (k > 0 ? gap : 0);
        const isTop = k === visible.length - 1;
        bars += isTop
          ? `<path class="bar ${s.cls}" d="${barPath(gx, yb, barW, hgt)}"/>`
          : `<rect class="bar ${s.cls}" x="${gx}" y="${yb - hgt}" width="${barW}" height="${hgt}"/>`;
        base = yb - hgt;
      });
    } else {
      series.forEach((s, k) => {
        const hgt = (Math.max(0, s.values[i]) / hi) * h;
        if (hgt > 0) bars += `<path class="bar ${s.cls}" d="${barPath(gx + k * (barW + gap), y(0), barW, hgt)}"/>`;
      });
    }
  });
  const every = Math.ceil(categories.length / Math.max(1, Math.floor(w / 46)));
  const lastIdx = categories.length - 1;
  const xlabels = categories.map((c, i) => ((i % every === 0 && lastIdx - i >= every) || i === lastIdx
    ? `<text class="axis" x="${m.l + band * i + band / 2}" y="${height - 8}" text-anchor="middle">${esc(c.label)}</text>` : '')).join('');
  const hits = categories.map((c, i) => `<rect class="hit" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${h}" ${tipAttr(c.tip)}/>`).join('');
  return `<svg class="chart-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel || 'Column chart')}">${grid}${bars}${xlabels}${hits}</svg>`;
}

export function legend(items) {
  return raw(`<div class="legend">${items.map((i) => `<span class="legend-item"><span class="swatch ${i.cls}${i.line ? ' line' : ''}${i.dashed ? ' dashed' : ''}"></span>${esc(i.label)}</span>`).join('')}</div>`);
}

/** Horizontal bars as HTML (wraps labels nicely on narrow screens). rows: [{label, value, display, tip}] */
export function hbars(rows, { max } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return raw(`<div class="hbars">${rows.map((r) => `
    <div class="hbar" ${tipAttr(r.tip || `${r.label}\n${r.display}`)}>
      <div class="hbar-label">${esc(r.label)}</div>
      <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(1, (r.value / top) * 100).toFixed(1)}%"></div></div>
      <div class="hbar-value">${esc(r.display)}</div>
    </div>`).join('')}</div>`);
}

export function tableView(headers, rows, summary = 'Show as table') {
  return raw(`<details class="table-view"><summary>${esc(summary)}</summary><div class="table-scroll"><table>
    <thead><tr>${headers.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`);
}
