// Validação da paleta do Prontus — o script que o README promete quando diz que as cores não
// foram escolhidas no olho. Roda os DOIS temas e falha se algum critério cair.
//
// Lê css/tokens.css diretamente: não existe uma segunda cópia da paleta aqui para ficar
// desencontrada da que o navegador usa.
//
// O que é verificado, e por quê:
//
//  1. TEXTO sobre papel e sobre superfície. Quem opera isto lê tabela o dia inteiro; contraste
//     fraco em metadado é o tipo de coisa que ninguém reclama e todo mundo sente no fim do dia.
//     --ink ≥ 7:1 (AAA), --ink-2 ≥ 4,5:1 (AA), --ink-3 ≥ 3:1 (texto de apoio, sempre curto).
//
//  2. ESTADOS ok / atenção / crítico. Precisam de contraste ≥ 3:1 sobre a superfície E de
//     distância entre si — inclusive para quem não distingue vermelho de verde, que é ~8% dos
//     homens. Daí o ΔE2000 nas três simulações de daltonismo, não só na visão normal.
//     (A cor nunca carrega sozinha o significado: toda etiqueta de estado tem rótulo. Isto aqui
//     é a segunda linha de defesa, não a primeira.)
//
//  3. TINTA SOBRE FUNDO DE ESTADO: o texto dentro de uma etiqueta "Alta" tem de ser legível.
//
//  4. RAMPA das barras. Um só matiz (variação de tom ≤ 12°), luminosidade monotônica e degraus
//     perceptíveis — senão a barra vira decoração em vez de medir magnitude.
//
// Uso: npm run cores
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(path.join(RAIZ, 'css/tokens.css'), 'utf8');

