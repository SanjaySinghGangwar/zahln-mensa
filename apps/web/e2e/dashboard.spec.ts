import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Finance' })).toBeVisible({ timeout: 60_000 });
});

test('daily totals per mensa and per till, with CSV export', async ({ page }) => {
  await expect(page.getByRole('rowheader', { name: 'All mensas' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: /Show tills of Mensa am Campus/ }).click();
  await expect(page.getByRole('rowheader', { name: 'Kasse 1' }).first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export day as CSV/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^zahln-tagessummen-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('needs attention, search with full history, and CSV export of a filter', async ({ page }) => {
  await page.getByRole('tab', { name: 'Needs attention' }).click();
  await expect(page.getByText(/shown/)).toBeVisible({ timeout: 60_000 });

  await page.getByRole('tab', { name: 'Payments' }).click();
  await page.getByLabel('Status').selectOption('confirmed');
  await expect
    .poll(async () => {
      const s = (await page.locator('table tbody tr td:last-child').allTextContents()).map((x) => x.trim());
      return s.length > 0 && s.every((x) => x === 'Confirmed');
    }, { timeout: 60_000 })
    .toBe(true);

  await page.locator('table tbody tr').first().getByRole('button').click();
  const dialog = page.getByRole('dialog', { name: 'Payment' });
  await expect(dialog.getByRole('heading', { name: 'History' })).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export CSV/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^zahln-zahlungen-.*\.csv$/);
  await expect(page.getByText(/payments exported/)).toBeVisible({ timeout: 90_000 });
});

test('German is one tap away', async ({ page }) => {
  await page.getByRole('button', { name: 'Deutsch' }).click();
  await expect(page.getByRole('heading', { name: 'Finanzen' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Tagessummen' })).toBeVisible();
});
