import { test, expect } from '@playwright/test';
import { loginAs } from './authHelper';
import { TEST_PREFIX, uniqueEmail, uniqueName, generateUniqueCpf, extractCreatedId, cleanupRecord } from './testDataHelper';

let testClientId: number | null = null;
let testDelivererId: number | null = null;
let createdDeliveryId: number | null = null;

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loginAs(page, {
    identifier: process.env.E2E_ADMIN_IDENTIFIER!,
    password: process.env.E2E_ADMIN_PASSWORD!
  });
  // Navega para a seção de Entregas
  await page.getByRole('button', { name: 'Entregas' }).click();
  await expect(page.getByText('Painel de operações')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  // Limpa a entrega criada pelo teste, se houver
  if (createdDeliveryId) {
    await cleanupRecord(page, 'entregas', createdDeliveryId);
    createdDeliveryId = null;
  }
});

// Helper para criar um cliente de teste via API
async function createTestClient(page: any): Promise<number> {
  const nome = uniqueName('ClienteEntrega');
  const cpf = generateUniqueCpf();
  const email = uniqueEmail('cliententrega');

  const responsePromise = page.waitForResponse(
    r => r.url().includes('/api/clientes') && r.request().method() === 'POST'
  );

  await page.getByRole('button', { name: 'Adicionar cliente' }).click();
  await page.getByLabel('Nome').fill(nome);
  await page.getByLabel('CPF').fill(generateUniqueCpf());
  await page.getByLabel('E‑mail').fill(uniqueEmail('cliententrega'));
  await page.selectOption('select[aria-label="Estado"]', 'SP');
  await page.getByRole('button', { name: 'Salvar' }).click();

  const response = await responsePromise;
  const body = await response.json();
  return extractCreatedId(body) as number;
}

// Helper para criar um entregador de teste via API
async function createTestDeliverer(page: any): Promise<number> {
  const nome = uniqueName('EntregadorEntrega');
  const cpf = generateUniqueCpf();
  const email = uniqueEmail('entregadorentrega');

  const responsePromise = page.waitForResponse(
    r => r.url().includes('/api/entregadores') && r.request().method() === 'POST'
  );

  await page.getByRole('button', { name: 'Adicionar entregador' }).click();
  await page.getByLabel('Nome').fill(nome);
  await page.getByLabel('CPF').fill(generateUniqueCpf());
  await page.getByLabel('E‑mail').fill(uniqueEmail('entregadorentrega'));
  await page.selectOption('select[aria-label="Estado"]', 'SP');
  await page.getByRole('button', { name: 'Salvar' }).click();

  const response = await responsePromise;
  const body = await response.json();
  return extractCreatedId(body) as number;
}

// Helper para criar uma entrega via UI e retornar o ID
async function createDeliveryViaUI(page: any, options: {
  clientId: number;
  delivererId?: number;
  descricao: string;
  cep: string;
  endereco: string;
  numero: string;
  cidade: string;
  estado: string;
}): Promise<number> {
  const responsePromise = page.waitForResponse(
    r => r.url().includes('/api/entregas') && r.request().method() === 'POST'
  );

  await page.getByRole('button', { name: 'Nova entrega' }).click();
  await page.getByLabel('Descrição').fill(options.descricao);
  await page.selectOption('select[name="cliente_id"]', String(options.clientId));
  if (options.delivererId) {
    await page.selectOption('select[name="entregador_id"]', String(options.delivererId));
  }
  await page.getByLabel('CEP destino').fill(options.cep);
  await page.getByLabel('Endereço destino').fill(options.endereco);
  await page.getByLabel('Número').fill(options.numero);
  await page.getByLabel('Cidade').fill(options.cidade);
  await page.selectOption('select[aria-label="Estado"]', options.estado);
  await page.getByRole('button', { name: 'Criar' }).click();

  const response = await responsePromise;
  const body = await response.json();
  return extractCreatedId(body) as number;
}

test('criar entrega (status inicial = na farmácia)', async ({ page }) => {
  // Garante que temos um cliente de teste
  if (!testClientId) {
    // Navega para clientes para criar
    await page.getByRole('button', { name: 'Clientes' }).click();
    testClientId = await createTestClient(page);
    // Volta para entregas
    await page.getByRole('button', { name: 'Entregas' }).click();
  }

  const descricao = uniqueName('Entrega Medicamentos');
  createdDeliveryId = await createDeliveryViaUI(page, {
    clientId: testClientId,
    descricao,
    cep: '01001000',
    endereco: 'Rua da Praia',
    numero: '10',
    cidade: 'São Paulo',
    estado: 'SP'
  });

  expect(createdDeliveryId).toBeTruthy();
  await expect(page.getByRow('td', new RegExp(descricao))).toBeVisible();
  await expect(page.getByText('Na farmácia')).toBeVisible();
});

