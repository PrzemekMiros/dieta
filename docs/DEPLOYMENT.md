# Wdrożenie i odbiór

## Aktualne wdrożenie: Sanity + Netlify

Sklep korzysta domyślnie z `SHOP_STORAGE=sanity`. **PostgreSQL nie jest wymagany
do zamówień.** Wykonaj [instrukcję konfiguracji zamówień w Sanity](SANITY-ORDERS.md).
Obejmuje prywatny zbiór, szyfrowanie danych klienta, magazyn w Studio oraz
funkcję `shop-outbox` uruchamianą co minutę na Netlify. `/admin` przekierowuje
do Sanity; nie twórz drugiego konta administratora.

Tpay pozostaje osobnym, nieukończonym etapem — patrz [gotowość Tpay](tpay-readiness.md).

Poniższe instrukcje PostgreSQL, migracji, seeda, kont `/admin` i workera SQL
dotyczą wyłącznie starszego adaptera `SHOP_STORAGE=postgres`. Nie stosuj ich
do obecnego wdrożenia Sanity.

## Środowisko

Node 24, PostgreSQL 17 (lub kompatybilny wspierany serwer), proces HTTP Astro SSR, osobny proces workera SMTP, uzgadnianie płatności online do wdrożenia wraz z Tpay. Studio Sanity ma zakładkę „Zamówienia”, która łączy się z API sklepu i wymaga działającego serwera sklepu oraz PostgreSQL.

### Netlify

Repozytorium ma `netlify.toml` z build command `npm run build`, publish directory `dist`, Node 24 i npm 11. Gdy Netlify uruchamia build (`NETLIFY` ustawione przez platformę), Astro używa `@astrojs/netlify`; build poza Netlify zachowuje adapter standalone Node. Adapter sam generuje wewnętrzną funkcję SSR — nie ustawiaj własnego `netlify/functions` jako katalogu funkcji, chyba że dodasz tam własne funkcje.

W Site configuration → Environment variables ustaw produkcyjne wartości wymagane przez `.env.example`, w szczególności `APP_ENV=production`, `DEMO_CATALOG=false`, `SITE_URL`, `DATABASE_URL`, `SANITY_PROJECT_ID` i `SANITY_DATASET`. Dodaj `SANITY_READ_TOKEN`, jeśli dataset wymaga uwierzytelnionego odczytu. Zmienne sprzedażowe ustawiaj dopiero po wdrożeniu i odbiorze Tpay oraz skonfigurowaniu S3, SMTP i dokumentów prawnych. Nie ustawiaj sekretów jako zmiennych `PUBLIC_*`.

Dla magazynu Sanity Netlify uruchamia funkcję `shop-outbox` co minutę. Starszy adapter PostgreSQL wymaga osobnego procesu `worker:start`. Dawny job uzgadniania płatności usunięto; harmonogram uzgadniania Tpay będzie częścią przyszłej integracji. Sam udany deploy nie oznacza gotowości sklepu do przyjmowania płatności online.

W konfiguracji witryny wybierz Node 24; `netlify.toml` i `.nvmrc` ustawiają tę wersję również dla buildów. Nie ustawiaj osobnego katalogu funkcji. Widoczność logów deployów ustaw jako prywatną.

