// PRONTUS — "Meus casos": os casos que VOCÊ assumiu.
//
// A tela inteira vive em filas.js, porque esta e a "Fila da equipe" são a mesma lista com um filtro
// diferente — e duas cópias da definição das filas seria a primeira coisa a ficar desencontrada.
import { telaDeFilas } from './filas.js';

export const init = () => telaDeFilas('minha');