test('transição de status: farmácia → trânsito (admin)', async ({ page }) => {
  // Cria uma entrega própria para este teste
  if (!testClientId) {
    await page.getByRole('button', { name: 'Clientes' }).click();
    testClientId = await createTestClient(page);
    await page.getByRole('button', { name: 'Entregas' }).click();
  }

  const descricao = uniqueName('Entrega Transito');
  createdDeliveryId = await createDeliveryViaUI(page, {
    clientId: testClientId,
    descricao,
    cep: '01001000',
    endereco: 'Rua da Praia',
    numero: '10',
    cidade: 'São Paulo',
    estado: 'SP'
  });

  // Verifica status inicial
  await expect(page.getByRow('td', new RegExp(descricao))).toBeVisible();
  await expect(page.getByText('Na farmácia')).toBeVisible();

  // Move para trânsito
  await page.getByRow('td', new RegExp(descricao)).locator('..').getByRole('button', { name: 'Mover para trânsito', exact: true }).click();
  await expect(page.getByText('Em trânsito')).toBeVisible();
});

test('transição de status: trânsito → conclusão (admin)', async ({ page }) => {
  // Cria uma entrega e move para trânsito primeiro
  if (!testClientId) {
    await page.getByRole('button', { name: 'Clientes' }).click();
    testClientId = await createTestClient(page);
    await page.getByRole('button', { name: 'Entregas' }).click();
  }

  const descricao = uniqueName('Entrega Conclusao');
  createdDeliveryId = await createDeliveryViaUI(page, {
    clientId: testClientId,
    descricao,
    cep: '01001000',
    endereco: 'Rua da Praia',
    numero: '10',
    cidade: 'São Paulo',
    estado: 'SP'
  });

  // Move para trânsito
  await page.getByRow('td', new RegExp(descricao)).locator('..').getByRole('button', { name: 'Mover para trânsito', exact: true }).click();
  await expect(page.getByText('Em trânsito')).toBeVisible();

  // Conclui
  await page.getByRow('td', new RegExp(descricao)).locator('..').getByRole('button', { name: 'Concluir', exact: true }).click();
  await expect(page.getByText('Concluída')).toBeVisible();
});

test('cancelamento de entrega', async ({ page }) => {
  // Cria uma entrega para cancelar
  if (!testClientId) {
    await page.getByRole('button', { name: 'Clientes' }).click();
    testClientId = await createTestClient(page);
    await page.getByRole('button', { name: 'Entregas' }).click();
  }

  const descricao = uniqueName('Entrega Cancelar');
  createdDeliveryId = await createDeliveryViaUI(page, {
    clientId: testClientId,
    descricao,
    cep: '01001000',
    endereco: 'Rua da Praia',
    numero: '10',
    cidade: 'São Paulo',
    estado: 'SP'
  });

  // Cancela a entrega
  await page.getByRow('td', new RegExp(descricao)).locator('..').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByLabel('Motivo do cancelamento').fill('Motivo de teste E2E');
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Cancelada')).toBeVisible();
});

test('segunda entrega criada e cancelada', async ({ page }) => {
  // Cria primeira entrega (já pode existir do teste anterior, mas criamos nova)
  if (!testClientId) {
    await page.getByRole('button', { name: 'Clientes' }).click();
    testClientId = await createTestClient(page);
    await page.getByRole('button', { name: 'Entregas' }).click();
  }

  // Primeira entrega
  const descricao1 = uniqueName('Entrega Primeira');
  const delivery1Id = await createDeliveryViaUI(page, {
    clientId: testClientId,
    descricao: descricao1,
    cep: '01001000',
    endereco: 'Rua da Praia',
    numero: '10',
    cidade: 'São Paulo',
    estado: 'SP'
  });
  expect(delivery1Id).toBeTruthy();

  // Segunda entrega
  const descricao2 = uniqueName('Entrega Segunda');
  createdDeliveryId = await createDeliveryViaUI(page, {
    clientId: testClientId,
    descricao: descricao2,
    cep: '22041001',
    endereco: 'Rua da Assembleia',
    numero: '50',
    cidade: 'Rio de Janeiro',
    estado: 'RJ'
  });
  expect(createdDeliveryId).toBeTruthy();
  await expect(page.getByRow('td', new RegExp(descricao2))).toBeVisible();

  // Cancela a segunda entrega
  await page.getByRow('td', new RegExp(descricao2)).locator('..').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByLabel('Motivo do cancelamento').fill('Sem necessidade');
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Cancelada')).toBeVisible();

  // Limpa a segunda entrega (a primeira fica para outros testes se quiser)
  createdDeliveryId = null;
  // Opcional: limpar a primeira também
  // await cleanupRecord(page, 'entregas', delivery1Id);
});