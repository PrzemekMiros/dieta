import { money } from '../lib/types';
type Item = { id: string; quantity: number };
type Quote = {
  lines: {
    _id: string;
    name: string;
    slug: string;
    image: string;
    price: number;
    quantity: number;
    productType: string;
    stock: number;
  }[];
  physical: boolean;
  digital: boolean;
  subtotal: number;
  shipping: number;
  total: number;
  methods: { id: string; name: string; price: number }[];
  shippingMethod?: string;
  codAvailable: boolean;
};
const key = 'tc-cart-v1';
export function readCart(): Item[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(raw)
      ? raw
          .filter(
            (i) =>
              typeof i.id === 'string' &&
              Number.isInteger(i.quantity) &&
              i.quantity > 0 &&
              i.quantity <= 20,
          )
          .slice(0, 30)
      : [];
  } catch {
    return [];
  }
}
function writeCart(items: Item[]) {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    toast('Przeglądarka blokuje zapis koszyka.');
  }
  updateCount();
}
function updateCount() {
  const count = readCart().reduce((s, i) => s + i.quantity, 0);
  document.querySelectorAll('[data-cart-count]').forEach((el) => (el.textContent = String(count)));
}
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const element = document.querySelector<HTMLElement>('#cart-toast');
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (element.hidden = true), 4000);
}
export async function quote(items = readCart(), shippingMethod?: string): Promise<Quote> {
  const response = await fetch('/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, shippingMethod }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
document.querySelectorAll<HTMLButtonElement>('[data-add]').forEach((button) =>
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const items = readCart();
      const existing = items.find((i) => i.id === button.dataset.add);
      if (existing) existing.quantity++;
      else items.push({ id: button.dataset.add!, quantity: 1 });
      const result = await quote(items);
      if (result.lines.some((i) => i.productType === 'physical' && i.quantity > i.stock))
        throw new Error('Nie ma tylu sztuk w magazynie.');
      writeCart(items);
      toast('Dodano do koszyka.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Nie udało się dodać produktu.');
    } finally {
      button.disabled = false;
    }
  }),
);
function element(tag: string, text?: string, className?: string) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}
export async function renderCart() {
  const root = document.querySelector<HTMLElement>('[data-cart-lines]');
  if (!root) return;
  const items = readCart();
  const total = document.querySelector<HTMLElement>('[data-cart-summary]');
  const itemCount = document.querySelector<HTMLElement>('[data-cart-items]');
  if (itemCount) itemCount.textContent = '';
  root.replaceChildren();
  if (!items.length) {
    root.classList.add('cart-empty');
    root.setAttribute('aria-busy', 'false');
    root.append(
      element('p', 'TWÓJ KOSZYK', 'eyebrow'),
      element('h2', 'Koszyk czeka na coś dobrego.'),
      element(
        'p',
        'Wybierz produkty, które Cię interesują. Dodane pozycje będą tutaj czekać na Ciebie.',
      ),
    );
    const browse = element('a', 'Zobacz produkty', 'btn') as HTMLAnchorElement;
    browse.href = '/sklep';
    root.append(browse);
    if (total) total.hidden = true;
    return;
  }
  root.classList.remove('cart-empty');
  root.setAttribute('aria-busy', 'true');
  try {
    const q = await quote();
    if (total) total.hidden = false;
    if (itemCount) {
      const count = q.lines.reduce((sum, item) => sum + item.quantity, 0);
      itemCount.textContent = `${count} ${count === 1 ? 'produkt' : count < 5 ? 'produkty' : 'produktów'}`;
    }
    for (const item of q.lines) {
      const row = element('div', undefined, 'cart-row');
      const image = element('img') as HTMLImageElement;
      image.src = item.image;
      image.alt = '';
      image.width = 90;
      image.height = 100;
      const details = element('div');
      const link = element('a', item.name);
      link.setAttribute('href', `/produkt/${item.slug}`);
      details.append(
        link,
        element('p', `${money(item.price)} / szt.`, 'muted text-sm'),
        element('p', money(item.price * item.quantity), 'cart-line-total'),
      );
      const quantityControl = element('div', undefined, 'cart-quantity-control');
      quantityControl.append(element('span', 'Ilość', 'cart-quantity-label'));
      const stepper = element('div', undefined, 'cart-quantity-stepper');
      const decrease = element('button', undefined, 'cart-quantity-button') as HTMLButtonElement;
      decrease.type = 'button';
      decrease.disabled = item.quantity <= 1;
      decrease.setAttribute('aria-label', `Zmniejsz ilość: ${item.name}`);
      decrease.append(element('span', '−'));
      const input = element('input') as HTMLInputElement;
      input.className = 'cart-quantity-input';
      input.type = 'number';
      input.min = '1';
      input.max = String(item.productType === 'digital' ? 1 : Math.min(item.stock, 20));
      input.value = String(item.quantity);
      input.setAttribute('aria-label', `Ilość: ${item.name}`);
      const increase = element('button', undefined, 'cart-quantity-button') as HTMLButtonElement;
      increase.type = 'button';
      increase.disabled = item.quantity >= Number(input.max);
      increase.setAttribute('aria-label', `Zwiększ ilość: ${item.name}`);
      increase.append(element('span', '+'));
      input.addEventListener('change', async () => {
        const quantity = Number(input.value);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > Number(input.max)) {
          input.value = String(item.quantity);
          return;
        }
        writeCart(readCart().map((i) => (i.id === item._id ? { ...i, quantity } : i)));
        await renderCart();
      });
      decrease.addEventListener('click', () => {
        input.value = String(item.quantity - 1);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      increase.addEventListener('click', () => {
        input.value = String(item.quantity + 1);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      stepper.append(decrease, input, increase);
      quantityControl.append(stepper);
      const remove = element('button', 'Usuń', 'text-link') as HTMLButtonElement;
      remove.type = 'button';
      remove.setAttribute('aria-label', `Usuń ${item.name}`);
      remove.addEventListener('click', () => {
        writeCart(readCart().filter((i) => i.id !== item._id));
        void renderCart();
      });
      row.append(image, details, quantityControl, remove);
      root.append(row);
    }
    document.querySelector('[data-subtotal]')!.textContent = money(q.subtotal);
    document.querySelector('[data-shipping]')!.textContent = q.physical
      ? `od ${money(q.shipping)}`
      : 'Bezpłatnie';
    document.querySelector('[data-total]')!.textContent = money(q.total);
    root.setAttribute('aria-busy', 'false');
  } catch (e) {
    root.append(
      element('p', e instanceof Error ? e.message : 'Nie udało się odczytać koszyka.', 'error'),
    );
    const clear = element('button', 'Wyczyść nieaktualny koszyk', 'btn btn-outline mt-6');
    clear.addEventListener('click', () => {
      writeCart([]);
      void renderCart();
    });
    root.append(clear);
    if (total) total.hidden = true;
    root.setAttribute('aria-busy', 'false');
  }
}
updateCount();
void renderCart();
window.addEventListener('storage', () => {
  updateCount();
  void renderCart();
});
