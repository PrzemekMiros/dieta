# Zamówienia w Sanity — bez PostgreSQL

Domyślny magazyn zamówień to `SHOP_STORAGE=sanity`. Osobny zbiór `orders`
w projekcie `fip0o8g2` został utworzony jako **private**. Nie dodajemy go do
publicznego katalogu `production` ani do edytora dokumentów Studio.

Panel „Zamówienia” nadal korzysta z logowania Sanity. API wymaga roli
administratora i zwraca tylko numer, produkty, kwoty, statusy i numer przesyłki.
Nie zwraca adresu, telefonu, e-maila, danych faktury, tokenów ani kluczy plików.
Dane klienta i treść kolejki e-maili są dodatkowo szyfrowane AES-256-GCM;
klucz pozostaje na serwerze. Prywatność zbioru jest sprawdzana przed dostępem.
Administrator projektu ma dostęp do prywatnego zbioru, ale bez klucza serwera
nie odczyta zaszyfrowanych danych klienta.

## Konfiguracja Netlify

Pobranie jest domyślnie włączone dla koszyków zawierających wyłącznie produkty
fizyczne, niezależnie od integracji Tpay i `SALES_ENABLED`. W produkcyjnym
zakresie **Functions** ustaw `COD_ENABLED=true`; jawne `COD_ENABLED=false`
wyłącza pobranie. Po zmianie zmiennych uruchom ponowny deploy. Ebooki i koszyki
mieszane nadal wymagają działającej płatności online.

1. W [ustawieniach projektu Sanity](https://www.sanity.io/manage/project/fip0o8g2)
   otwórz **API → Tokens** i utwórz dedykowany token serwera z prawami odczytu
   i zapisu zbioru `orders` oraz odczytu jego widoczności. Standardowa rola
   Editor pozwala na zapis; jeżeli plan udostępnia role niestandardowe,
   ogranicz token do tego zbioru. Nie używaj osobistego tokenu logowania Studio.
2. Wygeneruj klucz lokalnie:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. W **Netlify → Environment variables** ustaw dla środowiska produkcyjnego
   i zakresu **Functions**:

   | Zmienna | Wartość |
   | --- | --- |
   | `SHOP_STORAGE` | `sanity` |
   | `SANITY_PROJECT_ID` | `fip0o8g2` |
   | `SANITY_ORDERS_DATASET` | `orders` |
   | `SANITY_ORDERS_TOKEN` | dedykowany token serwera |
   | `SANITY_ORDERS_ENCRYPTION_KEY` | wygenerowane 64 znaki hex |

   Zapisz token i klucz jako sekrety. Nie dodawaj prefiksu `PUBLIC_` ani
   `SANITY_STUDIO_`. Nie wklejaj ich do czatu ani do repozytorium.
   Zachowaj klucz w menedżerze haseł: jego utrata uniemożliwi odczyt klientów
   i kolejki e-maili. Nie zmieniaj klucza bez migracji szyfrowanych dokumentów.
4. Ustaw działające `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
   `SMTP_PASSWORD`, `SMTP_FROM` oraz `SITE_URL=https://dietetykadlasmyka.pl`.
5. Uruchom ponowny deploy Netlify. W Functions sprawdź funkcję `shop-outbox`:
   pracuje co minutę, wysyła do pięciu wiadomości na przebieg, z ograniczeniem
   czasu i ponawianiem błędów. SMTP ma semantykę co najmniej jednej dostawy;
   awaria po wysłaniu może spowodować duplikat o tym samym Message-ID.
6. W Sanity → Zamówienia → Magazyn ustaw dostępne sztuki produktów fizycznych.
   Początkowy stan to zero. Pole katalogowe `stock` nie jest stanem rezerwacji.

Nie trzeba tworzyć bazy Netlify ani ustawiać `DATABASE_URL` dla zamówień,
magazynu, płatności, e-maili sklepu i linków do produktów cyfrowych. Starszy
adapter PostgreSQL pozostaje wyłącznie dla zgodności; osobny, dawny newsletter
nie został przeniesiony i powinien pozostać wyłączony (`NEWSLETTER_ENABLED=false`).

## Płatności i pliki

Ta zmiana przenosi trwały zapis sklepu, ale **nie implementuje Tpay**.
Przy `PAYMENT_PROVIDER=tpay` płatność online pozostaje wyłączona do czasu
ukończenia adaptera i testów podpisanych powiadomień. Nie przełączaj na P24,
jeśli masz konto Tpay. Pobranie jest osobną opcją dla produktów fizycznych.
E-booki nadal wymagają prywatnego magazynu S3; nie przechowujemy plików do
sprzedaży jako publicznych załączników Sanity.

Zamówienie, rezerwacja stanu i zaszyfrowana wiadomość są zapisywane jedną
transakcją. Warunki `_rev` chronią przed utratą aktualizacji, a unikatowe
identyfikatory dokumentów operacyjnych przed ponowieniem zamówienia.
Anulowanie zwalnia stan tylko raz. Płatność do anulowanego zamówienia trafia
do sprawdzenia, bez wydawania produktów cyfrowych.

Dokumentacja: [transakcje Sanity](https://www.sanity.io/docs/content-lake/transactions),
[prywatność zbiorów](https://www.sanity.io/docs/content-lake/keeping-your-data-safe),
[harmonogram funkcji Netlify](https://docs.netlify.com/build/functions/scheduled-functions/).
