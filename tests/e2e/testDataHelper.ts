/**
 * Helper para geração de dados de teste únicos e identificáveis.
 * Garante que cada execução da suíte E2E crie registros isolados
 * e rastreáveis, sem colidir com dados preexistentes.
 */

// ID único por execução da suíte (timestamp base-36 + aleatório)
export const TEST_RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const TEST_PREFIX = `E2E_${TEST_RUN_ID}_`;

/**
 * Gera CPF válido único (algoritmo simplificado dos dígitos verificadores).
 * Retorna string de 11 dígitos.
 */
export function generateUniqueCpf(): string {
  // Base: 9 dígitos derivados do timestamp + aleatório
  const base9 = (Date.now() % 1_000_000_000).toString().padStart(9, '0');
  const digits = base9.split('').map(Number);

  // 1º dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += digits[i] * (10 - i);
  }
  let dv1 = (sum * 10) % 11;
  if (dv1 === 10) dv1 = 0;

  // 2º dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += (i < 9 ? digits[i] : dv1) * (11 - i);
  }
  let dv2 = (sum * 10) % 11;
  if (dv2 === 10) dv2 = 0;

  return `${base9}${dv1}${dv2}`;
}

/**
 * Gera email único para testes.
 */
export function uniqueEmail(prefix: string): string {
  return `${prefix}${TEST_RUN_ID}@e2e-test.local`;
}

/**
 * Gera nome único para entidades de teste.
 */
export function uniqueName(base: string): string {
  return `${TEST_PREFIX}${base}`;
}

/**
 * Extrai ID numérico de resposta JSON de criação (POST /api/...).
 * Espera formato { id: number } ou { usuario: { id }, entregador: { id }, cliente: { id }, entrega: { id } }
 */
export function extractCreatedId(responseBody: any): number | null {
  if (!responseBody) return null;
  if (typeof responseBody.id === 'number') return responseBody.id;
  if (responseBody.usuario?.id) return responseBody.usuario.id;
  if (responseBody.entregador?.id) return responseBody.entregador.id;
  if (responseBody.cliente?.id) return responseBody.cliente.id;
  if (responseBody.entrega?.id) return responseBody.entrega.id;
  return null;
}

/**
 * Headers padrão para requisições autenticadas com CSRF.
 */
export async function getCsrfToken(page: any): Promise<string> {
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/auth/csrf', { credentials: 'include' });
    return r.json();
  });
  return res.csrfToken;
}

/**
 * Realiza DELETE via API para limpeza de registro de teste.
 * Retorna true se sucesso (200/204) ou 409 (não pode excluir por regra de negócio).
 */
export async function cleanupRecord(page: any, endpoint: string, id: number | string): Promise<boolean> {
  try {
    const csrf = await getCsrfToken(page);
    const res = await page.request.delete(`/api/${endpoint}/${id}`, {
      headers: { 'X-CSRF-Token': csrf }
    });
    return res.ok() || res.status() === 409;
  } catch {
    return false;
  }
}