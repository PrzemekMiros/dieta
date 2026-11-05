import { expect, test } from '@playwright/test';

test('strona główna wyświetla nowe zdjęcia posiłków', async ({ page }) => {
  await page.goto('/');

  for (const selector of ['.hero-photo', '.about-main', '.about-small img', '.product-card img']) {
    const image = page.locator(selector).first();
    await expect(image).toBeVisible();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
  }

  await expect(page.locator('.hero-photo')).toHaveAttribute('src', '/images/IMG_7495.png');
  await expect(page.locator('.about-main')).toHaveAttribute('src', '/images/IMG_8219.png');
  await expect(page.locator('.about-small img')).toHaveAttribute('src', '/images/IMG_7423.png');
});
