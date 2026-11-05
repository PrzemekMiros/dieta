# Wdrożenie i odbiór

## Środowisko

Node 24, PostgreSQL 17 (lub kompatybilny wspierany serwer), proces HTTP Astro SSR, osobny proces workera SMTP, cykliczny job uzgadniania płatności. Studio Sanity może działać niezależnie od sklepu. Nie jest panelem zamówień.

1. Ustaw zmienne z `.env.example` w managerze sekretów hostingu. `SITE_URL` to docelowy adres HTTPS bez końcowego ukośnika. `APP_ENV=production`, `DEMO_CATALOG=false`; na początku `SALES_ENABLED=false`.
2. `npm ci`, `npm run check`, `npm run lint`, `npm test`, `npm run build`.
3. Na kopii bazy wykonaj backup/restore oraz `npm run db:migrate`. Przed produkcyjną migracją wykonaj backup.
4. Uzupełnij Sanity: produkty, dokumenty prawne, dane firmy, kontakt, zdjęcia, pliki w prywatnym storage, stawki podatku zatwierdzone przez właściciela. Nie aktywuj rekordów `demo-*`.
5. `npm run db:seed` inicjuje brakujące rekordy magazynu; nie nadpisuje stanów. Kolejne zmiany wykonuj przez `/admin/magazyn`.
6. Utwórz konto `npm run admin:create` z tymczasowymi `ADMIN_EMAIL` i `ADMIN_PASSWORD` (min. 14 znaków). Usuń hasło z otoczenia po utworzeniu konta. Skrypt nie ma domyślnego hasła i nie nadpisuje istniejącego konta.
7. Uruchom `npm start` (HTTP; ustaw `HOST` i `PORT` zgodnie z hostingiem). Reverse proxy zapewnia HTTPS. Nie udostępniaj BrowserSync ani Studio dev server publicznie.
8. Uruchom stale `npm run worker:start`. `npm run payments:reconcile:start` wykonuj co 5 minut przez scheduler. Te joby są bundlowane w `dist/jobs`; po buildzie można użyć `npm prune --omit=dev` na instancji runtime. Migracje i tworzenie admina wykonuj w osobnym środowisku administracyjnym z narzędziami developerskimi.
9. Konfiguruj zaufane nagłówki proxy/IP na poziomie hostingu. Nie akceptuj dowolnego X-Forwarded-For od klienta. Dodaj limit żądań przed procesem Node i monitorowanie błędów/obciążenia.

## Sanity

`SANITY_PROJECT_ID`, `SANITY_DATASET`, opcjonalny serwerowy token odczytu. Studio: `npm run studio` lub `npm run studio:build`; projekt musi istnieć w Sanity, a redaktor musi być do niego zaproszony. Dodaj do CORS wyłącznie adresy własnego Studio. Token zapisu potrzebny jedynie do jawnego seeda datasetu development; nie wystawiaj go frontendowi. Dane prawne są dokumentami `page` o slugach `regulamin`, `polityka-prywatnosci`, `dostawa-i-zwroty`.

## Przelewy24

