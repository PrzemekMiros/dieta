# Tortowe Ciocho

Sklep w Astro SSR + TypeScript, Tailwind CSS 4 i GSAP/ScrollTrigger, z Sanity Studio, PostgreSQL/Drizzle, integracją Przelewy24, prywatnymi ebookami i osobnym panelem zamówień.

## Wdrożenie na Netlify

Repozytorium jest skonfigurowane do builda SSR na Netlify (`netlify.toml`, Node 24/npm 11). Netlify automatycznie używa adaptera Astro Netlify; poza Netlify lokalny build nadal używa adaptera Node. Ustaw wymagane zmienne z `.env.example` w Netlify Site configuration → Environment variables. Ustaw `SITE_URL` na publiczny adres HTTPS. Nie włączaj sprzedaży przed skonfigurowaniem i odbiorem bazy PostgreSQL, Sanity, P24, S3 i SMTP.

Netlify obsługuje SSR strony, ale nie uruchamia stale procesów `worker` i `payments:reconcile`. Bez osobnego hosta/schedulera te zadania nie będą przetwarzać kolejki e-mail ani uzgadniać płatności; sprzedaż nie jest gotowa do uruchomienia tylko przez sam deploy Netlify. Szczegóły: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Projekt działa lokalnie z 3 demonstracyjnymi ebookami i 10 produktami fizycznymi. **Sprzedaż jest domyślnie wyłączona.** Prawdziwy sandbox P24, Sanity, SMTP i S3 wymagają konfiguracji kont właściciela oraz testów odbiorowych. To nie jest deklaracja gotowości produkcyjnej.

## Start na tym komputerze

```powershell
.\dev.ps1
```

- Sklep z BrowserSync: http://localhost:3000
- Astro: http://localhost:4321
- Panel BrowserSync: preferowany port 3001 (aktualny adres UI pokazuje terminal).
- Admin: http://localhost:3000/admin (wymaga bazy i utworzenia konta).
- Studio: `.\dev.ps1 studio`, http://localhost:3333 (wymaga projektu Sanity).

Systemowy Node 20 jest za stary. `.tools/` zawiera lokalny Node 24/npm 11; `dev.ps1` ustawia PATH tylko dla polecenia. Jeśli PowerShell blokuje skrypt: `powershell -ExecutionPolicy Bypass -File .\dev.ps1`.

BrowserSync synchronizuje przewijanie i kliknięcia, nie formularze. Vite obsługuje HMR przez proxy WebSocket. Astro 7 może pozostawić daemon developerski; `npm run astro -- dev stop` zatrzymuje go jawnie. Na telefonie w tej samej sieci można użyć IP komputera i portu BrowserSync; operacje formularzy wymagają dodania dokładnego zaufanego adresu do konfiguracji Origin w `security.ts` (nie używaj wildcard).

## Odtworzenie instalacji

Na Node 24/npm 11: `npm ci`. Na komputerze ze starszym Node:

```powershell
npm install --prefix .tools --no-save --package-lock=false node@24 npm@11
.\dev.ps1 install
```

Skopiuj `.env.example` do `.env`. Tryb demonstracyjny działa bez zewnętrznych kont. W produkcji ustaw `APP_ENV=production` i `DEMO_CATALOG=false`; nie ma automatycznego zastępowania awarii Sanity przykładowym katalogiem.

## Baza, konto administratora i wiadomości

Uruchom Docker Desktop, a następnie:

```powershell
docker compose up -d
.\dev.ps1 db:migrate
.\dev.ps1 db:seed
```

Baza lokalna nasłuchuje na `127.0.0.1:54329`. Mailpit: SMTP `1025`, podgląd wiadomości http://localhost:8025. Hasło w compose jest wyłącznie dla lokalnego środowiska, nie do produkcji.

