// PRONTUS — qual papel está usando o sistema agora.
//
// O papel vem da conta que entrou (js/auth.js → tabela `perfis`), nunca de uma escolha na tela.
// Mexer no armazenamento do navegador para trocar de papel só estragaria a própria tela: a cada
// página o papel é lido de novo no servidor e, nos dados de verdade, quem recusa é a RLS do banco.
import { PAPEIS } from './permissoes.js';
import { perfilAtual } from './auth.js';

/** null = ninguém entrou. A guarda de js/boot.js impede uma tela de chegar aqui sem sessão. */
export const papelAtual = () => perfilAtual()?.papel ?? null;
/** Lista de papéis do usuário atual. Em produção pode ter mais de um; hoje, um por conta. */
export const papeisAtuais = () => { const p = papelAtual(); return p ? [p] : []; };
export const atorAtual = () => perfilAtual()?.id ?? null;
export { PAPEIS };
