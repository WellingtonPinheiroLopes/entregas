import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helper: fetch CSRF token and perform login in one step.
// The backend expects the tab‑scoped credential flow, so we first obtain
// a CSRF token via the dedicated endpoint, then POST credentials.
// ---------------------------------------------------------------------------
async function loginAs(page, { identifier, password }) {
  // 1️⃣ Get CSRF token
  const csrfRes = await page.evaluate(async () => {
    const r = await fetch('/api/auth/csrf', { credentials: 'include' });
    if (!r.ok) throw new Error('CSRF failed');
    return r.json();
  });
  const csrfToken = csrfRes.csrfToken;

  // 2️⃣ POST login
  await page.evaluate(
    async (token, ident, pwd) => {
      const body = JSON.stringify({ identificador: ident, senha: pwd });
      await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': token,
        },
        body,
      });
    },
    csrfToken,
    identifier,
    password,
  );

  // 3️⃣ Wait for the page to redirect/dashboard to appear
  await expect(page).toHaveURL(/^\/.+$/);
  await expect(page.getByRole('textbox', { name: 'E‑mail ou nome de usuário' })).not.toBeVisible(); // login screen should disappear
  await expect(page.getByText(/Painel|dashboard/i)).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // Ensure login form is present before each test
  await expect(page.getByRole('textbox', { name: 'E‑mail ou nome de usuário' })).toBeVisible();
});

test('login válido com e‑mail e senha', async ({ page }) => {
  await loginAs(page, {
    identifier: 'admin@teste.com',
    password: 'senha123',
  });
});

test('login com nome de usuário (usuário sem e‑mail)', async ({ page }) => {
  await loginAs(page, {
    identifier: 'admin', // users without e‑mail log in with the username
    password: 'senha123',
  });
});

test('login inválido permanece na página de login com mensagem de erro', async ({ page }) => {
  // Fill invalid credentials and submit
  await page.getByRole('textbox', { name: 'E‑mail ou nome de usuário' }).fill('usuario_inexistente');
  await page.getByLabel('Senha').fill('senha_errada');
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Should still see the login screen and an error alert
  await expect(page.getByRole('textbox', { name: 'E‑mail ou nome de usuário' })).toBeVisible();
  await expect(page.getByRole('alert', { name: /senha|identificação/i })).toBeVisible();
});

test('logout encerra a sessão e retorna à tela de login', async ({ page }) => {
  // First perform a valid login (the helper will take care)
  await loginAs(page, {
    identifier: 'admin@teste.com',
    password: 'senha123',
  });

  // Click the logout button (present in the dashboard header)
  await page.getByRole('button', { name: /Sair|logout/i }).click();

  // Should be back on the login page
  await expect(page.getByRole('textbox', { name: 'E‑mail ou nome de usuário' })).toBeVisible();
});
