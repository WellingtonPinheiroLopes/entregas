import { test, expect } from '@playwright/test';
import { loginAs } from './authHelper';
import { TEST_PREFIX, uniqueEmail, uniqueName, generateUniqueCpf, extractCreatedId, cleanupRecord } from './testDataHelper';

let createdDelivererId: number | null = null;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loginAs(page, {
    identifier: process.env.E2E_ADMIN_IDENTIFIER!,
    password: process.env.E2E_ADMIN_PASSWORD!
  });
  await page.getByRole('button', { name: 'Entregadores' }).click();
  await expect(page.getByText('Gerenciamento de entregadores')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  if (createdDelivererId) {
    await cleanupRecord(page, 'entregadores', createdDelivererId);
    createdDelivererId = null;
  }
});

test('listar entregadores', async ({ page }) => {
  await expect(page.getByRole('table')).toBeVisible();
});

test('cadastro de entregador', async ({ page }) => {
  const nome = uniqueName('Entregador');
  const cpf = generateUniqueCpf();
  const email = uniqueEmail('entregador');

  const responsePromise = page.waitForResponse(
    r => r.url().includes('/api/entregadores') && r.request().method() === 'POST'
  );

  await page.getByRole('button', { name: 'Adicionar entregador' }).click();
  await page.getByLabel('Nome').fill(nome);
  await page.getByLabel('CPF').fill(cpf);
  await page.getByLabel('E‑mail').fill(email);
  await page.selectOption('select[aria-label="Estado"]', 'SP');
  await page.getByRole('button', { name: 'Salvar' }).click();

  const response = await responsePromise;
  const body = await response.json();
  createdDelivererId = extractCreatedId(body);

  expect(createdDelivererId).toBeTruthy();
  await expect(page.getByRow('td', new RegExp(nome))).toBeVisible();
});

test('edição de entregador', async ({ page }) => {
  // Primeiro cria um entregador para editar
  if (!createdDelivererId) {
    const nome = uniqueName('EntregadorEdit');
    const cpf = generateUniqueCpf();
    const email = uniqueEmail('entregadoredit');

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/api/entregadores') && r.request().method() === 'POST'
    );

    await page.getByRole('button', { name: 'Adicionar entregador' }).click();
    await page.getByLabel('Nome').fill(nome);
    await page.getByLabel('CPF').fill(cpf);
    await page.getByLabel('E‑mail').fill(email);
    await page.selectOption('select[aria-label="Estado"]', 'SP');
    await page.getByRole('button', { name: 'Salvar' }).click();

    const response = await responsePromise;
    const body = await response.json();
    createdDelivererId = extractCreatedId(body);
    expect(createdDelivererId).toBeTruthy();
  }

  // Agora edita o entregador criado
  const novoNome = uniqueName('EntregadorAtualizado');

  await page.getByRow('td', new RegExp(TEST_PREFIX + 'Entregador')).locator('..').getByRole('button', { name: 'Editar' }).click();
  await page.getByLabel('Nome').clear().fill(novoNome);
  await page.getByRole('button', { name: 'Salvar' }).click();

  await expect(page.getByRow('td', new RegExp(novoNome))).toBeVisible();
});

test('exclusão de entregador (regra de negócio)', async ({ page }) => {
  // Cria um entregador específico para exclusão
  if (!createdDelivererId) {
    const nome = uniqueName('EntregadorDelete');
    const cpf = generateUniqueCpf();
    const email = uniqueEmail('entregadordel');

    const responsePromise = page.waitForResponse(
      r => r.url().includes('/api/entregadores') && r.request().method() === 'POST'
    );

    await page.getByRole('button', { name: 'Adicionar entregador' }).click();
    await page.getByLabel('Nome').fill(nome);
    await page.getByLabel('CPF').fill(cpf);
    await page.getByLabel('E‑mail').fill(email);
    await page.selectOption('select[aria-label="Estado"]', 'SP');
    await page.getByRole('button', { name: 'Salvar' }).click();

    const response = await responsePromise;
    const body = await response.json();
    createdDelivererId = extractCreatedId(body);
    expect(createdDelivererId).toBeTruthy();
  }

  // Tenta excluir o entregador criado pelo teste
  await page.getByRow('td', new RegExp(TEST_PREFIX + 'EntregadorDelete')).locator('..').getByRole('button', { name: 'Excluir' }).click();

  // Verifica que a exclusão respeita a regra de negócio
  const errorBox = page.locator('.error-message');
  await expect(errorBox).not.toContainText('possui registros relacionados');

  // Se excluído com sucesso, a linha deve desaparecer
  await expect(page.getByRow('td', new RegExp(TEST_PREFIX + 'EntregadorDelete'))).not.toBeVisible();

  createdDelivererId = null;
});