// ---------------------------------------------------------------- leitura dos temas
/** Extrai os `--token: valor` de um bloco, achando o fecho do bloco pelo primeiro `}`. */
function bloco(seletor) {
  const i = css.indexOf(seletor + ' {');
  if (i < 0) throw new Error(`bloco ${seletor} não encontrado em css/tokens.css`);
  const corpo = css.slice(i, css.indexOf('\n}', i));
  const out = {};
  for (const m of corpo.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const escuro = bloco(':root');
const claro = { ...escuro, ...bloco(":root[data-theme='claro']") };
const TEMAS = { escuro, claro };

// ---------------------------------------------------------------- cor: conversões
const hex = (s) => {
  const m = /^#([0-9a-f]{6})$/i.exec(s.trim());
  if (!m) throw new Error(`não é um hex de 6 dígitos: ${s}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const aLinear = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (rgb) => { const [r, g, b] = rgb.map(aLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** sRGB → CIE Lab (D65). */
function aLab(rgbHex) {
  const [r, g, b] = hex(rgbHex).map(aLinear);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b) / 1.0;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** ΔE CIEDE2000 — a métrica que corresponde ao que o olho chama de "cores diferentes". */
function deltaE(c1, c2) {
  const [L1, a1, b1] = aLab(c1), [L2, a2, b2] = aLab(c2);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => { if (b === 0 && a === 0) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h; };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) {
    dh = hp2 - hp1;
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh * rad) / 2);
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm;
  if (Cp1 * Cp2 === 0) hm = hp1 + hp2;
  else if (Math.abs(hp1 - hp2) <= 180) hm = (hp1 + hp2) / 2;
  else hm = (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad)
    + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.20 * Math.cos((4 * hm - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/**
 * Simulação de daltonismo (Viénot, Brettel & Mollon 1999) — projeção no plano LMS que a visão
 * dicromata enxerga. É a aproximação padrão para checagem de interface.
 */
const LMS = [[0.31399, 0.63951, 0.04649], [0.15537, 0.75789, 0.08670], [0.01775, 0.10945, 0.87253]];
const LMS_INV = [[5.47221, -4.64196, 0.16963], [-1.12524, 2.29317, -0.16789], [0.02980, -0.19318, 1.16364]];
const SIM = {
  protanopia: [[0, 1.05118294, -0.05116099], [0, 1, 0], [0, 0, 1]],
  deuteranopia: [[1, 0, 0], [0.9513092, 0, 0.04866992], [0, 0, 1]],
  tritanopia: [[1, 0, 0], [0, 1, 0], [-0.86744736, 1.86727089, 0]],
};

const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function simular(corHex, tipo) {
  const lin = hex(corHex).map(aLinear);
  const out = mul(LMS_INV, mul(SIM[tipo], mul(LMS, lin)));
  const aSrgb = (v) => {
    const c = Math.min(1, Math.max(0, v));
    const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(s * 255);
  };
  return '#' + out.map(aSrgb).map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** Matiz em graus, para provar que a rampa é de um só matiz. */
function matiz(corHex) {
  const [, a, b] = aLab(corHex);
  const h = Math.atan2(b, a) * (180 / Math.PI);
  return h < 0 ? h + 360 : h;
}

// ---------------------------------------------------------------- critérios
const falhas = [];
const linhas = [];
const n2 = (x) => x.toFixed(2);
function exigir(ok, titulo, valor, alvo) {
  linhas.push(`      ${ok ? '✓' : '✗'} ${titulo.padEnd(52)} ${valor.padStart(9)}  (mín. ${alvo})`);
  if (!ok) falhas.push(`${titulo}: ${valor}, mínimo ${alvo}`);
}

for (const [nome, T] of Object.entries(TEMAS)) {
  console.log(`\n── tema ${nome} ${'─'.repeat(58 - nome.length)}`);

  // 1. texto
  console.log('   texto');
  for (const fundo of ['--paper', '--surface']) {
    for (const [tk, min] of [['--ink', 7], ['--ink-2', 4.5], ['--ink-3', 3]]) {
      const c = contraste(T[tk], T[fundo]);
      exigir(c >= min, `${tk} sobre ${fundo}`, n2(c) + ':1', `${min}:1`);
    }
  }

  // 2. estados: contraste sobre a superfície e distância entre si
  console.log('   estados');
  const estados = ['--ok', '--warn', '--crit'];
  for (const tk of estados) {
    const c = contraste(T[tk], T['--surface']);
    exigir(c >= 3, `${tk} sobre --surface`, n2(c) + ':1', '3:1');
  }
  const pares = [['--ok', '--warn'], ['--ok', '--crit'], ['--warn', '--crit']];
  for (const [a, b] of pares) {
    const d = deltaE(T[a], T[b]);
    exigir(d >= 15, `ΔE2000 ${a} × ${b} (visão normal)`, n2(d), '15');
  }
  for (const tipo of ['protanopia', 'deuteranopia', 'tritanopia']) {
    for (const [a, b] of pares) {
      const d = deltaE(simular(T[a], tipo), simular(T[b], tipo));
      exigir(d >= 8, `ΔE2000 ${a} × ${b} (${tipo})`, n2(d), '8');
    }
  }

  // 3. tinta dentro da etiqueta de estado — e ela tem de continuar PARECENDO aquele estado:
  //    uma tinta legível com matiz de outra cor trocaria o significado da etiqueta.
  console.log('   etiquetas de estado');
  for (const e of estados) {
    const c = contraste(T[e + '-ink'], T[e + '-wash']);
    exigir(c >= 4.5, `${e}-ink sobre ${e}-wash`, n2(c) + ':1', '4.5:1');
    let dh = Math.abs(matiz(T[e + '-ink']) - matiz(T[e]));
    if (dh > 180) dh = 360 - dh;
    exigir(dh <= 20, `${e}-ink mantém o matiz de ${e}`, n2(dh) + '°', '≤ 20°');
  }
  const cb = contraste(T['--on-brand'], T['--brand']);
  exigir(cb >= 4.5, '--on-brand sobre --brand', n2(cb) + ':1', '4.5:1');

  // 4. rampa sequencial
  console.log('   rampa das barras');
  const rampa = ['--seq-1', '--seq-2', '--seq-3', '--seq-4'].map((k) => T[k]);
  const hs = rampa.map(matiz);
  const espalhamento = Math.max(...hs) - Math.min(...hs);
  exigir(espalhamento <= 12, 'rampa é de um matiz só (variação de tom)', n2(espalhamento) + '°', '≤ 12°');
  const Ls = rampa.map((c) => lum(hex(c)));
  const sobe = Ls.every((v, i) => i === 0 || v > Ls[i - 1]);
  const desce = Ls.every((v, i) => i === 0 || v < Ls[i - 1]);
  exigir(sobe || desce, 'luminosidade monotônica ao longo da rampa', sobe ? 'cresce' : desce ? 'decresce' : 'oscila', 'sem oscilar');
  const degraus = Ls.slice(1).map((v, i) => Math.abs(v - Ls[i]));
  exigir(Math.min(...degraus) >= 0.02, 'menor degrau de luminosidade', n2(Math.min(...degraus)), '0.02');
  const ponta = Math.max(contraste(rampa[0], T['--surface']), contraste(rampa[3], T['--surface']));
  exigir(ponta >= 1.6, 'ponta da rampa visível sobre --surface', n2(ponta) + ':1', '1.6:1');

  console.log(linhas.join('\n'));
  linhas.length = 0;
}

console.log('');
if (falhas.length) {
  console.log(`✗ ${falhas.length} critério(s) de cor não atendido(s):`);
  falhas.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('✓ paleta validada nos dois temas: texto, estados, daltonismo, etiquetas e rampa.');
