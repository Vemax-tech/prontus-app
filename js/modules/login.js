// PRONTUS — tela de entrada.
//
// A única página aberta sem sessão. Valida o que dá para validar no navegador (campo vazio, e-mail
// malformado — conveniência, não segurança), manda e-mail e senha ao servidor de login e, se a
// conta tiver perfil ativo, leva a pessoa de volta para onde ela estava (`?next=`, só dentro do app).
//
// Duas escolhas de texto que importam: a recusa é UMA frase para e-mail errado e senha errada (não
// ensina a adivinhar quais e-mails existem) e "esqueci a senha" manda falar com o administrador,
// porque a conta é criada e mantida pela clínica — não há cadastro nem recuperação abertos.
import { h, criarIcon } from '../base/dom.js';
import { emailValido } from '../base/validacao.js';
import { MARCA, MONOGRAMA } from '../marca.js';
import { entrar, jaEntrou, configurado, destinoSeguro, navegar } from '../auth.js';

const icon = criarIcon({
  marca: MONOGRAMA,
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  olhoRisca: '<path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-2.6 3.6M6.6 6.6A17.4 17.4 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2M2 2l20 20"/>',
});

const MOTIVOS = {
  expirou: 'Sua sessão expirou. Entre novamente.',
  inatividade: 'Você ficou um tempo sem usar o sistema, então saímos por segurança. Entre novamente.',
  semacesso: 'Sua conta não tem mais acesso ao sistema. Fale com o administrador.',
  configuracao: 'O login ainda não foi configurado neste ambiente. Avise o administrador.',
  saiu: 'Você saiu do sistema.',
};

export async function init() {
  const app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const destino = destinoSeguro(params.get('next'));

  // Quem já entrou não digita senha de novo.
  if (await jaEntrou()) { navegar(destino); return; }

  const campoEmail = h('input', {
    id: 'email', name: 'email', type: 'email', inputmode: 'email', autocomplete: 'username',
    autocapitalize: 'none', spellcheck: 'false', maxlength: '254', required: '', 'aria-describedby': 'erro-email',
  });
  const campoSenha = h('input', {
    id: 'senha', name: 'senha', type: 'password', autocomplete: 'current-password',
    maxlength: '128', required: '', 'aria-describedby': 'erro-senha',
  });
  const erroEmail = h('p', { id: 'erro-email', class: 'err', hidden: '' });
  const erroSenha = h('p', { id: 'erro-senha', class: 'err', hidden: '' });
  const erroGeral = h('p', { class: 'err', role: 'alert', hidden: '' });
  const botao = h('button', { class: 'btn primary', type: 'submit' }, 'Entrar');

  const ver = h('button', {
    class: 'ver', type: 'button', 'aria-label': 'Mostrar a senha', 'aria-pressed': 'false',
    onclick: () => {
      const mostrando = campoSenha.type === 'text';
      campoSenha.type = mostrando ? 'password' : 'text';
      ver.setAttribute('aria-pressed', String(!mostrando));
      ver.setAttribute('aria-label', mostrando ? 'Mostrar a senha' : 'Esconder a senha');
      ver.replaceChildren(icon(mostrando ? 'olho' : 'olhoRisca'));
    },
  }, icon('olho'));

  const marcar = (campo, aviso, msg) => {
    aviso.textContent = msg || '';
    aviso.hidden = !msg;
    if (msg) campo.setAttribute('aria-invalid', 'true'); else campo.removeAttribute('aria-invalid');
    return !msg;
  };
  const falhar = (msg) => { erroGeral.textContent = msg; erroGeral.hidden = false; };

  async function enviar(e) {
    e.preventDefault();
    if (botao.dataset.ocupado) return;                  // segundo clique/Enter enquanto espera
    erroGeral.hidden = true;
    const email = campoEmail.value.trim(), senha = campoSenha.value;
    const okEmail = marcar(campoEmail, erroEmail, !email ? 'Informe o e-mail.' : !emailValido(email) ? 'Esse e-mail não parece certo.' : '');
    const okSenha = marcar(campoSenha, erroSenha, !senha ? 'Informe a senha.' : '');
    if (!okEmail || !okSenha) { (okEmail ? campoSenha : campoEmail).focus(); return; }

    botao.dataset.ocupado = '1';
    botao.setAttribute('aria-busy', 'true');
    botao.textContent = 'Entrando…';
    const r = await entrar(email, senha);
    if (r.perfil) { navegar(destino); return; }

    delete botao.dataset.ocupado;
    botao.removeAttribute('aria-busy');
    botao.textContent = 'Entrar';
    campoSenha.value = '';                              // senha errada não fica na tela nem no campo
    falhar(r.erro);
    campoSenha.focus();
  }

  const motivo = MOTIVOS[params.get('motivo')];
  const configurada = await configurado();

  app.replaceChildren(h('main', { class: 'login' },
    h('div', { class: 'login-box' },
      h('div', { class: 'mark', 'aria-label': MARCA.produto }, icon('marca'), h('span', {}, MARCA.produto)),
      h('section', { class: 'card login-card' },
        h('h1', {}, 'Entrar'),
        h('p', { class: 'lead' }, 'Use o e-mail e a senha que a clínica cadastrou para você.'),
        motivo ? h('p', { class: 'info', role: 'status' }, motivo) : null,
        !configurada && params.get('motivo') !== 'configuracao'
          ? h('p', { class: 'err', role: 'alert' }, MOTIVOS.configuracao) : null,
        h('form', { novalidate: '', onsubmit: enviar },
          h('label', { for: 'email' }, 'E-mail'), campoEmail, erroEmail,
          h('label', { for: 'senha' }, 'Senha'), h('div', { class: 'senha-linha' }, campoSenha, ver), erroSenha,
          erroGeral, botao)),
      h('p', { class: 'login-ajuda micro muted' }, 'Esqueceu a senha ou não tem acesso? Fale com o administrador da clínica.'))));

  campoEmail.focus();
}
