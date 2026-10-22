// Segredo, senha e contas da stack LOCAL — públicos de propósito, valem só nesta máquina.
import { createHmac } from 'node:crypto';

export const URL_LOCAL = 'http://localhost:54321';
const SEGREDO = 'local-dev-jwt-secret-com-pelo-menos-32-caracteres';
export const SENHA_LOCAL = 'Prontus-Local-2026!';
export const CONTAS = [
  ['admin@prontus.local', 'Beatriz Lima', 'Coordenação', 'admin'],
  ['callcenter@prontus.local', 'Aline Barros', 'Atendente', 'callcenter'],
  ['arquivo@prontus.local', 'Silvio Prado', 'Responsável pelo arquivo', 'arquivo'],
  ['recepcao@prontus.local', 'Carla Menezes', 'Recepção', 'recepcao'],
];

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const jwt = (role) => {
  const corpo = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'prontus-local', exp: 4102444800 })}`;
  return `${corpo}.${createHmac('sha256', SEGREDO).update(corpo).digest('base64url')}`;
};
export const anonKey = jwt('anon');
export const servicoKey = jwt('service_role');
