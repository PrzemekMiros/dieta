# Przygotowanie do Tpay — 19.11.2026

## Stan wdrożenia

Przygotowano stronę informacyjną `/platnosci`, stronę `/dostawa-i-zwroty` (z zachowaniem pierwszeństwa istniejącego dokumentu CMS), linki w stopce, kontakt z danych ustawień i blokadę składania zamówień bez dostępnej metody płatności. Usunięto przykładowy numer telefonu z kontaktu. Koszty dostawy pochodzą z tej samej konfiguracji co wycena koszyka.

Integracja Przelewy24 została usunięta: adapter, rejestracja transakcji, obsługa powiadomień oraz zadanie uzgadniania płatności. Nie można jej ponownie włączyć zmienną środowiskową. Tpay wymaga osobnego adaptera, weryfikacji powiadomień i testów. Płatności online pozostają wyłączone także przy `SALES_ENABLED=true`. Pobranie działa niezależnie dla produktów fizycznych.

## Wymagania i źródła

- Tpay wymaga działającej strony z łatwo dostępnym regulaminem i polityką prywatności, dokumentów przedsiębiorcy oraz weryfikacji w Panelu Akceptanta: https://tpay.com/dla-biznesu/jak-zaczac-z-tpay
- Aktualne dokumenty operatora, OWU i wykluczone towary/usługi: https://tpay.com/dla-biznesu/do-pobrania.html
- Tpay wskazuje potrzebę linku do regulaminu płatności, również w kontekście Click to Pay: https://support.tpay.com/sprzedawca/click-to-pay-i-dodanie-linku-do-regulaminu-tpay
- Dane operatora i regulamin płatnika: https://tpay.com/user/assets/files_for_download/regulamin.pdf
- Informacje o przetwarzaniu danych przez Tpay: https://tpay.com/polityka-prywatnosci
- Obowiązki informacyjne sprzedawcy: https://prawakonsumenta.uokik.gov.pl/pytania-i-odpowiedzi/prawo-do-informacji/
- Warunki utraty prawa odstąpienia przy treściach cyfrowych: https://prawakonsumenta.uokik.gov.pl/prawo-odstapienia-od-umowy/wylaczenia-prawa-do-odstapienia/
- Zwroty: https://prawakonsumenta.uokik.gov.pl/prawo-odstapienia-od-umowy/skutek/
- Przebieg transakcji API: https://docs-api.tpay.com/en/first-steps/first-transaction/

## Blokery przed zgłoszeniem strony do weryfikacji

1. Potwierdzić sprzedawcę. Lokalny regulamin wskazuje Catering dietetyczny Elżbieta Dworzyńska, ale podaje zarówno Niemojewską 13/U6, jak i Niemojewską 2 w Warce. Nie wybrano arbitralnie adresu. Ujednolicić nazwę, adres siedziby i reklamacji, NIP, telefon oraz e-mail w ustawieniach CMS, regulaminie i polityce. Kontakt miał inny e-mail i przykładowy telefon.
2. Dopasować regulamin do faktycznej oferty. Usunięto z lokalnej sekcji płatności poprzednich operatorów; opis wskazuje dostępne pobranie oraz przygotowanie Tpay. Pozostałe zapisy o cateringu, kontach i voucherach nadal wymagają przeglądu. Sklep implementuje produkty fizyczne i e-booki; rezerwacje konsultacji są osobnym formularzem. Potwierdzić, które świadczenia będą sprzedawane przez Tpay.
3. Ustalić i opublikować czas realizacji produktów fizycznych (`siteSettings.deliveryInfo`), adres zwrotów, koszty odesłania i pełną procedurę reklamacji oraz odstąpienia. Strona dostawy bez ustalonego terminu nie jest gotowa do weryfikacji.
4. Uzupełnić opisy, ceny brutto, formaty i wymagania techniczne e-booków, warunki konsultacji i rzeczywiste pliki. Nie sprzedawać demonstracyjnych produktów.
5. Zaktualizować politykę prywatności o Tpay oraz faktycznych dostawców, cele, podstawy, retencję i prawa. Lokalny dokument zawiera rozbieżne adresy e-mail oraz opis narzędzi wymagający porównania z rzeczywistą konfiguracją.
6. Opublikować zatwierdzone dokumenty w Sanity: `contentPage()` preferuje CMS nad lokalnymi plikami. Sama edycja `src/data/terms-of-service.ts` lub `privacy-policy.ts` nie zmieni dokumentu już istniejącego w CMS. W tej zmianie nie zmieniono ani nie opublikowano dokumentów CMS.
7. Przed dostarczeniem e-booka wysłać trwałe potwierdzenie umowy i zgody. Obecny e-mail potwierdzający zamówienie nie zawiera pełnych warunków i zgody. Zachować wersję/snapshot regulaminu, pozycje, ceny, dane sprzedawcy i treść oświadczenia w e-mailu lub załączniku; sam link do zmiennej strony nie wystarczy.

