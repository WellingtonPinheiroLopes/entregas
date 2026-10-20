import { test, expect } from '@playwright/test';
import { loginAs } from './authHelper';
import { TEST_PREFIX, uniqueEmail, uniqueName, extractCreatedId, cleanupRecord, getCsrfToken } from './testDataHelper';

let createdUserId: number | null = null;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loginAs(page, {
    identifier: process.env.E2E_ADMIN_IDENTIFIER!,
    password: process.env.E2E_ADMIN_PASSWORD!
  });
  await page.getByRole('button', { name: 'Usuários' }).click();
  await expect(page.getByText('Gerenciamento de usuários')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  if (createdUserId) {
    await cleanupRecord(page, 'usuarios', createdUserId);
    createdUserId = null;
  }
});

test('listar usuários', async ({ page }) => {
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRow('td', /Admin/)).toBeVisible();
});

test('cadastro de usuário (admin)', async ({ page }) => {
  const nome = uniqueName('Usuario');
  const email = uniqueEmail('user');

  // Intercepta a resposta do POST para capturar o ID criado
  const responsePromise = page.waitForResponse(
    r => r.url().includes('/api/usuarios') && r.request().method() === 'POST'
  );

  await page.getByRole('button', { name: 'Adicionar usuário' }).click();
  await page.getByLabel('Nome completo').fill(nome);
  await page.getByLabel('E‑mail (opcional)').fill(email);
  await page.selectOption('select[aria-label="Tipo de acesso"]', 'administrador');
  await page.getByRole('button', { name: 'Salvar' }).click();

  const response = await responsePromise;
  const body = await response.json();
  createdUserId = extractCreatedId(body);

  expect(createdUserId).toBeTruthy();
  await expect(page.getByRow('td', new RegExp(nome))).toBeVisible();
});

test('edição de usuário', async ({ page }) => {
  // Primeiro cria um usuário para editar
  if (!createdUserId) {
    const nome = uniqueName('UsuarioEdit');
    const email = uniqueEmail('useredit');

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/api/usuarios') && r.request().method() === 'POST'
    );

    await page.getByRole('button', { name: 'Adicionar usuário' }).click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('E‑mail (opcional)').fill(email);
    await page.selectOption('select[aria-label="Tipo de acesso"]', 'administrador');
    await page.getByRole('button', { name: 'Salvar' }).click();

    const response = await responsePromise;
    const body = await response.json();
    createdUserId = extractCreatedId(body);
    expect(createdUserId).toBeTruthy();
  }

  // Agora edita o usuário criado
  const novoNome = uniqueName('UsuarioAtualizado');

  // Localiza a linha pelo ID (precisamos localizar via linha da tabela)
  await page.getByRow('td', new RegExp(TEST_PREFIX + 'Usuario')).locator('..').getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Nome completo').clear().fill(novoNome);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(page.getByRow('td', new RegExp(novoNome))).toBeVisible();
});

test('exclusão de usuário (regra de negócio)', async ({ page }) => {
  // Cria um usuário específico para exclusão
  if (!createdUserId) {
    const nome = uniqueName('UsuarioDelete');
    const email = uniqueEmail('userdel');

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/api/usuarios') && r.request().method() === 'POST'
    );

    await page.getByRole('button', { name: 'Adicionar usuário' }).click();
    await page.getByLabel('Nome completo').fill(nome);
    await page.getByLabel('E‑mail (opcional)').fill(email);
    await page.selectOption('select[aria-label="Tipo de acesso"]', 'administrador');
    await page.getByRole('button', { name: 'Salvar' }).click();

    const response = await responsePromise;
    const body = await response.json();
    createdUserId = extractCreatedId(body);
    expect(createdUserId).toBeTruthy();
  }

  // Tenta excluir o usuário criado pelo teste
  await page.getByRow('td', new RegExp(TEST_PREFIX + 'UsuarioDelete')).locator('..').getByRole('button', { name: 'Excluir' }).click();

  // Verifica que a exclusão respeita a regra de negócio (não pode excluir último admin, etc.)
  // Se for último admin, espera erro 409; se não, espera sucesso
  const errorBox = page.locator('.error-message');
  await expect(errorBox).not.toContainText('não pode ser excluído');

  // Se excluído com sucesso, a linha deve desaparecer
  await expect(page.getByRow('td', new RegExp(TEST_PREFIX + 'UsuarioDelete'))).not.toBeVisible();

  // Marca como limpo para não tentar limpar de novo no afterEach
  createdUserId = null;
});