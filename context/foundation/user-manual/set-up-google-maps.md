# Przygotowanie Google Maps Platform pod czasy dojazdu (FR-016)

Czasy dojazdu z oferty do punktów zespołu liczy Google Maps Platform: **Routes API** liczy
trasy na serwerze, a **Maps JavaScript API** rysuje mapę w przeglądarce. Aplikacja potrzebuje
do tego dwóch kluczy. Agent nie zakłada kont i nie wyklikuje konsoli. Wszystko poniżej robi
właściciel konta rozliczeniowego (Ty). Bez kluczy aplikacja działa dalej: sekcja dojazdów się
renderuje, przycisk jest niedostępny, a brak konfiguracji pokazuje baner.

Nazwy kluczy pochodzą z decyzji z 2026-10-26 (`context/changes/commute-times/`). Jeśli plan
zmiany je przemianuje, popraw je tutaj w tej samej zmianie.

| Zmienna                   | Do czego                                             | Ograniczenia klucza w Google                  |
| ------------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `GOOGLE_MAPS_SERVER_KEY`  | Routes API, wywoływane tylko z Workera               | tylko Routes API; bez ograniczenia aplikacji  |
| `GOOGLE_MAPS_BROWSER_KEY` | Maps JavaScript API, ładowane w przeglądarce członka | tylko Maps JavaScript API; tylko nasze domeny |

## Kiedy

- **Kroki 1–6** możesz zrobić od razu, równolegle z planowaniem i implementacją. Nic nie
  kosztuje, dopóki aplikacja nie wyśle zapytania.
- **Krok 7** (klucze w Cloudflare) robisz po wdrożeniu kodu zmiany. Można też wcześniej:
  nieużywany sekret niczego nie psuje.
- **Krok 8** to ręczny, płatny krok z planu zmiany: jedno prawdziwe liczenie dojazdów.

## Ile to kosztuje