1. Ustaw zmienne z `.env.example` w managerze sekretów hostingu. `SITE_URL` to docelowy adres HTTPS bez końcowego ukośnika. Ustaw `APP_ENV=production`, `DEMO_CATALOG=false`. `COD_ENABLED=true` udostępnia wyłącznie pobranie dla zamówień z produktami fizycznymi i działa niezależnie od `SALES_ENABLED`; płatności online pozostają zablokowane do czasu wdrożenia Tpay. Dotyczy to również e-booków i koszyków mieszanych.
2. `npm ci`, `npm run check`, `npm run lint`, `npm test`, `npm run build`.
3. Na kopii bazy wykonaj backup/restore oraz `npm run db:migrate`. Przed produkcyjną migracją wykonaj backup.
4. Uzupełnij Sanity: produkty, dokumenty prawne, dane firmy, kontakt, zdjęcia, pliki w prywatnym storage, stawki podatku zatwierdzone przez właściciela. Nie aktywuj rekordów `demo-*`.
5. `npm run db:seed` inicjuje brakujące rekordy magazynu; nie nadpisuje stanów. Kolejne zmiany wykonuj przez `/admin/magazyn`.
6. Utwórz konto `npm run admin:create` z tymczasowymi `ADMIN_EMAIL` i `ADMIN_PASSWORD` (min. 14 znaków). Usuń hasło z otoczenia po utworzeniu konta. Skrypt nie ma domyślnego hasła i nie nadpisuje istniejącego konta.
7. Uruchom `npm start` (HTTP; ustaw `HOST` i `PORT` zgodnie z hostingiem). Reverse proxy zapewnia HTTPS. Nie udostępniaj BrowserSync ani Studio dev server publicznie.
8. Uruchom stale `npm run worker:start`. Worker jest bundlowany w `dist/jobs`; po buildzie można użyć `npm prune --omit=dev` na instancji runtime. Migracje i tworzenie admina wykonuj w osobnym środowisku administracyjnym z narzędziami developerskimi.
9. Konfiguruj zaufane nagłówki proxy/IP na poziomie hostingu. Nie akceptuj dowolnego X-Forwarded-For od klienta. Dodaj limit żądań przed procesem Node i monitorowanie błędów/obciążenia.

## Rezerwacje konsultacji i Google Calendar

Rezerwacje nie wymagają bazy danych: dostępność jest odczytywana z Google Calendar API, a potwierdzone terminy zapisywane bezpośrednio jako wydarzenia w kalendarzu. W Google Cloud włącz Google Calendar API, utwórz konto usługi i udostępnij mu docelowy kalendarz z uprawnieniami do wprowadzania zmian. Wprowadź adres `client_email`, klucz prywatny oraz samo ID kalendarza (nie jego URL) do managera sekretów hostingu. Klucz przechowuj wyłącznie po stronie serwera; w `.env` można zapisać go z sekwencjami `\n`, które aplikacja zamieni na nowe linie.

Domyślnie konsultacje odbywają się od poniedziałku do piątku, w godzinach 09:00–17:00, trwają 60 minut, wymagają 24-godzinnego wyprzedzenia i są dostępne przez 60 dni. Godziny, czas trwania, strefę, wyprzedzenie, horyzont i dni pracy można zmienić zmiennymi `BOOKING_*` z `.env.example`. Dostępność jest sprawdzana w Google przed pokazaniem godzin i ponownie przed zapisem. Limity żądań rezerwacji są przechowywane w pamięci procesu, więc na hostingu wieloinstancyjnym skonfiguruj dodatkowy limit na warstwie platformy. Google Calendar nie oferuje transakcyjnej blokady względem równoczesnych zmian poza aplikacją; kolizja identycznego slotu jest dodatkowo ograniczana przez deterministyczne ID wydarzenia. Rezerwacja od razu tworzy wydarzenie Google; formularz pokazuje potwierdzenie na stronie, ale nie wysyła zaproszenia ani e-maila.

Wydarzenie Google zawiera imię i adres e-mail podane w formularzu. Uwzględnij przekazanie tych danych do Google Calendar w opublikowanej polityce prywatności. Nie udostępniaj klucza usługi ani zmiennych bezpośrednio przeglądarce.

## Sanity

### Zamówienia w Studio

