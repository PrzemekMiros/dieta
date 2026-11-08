# Tortowe Ciocho — architektura i plan

## Analiza referencji

Źródła: https://dietetykmaria.pl/ oraz screenshot dostarczony 5 listopada 2026. Kopiujemy rytm i kompozycję, nie treści, logo ani fotografie.

Na desktopie: treść około 1200–1280 px, szerokie marginesy, niska nawigacja, hero w dwóch kolumnach, fotografia z łukiem i wysuniętą kartą. Duże szeryfowe nagłówki zestawione z małym sans-serifem. Akcent w zgaszonym różu, krem, ciepły beż, grafit. Kolejne sekcje: pasek, filozofia 1:1, beżowe „o nas” z nakładającymi się fotografiami, trzy karty (ostatnia ciemna), grafitowe cztery kroki, katalog, opinie, FAQ, newsletter, wielokolumnowa stopka. Długich pustych fragmentów screenshota nie traktujemy jako projektu: najprawdopodobniej są skutkiem animacji, które nie ujawniły treści podczas przechwytywania.

Tokeny: tło #F7F6F4, beż #E5DED7, grafit #2D2F30, akcent #B66E67 (ciemniejszy dla tekstu i przycisków z białym napisem); Cormorant Garamond + DM Sans hostowane lokalnie. Kontener 1240 px, odstępy sekcji clamp(64px, 8vw, 128px), karty 12px, przyciski pill, animacje 0.6–0.9 s. Mobile: jedna kolumna, menu rozwijane, fotografia pod tekstem, brak ukrywania treści bez JS.

## Mapa strony

Publiczne: `/`, `/sklep`, `/ebooki`, `/produkty`, `/produkt/[slug]`, `/koszyk`, `/zamowienie`, `/zamowienie/sukces`, `/pobierz/[token]`, `/o-nas`, `/kontakt`, `/blog`, `/blog/[slug]`, `/regulamin`, `/polityka-prywatnosci`, `/dostawa-i-zwroty`.

Operacyjne: `/admin/login`, `/admin`, `/admin/zamowienia/[id]`. Studio jako osobna aplikacja `sanity dev` na 3333.

API: katalog/wycena, checkout, callback P24, odczyt statusu za tokenem, pobieranie, newsletter, logowanie/wylogowanie, operacje administracyjne. Żadne dane zamówień nie są publiczne ani pobierane wyłącznie po UUID.

## Podział odpowiedzialności

Astro SSR + adapter Node: HTML, API i panel. Natywne komponenty Astro i małe skrypty TypeScript, bez Reacta w sklepie. Sanity Studio używa Reacta. Sanity dostarcza katalog i treść; produkcyjny checkout odczytuje świeże dane bez CDN. PostgreSQL jest źródłem prawdy o zamówieniach i dostępnych stanach. Stany początkowe w CMS służą wyłącznie inicjalizacji magazynu; dalsze korekty przez panel i rejestr ruchów.

Drizzle: transakcje, blokady rekordów magazynu, unikalne klucze idempotencji i identyfikatory P24. Rezerwacja pomniejsza dostępny stan jeden raz. Anulowanie zwalnia rezerwację; późne powiadomienie P24 wymaga ponownej rezerwacji lub trafia do ręcznej obsługi (bez wydania towaru). Brak automatycznego zwalniania niezweryfikowanych płatności przez sam powrót przeglądarki.

P24: SHA-384 z JSON w kolejności pól określonej dokumentacją, uwierzytelnienie Basic, weryfikacja podpisu callbacku i parametrów, następnie transaction/verify. Powtórzenia nie wydają ponownie ebooków ani magazynu. Rejestracja niepewna po timeout nie jest automatycznie powtarzana jako nowa transakcja.

Ebooki: prywatny bucket S3-compatible. Losowy token 256-bit, w bazie hash, ważność ograniczona; krótko ważny podpisany URL generowany dopiero po sprawdzeniu uprawnienia. W bazie outbox przechowuje treść e-maila i ponawia wysyłkę z backoff. SMTP może dostarczyć duplikat po awarii między wysyłką i zapisem — gwarancja at-least-once, nie exactly-once.

Admin: scrypt, losowe sesje przechowywane jako hash, HttpOnly/SameSite/secure cookie, weryfikacja Origin dla mutacji, limity w PostgreSQL, kontrola uprawnień na serwerze i audit log. Brak domyślnego hasła. Konto tworzy skrypt CLI.

## Komponenty

Layout → Header, Footer, skrypty GSAP i koszyka. Homepage → Hero, Philosophy, About, Categories, Steps, ProductGrid, Testimonials, FAQ, Newsletter (sekcje sterowane CMS). Catalog → ProductCard. Checkout i Cart korzystają z jednego modułu wyceny serwerowej. AdminLayout korzysta z tego samego design systemu.

## Schemat danych

customers 1:N orders 1:N order_items. orders 1:1 payments, 1:N payment_events, 1:1 shipments. order_items 1:1 digital_entitlements 1:N download_tokens. inventory 1:N inventory_movements. admin_users 1:N admin_sessions i audit_logs. Dodatkowo email_outbox, rate_limits, newsletter_subscribers. Kwoty integer w groszach; snapshot SKU, nazwy, ceny, stawki podatku i klucza pliku w order_items. Zamówienie zachowuje zgody, dane dostawy i faktury.

## Kolejność i kryteria

1. Frontend i responsywność 375/768/1024/1440/1920.
2. Sanity: schematy, Studio, odczyt i kontrolowane dane demonstracyjne wyłącznie lokalnie.
3. Drizzle, migracje, magazyn, koszyk i checkout.
4. P24, callback, idempotencja i testy kontraktu; test rzeczywistego sandboxu wymaga konta sprzedawcy.
5. Uprawnienia, pobieranie i outbox SMTP.
6. Admin, statusy, ponawianie wiadomości i linków.
7. Typecheck, ESLint, unit/integration, Playwright, build i dokumentacja wdrożenia.

## Konfiguracja i decyzje właściciela

Potrzebne: Sanity project/dataset, PostgreSQL, SMTP, prywatny bucket, P24 sandbox/production, domena HTTPS, dane firmy, treść regulaminu/prywatności, metody dostaw, rzeczywiste produkty/PDF/zdjęcia, stawki podatku, zweryfikowane opinie i social media. Nie wymyślamy danych firmy ani opinii. Dane demonstracyjne i koncepcyjne zdjęcia nie trafiają do produkcyjnego checkoutu. Sprzedaż pozostaje wyłączona do jawnej konfiguracji.
