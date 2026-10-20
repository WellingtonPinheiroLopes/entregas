import { expect } from '@playwright/test';

/**
 * Helper shared by all E2E specs.
 * Performs login using the actual UI form, which properly handles
 * the tab-scoped session flow (X-Tab-Session header, CSRF, cookies).
 */
export async function loginAs(page, { identifier, password }) {
  // Ensure we are logged out first (ignore errors if not logged in)
  try {
    const logoutBtn = page.getByRole('button', { name: /Sair|logout/i });
    if (await logoutBtn.isVisible()) {
      await logoutBtn.click();
      // Wait for login form to appear after logout
      await expect(page.getByRole('textbox', { name: 'E-mail ou nome de usuário' })).toBeVisible({ timeout: 5000 });
    }
  } catch (_) {
    // Ignore errors during logout attempt
  }

  // Navigate to login page
  await page.goto('/');

  // Wait for login form
  await expect(page.getByRole('textbox', { name: 'E-mail ou nome de usuário' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Senha' })).toBeVisible();

  // Fill credentials
  await page.getByRole('textbox', { name: 'E-mail ou nome de usuário' }).fill(identifier);
  await page.getByRole('textbox', { name: 'Senha' }).fill(password);

  // Click login button
  await page.getByRole('button', { name: 'Entrar' }).click();

  // Wait for dashboard to appear - check for multiple possible indicators
  await Promise.race([
    page.getByRole('button', { name: /Sair|logout/i }).waitFor({ state: 'visible', timeout: 15000 }),
    page.getByRole('button', { name: 'Painel' }).waitFor({ state: 'visible', timeout: 15000 }),
    page.getByLabel(/Usuário/i).waitFor({ state: 'visible', timeout: 15000 }),
    page.getByText(/Painel de operações/i).waitFor({ state: 'visible', timeout: 15000 }),
  ]);

  // Additional small wait to ensure UI settled
  await page.waitForTimeout(500);
}

/**
 * Performs logout via the UI logout button.
 */
export async function logout(page) {
  await page.getByRole('button', { name: /Sair|logout/i }).click();
  // Wait for login form to reappear
  await expect(page.getByRole('textbox', { name: 'E-mail ou nome de usuário' })).toBeVisible({ timeout: 5000 });
}

/**
 * Gets CSRF token via the API (for tests that need direct API calls).
 */
export async function getCsrfToken(page): Promise<string> {
  const res = await page.evaluate(async () => {
    const r = await fetch('/api/auth/csrf', { credentials: 'include' });
    if (!r.ok) throw new Error('CSRF endpoint failed (status ' + r.status + ')');
    return r.json();
  });
  return res.csrfToken;
}