## Gotowe brzmienie klauzul do docelowych dokumentów

Poniższe klauzule są do włączenia po uruchomieniu integracji i uzgodnieniu całego regulaminu. Nie są jeszcze opublikowane jako obowiązujące warunki.

**Płatności:** „Płatności online obsługuje Krajowy Integrator Płatności S.A. z siedzibą w Poznaniu, plac Andersa 3, 17. piętro, 61-894 Poznań, KRS 0000412357, NIP 7773061579, działający pod marką Tpay. Dostępne metody płatności są prezentowane w panelu operatora. Kwota do zapłaty jest podana w PLN i obejmuje podatki oraz wskazane w podsumowaniu koszty dostawy. Regulamin dokonywania płatności Tpay: https://tpay.com/user/assets/files_for_download/regulamin.pdf. Realizacja opłaconego zamówienia następuje po potwierdzeniu płatności przez operatora, zgodnie z terminem podanym w ofercie.”

**Dane płatnika:** „W przypadku wyboru płatności online dane niezbędne do obsługi transakcji, w tym imię i nazwisko, adres e-mail, identyfikator zamówienia i kwota płatności, przekazywane są operatorowi Tpay — Krajowemu Integratorowi Płatności S.A. Operator przetwarza dane również jako odrębny administrator w celu świadczenia usług płatniczych i realizacji własnych obowiązków prawnych. Szczegóły: https://tpay.com/polityka-prywatnosci.” Podstawę przekazania danych i pozostałe informacje administratora należy spójnie ująć w całej polityce; nie dodawać obowiązkowej zgody marketingowej do zakupu.

## Kolejny etap techniczny

- Zweryfikowane konto sprzedawcy, osobne konto sandbox oraz dane dostępowe API przechowywane wyłącznie po stronie serwera.
- Rejestracja transakcji z kwotą obliczoną na serwerze, powiązaniem z zamówieniem i publicznymi adresami HTTPS powrotu oraz powiadomień.
- Weryfikacja autentyczności powiadomień według aktualnej dokumentacji Tpay, zgodności identyfikatora, kwoty i statusu. Powrót przeglądarki nie potwierdza zapłaty.
- Dodać osobne pola operatora i identyfikatora transakcji Tpay. Historyczna kolumna SQL `p24_order_id` i stare dokumenty pozostają zachowane wyłącznie jako dane archiwalne; nowa integracja nie może ich używać. Checkout przyjmuje `tpay` lub `cod`, ale żądania `tpay` są blokowane przed zapisem zamówienia. Status starych płatności online używa ogólnego oznaczenia `online`.
- Idempotencja, obsługa duplikatów, opóźnionych powiadomień, timeoutu rejestracji, płatności anulowanej i zwrotu. Dostęp do plików dopiero po wiarygodnym potwierdzeniu.
- Testy sandbox: sukces, błąd, brak zapłaty, niezgodna kwota, fałszywy podpis, duplikat i powiadomienie po anulowaniu. Test wysyłki e-mail i dostępu do e-booka. Dopiero potem włączenie produkcji.

Nie aktywować wszystkich metod z materiałów marketingowych Tpay automatycznie — dostępność metod zależy od konfiguracji i umowy operatora.

## Po usunięciu poprzedniej integracji

Usuń zmienne `P24_*` z hostingu i wyłącz zewnętrzne harmonogramy dawnego zadania `payments:reconcile`. Endpoint `/api/p24/notify` nie obsługuje już płatności. Ewentualne historyczne, nierozliczone transakcje wymagają ręcznego sprawdzenia u poprzedniego operatora. Nie zmieniono danych w bazach ani opublikowanych dokumentów Sanity.
