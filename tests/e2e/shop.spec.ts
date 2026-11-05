import { test, expect } from '@playwright/test';
for (const width of [375, 768, 1024, 1440, 1920])
  test(`strona główna ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Słodkie chwile');
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `.work/home-${width}.png`, fullPage: true });
    if (width === 375) {
      await page.locator('.menu-toggle').click();
      await expect(page.locator('#main-nav')).toBeVisible();
    }
  });
test('koszyk, trwałość i mieszany checkout', async ({ page }) => {
  await page.goto('/produkt/tort-od-pierwszej-warstwy');
  await page.getByRole('button', { name: 'Dodaj do koszyka' }).click();
  await expect(page.locator('[data-cart-count]')).toHaveText('1');
  await page.goto('/koszyk');
  await expect(page.locator('[data-total]')).toHaveText(/89,00/);
  await page.reload();
  await expect(page.locator('[data-total]')).toHaveText(/89,00/);
  await page.goto('/zamowienie');
  await expect(page.locator('#shipping-fields')).toBeHidden();
  await expect(page.locator('#digital-consent')).toBeVisible();
  await page.goto('/produkt/szpatula');
  await page.getByRole('button', { name: 'Dodaj do koszyka' }).click();
  await expect(page.locator('[data-cart-count]')).toHaveText('2');
  await page.goto('/zamowienie');
  await expect(page.locator('#shipping-fields')).toBeVisible();
  await expect(page.locator('[data-checkout-total]')).toHaveText(/134,90/);
});
test('usuwanie i zmiana ilości', async ({ page }) => {
  await page.goto('/produkt/szpatula');
  await page.getByRole('button', { name: 'Dodaj do koszyka' }).click();
  await expect(page.locator('[data-cart-count]')).toHaveText('1');
  await page.goto('/koszyk');
  await page.getByRole('spinbutton').fill('2');
  await page.getByRole('spinbutton').blur();
  await expect(page.locator('[data-total]')).toHaveText(/74,90/);
  await page.getByRole('button', { name: 'Usuń Szpatuła cukiernicza' }).click();
  await expect(page.locator('[data-cart-lines]')).toContainText('czeka na coś dobrego');
});
test('anonimowy admin i blokada demonstracyjnego checkoutu', async ({ page, request }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/admin\/login/);
  const result = await request.post('/api/checkout', {
    headers: { Origin: 'http://localhost:4321' },
    data: { items: [{ id: 'demo-1', quantity: 1 }] },
  });
  expect(result.status()).toBe(503);
  const admin = await request.post('/api/admin/order', {
    headers: { Origin: 'http://localhost:4321' },
    data: {},
  });
  expect(admin.status()).toBe(401);
  const csrf = await request.post('/api/quote', {
    headers: { Origin: 'https://evil.test' },
    data: {},
  });
  expect(csrf.status()).toBe(403);
});
test('katalog, filtry, FAQ i linki publiczne', async ({ page }) => {
  for (const url of [
    '/sklep',
    '/ebooki',
    '/produkty',
    '/o-nas',
    '/kontakt',
    '/blog',
    '/blog/dobry-tort-zaczyna-sie-od-planu',
    '/regulamin',
    '/polityka-prywatnosci',
    '/dostawa-i-zwroty',
  ]) {
    const response = await page.goto(url);
    expect(response?.status()).toBe(200);
    await expect(page.locator('main h1')).toHaveCount(1);
  }
  await page.goto('/sklep?q=Kremy');
  await expect(page.locator('.product-card')).toHaveCount(1);
  await page.goto('/');
  await page.locator('summary').filter({ hasText: 'Jak otrzymam ebooka?' }).click();
  await expect(page.locator('details[open]')).toHaveCount(1);
});
