// PRONTUS — as contas de quem usa o sistema, de verdade (tabela `perfis` + auth.users).
//
// Quem decide é o banco: a lista, a liberação e a auditoria só respondem ao Administrador (RLS e
// funções em supabase/migrations/0003_admin_contas.sql). Este arquivo só chama e traduz o erro
// para o formato { data, error } que as telas já usam.
//
// O que NÃO existe aqui, de propósito: criar a conta (e-mail e senha) e excluí-la. As duas exigem
// a chave de serviço, que não pode estar no navegador; ficam no painel do Supabase. Quem já agiu
// no sistema é desativado, não apagado — a autoria do histórico não se perde.
import { api } from './auth.js';

const CAMPOS_EDITAVEIS = ['nome', 'cargo', 'papel', 'ativo'];

/** { status, corpo } do PostgREST → { data, error } com `code` e `message` que mensagemErro() entende. */
function resposta({ status, corpo }) {
  if (status === 0) return { data: null, error: { code: 'P0001', message: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' } };
  if (status >= 400) {
    return { data: null, error: { code: String(corpo?.code || status), message: String(corpo?.message || '') } };
  }
  return { data: corpo, error: null };
}

/** Todas as contas do login, com ou sem perfil. Só o Administrador recebe; os outros levam 42501. */
export async function listarContas() {
  const r = resposta(await api('/rest/v1/rpc/usuarios_da_clinica', { metodo: 'POST', corpo: {} }));
  return r.error ? r : { data: (r.data || []).map(daConta), error: null };
}
const daConta = (c) => ({
  id: c.id, email: c.email || '', nome: c.nome || '', cargo: c.cargo || '', papel: c.papel || null,
  ativo: c.tem_perfil && c.ativo, temPerfil: c.tem_perfil, criadoEm: c.criado_em, ultimoAcesso: c.ultimo_acesso,
});

/** Dá perfil a uma conta que já existe no login. */
export async function liberarConta({ id, nome, cargo, papel }) {
  const r = resposta(await api('/rest/v1/rpc/liberar_conta', {
    metodo: 'POST', corpo: { p_id: id, p_nome: String(nome || ''), p_cargo: String(cargo || ''), p_papel: papel },
  }));
  return r.error ? r : { data: true, error: null };
}

/**
 * Altera nome, cargo, papel ou situação de um perfil. A RLS filtra em silêncio quem não é
 * administrador (0 linhas, sem erro), por isso "nenhuma linha mudou" vira recusa explícita.
 */
export async function atualizarPerfil(id, campos) {
  const corpo = {};
  for (const k of CAMPOS_EDITAVEIS) if (k in campos) corpo[k] = campos[k];
  const r = resposta(await api(`/rest/v1/perfis?id=eq.${encodeURIComponent(id)}`, {
    metodo: 'PATCH', corpo, extra: { prefer: 'return=representation' },
  }));
  if (r.error) return r;
  if (!Array.isArray(r.data) || !r.data.length) return { data: null, error: { code: '42501', message: 'Sem permissão para esta ação.' } };
  return { data: r.data[0], error: null };
}

/** Últimas alterações de conta, da mais nova para a mais antiga. */
export async function listarAuditoriaContas(limite = 30) {
  const n = Math.min(Math.max(Number(limite) || 30, 1), 200);
  return resposta(await api(`/rest/v1/auditoria_contas?select=id,quando,acao,ator_id,alvo_id,detalhe&order=id.desc&limit=${n}`));
}
