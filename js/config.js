// PRONTUS — onde está o servidor de login.
//
// `anonKey` é a chave PÚBLICA do Supabase (papel `anon`): ela vai para o navegador de qualquer
// forma e não dá acesso a nada sozinha — quem protege os dados é a RLS do banco. NUNCA coloque aqui
// a chave `service_role`: ela ignora a RLS e quem a vê tem o banco inteiro.
//
// Preencha com os valores de Project Settings → API do seu projeto Supabase, e inclua o endereço
// no `connect-src` do arquivo _headers. Em desenvolvimento local, `node supabase/local/preparar.mjs`
// gera js/config.local.js, que tem prioridade em localhost e nunca é versionado.
export default { url: 'https://fgbqzcqvmdfldiaenkhv.supabase.co', anonKey: 'sb_publishable_PqGO3zmuoQuJa0t5CILk9Q_UqJM_lgI' };
