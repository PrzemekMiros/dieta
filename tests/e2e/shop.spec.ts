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
test('opis opinii klientów jest wyśrodkowany pod nagłówkiem', async ({ page }) => {
  await page.goto('/');
  const intro = page.locator('.testimonials > .intro');
  await expect(intro).toBeVisible();
  await expect(intro).toHaveCSS('text-align', 'center');
  const alignment = await intro.evaluate((element) => {
    const section = element.parentElement!.getBoundingClientRect();
    const paragraph = element.getBoundingClientRect();
    return Math.abs(section.left + section.width / 2 - (paragraph.left + paragraph.width / 2));
  });
  expect(alignment).toBeLessThan(2);
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
test('strona produktu pokazuje okruszki nad tytułem i kategorię pod nim', async ({ page }) => {
  await page.goto('/produkt/chlebek-pelnoziarnisty');
  const breadcrumbs = page.getByRole('navigation', { name: 'Okruszki' });
  const title = page.locator('main h1');
  const category = page.locator('.product-category');

  await expect(breadcrumbs).toBeVisible();
  await expect(title).toBeVisible();
  await expect(category).toBeVisible();
  await expect(category).toHaveText('Pieczywo');
  await expect(breadcrumbs.getByRole('link', { name: 'Sklep' })).toHaveAttribute('href', '/sklep');
  const positions = await Promise.all([
    breadcrumbs.evaluate((element) => element.getBoundingClientRect().bottom),
    title.evaluate((element) => element.getBoundingClientRect().top),
    title.evaluate((element) => element.getBoundingClientRect().bottom),
    category.evaluate((element) => element.getBoundingClientRect().top),
  ]);
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[2]).toBeLessThan(positions[3]);
});
test('katalog pieczywa ogranicza szerokość źródłową zdjęć do 450px', async ({ page }) => {
  await page.goto('/produkty');
  const images = page.locator('.catalog-grid .product-card .product-image > img');
  await expect(images.first()).toBeVisible();
  const widths = await images.evaluateAll((elements) =>
    elements.map((image) => Number(image.getAttribute('width'))),
  );
  expect(widths.length).toBeGreaterThan(0);
  expect(widths.every((width) => width > 0 && width <= 450)).toBe(true);
  await expect
    .poll(() => images.first().evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeLessThanOrEqual(450);
});
test('pusty koszyk wyjaśnia kolejny krok', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.removeItem('tc-cart-v1'));
  await page.goto('/koszyk');
  await expect(page.locator('.cart-empty h2')).toHaveText('Koszyk czeka na coś dobrego.');
  await expect(
    page.locator('.cart-empty').getByRole('link', { name: 'Zobacz produkty' }),
  ).toHaveAttribute('href', '/sklep');
  await expect(page.locator('[data-cart-summary]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('checkout jasno pokazuje krok i pełne podsumowanie przed płatnością', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => {
    localStorage.setItem('tc-cart-v1', JSON.stringify([{ id: 'demo-1', quantity: 1 }]));
  });
  await page.goto('/zamowienie');
  await expect(page.locator('.checkout-progress [aria-current="step"]')).toContainText(
    'Dane i płatność',
  );
  await expect(page.locator('[data-checkout-lines]')).toContainText(
    'E-book: 7 dni zdrowego jedzenia',
  );
  await expect(page.locator('[data-checkout-subtotal]')).toContainText('89,00');
  await expect(page.locator('[data-checkout-shipping]')).toHaveText('Bezpłatnie');
  await expect(page.locator('#pay-button')).toContainText('obowiązkiem zapłaty');
  const summary = await page.locator('.checkout-summary').boundingBox();
  const contact = await page.locator('.checkout-section').first().boundingBox();
  expect(summary?.y).toBeLessThan(contact?.y ?? 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('checkout udostępnia gotówkę przy odbiorze dla zamówień fizycznych', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tc-cart-v1', JSON.stringify([{ id: 'demo-4', quantity: 1 }]));
  });
  await page.goto('/zamowienie');

  const paymentFields = page.locator('#payment-fields');
  await expect(paymentFields).toBeVisible();
  await expect(paymentFields.getByLabel('Gotówka przy odbiorze przesyłki')).toBeChecked();
  await expect(page.locator('#payment-note')).toContainText(
    'Zapłacisz gotówką przy odbiorze przesyłki.',
  );
  await page.getByRole('button', { name: 'Akceptuję wszystkie' }).click();
  await paymentFields.getByLabel('Płatność online przez Przelewy24').check();
  await expect(page.locator('#payment-note')).toContainText('Przelewy24');
});
test('strona podziękowania pokazuje status i szczegóły zamówienia', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const token = 'a'.repeat(64);
  await page.addInitScript(() => {
    localStorage.setItem('tc-cart-v1', JSON.stringify([{ id: 'demo-1', quantity: 1 }]));
  });
  await page.route('**/api/status?token=*', (route) =>
    route.fulfill({
      json: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        status: 'paid',
        total: 10590,
        email: 'klient@example.com',
        shipping: 1690,
        shippingMethod: 'Dostawa standardowa',
        paymentMethod: 'p24',
        items: [{ name: 'E-book: 7 dni zdrowego jedzenia', quantity: 1, unitPrice: 8900 }],
      },
    }),
  );
  await page.goto(`/zamowienie/sukces?token=${token}`);

  await expect(page.getByRole('heading', { name: 'Dziękujemy za zakup!' })).toBeVisible();
  await expect(page.locator('#status-badge')).toHaveText('Płatność potwierdzona');
  await expect(page.locator('#status-id')).toContainText('123e4567-e89b-12d3-a456-426614174000');
  await expect(page.locator('#order-lines')).toContainText('E-book: 7 dni zdrowego jedzenia × 1');
  await expect(page.locator('#shipping-method')).toContainText('Dostawa standardowa');
  await expect(page.locator('#shipping-total')).toContainText('16,90');
  await expect(page.locator('#order-total')).toContainText('105,90');
  await expect(page.locator('#order-email')).toHaveText('klient@example.com');
  await expect(page.locator('#status-refresh')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem('tc-cart-v1'))).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('strona podziękowania wyjaśnia płatność za pobraniem', async ({ page }) => {
  const token = 'b'.repeat(64);
  await page.addInitScript(() => {
    localStorage.setItem('tc-cart-v1', JSON.stringify([{ id: 'demo-4', quantity: 1 }]));
  });
  await page.route('**/api/status?token=*', (route) =>
    route.fulfill({
      json: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        status: 'pending',
        total: 3190,
        email: 'klient@example.com',
        shipping: 1690,
        shippingMethod: 'Dostawa standardowa',
        paymentMethod: 'cod',
        items: [{ name: 'Szpatuła', quantity: 1, unitPrice: 1500 }],
      },
    }),
  );
  await page.goto(`/zamowienie/sukces?token=${token}`);

  await expect(page.getByRole('heading', { name: 'Zamówienie przyjęte.' })).toBeVisible();
  await expect(page.locator('#status-badge')).toHaveText('Płatność przy odbiorze');
  await expect(page.locator('#status-description')).toContainText(
    'Zapłacisz gotówką przy odbiorze przesyłki',
  );
  await expect(page.locator('#status-refresh')).toBeVisible();
  await expect(page.locator('#order-email')).toHaveText('klient@example.com');
  expect(await page.evaluate(() => localStorage.getItem('tc-cart-v1'))).toBeNull();
});
test('telefon jest w danych kontaktowych, a pola mają równe kolumny', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem(
      'tc-cart-v1',
      JSON.stringify([
        { id: 'demo-1', quantity: 1 },
        { id: 'demo-4', quantity: 1 },
      ]),
    );
  });
  await page.goto('/zamowienie');

  const phone = page.locator('[name="phone"]');
  await expect(phone).toBeVisible();
  await expect(phone).toHaveAttribute('required', '');
  await expect(
    page.locator('.checkout-section[aria-labelledby="contact-title"] [name="phone"]'),
  ).toBeVisible();
  const contactHeading = page.locator('#contact-title');
  const shippingHeading = page.locator('#shipping-fields legend');
  await expect(shippingHeading).toHaveText('Adres dostawy');
  const [contactFont, shippingFont] = await Promise.all([
    contactHeading.evaluate((element) => getComputedStyle(element).fontFamily),
    shippingHeading.evaluate((element) => getComputedStyle(element).fontFamily),
  ]);
  expect(shippingFont).toBe(contactFont);
  await expect(page.locator('.checkout-shipping .checkout-step-number')).toHaveCount(0);
  const contactFields = page.locator(
    '.checkout-section[aria-labelledby="contact-title"] .checkout-fields-grid > .field',
  );
  const widths = await contactFields.evaluateAll((fields) =>
    fields.map((field) => field.getBoundingClientRect().width),
  );
  expect(widths).toHaveLength(4);
  expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(2);
});
test('menu pokazuje koszyk i liczbę produktów', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tc-cart-v1', JSON.stringify([{ id: 'demo-1', quantity: 2 }]));
  });
  await page.goto('/');
  const logo = page.locator('.brand img');
  await expect(logo).toHaveAttribute('src', '/images/logo.png');
  await expect
    .poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  const cartLink = page.locator('#main-nav').getByRole('link', { name: /Koszyk/ });
  await expect(cartLink).toContainText('2');
  await cartLink.click();
  await expect(page).toHaveURL('/koszyk');
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
test('pole ilości w koszyku jest czytelne i wygodne do obsługi', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('tc-cart-v1', JSON.stringify([{ id: 'demo-4', quantity: 1 }]));
  });
  await page.goto('/koszyk');
  const row = page.locator('.cart-row').first();
  const quantity = row.getByRole('spinbutton');
  await expect(quantity).toBeVisible();
  await expect(quantity).toHaveAttribute('min', '1');
  const styles = await quantity.evaluate((input) => ({
    height: getComputedStyle(input).minHeight,
    textAlign: getComputedStyle(input).textAlign,
    controlDisplay: getComputedStyle(input.closest('.cart-quantity-control')!).display,
  }));
  expect(styles).toEqual({ height: '34px', textAlign: 'center', controlDisplay: 'flex' });

  await row.getByRole('button', { name: /^Zwiększ ilość:/ }).click();
  await expect(quantity).toHaveValue('2');
  await row.getByRole('button', { name: /^Zmniejsz ilość:/ }).click();
  await expect(quantity).toHaveValue('1');
  await expect(row.locator('.cart-quantity-label')).toHaveText('Ilość');

  await page.route('**/api/quote', (route) =>
    route.fulfill({
      json: {
        lines: [
          {
            _id: 'digital-test',
            name: 'Plan żywieniowy na 30 dni',
            slug: 'plan-zywieniowy-30-dni',
            image: '/images/plan.jpg',
            price: 6900,
            quantity: 1,
            productType: 'digital',
            stock: 1,
          },
        ],
        physical: false,
        digital: true,
        subtotal: 6900,
        shipping: 0,
        total: 6900,
        methods: [],
      },
    }),
  );
  await page.evaluate(() => {
    localStorage.setItem('tc-cart-v1', JSON.stringify([{ id: 'demo-1', quantity: 1 }]));
  });
  await page.reload();
  const digitalRow = page.locator('.cart-row').first();
  const increase = digitalRow.getByRole('button', { name: /^Zwiększ ilość:/ });
  await expect(increase).toBeDisabled();
  await expect(digitalRow.getByRole('spinbutton')).toHaveAttribute('max', '1');
  await expect(increase).toHaveCSS('opacity', '1');
  await expect(increase).toHaveCSS('color', 'rgb(116, 108, 101)');
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