Implementacja odpowiada dokumentacji [P24 REST](https://developers.przelewy24.pl/) i [specyfikacji OpenAPI](https://developers.przelewy24.pl/yaml/en_documentation_1.0.yaml). Konto sprzedawcy i rzeczywisty test sandboxu nie zostały skonfigurowane w tej sesji.

- Rejestracja: POST `transaction/register`, podpis SHA-384.
- Callback: publiczne HTTPS `/api/p24/notify`, podpis, merchant/pos/session/order/amount/originAmount/currency, następnie PUT `transaction/verify`.
- Powrót: `/zamowienie/sukces?token=...` tylko odczytuje status; nie potwierdza płatności.
- P24 powiadamia o opłaconych transakcjach, nie o każdej anulowanej próbie. Po przerwaniu płatności zamówienie pozostaje `pending`. Operator sprawdza P24 przed anulowaniem i zwolnieniem rezerwacji.
- `registration_unknown`: timeout lub błąd rejestracji. Nie rejestruj automatycznie kolejnej transakcji; sprawdź ją po sessionId. Job uzgadniania odczytuje autorytatywny status i weryfikuje płatność wstępną.
- `payment_review`: płatność wpłynęła po anulowaniu. Towar nie jest wydawany automatycznie. Operator uzgadnia realizację lub zwrot z klientem i w panelu P24. Automatyczne zwroty P24 nie są częścią tej implementacji.
- Włącz produkcję dopiero po odbiorze: `P24_ENV=production`, `P24_PRODUCTION_APPROVED=true` (jawna zgoda właściciela), `SALES_ENABLED=true`.

## Pliki i wiadomości

Bucket S3 musi być prywatny, z blokadą publicznego dostępu. `digitalAssetReference` to klucz obiektu, nigdy publiczny URL. Sklep wydaje link 72-godzinny z losowym tokenem, którego hash jest w bazie. Po weryfikacji uprawnienia generuje URL S3 ważny 60 sekund. Link daje dostęp do pliku, nie jest DRM i nie uniemożliwia kopiowania pobranego PDF.

Outbox jest zapisany w tej samej transakcji co zmiana statusu. Worker pobiera rekord z `FOR UPDATE SKIP LOCKED`, próbuje maksymalnie 12 razy z wykładniczym backoff. Po 12 błędach panel pokazuje liczbę wiadomości wymagających interwencji. Dostarczanie jest at-least-once: awaria po przyjęciu SMTP, a przed commitem, może spowodować powtórkę wiadomości. Ponowne wygenerowanie ebooków unieważnia stare tokeny. Wysyłaj nowe linki zamiast starego potwierdzenia zawierającego wygasły link.

Ustaw prawdziwy SMTP i zweryfikowaną domenę nadawcy. Dopiero po publikacji polityki prywatności skonfiguruj `NEWSLETTER_ENABLED=true`. Zapis wymaga double opt-in, link rezygnacji jest w mailu potwierdzającym. Wysyłka kampanii newslettera nie jest zaimplementowana — baza zbiera zgody/subskrypcje, a nie wysyła marketingowych kampanii.

## Odbiór przed przyjmowaniem pieniędzy

- Rzeczywisty sandbox: ebook, produkt fizyczny, koszyk mieszany, przerwanie płatności, ponowiony callback, timeout i ponowne uzgodnienie.
- Natywny PostgreSQL: równoczesne zakupy ostatniej sztuki, restart procesu podczas transakcji, restore backupu. PGlite sprawdza SQL i transakcje lokalnie, ale nie zastępuje testu wielu połączeń na serwerze docelowym.
- SMTP: faktyczne dostarczenie, spam, awaria i retry, wielokrotne ebooki, ponowne linki.
- S3: prywatność bucketu, wygasanie URL, nieaktywny token, zablokowane uprawnienie.
- Konto admina: hasło, wygasanie sesji, CSRF, rate limiting, historia działań i uprawnienia redaktorów Sanity.
- Uzupełnienie i zatwierdzenie dokumentów prawnych, danych firmy, kosztów dostaw, terminów realizacji, podatków i rzeczywistych materiałów produktowych.
- Pomiary Lighthouse/Core Web Vitals na docelowym hostingu oraz przegląd dostępności czytnikiem ekranu. Nie deklarowano wyniku CWV ani pełnej zgodności WCAG bez tych pomiarów.

## Utrzymanie

Monitoruj `payment_review`, `registration_unknown`, `reconcile_failed`, zaległy outbox i długie rezerwacje. Nie zwalniaj ich bez uzgodnienia z bramką. Ustal okresy retencji danych klientów, audytu, sesji, wygasłych tokenów i maili; czyść stare sesje/limity według polityki firmy. Backup bazy i plików powinien być testowany przez odtworzenie.

`package.json` zawiera overrides poprawek bezpieczeństwa dla zależności narzędzi (`js-yaml`, `smol-toml`, `undici`, `minimatch`, `esbuild`). Przy aktualizacji sprawdzaj kompatybilność przez lint, testy, build sklepu i build Studio. Nie uruchamiaj bezrefleksyjnie `npm audit fix --force`.
