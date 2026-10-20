import { test, expect } from '@playwright/test';
import { loginAs, logout } from './authHelper';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Ensure login form is present before each test
  await expect(page.getByRole('textbox', { name: 'E-mail ou nome de usuário' })).toBeVisible();
});

test('login válido com e-mail e senha', async ({ page }) => {
  await loginAs(page, {
    identifier: 'admin@teste.com',
    password: 'senha123',
  });
  await expect(page).toHaveURL(/^\/.+$/);
});

test('login com nome de usuário (usuário sem e-mail)', async ({ page }) => {
  await loginAs(page, {
    identifier: 'admin', // users without e-mail log in with the username
    password: 'senha123',
  });
  await expect(page).toHaveURL(/^\/.+$/);
});

test('login inválido permanece na página de login com mensagem de erro', async ({ page }) => {
  // Fill invalid credentials and submit
  await page.getByRole('textbox', { name: 'E-mail ou nome de usuário' }).fill('usuario_inexistente');
  await page.getByRole('textbox', { name: 'Senha' }).fill('senha_errada');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Should still see the login screen and an error alert
  await expect(page.getByRole('textbox', { name: 'E-mail ou nome de usuário' })).toBeVisible();
  await expect(page.getByRole('alert', { name: /senha|identificação/i })).toBeVisible();
});

test('logout encerra a sessão e retorna à tela de login', async ({ page }) => {
  // First perform a valid login (the helper will take care)
  await loginAs(page, {
    identifier: 'admin@teste.com',
    password: 'senha123',
  });

  // Click the logout button (present in the dashboard header)
  await logout(page);

  // Should be back on the login page
  await expect(page.getByRole('textbox', { name: 'E-mail ou nome de usuário' })).toBeVisible();
});