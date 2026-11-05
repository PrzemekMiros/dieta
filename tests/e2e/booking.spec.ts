import { expect, test } from '@playwright/test';

test('kalendarz konsultacji otwiera się jako pełnoekranowy podgląd', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');

  const dialog = page.locator('.booking-dialog');
  await page.locator('.site-header [data-booking-open]').click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-label', 'Wybór terminu konsultacji');
  await expect(dialog.locator('.booking-topbar, .booking-intro')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await dialog.locator('[data-date]:not(:disabled)').first().click();
  await expect(dialog.locator('[data-time-section]')).toBeVisible();
  await dialog.locator('[data-time]:not(:disabled)').first().click();
  await expect(dialog.locator('[data-booking-form]')).toBeVisible();

  await dialog.locator('[name="name"]').fill('Anna');
  await dialog.locator('[name="email"]').fill('anna@example.test');
  await dialog.getByRole('button', { name: 'Pokaż podsumowanie' }).click();
  await expect(dialog.locator('[data-booking-result]')).toContainText(
    'zgłoszenie nie zostało wysłane',
  );
  await expect(page).toHaveURL('/');
  await dialog.getByRole('button', { name: 'Zamknij kalendarz' }).click();
  await expect(dialog).toBeHidden();
});

test('kalendarz zajmuje pełną szerokość, a dni i opis są obok siebie', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.locator('.site-header [data-booking-open]').click();

  const dialog = page.locator('.booking-dialog');
  await expect(dialog).toBeVisible();
  const calendar = await dialog.locator('.booking-calendar').boundingBox();
  const days = await dialog.locator('.calendar-pane').boundingBox();
  const details = await dialog.locator('.booking-details').boundingBox();

  expect(calendar?.width).toBeGreaterThan(1000);
  expect(days?.x).toBeLessThan(details?.x ?? 0);
  expect(Math.abs((days?.y ?? 0) - (details?.y ?? 0))).toBeLessThan(20);
});
