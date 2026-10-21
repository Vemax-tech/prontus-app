// Validações de entrada e tradução de erro do servidor. Funções puras, testáveis em Node.
// IMPORTANTE: validar no navegador é conveniência. Quem barra dado inválido de verdade é o banco
// (CHECK, trigger e as funções de transição) — ver js/fluxo.js.

// ---------- e-mail e telefone ----------
export const emailOk = (s) => { const v = String(s ?? ''); return v === '' || (v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)); };
export const emailValido = (s) => String(s ?? '').trim() !== '' && emailOk(String(s).trim());
export const soDigitos = (s) => String(s ?? '').replace(/\D/g, '');
export const telefoneOk = (s) => { const v = String(s ?? ''); return v === '' || (/^[0-9+()\s.-]{8,40}$/.test(v) && soDigitos(v).length >= 8 && soDigitos(v).length <= 15); };
export const telefoneValido = (s) => String(s ?? '').trim() !== '' && telefoneOk(String(s).trim());

// ---------- CPF e CNPJ (com dígitos verificadores) ----------
export function cpfValido(s) {
  const d = soDigitos(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dig = (n) => { let t = 0; for (let i = 0; i < n; i++) t += Number(d[i]) * (n + 1 - i); return ((t * 10) % 11) % 10; };
  return dig(9) === Number(d[9]) && dig(10) === Number(d[10]);
}
export function cnpjValido(s) {
  const d = soDigitos(s);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dig = (n) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let t = 0; for (let i = 0; i < n; i++) t += Number(d[i]) * pesos[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
  return dig(12) === Number(d[12]) && dig(13) === Number(d[13]);
}
/** Vazio é permitido (campo opcional); preenchido precisa ser CPF ou CNPJ válido. */
export const documentoOk = (s) => { const d = soDigitos(s); return d === '' || cpfValido(d) || cnpjValido(d); };

/**
 * Traduz um erro do servidor (Postgres/PostgREST) para uma frase segura na tela. Nunca mostra o texto cru
 * do banco — nome de tabela, coluna ou constraint —, só mensagens escritas por nós (código P0001).
 */
export function mensagemErro(err, padrao = 'Não foi possível concluir. Tente de novo; se continuar, avise o administrador.') {
  if (!err) return padrao;
  const cod = String(err.code || err.status || ''), msg = String(err.message || '');
  if (cod === '42501' || /row-level security|permission denied/i.test(msg)) return 'Sem permissão para esta ação.';
  if (cod === '23505') return 'Já existe um registro igual (código ou documento repetido).';
  if (cod === '23514') {
    if (/email/i.test(msg)) return 'E-mail inválido.';
    if (/telefone/i.test(msg)) return 'Telefone inválido. Use apenas números, espaços, parênteses, + e -.';
    if (/documento/i.test(msg)) return 'CPF ou CNPJ inválido.';
    return 'Algum campo está em formato inválido. Confira os dados e tente de novo.';
  }
  if (cod === '23503') return 'Este registro está ligado a outros e não pode ser usado ou removido assim.';
  if (cod === '23502') return 'Falta preencher um campo obrigatório.';
  if (cod === '22001') return 'Algum texto está longo demais.';
  if (cod === '22P02' || cod === '22007' || cod === '22008') return 'Algum valor está em formato inválido.';
  if (cod === 'PGRST116') return 'Registro não encontrado.';
  if (cod === 'PGRST301' || cod === '401' || /jwt/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';
  if (cod === '429') return 'Muitas tentativas. Aguarde alguns minutos.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (cod === 'P0001' && msg && msg.length <= 200) return msg;
  return padrao;
}
