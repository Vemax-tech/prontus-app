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
  const th = (c) => h('th', {
    role: 'columnheader', scope: 'col', 'data-ordena': c.sort ? '' : null,
    'aria-sort': c.key === state.sort ? (state.dir > 0 ? 'ascending' : 'descending') : null,
  }, c.sort ? h('button', { class: 'thbtn', type: 'button', onclick: () => { state.dir = state.sort === c.key ? -state.dir : 1; state.sort = c.key; state.page = 0; onState(); } },
    c.label, c.key === state.sort ? h('span', { 'aria-hidden': 'true' }, state.dir > 0 ? '▲' : '▼') : null) : c.label);
  if (!rows.length) return vazio;
  // Em tela estreita a tabela vira uma lista de cartões (css/base.css, `.tw.cartoes`). O rótulo de
  // cada célula sai do próprio cabeçalho, por data-label; os papéis ARIA explícitos seguram a
  // leitura de tabela quando o CSS troca o `display` — sem eles o leitor de tela a perderia.
  return h('div', {},
    h('div', { class: 'tw cartoes' }, h('table', { role: 'table' }, h('thead', { role: 'rowgroup' }, h('tr', { role: 'row' }, cols.map(th))),
      h('tbody', { role: 'rowgroup' }, slice.map((r) => h('tr', { role: 'row', class: rowClass?.(r) || null },
        cols.map((c) => celula(c, r))))))),
    sorted.length > size && h('div', { class: 'row between pager' },
      h('span', { class: 'small muted' }, `${state.page * size + 1}–${Math.min(sorted.length, state.page * size + size)} de ${sorted.length}`),
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', disabled: state.page === 0, onclick: () => { state.page--; onState(); } }, 'Anterior'),
        h('span', { class: 'small' }, `Página ${state.page + 1} de ${pages}`),
        h('button', { class: 'btn sm', disabled: state.page >= pages - 1, onclick: () => { state.page++; onState(); } }, 'Próxima'))));
}

// Célula que não diz nada — "—", "não se aplica", vazia — ganha `vazia`: no cartão do celular ela
// some, e o cartão mostra só o que o caso tem. Na tabela larga continua, porque lá a coluna precisa
// da célula para alinhar.
const SEM_VALOR = new Set(['', '—', 'não se aplica', 'nenhuma']);
function celula(c, r) {
  const td = h('td', { role: 'cell', 'data-label': c.label }, c.render(r));
  if (SEM_VALOR.has(td.textContent.trim())) td.classList.add('vazia');
  return td;
}

// ---------------------------------------------------------------- CSV
export function baixarCsv(nome, colunas, linhas) {
  const txt = '﻿' + [colunas.map((c) => csvCell(c.label)).join(';'), ...linhas.map((r) => colunas.map((c) => csvCell(c.val(r))).join(';'))].join('\r\n');
  const a = h('a', { href: URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' })), download: nome });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------------------------------------------------------------- filtros
/**
 * Barra de filtros simples: defs = [{tipo:'busca'|'select', chave, placeholder?, rotulo?, opcoes?, extra?}];
 * f é mutado e onChange() redesenha.
 *
 * `extra: true` marca o filtro de uso raro: ele fica atrás de "Mais filtros" também na tela larga,
 * para a barra mostrar só o que se usa todo dia. Quem tem filtro extra EM USO vê o número no botão.
 */
//
// Com três ou mais seletores a barra RECOLHE em tela estreita: fica a busca e um botão "Filtros"
// com o número de filtros em uso. Sete seletores empilhados empurravam a lista para baixo da dobra
// no celular — a pessoa via os filtros e não via o que eles filtravam.
export function filtros(defs, f, onChange) {
  const selects = defs.filter((d) => d.tipo !== 'busca');
  const recolhe = selects.length >= 3;
  const comBotao = recolhe || selects.some((d) => d.extra);
  const temExtra = selects.some((d) => d.extra);
  // Dois números, um por situação: na tela larga o botão só esconde os extras e conta os extras em
  // uso; no celular ele esconde TODOS os seletores e conta todos (css/base.css escolhe qual aparece).
  const pinoExtra = h('span', { class: 'pill pe' });
  const pinoTodos = h('span', { class: 'pill pt' });
  const emUso = (d) => String(f[d.chave] ?? '') !== '';
  const contar = () => {
    const todos = selects.filter(emUso).length, extras = selects.filter((d) => d.extra && emUso(d)).length;
    pinoTodos.textContent = String(todos); pinoTodos.hidden = !todos;
    pinoExtra.textContent = String(extras); pinoExtra.hidden = !extras;
    const n = temExtra ? extras : todos;
    if (tgl) tgl.setAttribute('aria-label', n ? `Mais filtros, ${n} em uso` : 'Mais filtros');
  };
  const mudou = () => { contar(); onChange(); };
  const bar = h('div', { class: 'toolbar' + (recolhe ? ' recolhe' : '') + (temExtra ? ' tem-extra' : '') });
  const tgl = comBotao && h('button', {
    class: 'btn tgl', type: 'button', 'aria-expanded': 'false',
    onclick: (e) => { const o = bar.classList.toggle('aberta'); e.currentTarget.setAttribute('aria-expanded', String(o)); },
  }, temExtra ? 'Mais filtros' : 'Filtros', pinoExtra, pinoTodos);
  bar.append(defs.map((d) => d.tipo === 'busca'
    ? h('input', { type: 'search', placeholder: d.placeholder || 'Buscar…', 'aria-label': d.placeholder || 'Buscar', value: f[d.chave] || '', oninput: (e) => { f[d.chave] = e.target.value; onChange(); } })
    : h('select', { class: d.extra ? 'extra' : null, 'aria-label': d.rotulo, onchange: (e) => { f[d.chave] = e.target.value; mudou(); } },
      h('option', { value: '' }, d.rotulo), d.opcoes.map(([v, l]) => h('option', { value: v, selected: String(f[d.chave] ?? '') === String(v) }, l)))));
  // O botão entra logo depois da busca, para os dois dividirem a mesma linha no celular.
  if (tgl) { const busca = bar.querySelector('input[type="search"]'); if (busca) busca.after(tgl); else bar.prepend(tgl); }
  contar();
  return bar;
}
export const contem = (campos, q) => !q || campos.join(' ').toLowerCase().includes(q.toLowerCase());
