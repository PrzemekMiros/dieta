import { expect, test } from '@playwright/test';

test.describe('Consent Mode V2 banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('consentMode'));
    await page.reload();
  });

  test('shows the localized banner and stores a customized selection', async ({ page }, testInfo) => {
    const dialog = page.getByRole('dialog', { name: 'Twoja prywatność' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Zgoda' })).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('button', { name: /Dostosuj/ }).click();
    await expect(page.getByRole('tab', { name: 'Szczegóły' })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Analityczne').check();
    await page.screenshot({ path: testInfo.outputPath('consent-banner.png'), fullPage: true });
    await page.getByRole('button', { name: /Zapisz wybór/ }).click();

    await expect(dialog).toBeHidden();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('consentMode') || 'null'));
    expect(stored.schemaVersion).toBe(1);
    expect(stored.selection.analytics).toBe(true);
    expect(stored.selection.marketing).toBe(false);
    expect(stored.consentMode.analytics_storage).toBe('granted');
    expect(stored.consentMode.ad_storage).toBe('denied');
  });

  test('rejects optional categories and can be reopened from the footer', async ({ page }) => {
    await page.getByRole('button', { name: 'Odrzuć' }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('consentMode') || 'null'));
    expect(stored.selection).toEqual({
      necessary: true,
      analytics: false,
      preferences: false,
      marketing: false,
      partners: false,
    });

    await page.getByRole('button', { name: 'Ustawienia cookies' }).click();
    await expect(page.getByRole('dialog', { name: 'Twoja prywatność' })).toBeVisible();
  });
});
