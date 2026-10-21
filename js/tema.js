// PRONTUS — tema da interface: escuro (padrão) ou claro.
//
// O escuro é o padrão porque a recepção e o arquivo ficam com esta tela aberta o dia inteiro, em
// sala de luz baixa. O claro continua inteiro porque sala de luz forte pede o contrário — e a
// escolha é de quem usa, não nossa.
//
// A troca é só um atributo em <html>: todo o resto são os tokens de css/tokens.css. Nenhuma tela
// conhece uma cor, então nenhuma tela precisa saber que existe tema.
//
// A preferência fica em localStorage, não em sessionStorage: é configuração da PESSOA naquele
// computador — o terminal da recepção deve abrir sempre do mesmo jeito, inclusive no dia seguinte.
// Não é dado de paciente; é preferência de interface. (Os dados da demonstração, esses sim, ficam
// em sessionStorage e morrem com a aba — ver js/dados.js.)
const CHAVE = 'prontus_tema';
export const TEMAS = { escuro: 'Escuro', claro: 'Claro' };
export const TEMA_PADRAO = 'escuro';

export function temaAtual() {
  try { const t = localStorage.getItem(CHAVE); if (t && TEMAS[t]) return t; } catch { /* sem storage */ }
  return TEMA_PADRAO;
}

/**
 * Aplica o tema ao documento. O escuro é o valor de `:root` no CSS, então ele NÃO precisa de
 * atributo: assim a página já nasce escura antes de qualquer script rodar, e não existe um
 * clarão branco entre o carregamento e a aplicação do tema.
 */
export function aplicarTema(t = temaAtual()) {
  const raiz = document.documentElement;
  if (t === 'claro') raiz.setAttribute('data-theme', 'claro');
  else raiz.removeAttribute('data-theme');
  // A cor da barra do navegador no celular acompanha a superfície da página.
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t === 'claro' ? '#0E4B57' : '#0D1417');
  return t;
}

export function definirTema(t) {
  if (!TEMAS[t]) return temaAtual();
  try { localStorage.setItem(CHAVE, t); } catch { /* sem storage: vale só esta página */ }
  return aplicarTema(t);
}

export const alternarTema = () => definirTema(temaAtual() === 'claro' ? 'escuro' : 'claro');
