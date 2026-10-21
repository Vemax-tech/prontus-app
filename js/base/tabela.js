// Peças de listagem: tabela com ordenação e paginação, barra de filtros e exportação CSV.
// Só dependem do DOM; nada de banco, nada de schema, nada de identidade visual.
import { h } from './dom.js';
import { csvCell } from './formato.js';

// ---------------------------------------------------------------- tabela com ordenação e paginação
const cmp = (x, y) => (x == null && y == null ? 0 : x == null ? 1 : y == null ? -1 : x > y ? 1 : x < y ? -1 : 0);
/** state = {sort, dir, page} mantido pela tela; onState() redesenha. cols: [{key,label,sort?:(r)=>valor,render:(r)=>nó}] */
export function dataTable({ cols, rows, state, size = 20, onState, vazio, rowClass }) {
  const col = cols.find((c) => c.key === state.sort);
  const sorted = col?.sort ? [...rows].sort((a, b) => { const x = col.sort(a), y = col.sort(b); return x == null || y == null ? cmp(x, y) : cmp(x, y) * state.dir; }) : rows;
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  state.page = Math.min(state.page || 0, pages - 1);
  const slice = sorted.slice(state.page * size, state.page * size + size);
  const th = (c) => h('th', { 'aria-sort': c.key === state.sort ? (state.dir > 0 ? 'ascending' : 'descending') : null },
    c.sort ? h('button', { class: 'thbtn', onclick: () => { state.dir = state.sort === c.key ? -state.dir : 1; state.sort = c.key; state.page = 0; onState(); } }, c.label, c.key === state.sort ? (state.dir > 0 ? ' ▲' : ' ▼') : '') : c.label);
  if (!rows.length) return vazio;
  return h('div', {},
    h('div', { class: 'tw' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map(th))),
      h('tbody', {}, slice.map((r) => h('tr', { class: rowClass?.(r) || null }, cols.map((c) => h('td', {}, c.render(r)))))))),
    sorted.length > size && h('div', { class: 'row between pager' },
      h('span', { class: 'small muted' }, `${state.page * size + 1}–${Math.min(sorted.length, state.page * size + size)} de ${sorted.length}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', disabled: state.page === 0, onclick: () => { state.page--; onState(); } }, 'Anterior'),
        h('span', { class: 'small' }, `Página ${state.page + 1} de ${pages}`),
        h('button', { class: 'btn sm', disabled: state.page >= pages - 1, onclick: () => { state.page++; onState(); } }, 'Próxima'))));
}

// ---------------------------------------------------------------- CSV
export function baixarCsv(nome, colunas, linhas) {
  const txt = '﻿' + [colunas.map((c) => csvCell(c.label)).join(';'), ...linhas.map((r) => colunas.map((c) => csvCell(c.val(r))).join(';'))].join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })), download: nome });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- filtros
/** Barra de filtros simples: defs = [{tipo:'busca'|'select', chave, placeholder?, rotulo?, opcoes?}]; f é mutado e onChange() redesenha. */
export function filtros(defs, f, onChange) {
  return h('div', { class: 'toolbar' }, defs.map((d) => d.tipo === 'busca'
    ? h('input', { type: 'search', placeholder: d.placeholder || 'Buscar…', 'aria-label': d.placeholder || 'Buscar', value: f[d.chave] || '', oninput: (e) => { f[d.chave] = e.target.value; onChange(); } })
    : h('select', { 'aria-label': d.rotulo, onchange: (e) => { f[d.chave] = e.target.value; onChange(); } },
      h('option', { value: '' }, d.rotulo), d.opcoes.map(([v, l]) => h('option', { value: v, selected: String(f[d.chave] ?? '') === String(v) }, l)))));
}
export const contem = (campos, q) => !q || campos.join(' ').toLowerCase().includes(q.toLowerCase());