Rozliczenie miesięczne, z karty (postpaid, bez opcji prepaid). Każda usługa ma własny darmowy
limit miesięczny (stan z 2026-10-23, <https://developers.google.com/maps/billing-and-pricing/pricing>):

| Usługa (SKU)                  | Za darmo / mies. | Potem     | Jedno „Policz dojazdy” przy 4 punktach |
| ----------------------------- | ---------------- | --------- | -------------------------------------- |
| Compute Routes Essentials     | 10 000 zapytań   | $5 / 1000 | 8 zapytań (4 punkty × 2 tryby)         |
| Dynamic Maps (ładowanie mapy) | 10 000           | $7 / 1000 | 1 ładowanie, tylko po policzeniu       |

Przy rodzinnym użyciu realny koszt to 0 zł. Karta jest jednak wymagana, a Google nie pozwala ustawić
twardej granicy (krok 5). Przez okres próbny nic nie jest pobierane, a budżet z kroku 6 tylko
wysyła alerty.

## Kroki

### 1. Konto rozliczeniowe i projekt

1. Zaloguj się na konto Google, które ma być właścicielem (najlepiej Twoje prywatne, nie
   służbowe), i wejdź na <https://console.cloud.google.com/google/maps-apis/start>.
2. Kreator poprosi o:
   - **kraj**: Polska, i akceptację warunków;
   - **typ konta**: osoba prywatna (_Individual_);
   - **dane karty**. Google może zrobić autoryzację testową na niewielką kwotę, która wraca.

   Konto w Polsce podlega warunkom **EEA** Google Maps Platform. Jest to zgodne z założeniami
   researchu.

   Kreator pyta też o plan. Wybierz **Płatność według wykorzystania** (_Pay as you go_), a
   nie subskrypcję (Starter, Essentials, Pro). Subskrypcja to stała opłata co miesiąc, nawet
   gdy nic nie liczysz. Przy płatności według wykorzystania obowiązują darmowe limity z tabeli
   wyżej.

3. Kreator może zaproponować od razu utworzenie klucza i pytać o zastosowanie. Ankietę możesz
   pominąć. Klucz utworzony przez kreatora zostaje w projekcie bez ograniczeń, więc nie
   zostawiaj go takim. Gdy okno „Chroń swój klucz interfejsu API” pyta o typ ograniczenia,
   wybierz **Witryny** i dodaj dwa adresy z kroku 4. W kroku 4 nie twórz wtedy nowego klucza,
   tylko zmień nazwę tego i dodaj ograniczenie API. Możesz też ten klucz usunąć
   (**Keys & Credentials** → klucz → **Delete**) i przejść kroki 3 i 4 tak, jak są opisane.
4. Nazwij projekt czytelnie. U góry konsoli kliknij selektor projektu, a jeśli kreator
   utworzył „My First Project”, zmień nazwę w **IAM & Admin → Settings** na `vetpad` (po
   polsku: **Administracja → Ustawienia** → pole **Nazwa projektu** → **Zapisz**).
   Identyfikator projektu (`project-…`) zostaje, bo nie da się go zmienić, i nie przeszkadza. Jeśli
   wolisz nowy projekt: selektor projektu → **New Project** → nazwa `vetpad` → **Create**,
   potem **Billing → Link a billing account**.
5. Sprawdzenie: **Billing** (<https://console.cloud.google.com/billing>) pokazuje konto
   rozliczeniowe, a w zakładce **My projects / Account management** jest przy nim projekt
   `vetpad`.

**Free Trial.** Nowe konto Google Cloud może dostać okres próbny: $300 na 90 dni. W tym czasie
nic nie płacisz, ale po jego końcu usługi przestają działać, dopóki nie klikniesz **Activate
full account** (baner u góry konsoli lub strona **Billing**). Po aktywacji obowiązują darmowe
limity z tabeli wyżej, a nadwyżka jest pobierana z karty.

### 2. Włącz tylko dwa API

1. Wejdź w **Google Maps Platform → APIs & Services**
   (<https://console.cloud.google.com/google/maps-apis/api-list>), z projektem `vetpad`
   wybranym u góry.
2. Kliknij **Routes API** → **Enable**.
3. Kliknij **Maps JavaScript API** → **Enable**.
4. **Nie** włączaj Geocoding API, Distance Matrix API, Directions API ani Places API.
   Aplikacja z nich nie korzysta (decyzja z 2026-10-26: adres punktu idzie prosto do Routes).
5. Kreator z kroku 1 mógł włączyć więcej API. Otwórz **APIs & Services → Enabled APIs &
   services**, a każde API Maps poza tymi dwoma kliknij i wybierz **Disable API**. API
   techniczne Google Cloud (np. _Cloud Logging_) zostaw.

### 3. Klucz serwerowy (`GOOGLE_MAPS_SERVER_KEY`)

1. **Google Maps Platform → Keys & Credentials**
   (<https://console.cloud.google.com/google/maps-apis/credentials>) → **Create credentials
   → API key**. Skopiuj klucz albo zamknij okno, potem kliknij klucz na liście.
2. **Name**: `vetpad-server`.
3. **Application restrictions**: **None**. Worker na Cloudflare nie ma stałego adresu IP, a
   Google przyznaje, że ograniczenie po IP jest w chmurze niepraktyczne
   (<https://developers.google.com/maps/api-security-best-practices>). Ten klucz chronią
   zamiast tego: ograniczenie do jednego API i to, że żyje tylko jako sekret
   Workera.
4. **API restrictions** → **Restrict key** → zaznacz tylko **Routes API** → **OK**.
5. **Save**. Wartość zobaczysz później przez **Show key**.

### 4. Klucz przeglądarkowy (`GOOGLE_MAPS_BROWSER_KEY`)

Ten klucz z założenia trafia do przeglądarki każdego członka. Nie jest tajny, dlatego musi
być ograniczony.

1. **Create credentials → API key**, potem wejdź w nowy klucz. Jeśli w kroku 1 ograniczyłeś do
   witryn klucz z kreatora, wejdź w niego zamiast tworzyć nowy.
2. **Name**: `vetpad-browser`.
3. **Application restrictions** → **Websites** → **Add** dwa wpisy:
   - `https://vetpad.vetpad.workers.dev/*` — produkcja,
   - `http://localhost:4321/*` — `npm run dev` i `npm run preview` (domyślny port Astro).

   Jeśli nie chcesz, żeby klucz produkcyjny działał lokalnie, utwórz trzeci klucz
   `vetpad-browser-dev` tylko z `localhost` i użyj go w `.env` / `.dev.vars`.

4. **API restrictions** → **Restrict key** → tylko **Maps JavaScript API** → **OK** → **Save**.

Zmiana ograniczeń może zacząć działać dopiero po kilku minutach.

### 5. Limity Google: tylko do podglądu

Sprawdzone 2026-10-26: na koncie Pay as you go limitów dziennych **nie da się zmienić**. Dotyczy
to Routes API („Directions – ComputeRoutes per request quota per day”) i Maps JavaScript API.
Konsola przy nich pokazuje „Limitu nie można dostosować”, a w menu wiersza jest tylko
**Utwórz alert o wykorzystaniu**. Twardej granicy kosztów po stronie Google więc nie ma.
Koszty ograniczają:

1. **Okres próbny** (nota pod krokiem 1). Dopóki nie klikniesz **Activate** / **Przejdź na
   wersję płatną**, Google nic nie pobiera z karty. Konto samo nie przechodzi na płatne: po
   90 dniach albo po wyczerpaniu kredytu konto próbne się zamyka, a API przestają działać.
2. **Tajny klucz serwerowy** (krok 3) i ograniczenie klucza przeglądarkowego do dwóch
   adresów (krok 4).
3. **Ręczne liczenie.** Liczy tylko zalogowany członek zespołu po kliknięciu, najwyżej
   12 zapytań na kliknięcie, bez ponawiania. Darmowe 10 000 zapytań miesięcznie to ok. 830
   pełnych liczeń.
4. **Alert budżetowy** (krok 6). Informuje, ale nie zatrzymuje.

Twardą granicę trzyma więc aplikacja: **najwyżej 300 zapytań do Routes API na dobę** liczoną
według czasu warszawskiego, w tabeli `public.commute_usage` w Supabase. Każde „Policz dojazdy”
rezerwuje swoje zapytania (2 na punkt) przed wysłaniem pierwszego, a liczenie, które
przekroczyłoby limit, kończy się przed Google zdaniem: „Dzienny limit liczenia dojazdów zespołu
został wyczerpany — spróbuj jutro.” Zarezerwowane zapytania nie wracają, nawet gdy Google
odpowie błędem. Mapa ładuje się tylko po udanym liczeniu, więc ten sam limit ogranicza też
ładowania mapy. 31 dni × 300 = 9 300, czyli mniej niż darmowe 10 000 zapytań miesięcznie. Jak
wyzerować dzisiejszy licznik albo zmienić limit na stałe, opisuje runbook:
`context/foundation/deployment-runbook.md`, sekcja „Google Maps keys (FR-016)” → „The owner's
levers on the daily limit”.

Ogólny opis limitów: <https://docs.cloud.google.com/apis/docs/capping-api-usage>.

### 6. Alert budżetowy

1. Wybierz projekt `vetpad` → ☰ → **Płatności** → **Przejdź do połączonego konta**. Strona
   **Płatności** otwarta bez projektu filtruje konta po organizacji, którą kreator utworzył
   automatycznie, i może nie pokazać konta próbnego. Nie klikaj tam **Dodaj konto
   rozliczeniowe**.
2. **Budżety i alerty** (_Budgets & caps_) → **Create new**.
3. **Zdefiniuj**: **Tylko alerty**, nazwa `vetpad-maps`. **Egzekwowanie limitu wydatków**
   (_spend caps_) nie obejmuje Google Maps Platform. Sprawdzone 2026-10-26: działa tylko dla
   Gemini API, Vertex AI, Cloud Run i Cloud Run functions
   (<https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps>). Warto
   sprawdzać, czy Google dopisało tam Mapy.
4. **Zakres**: wszystkie projekty (jest jeden, `vetpad`), wszystkie usługi. W
   **Oszczędnościach** odznacz tylko **Kwoty promocyjne**, czyli kredyt okresu próbnego.
   Inaczej budżet pokazywałby 0 zł aż do końca okresu próbnego. Pozostałe pola zostaw
   zaznaczone.
5. **Kwota**: określona kwota, **5 zł**.
6. **Działania**: progi 50%, 90%, 100% (_Rzeczywiste_), e-mail do administratorów płatności.
7. **Zakończ**. Na liście budżetów pojawia się `vetpad-maps`: „Co miesiąc”, 0,00 zł / 5,00 zł.

Budżet **nie** zatrzymuje usług, tylko informuje.

### 7. Klucze w aplikacji

Lokalnie dopisz oba klucze do `.env` (czyta go `npm run dev`) i do `.dev.vars` (czyta go
`npm run preview` po `npm run build`):

```bash
GOOGLE_MAPS_SERVER_KEY=AIza...
GOOGLE_MAPS_BROWSER_KEY=AIza...
```

Na produkcji ustaw sekrety Workera, z katalogu repozytorium:

```bash
npx wrangler secret put GOOGLE_MAPS_SERVER_KEY
npx wrangler secret put GOOGLE_MAPS_BROWSER_KEY
```

Każde polecenie od razu tworzy i wdraża nową wersję Workera
(`context/foundation/deployment-runbook.md`). Alternatywnie: panel Cloudflare → **Workers &
Pages** → `vetpad` → **Settings → Variables and Secrets → Add** → typ **Secret**.

**Nigdy** nie dodawaj tych kluczy do sekretów repozytorium na GitHubie ani do
`.github/workflows/`. Build ich nie potrzebuje, bo aplikacja czyta je w czasie działania, a
żaden krok CI nie może wysłać płatnego zapytania do Google.

### 8. Sprawdzenie

1. Na <https://vetpad.vetpad.workers.dev> baner nie wymienia już Google Maps.
2. Pierwsze prawdziwe liczenie to ręczny, płatny krok z planu zmiany `commute-times`.
   Uruchamiasz je Ty, na jednej ofercie.
3. Po kilku minutach zapytania widać w **Google Maps Platform → Metrics**, a koszt w
   **Billing → Reports** (powinien wynosić 0 zł, bo zużycie mieści się w darmowym limicie).

## Gdy coś nie działa

| Objaw                                                                                                                                                                  | Prawdopodobna przyczyna                                                                                                                                                                    | Co zrobić                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Mapa szara z komunikatem Google, w konsoli `RefererNotAllowedMapError`                                                                                                 | adresu strony nie ma w ograniczeniach klucza przeglądarkowego                                                                                                                              | dodaj adres w kroku 4, odczekaj kilka minut                                                                                |
| Mapa: `ApiNotActivatedMapError`                                                                                                                                        | Maps JavaScript API nie jest włączone                                                                                                                                                      | krok 2                                                                                                                     |
| Liczenie kończy się błędem `403` / `PERMISSION_DENIED`                                                                                                                 | Routes API wyłączone, klucz serwerowy ograniczony do innego API albo nieaktywne rozliczenia (koniec Free Trial)                                                                            | krok 2, krok 3, **Billing**                                                                                                |
| Liczenie kończy się błędem `429` / `RESOURCE_EXHAUSTED`                                                                                                                | wyczerpany dzienny limit Google (krok 5)                                                                                                                                                   | poczekaj do jutra (limit dzienny Google liczony jest według czasu pacyficznego)                                            |
| „Dzienny limit liczenia dojazdów zespołu został wyczerpany — spróbuj jutro.”                                                                                           | zespół wykorzystał dziś 300 zapytań, limit aplikacji (krok 5); do Google nic nie poszło                                                                                                    | poczekaj do północy czasu warszawskiego albo wyzeruj dzisiejszy licznik (runbook, „The owner's levers on the daily limit”) |
| „Nie udało się sprawdzić, czy liczenie mieści się w dziennym limicie zespołu, więc nic nie zostało wysłane do Google. Spróbuj ponownie za chwilę.”                     | aplikacja nie odczytała albo nie zapisała licznika w Supabase; to problem Supabase, nie Google                                                                                             | sprawdź projekt Supabase i czy migracje `commute-times` są wypchnięte                                                      |
| W wierszu punktu: „Google odrzucił adres tego punktu — sprawdź go w kryteriach”, pozostałe punkty mają czasy                                                           | Google nie rozumie adresu tego punktu w żadnym z trybów; adres nie jest sprawdzany przy zapisie                                                                                            | popraw adres w `/criteria`: ulica z numerem i miasto                                                                       |
| W wierszu punktu: „brak trasy”                                                                                                                                         | Google nie znalazł trasy w tym trybie, np. komunikacją                                                                                                                                     | to wynik, nie błąd                                                                                                         |
| „Google odrzucił klucz aplikacji. Dojazdy nie zostały policzone — klucz trzeba sprawdzić w konfiguracji aplikacji.”                                                    | to samo co `403` wyżej                                                                                                                                                                     | krok 2, krok 3, **Billing**                                                                                                |
| „Google ogranicza teraz liczbę zapytań o trasy. Dojazdy nie zostały policzone — spróbuj ponownie później.”                                                             | to samo co `429` wyżej                                                                                                                                                                     | poczekaj do jutra                                                                                                          |
| „Google odrzucił zapytanie o trasy jako niepoprawne. Jeśli zespół ma jeden punkt, sprawdź jego adres w kryteriach; w przeciwnym razie to wymaga poprawki w aplikacji.” | przy jednym punkcie: Google odrzucił jego adres; przy kilku: Google odrzucił wszystkie punkty w jednym trybie albo jeden punkt tylko w jednym trybie, więc błąd leży w zapytaniu aplikacji | przy jednym punkcie popraw adres; przy kilku zgłoś błąd aplikacji                                                          |
| „Google Maps jest chwilowo niedostępny albo nie udało się z nim połączyć. Dojazdy nie zostały policzone — spróbuj ponownie za chwilę.”                                 | błąd `5xx` Google albo brak połączenia                                                                                                                                                     | spróbuj ponownie później                                                                                                   |
| „Google nie odpowiedział w ciągu 10 sekund. Dojazdy nie zostały policzone — spróbuj ponownie.”                                                                         | któreś zapytanie przekroczyło limit czasu                                                                                                                                                  | spróbuj ponownie; każde ponowienie to nowe, płatne liczenie                                                                |
| „Google zwrócił odpowiedź, której nie udało się odczytać. Dojazdy nie zostały policzone.”                                                                              | odpowiedź Google nie ma oczekiwanego kształtu                                                                                                                                              | zgłoś błąd aplikacji                                                                                                       |
| „Liczenie dojazdów jest wyłączone — aplikacja nie ma klucza Google Maps do tras.” przy przycisku                                                                       | brak `GOOGLE_MAPS_SERVER_KEY`                                                                                                                                                              | krok 7                                                                                                                     |
| „Mapa jest niedostępna — aplikacja nie ma klucza Google Maps do mapy. Tabela pokazuje wszystkie dojazdy.”                                                              | brak `GOOGLE_MAPS_BROWSER_KEY`                                                                                                                                                             | krok 7                                                                                                                     |
| Baner wciąż wymienia Google Maps                                                                                                                                       | brak sekretu w Workerze albo w `.env` / `.dev.vars`                                                                                                                                        | krok 7; po zmianie `.dev.vars` przebuduj (`npm run build`) przed `npm run preview`                                         |

## Wymiana klucza

Gdy klucz wycieknie albo chcesz go wymienić: **Keys & Credentials** → klucz → **Regenerate
key** (stary działa jeszcze przez okno przejściowe podane przez Google) → `npx wrangler secret
put <NAZWA>` z nową wartością → popraw `.env` i `.dev.vars`. Klucz przeglądarkowy jest
publiczny z natury, więc jego ochroną są ograniczenia z kroku 4, a nie tajność.