W `.env` lub zmiennych procesu ustaw tymczasowo `ADMIN_EMAIL` i `ADMIN_PASSWORD` (min. 14 znaków), wykonaj `.\dev.ps1 admin:create`, potem usuń hasło z konfiguracji. Nie podawaj sekretów w czacie ani argumentach poleceń.

```powershell
.\dev.ps1 worker              # przetwarzanie kolejki maili
.\dev.ps1 payments:reconcile  # uzgodnienie zaległych płatności z P24
```

Sanity jest źródłem treści i cen. Dostępny stan magazynowy jest w PostgreSQL, a nie w publicznym polu `stock` z CMS. Seed inicjuje tylko brakujące rekordy. Korekty wykonuj w `/admin/magazyn`.

## Polecenia

| Polecenie npm | Odpowiednik Windows | Cel |
| --- | --- | --- |
| `npm run dev` | `.\dev.ps1` | Astro + BrowserSync |
| `npm run check` | `.\dev.ps1 check` | TypeScript i Astro |
| `npm run lint` | `.\dev.ps1 lint` | ESLint |
| `npm test` | `.\dev.ps1 test` | testy jednostkowe i bazodanowe PGlite |
| `npm run test:e2e` | `.\dev.ps1 test:e2e` | Playwright, lokalnie Chrome |
| `npm run build` | `.\dev.ps1 build` | SSR + joby do `dist/` |
| `npm start` | `.\dev.ps1 start` | serwer produkcyjny |
| `npm run studio:build` | `.\dev.ps1 studio:build` | build niezależnego Studio |
| `npm run db:generate` | `.\dev.ps1 db:generate` | nowa migracja schematu |
| `npm run format` | `.\dev.ps1 format` | Prettier |

Playwright używa zainstalowanego Chrome. Dla CI można zmienić `channel` na Chromium i wykonać `npx playwright install --with-deps chromium`. W CI testy uruchamiają własny dev server; lokalnie mogą używać istniejącego na 4321, który musi pracować na danych demo i z wyłączoną sprzedażą. Zrzuty pięciu szerokości zapisują się w `.work/home-*.png`.

## Zaimplementowane obszary

- Strona główna inspirowana kompozycją dietetykmaria.pl, podstrony katalogu, produktu, bloga, marki i dokumentów.
- Koszyk z zapisem lokalnym, zmianą ilości, usuwaniem i wyceną serwerową; checkout cyfrowy, fizyczny i mieszany.
- Sanity: produkty, kategorie, strony, artykuły, ustawienia i konfigurowalna kolejność sekcji strony głównej.
- Zamówienia, snapshoty cen/podatku/produktu, transakcyjny magazyn i rejestr ruchów.
- Przelewy24: sandbox/production, podpisy, rejestracja, weryfikowany callback, idempotencja i uzgadnianie.
- Ebooki: prywatny S3, uprawnienia, hashowane tokeny, wygasanie i regeneracja linków.
- Admin: logowanie scrypt, sesje, dashboard, filtry i szczegóły zamówień, przesyłki, magazyn, historia i ponawianie wiadomości.
- Outbox SMTP z retry, newsletter double opt-in, SEO/OG/sitemap/robots, lokalne fonty i reduced motion.

## Dokumentacja i granice weryfikacji

- [Architektura, analiza referencji i plan](docs/ARCHITECTURE.md).
- [Wdrożenie, wymagane decyzje i scenariusze odbioru](docs/DEPLOYMENT.md).
- [Weryfikacja i ograniczenia testów](docs/VERIFICATION.md).
- [Obrazy, pochodzenie i prompty imagegen](docs/ASSETS.md).

Nie ma rzeczywistych opinii, danych przedsiębiorcy, płatnych PDF ani zdjęć produktów. Nie są zastępowane fikcyjnymi materiałami w produkcyjnym checkout. Dokumenty prawne czekają na treść właściciela. Zdjęcia w projekcie są koncepcyjne, wygenerowane przez imagegen; szczegóły w dokumentacji materiałów.
