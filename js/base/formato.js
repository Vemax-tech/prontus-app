// Formatação e saneamento de valores. Funções puras, sem DOM e sem banco.
// Enxuto de propósito: só o que o Prontus usa (o restante ficou no projeto de onde este código veio).

/** Só abre link http(s); qualquer outro esquema (javascript:, data:) é recusado. */
export const urlValida = (s) => { try { const u = new URL(String(s)); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

/** Valor para CSV/planilha sem quebrar (aspas, quebras de linha) e sem virar fórmula no Excel. */
export const csvCell = (v) => {
  if (typeof v === 'number') return String(v);
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