1. Wdróż serwer sklepu z endpointami `/api/studio/*`. W jego środowisku ustaw `SANITY_STUDIO_ORIGINS=https://dietetyka-dla-smyka.sanity.studio`. Dodatkowe zaufane adresy podawaj po przecinku, bez końcowego ukośnika. Lokalny `http://localhost:3333` jest dozwolony wyłącznie poza `APP_ENV=production`.
2. W `studio/.env` ustaw `SANITY_STUDIO_SHOP_URL=https://dietetykadlasmyka.pl` (lokalnie `http://localhost:4321`). Jest to publiczna konfiguracja, nie token. Zmienna musi być dostępna podczas builda Studio. Wzór: `studio/.env.example`. Na serwerze sklepu ustaw również `SITE_URL=https://dietetykadlasmyka.pl`.
3. Wykonaj `npm run studio:deploy`. Zaloguj się do Sanity jako administrator projektu `fip0o8g2` i otwórz zakładkę „Zamówienia”. Panel korzysta automatycznie z sesji Sanity, bez osobnego konta lub hasła do sklepu. API sprawdza token i rolę administratora po stronie Sanity przy każdym żądaniu. Redaktorzy i tokeny robotów nie mają dostępu do zamówień.
4. Sprawdź listę, filtr i szczegóły zamówienia. Na zamówieniu testowym sprawdź aktualizację przesyłki oraz dostarczenie powiadomienia przez worker SMTP.

Panel pokazuje zamówienia bezpośrednio z PostgreSQL; nie kopiuje danych klientów do datasetu Sanity. Korzysta z tych samych operacji realizacji co `/admin`. Studio używa `auth.loginMethod: 'token'`; panel przekazuje aktualny token sesji Sanity wyłącznie do skonfigurowanego API sklepu, które weryfikuje go w Sanity. Nie tworzy dodatkowej sesji ani konta administratora w bazie sklepu. Historia działań zapisuje identyfikator Sanity w `audit_logs.data.sanityUserId`, z pustym `adminId`. Wylogowanie odbywa się przez menu konta Sanity. Brak adresu sklepu wyświetla ekran konfiguracji. API zwraca wyłącznie potrzebne dane zamówienia, bez tokenów płatniczych, hashy dostępu i kluczy prywatnych plików. Osobny panel `/admin` zachowuje dotychczasowe logowanie i jest opcjonalny przy pracy przez Studio.

`SANITY_PROJECT_ID`, `SANITY_DATASET`, opcjonalny serwerowy token odczytu. Studio: `npm run studio` lub `npm run studio:build`; projekt musi istnieć w Sanity, a redaktor musi być do niego zaproszony. Dodaj do CORS wyłącznie adresy własnego Studio. Token zapisu potrzebny jedynie do jawnego seeda datasetu development; nie wystawiaj go frontendowi. Dane prawne są dokumentami `page` o slugach `regulamin`, `polityka-prywatnosci`, `dostawa-i-zwroty`.

## Płatności online — Tpay

Poprzednia integracja została usunięta. Tpay nie jest jeszcze zaimplementowany, więc płatności online są wyłączone niezależnie od `SALES_ENABLED` i `PAYMENT_PROVIDER`. Nie ma aktywnego endpointu powiadomień ani zadania uzgadniania płatności online. Szczegóły kolejnego etapu: [gotowość Tpay](tpay-readiness.md).

Pobranie jest niezależne od płatności online i wymaga `COD_ENABLED=true`, rzeczywistego katalogu, działającego magazynu zamówień oraz SMTP. Dotyczy wyłącznie produktów fizycznych. Administrator potwierdza odbiór gotówki w panelu.

Historyczne dane płatności pozostają zachowane. Jeśli istnieją nierozliczone transakcje poprzedniego operatora, sprawdź je ręcznie przed anulowaniem zamówień. Usuń nieużywane sekrety poprzedniej bramki i jej harmonogramy z hostingu.

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

Monitoruj zaległy outbox i długie rezerwacje. Historyczne statusy `payment_review` i `registration_unknown` wymagają ręcznego sprawdzenia. Nie zwalniaj ich bez uzgodnienia z bramką. Ustal okresy retencji danych klientów, audytu, sesji, wygasłych tokenów i maili; czyść stare sesje/limity według polityki firmy. Backup bazy i plików powinien być testowany przez odtworzenie.

`package.json` zawiera overrides poprawek bezpieczeństwa dla zależności narzędzi (`js-yaml`, `smol-toml`, `undici`, `minimatch`, `esbuild`). Przy aktualizacji sprawdzaj kompatybilność przez lint, testy, build sklepu i build Studio. Nie uruchamiaj bezrefleksyjnie `npm audit fix --force`.
