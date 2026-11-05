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
  root.replaceChildren();
  if (!items.length) {
    root.append(element('p', 'Twój koszyk czeka na coś dobrego.'));
    if (total) total.hidden = true;
    return;
  }
  try {
    const q = await quote();
    if (total) total.hidden = false;
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
      details.append(link, element('p', money(item.price), 'muted text-sm'));
      const label = element('label', 'Ilość', 'text-xs');
      const input = element('input') as HTMLInputElement;
      input.type = 'number';
      input.min = '1';
      input.max = String(item.productType === 'digital' ? 1 : Math.min(item.stock, 20));
      input.value = String(item.quantity);
      input.setAttribute('aria-label', `Ilość: ${item.name}`);
      input.addEventListener('change', async () => {
        const quantity = Number(input.value);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > Number(input.max)) {
          input.value = String(item.quantity);
          return;
        }
        writeCart(readCart().map((i) => (i.id === item._id ? { ...i, quantity } : i)));
        await renderCart();
      });
      label.append(input);
      const remove = element('button', 'Usuń', 'text-link') as HTMLButtonElement;
      remove.type = 'button';
      remove.setAttribute('aria-label', `Usuń ${item.name}`);
      remove.addEventListener('click', () => {
        writeCart(readCart().filter((i) => i.id !== item._id));
        void renderCart();
      });
      row.append(image, details, label, remove);
      root.append(row);
    }
    document.querySelector('[data-subtotal]')!.textContent = money(q.subtotal);
    document.querySelector('[data-shipping]')!.textContent = q.physical
      ? `od ${money(q.shipping)}`
      : 'Bezpłatnie';
    document.querySelector('[data-total]')!.textContent = money(q.total);
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
  }
}
updateCount();
void renderCart();
window.addEventListener('storage', () => {
  updateCount();
  void renderCart();
});
