import { test, expect } from '@playwright/test';
import { loginAs } from './authHelper';
import { TEST_PREFIX, uniqueEmail, uniqueName, generateUniqueCpf, extractCreatedId, cleanupRecord } from './testDataHelper';

let createdClientId: number | null = null;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loginAs(page, {
    identifier: process.env.E2E_ADMIN_IDENTIFIER!,
    password: process.env.E2E_ADMIN_PASSWORD!
  });
  await page.getByRole('button', { name: 'Clientes' }).click();
  await expect(page.getByText('Gerenciamento de clientes')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  if (createdClientId) {
    await cleanupRecord(page, 'clientes', createdClientId);
    createdClientId = null;
  }
});

test('listar clientes', async ({ page }) => {
  await expect(page.getByRole('table')).toBeVisible();
});

test('cadastro de cliente', async ({ page }) => {
  const nome = uniqueName('Cliente');
  const cpf = generateUniqueCpf();
  const email = uniqueEmail('cliente');

  const responsePromise = page.waitForResponse(
    r => r.url().includes('/api/clientes') && r.request().method() === 'POST'
  );

  await page.getByRole('button', { name: 'Adicionar cliente' }).click();
  await page.getByLabel('Nome').fill(nome);
  await page.getByLabel('CPF').fill(cpf);
  await page.getByLabel('E‑mail').fill(email);
  await page.selectOption('select[aria-label="Estado"]', 'RJ');
  await page.getByRole('button', { name: 'Salvar' }).click();

  const response = await responsePromise;
  const body = await response.json();
  createdClientId = extractCreatedId(body);

  expect(createdClientId).toBeTruthy();
  await expect(page.getByRow('td', new RegExp(nome))).toBeVisible();
});

test('edição de cliente', async ({ page }) => {
  // Primeiro cria um cliente para editar
  if (!createdClientId) {
    const nome = uniqueName('ClienteEdit');
    const cpf = generateUniqueCpf();
    const email = uniqueEmail('clienteedit');

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/api/clientes') && r.request().method() === 'POST'
    );

    await page.getByRole('button', { name: 'Adicionar cliente' }).click();
    await page.getByLabel('Nome').fill(nome);
    await page.getByLabel('CPF').fill(cpf);
    await page.getByLabel('E‑mail').fill(email);
    await page.selectOption('select[aria-label="Estado"]', 'RJ');
    await page.getByRole('button', { name: 'Salvar' }).click();

    const response = await responsePromise;
    const body = await response.json();
    createdClientId = extractCreatedId(body);
    expect(createdClientId).toBeTruthy();
  }

  // Agora edita o cliente criado
  const novoNome = uniqueName('ClienteAtualizado');

  await page.getByRow('td', new RegExp(TEST_PREFIX + 'Cliente')).locator('..').getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Nome').clear().fill(novoNome);
  await page.getByRole('button', { name: 'Salvar alterações' }).click();

  await expect(page.getByRow('td', new RegExp(novoNome))).toBeVisible();
});

test('exclusão de cliente (regra de negócio)', async ({ page }) => {
  // Cria um cliente específico para exclusão
  if (!createdClientId) {
    const nome = uniqueName('ClienteDelete');
    const cpf = generateUniqueCpf();
    const email = uniqueEmail('clientedel');

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/api/clientes') && r.request().method() === 'POST'
    );

    await page.getByRole('button', { name: 'Adicionar cliente' }).click();
    await page.getByLabel('Nome').fill(nome);
    await page.getByLabel('CPF').fill(cpf);
    await page.getByLabel('E‑mail').fill(email);
    await page.selectOption('select[aria-label="Estado"]', 'RJ');
    await page.getByRole('button', { name: 'Salvar' }).click();

    const response = await responsePromise;
    const body = await response.json();
    createdClientId = extractCreatedId(body);
    expect(createdClientId).toBeTruthy();
  }

  // Tenta excluir o cliente criado pelo teste
  await page.getByRow('td', new RegExp(TEST_PREFIX + 'ClienteDelete')).locator('..').getByRole('button', { name: 'Excluir' }).click();

  // Verifica que a exclusão respeita a regra de negócio
  const errorBox = page.locator('.error-message');
  await expect(errorBox).not.toContainText('possui registros relacionados');

  // Se excluído com sucesso, a linha deve desaparecer
  await expect(page.getByRow('td', new RegExp(TEST_PREFIX + 'ClienteDelete'))).not.toBeVisible();

  createdClientId = null;
});