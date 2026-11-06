import { expect, test } from '@playwright/test';

test('strona główna wyświetla zdjęcie dietetyczki i zdjęcia posiłków', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.hero-note')).toHaveCount(0);
  const heroDetails = page.locator('.hero-details');
  await expect(heroDetails).toBeVisible();
  await expect(heroDetails.locator('span').first()).toHaveCSS('font-size', '34px');
  await expect(heroDetails.locator('p').first()).toHaveCSS('font-size', '13px');
  for (const selector of ['.hero-photo', '.about-main', '.about-small img']) {
    const image = page.locator(selector).first();
    await image.scrollIntoViewIfNeeded();
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
  }

  await expect(page.locator('.hero-photo')).toHaveAttribute('src', '/images/Natalia.png');
  await expect(page.locator('.about-main')).toHaveAttribute('src', '/images/IMG_8219.png');
  await expect(page.locator('.about-small img')).toHaveAttribute('src', '/images/IMG_7423.png');
});
