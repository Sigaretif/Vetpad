---
date: 2026-09-23T22:30:10+02:00
researcher: Claude (Opus 5.5) for Wiktor Ortel
git_commit: fda73fbca288c01d4e0565bb046a110b3185dd0e
branch: master
repository: 10xDevs4 (Vetpad)
topic: "Pozostałe widoki (signin, dashboard, strona główna) i komponenty formularzy: audyt zarzutów wg /10x-ui względem kontraktu z ui-offer-card"
tags: [research, ui, design-tokens, shadcn, forms, signin, dashboard, welcome, app-layout, destructive, states]
status: complete
last_updated: 2026-09-23
last_updated_by: Claude (Opus 5.5)
---

# Research: pozostałe widoki i komponenty formularzy

**Date**: 2026-09-23T22:30:10+02:00
**Researcher**: Claude (Opus 5.5) for Wiktor Ortel
**Git Commit**: fda73fbca288c01d4e0565bb046a110b3185dd0e (drzewo robocze: niezacommitowane zmiany w `CLAUDE.md`, `README.md`, `scripts/ui-screenshots.mjs` — tylko argument katalogu wyjściowego; `src/` czyste)
**Branch**: master
**Repository**: 10xDevs4 (Vetpad)

## Research Question

Audyt w obu kierunkach wg `/10x-ui` dla plików z listy `ignores` w `tokensOnlyConfig` (`eslint.config.js:82-94`). Wynik to zarzuty w trzech kategoriach (brakujące tokeny, brakujący komponent współdzielony, przypadkowa architektura), każdy z plik:linia i jednym zdaniem o skutku dla użytkownika, z 3–5 zarzutami rdzeniowymi. Referencja: kontrakt z `context/archive/2026-09-23-ui-offer-card/`, `CLAUDE.md` `### UI`, `context/foundation/lessons.md`. Cztery pytania szczegółowe:

1. Literały i tokeny, które je zastępują; czy `destructive` potrzebuje `--destructive-foreground` (≥4,5:1 w `.dark`).
2. Brakujące prymitywy shadcn dla formularzy; co z `FormField`/`PasswordToggle`/`SubmitButton`/`ServerError` zostaje lokalne.
3. Macierz 7 stanów dla `SignInForm` i `AddOfferForm`.
4. Wejścia: wylogowany na `/`, `/dashboard`, `/auth/signin?error=`; `AppLayout` dla dashboardu i Welcome; drugi „Sign out”; język ekranów.

Bez zmian w kodzie. Metoda: wszystkie pliki z zakresu przeczytane w całości w głównym kontekście (zakres to 11 plików plus rama, więc bez podagentów). `shadcn add` uruchomiony na kopii konfiguracji w scratchpadzie. Kontrast liczony skryptem oklch → sRGB → WCAG z nakładaniem alfy w sRGB. Kolejność wariantów sprawdzona kompilacją Tailwinda z `node_modules`.

## Summary

**Zarzuty rdzeniowe (5)** — pełne wiersze w tabelach niżej:

| # | Kategoria | Zarzut | Skutek dla użytkownika |
| --- | --- | --- | --- |
| **K1** | komponent | Pole formularza zbudowane ręcznie (`FormField.tsx:5-6`, `:42-55`), bez `Input`/`Label`. Błąd nie jest powiązany z polem: brak `aria-invalid`, `aria-describedby` i `id` na komunikacie (`:58-62`) | Czytnik ekranu na polu z błędem nie mówi, że pole jest błędne ani co poprawić. Oba formularze (i S-03) dziedziczą fiolet spoza tokenów |
| **A1** | architektura | `SignInForm` nie ma stanu ładowania ani `disabled`: `useFormStatus()` nigdy nie zgłasza `pending` przy natywnym POST-cie (`SubmitButton.tsx:9`, `:14-15`), a `SignInForm.tsx:82` nie podaje `pending` | Po „Sign in” przycisk wygląda tak samo aż do przeładowania. `pendingText="Signing in..."` jest martwym kodem, możliwe podwójne wysłanie |
| **A2** | architektura | Po udanym logowaniu `signin.ts:25` przekierowuje na `/`. Tam `Welcome.astro:29-34` pokazuje zalogowanemu przycisk „Sign In” i trzy karty reklamujące starter (`:56`, `:79`, `:101`) | Pierwszy ekran po zalogowaniu zaprasza do logowania i opowiada o ESLint zamiast prowadzić do ofert |
| **A3** | architektura | Dashboard poza ramą: `Layout` zamiast `AppLayout` (`dashboard.astro:9`), bez Topbara, własny „Sign out” z literałów (`:22-29`), „Welcome, e-mail” (`:15-17`) i tekst startera (`:18`) | Na przejściu karta → „Oferty” pasek z e-mailem i „Wyloguj” znika. Na jego miejscu jest drugi, inaczej wyglądający przycisk wylogowania i mieszanka angielskiego z polskim |
| **T1** | tokeny | Trzy widoki malują się na `bg-cosmic` + `white/10` + `backdrop-blur-xl` + nagłówek-gradient (`signin.astro:9-11`, `dashboard.astro:10-12`, `Welcome.astro:5-9`, `:22`, `:40`, `:62`, `:85`). `SubmitButton.tsx:21` nadpisuje `Button` fioletem | Preset i ciemny motyw z tokenów nie docierają do pierwszego ekranu, który widzi każdy (logowanie), a główny przycisk ma inny kolor niż „primary” reszty aplikacji |

**Odpowiedzi na cztery pytania w skrócie:**

1. **Literały**: 41 linii z trafieniem regexu lintu w 9 plikach z `ignores`. `SignInForm.tsx` i `AddOfferForm.tsx` mają 0, bo wygląd dziedziczą. Mapowanie na tokeny: tabela „Kategoria 1”. **`--destructive-foreground`: kontrast go nie wymaga, lint i reguła z `lessons.md` tak.** Biały na `dark:bg-destructive/60` ma 6,03:1 na `card` i 6,48:1 na `background`. Jedynym powodem, dla którego `button.tsx` i `badge.tsx` są na liście `ignores`, jest literał `text-white` (`button.tsx:14`, `badge.tsx:14`; komentarz `eslint.config.js:91`). Para `--destructive-foreground` = `oklch(0.985 0 0)` daje 5,77/6,20:1 w `.dark` i pozwala zdjąć oba pliki z listy. Przy okazji wyszło, że w `.dark` `hover:bg-destructive/90` nigdy nie działa, bo `dark:bg-destructive/60` stoi w CSS później (T7).
2. **Prymitywy**: `input` i `alert` przychodzą bez nowych zależności poza rytuałem. `label` importuje `Label` z parasolowego `radix-ui`. Rytuał z `CLAUDE.md` `### UI` opisuje tylko `Slot`, a `@radix-ui/react-label` nie ma w `package.json`, więc to decyzja: nowa zależność albo natywny `<label>`. `FormField` i `SubmitButton` zostają lokalnymi kompozytami na prymitywach, `PasswordToggle` zostaje lokalny na `Button variant="ghost" size="icon"`, `ServerError` zastępuje `Alert variant="destructive"`.
3. **Stany**: z 14 komórek macierzy (2 formularze × 7 stanów) brakuje `loading` i `disabled` w `SignInForm`. `error` istnieje w obu formularzach, ale bez powiązania z polem. `hover` na polach tekstowych „nie dotyczy” (prymityw `Input` go nie ma). Kitchen sink nie wyrenderuje stanów błędu ani ładowania z samych propsów, bo stan siedzi w `useState` (`SignInForm.tsx:13-16`, `AddOfferForm.tsx:12-14`). Narzędzie zrzutów umie wymusić fokus, ale nie hover (`scripts/ui-screenshots.mjs:28`, `:206-210`).
4. **Wejścia**: wylogowany na `/dashboard` dostaje 302 na `/auth/signin` bez powodu i bez powrotu (`middleware.ts:18-21`), a po zalogowaniu ląduje na `/` (A2). `/auth/signin?error=` wyświetla dowolny tekst z URL-a w czerwonej ramce (A6). Dashboard i Welcome pasują do `AppLayout`. Signin zostaje na `Layout`, bo Topbar niezalogowanego pokazuje link „Zaloguj” do strony, na której użytkownik już jest. Język: PRD go nie rozstrzyga. Decyzja S-01 („UI pozostaje po angielsku”) dotyczyła tekstów logowania, a od ui-offer-card rama, karta i formularz ofert są po polsku, więc angielskie zostały tylko te trzy ekrany (A5).

## Zarzuty

Numeracja stała, do odwołań w planie. **R** = rdzeniowy, **D** = drugorzędny (do planu, jeśli tani), **O** = odłożony (z powodem).

### Kategoria 1 — brakujące tokeny

| # | Prio | Plik:linia | Co jest | Token, który to pokrywa | Skutek dla użytkownika |
| --- | --- | --- | --- | --- | --- |
| T1 | **R** | `signin.astro:9-11`, `:15`; `dashboard.astro:10-12`, `:15-18`; `Welcome.astro:5`, `:22`, `:25`, `:40`, `:57`, `:62`, `:80`, `:85`, `:102` | Tło `bg-cosmic` (hexy w `global.css:150-152`), panele `border-white/10 bg-white/10`/`bg-white/5` + `backdrop-blur-xl`, tekst `text-white`/`text-blue-100/50…80`, nagłówki `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-transparent` | tło: nic (body ma już `bg-background`, `global.css:158-160`); panel: `Card` (`bg-card border-border`); tekst: `text-foreground` / `text-muted-foreground`; nagłówek: `text-foreground` (T8 z ui-offer-card) | Pierwszy ekran każdej sesji nie reaguje na tokeny ani preset; 5 paneli z `backdrop-blur-xl` na trzech widokach (1+1+3) to ten sam koszt przewijania bez GPU, który zmierzono na karcie (~9 fps, archiwum `plan.md` Performance) — tu nie mierzony |
| T2 | **R** (z T1) | `SubmitButton.tsx:21`, `:25`; `Welcome.astro:31` | Przycisk główny `bg-purple-600 text-white hover:bg-purple-500` nadpisuje `Button` default; spinner `border-white/30 border-t-white`; CTA Welcome to `<a>` z tymi samymi klasami | `Button` default (`bg-primary text-primary-foreground hover:bg-primary/90`, `button.tsx:12`; 6,97:1); spinner `border-primary-foreground/30 border-t-primary-foreground` albo `Loader2 animate-spin` (lucide już w zależnościach); CTA `buttonVariants()` na `<a>` | Główna akcja formularza jest fioletowa, każda inna akcja w aplikacji cyan — dwa „primary” |
| T3 | D | `FormField.tsx:6`, `:37`, `:41`, `:53`, `:59` | Pole `bg-white/10 border-white/20 text-white placeholder-white/40`, etykieta `text-blue-100/80`, ikona `text-white/40`, fokus `focus:ring-purple-400`, błąd `border-red-400/60 focus:ring-red-400`, komunikat `text-red-300` | `Input` (`border-input dark:bg-input/30 placeholder:text-muted-foreground focus-visible:ring-ring/50 aria-invalid:border-destructive`); etykieta `Label` / `text-foreground`; ikona `text-muted-foreground`; komunikat `text-destructive` (6,19:1 na `card`) | Placeholder i ikona mają dziś 3,05:1 (poniżej 4,5 dla tekstu); po migracji placeholder `muted-foreground` na wypełnieniu pola 6,17:1 |
| T4 | D | `PasswordToggle.tsx:13` | `text-white/40 hover:text-white/70` | `text-muted-foreground hover:text-foreground` (przez `Button variant="ghost"`) | Ikona „pokaż hasło” ma 3,05:1 — słabo widoczna kontrolka |
| T5 | D | `ServerError.tsx:11` | `border-red-500/30 bg-red-900/30 text-red-300` | `Alert variant="destructive"` (`bg-card text-destructive`, opis `text-destructive/90`: 5,22:1 na `card`) | Błąd serwera w innym odcieniu czerwieni niż baner `error` (`Banner.astro:15`) i błąd pola |
| T6 | **R** (Q1) | `button.tsx:14`, `badge.tsx:14`; `eslint.config.js:91-93` | `destructive: "bg-destructive text-white … dark:bg-destructive/60"` — literał `text-white` to jedyny powód obu plików na liście `ignores`; preset nie ma `--destructive-foreground` (depozyt `preset-b1s91W2me.css:71`, `:106` — tylko `--destructive`) | Nowy `--destructive-foreground` w `:root` i `.dark` + `--color-destructive-foreground` w `@theme inline`; wariant `text-destructive-foreground`; komentarz odstępstwa od presetu w `global.css` | Dziś nikt nie używa wariantu (grep `variant="destructive"` w `src/`: 0); bez pary każdy przyszły przycisk „Usuń” (S-11, FR-015) trafi na listę `ignores` albo złamie lint |
| T7 | D | `button.tsx:14` | W `.dark` `hover:bg-destructive/90` przegrywa z `dark:bg-destructive/60` (kompilacja Tailwinda: reguła `dark:` emitowana po `hover:`, równa specyficzność) | Hover przez token w obrębie wariantu ciemnego, np. `dark:hover:bg-destructive/50` | Przycisk destrukcyjny w jedynym motywie aplikacji nie reaguje na najechanie; gdyby hover zadziałał, biały na `destructive/90` ma tylko 3,43:1 |
| T8 | D | `global.css:72-73` (`--border` 10%, `--input` 15%) | Obramowanie pola `border-input` ma 1,57:1 wobec `card` i 1,61:1 wobec wypełnienia pola (WCAG 1.4.11 wymaga 3:1 dla granicy kontrolki); przed zmianą `white/20` — 1,90:1 | `--input` o wyższej jasności w `.dark` (odstępstwo od presetu, komentarz w miejscu) — albo świadome przyjęcie wartości shadcn | Pole tekstowe na karcie odróżnia się od tła głównie etykietą i placeholderem; nie jest to regres względem stanu dziś |
| T9 | D | `input.tsx` z rejestru (kopia w scratchpadzie, linie 11-12) | `focus-visible:ring-ring/50` i `aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40` ustawiają ten sam `ring-color`; reguła `aria-invalid` stoi w CSS później, więc pole błędne z fokusem ma pierścień `destructive/40` = 1,98:1 na `card` | Wzmocnić pierścień błędu w lokalnym `FormField` (np. `aria-invalid:focus-visible:ring-ring/50`) albo przyjąć, że obramowanie `destructive` (6,19:1) niesie stan, a pierścień fokusu słabnie | Użytkownik klawiatury po błędzie walidacji słabo widzi, że fokus stoi w błędnym polu |

### Kategoria 2 — brakujący wspólny komponent

| # | Prio | Plik:linia | Duplikat | Komponent, który zastępuje | Skutek dla użytkownika |
| --- | --- | --- | --- | --- | --- |
| K1 | **R** | `FormField.tsx:5-6`, `:37-55`, `:58-62` | Ręczne `<label>` + `<input>` z własnymi stanami fokus/błąd; komunikat błędu bez `id`, pole bez `aria-invalid` i `aria-describedby` | `npx shadcn add input label` + rytuał; `FormField` zostaje **lokalnym kompozytem** (ikona po lewej, `endContent`, `hint`/`error` z `id`, `aria-invalid={!!error}`, `aria-describedby`) — shadcn `Input` nie ma slotu na ikonę | Czytnik ekranu nie ogłasza błędu przy polu; S-03 (pierwszy nowy formularz, `lessons.md:21`) nie ma dziś z czego zbudować pola zgodnie z kontraktem |
| K2 | **R** (z T2) | `SubmitButton.tsx:18-34` | `Button` z nadpisanym kolorem, kształtem (`rounded-lg px-4 py-2`) i ręcznym spinnerem | Zostaje **lokalny** (logika `pending` + tekst oczekiwania), bez nadpisań koloru i kształtu; `useFormStatus()` do usunięcia lub do decyzji — patrz A1 | Wygląd głównej akcji rozjeżdża się z każdym innym `Button` |
| K3 | D | `ServerError.tsx:7-16` | Ręczna ramka błędu bez `role="alert"` | `npx shadcn add alert` (bez nowych zależności poza rytuałem; `role="alert"` wbudowany, kopia rejestru `alert.tsx:29`); ewentualnie cienki wrapper zachowujący semantykę `message == null → nic`. Treść w `AlertDescription`, nie w `AlertTitle` (`line-clamp-1` ucina długi komunikat, kopia `alert.tsx:41`) | Komunikat z `?error=` nie jest ogłaszany jako alert |
| K4 | D | `PasswordToggle.tsx:10-17` | `<button>` z literałami; fokus tylko globalny `outline-ring/50` (`global.css:156`), jak link Banera przed F1 z ui-offer-card | Zostaje **lokalny**, zbudowany na `Button variant="ghost" size="icon"` (pierścień 3 px z `button.tsx:8`); `aria-pressed={visible}` | Fokus na przełączniku hasła cieńszy i inny niż na każdej innej kontrolce |
| K5 | D | `dashboard.astro:22-29` | Drugi przycisk wylogowania z literałów obok (przyszłego) Topbara | Usunąć — Topbar ma „Wyloguj” (`Topbar.astro:19-23`) po przejściu na `AppLayout` (A3) | Dwa różne przyciski wylogowania na jednym ekranie |
| K6 | D | `Welcome.astro:40-104` | Trzy ręczne karty `rounded-xl border bg-white/5 p-6 backdrop-blur-xl` | `Card` (`src/components/ui/card.tsx`) — o ile karty zostają (A2) | Jak T1 |

**Mapowanie komponentów formularza (pytanie 2)**:

| Dziś | Po migracji | Nowe zależności |
| --- | --- | --- |
| `FormField` | lokalny kompozyt na `Label` + `Input` (+ ikona, `endContent`, `hint`, błąd z `id`) | `input`: brak; `label`: **`@radix-ui/react-label`** (CLI dokłada parasolowe `radix-ui`, które rytuał usuwa) — albo `label.tsx` przepisany na natywny `<label>` z klasami rejestru |
| `PasswordToggle` | lokalny, na `Button variant="ghost" size="icon"` | brak |
| `SubmitButton` | lokalny, na `Button` default bez nadpisań; spinner z tokenów | brak |
| `ServerError` | `Alert variant="destructive"` + `AlertDescription` (ew. cienki wrapper) | brak |

`shadcn add input label alert -y` (CLI 4.21.0, kopia w scratchpadzie) utworzył 3 pliki. Każdy importuje `cn` z `"cn"`. `label.tsx:3` importuje `Label` z `"radix-ui"`. CLI dopisał `cn@^0.4.0` i `radix-ui@^1.6.7`, a `global.css` zostawił bez zmian. Pułapka jest ta sama co w ui-offer-card, a rytuał z `CLAUDE.md` `### UI` trzeba rozszerzyć o `Label`. `node_modules/@radix-ui/` zawiera dziś tylko `react-slot` i `react-compose-refs`.

Po migracji komponenty formularza przestają być pułapką z `lessons.md:23`. Nadal jednak leżą w `src/components/auth/`, a importuje je formularz ofert (`AddOfferForm.tsx:3-5`), więc S-03 szukałby ich w folderze logowania (A7).

### Kategoria 3 — przypadkowa architektura

| # | Prio | Ścieżka | Co jest | Co widzi użytkownik | Poprawka w punkcie wejścia |
| --- | --- | --- | --- | --- | --- |
| A1 | **R** | `SubmitButton.tsx:9`, `:14-15`; `SignInForm.tsx:82`; wzorzec `AddOfferForm.tsx:14-25`, `:33`, `:54` | `SignInForm` polega na `useFormStatus()`, który przy natywnym POST-cie na string `action` nigdy nie zgłasza `pending` (komentarz w `SubmitButton.tsx:9`; ustalenie `context/archive/2026-09-22-paste-listing-to-card/plan.md:270`); `AddOfferForm` ma własny `submitting` + `pageshow`, `SignInForm` nie | Po „Sign in” brak reakcji do czasu przeładowania; przycisk nie blokuje się | Ten sam mechanizm co w `AddOfferForm` (stan `submitting` + `pageshow`) dla obu formularzy — np. przeniesiony do wspólnego hooka lub do `SubmitButton`; `useFormStatus()` przestaje mieć konsumenta |
| A2 | **R** | `signin.ts:25` → `index.astro:6-8` → `Welcome.astro:18`, `:29-34`, `:56`, `:79`, `:101` | Sukces logowania przekierowuje na stronę startera; hero zawsze pokazuje „Sign In” (brak gałęzi dla zalogowanego); karty „Authentication Ready / Modern Stack / Developer Experience” opisują szablon, nie produkt | Zalogowany członek zespołu widzi zaproszenie do logowania i reklamę narzędzi deweloperskich (zrzut `before-home.png`) | Decyzja w planie: przekierowanie po logowaniu na `/dashboard` (smoke asertuje dziś `location: "/"` kroku logowania, `scripts/smoke.mjs:91-95` — zmiana celu wymaga zmiany smoke, reguła `CLAUDE.md` `## Testing`) i/lub CTA zależne od `Astro.locals.user` |
| A3 | **R** | `dashboard.astro:9-31` | `Layout` zamiast `AppLayout`: brak Topbara, własne tło i centrowanie, „Welcome, e-mail” (dubluje e-mail z Topbara), „This page is only for authenticated users.” (tekst startera), drugi „Sign out” (K5), nagłówek „Dashboard” przy linku „Oferty” w Topbarze | Przejście karta → „Oferty” gubi pasek nawigacji; ekran opisuje sam siebie zamiast akcji | `AppLayout` (jak `[id].astro:40`); `?error=` w slocie `notice` albo w `Alert` przy formularzu; nagłówek zgodny z nawigacją — zależność od S-06 zapisana w `roadmap.md:160` |
| A4 | D | `index.astro:6`, `Welcome.astro:5-18` | Strona główna renderuje własną ramę (tło, orby, Topbar w środku `Welcome`) zamiast `AppLayout` | Topbar na `/` stoi na innym tle i w innym kontenerze niż na karcie | `AppLayout` dla `/`; orby i pole gwiazd (`Welcome.astro:7-15`) znikają razem z `bg-cosmic` |
| A5 | D (decyzja) | `Layout.astro:11` (`lang = "en"` domyślnie); `signin.astro:8-15`; `SignInForm.tsx:21-27`, `:47`, `:53`, `:60`, `:67`, `:82-83`; `PasswordToggle.tsx:14`; `signin.ts:10`, `:17`, `:22`; `dashboard.astro:9-28`; `Welcome.astro:22-103` | Angielskie: ekran logowania, walidacja, `aria-label` przełącznika, komunikaty trasy (w tym surowe `error.message` z Supabase, `signin.ts:22`), dashboard, hero. Polskie: Topbar, `AppLayout` (`lang="pl"`), karta, `AddOfferForm`, komunikaty `/api/offers` | Na dashboardzie w jednym panelu „Dashboard / Welcome / Sign out” obok „Adres ogłoszenia / Dodaj ofertę”; czytnik ekranu czyta polski formularz z `lang="en"` | Decyzja w planie (patrz Open Questions 1). Przy polskim: także mapowanie `error.message` z Supabase na polskie komunikaty w `signin.ts` (kontrakt `?error=` bez zmian, smoke sprawdza tylko prefiks `locationPrefix`) |
| A6 | D | `signin.astro:5`, `:14`; `dashboard.astro:6`, `:20`; `ServerError.tsx:13` | `?error=` jest renderowany dosłownie — React escapuje HTML, ale dowolny tekst z linku trafia do czerwonej ramki błędu | Link `…/auth/signin?error=Twoje konto zablokowane, zadzwoń pod…` wygląda jak komunikat aplikacji (content spoofing; zespół 3 osób, ryzyko niskie) | Odłożyć albo ograniczyć do znanych kodów (`?error=<kod>` → komunikat w aplikacji) — to zmiana kontraktu tras (`CLAUDE.md` `## Conventions`, smoke), nie UI |
| A7 | D | `AddOfferForm.tsx:3-5` | Formularz ofert importuje wspólne pola z `src/components/auth/` | Brak widocznego skutku; S-03 i następne formularze szukają pól w folderze logowania | Przenieść kompozyty formularza do neutralnego folderu (np. `src/components/form/`) przy migracji i przepiąć `lessons.md:23` (pułapka przestaje obowiązywać) |
| A8 | D | `signin.ts:22` → `signin.astro:5`; `api/offers.ts:44` → `dashboard.astro:6` | Błąd serwera wraca przekierowaniem, pole startuje puste (`useState("")`, `SignInForm.tsx:13`, `AddOfferForm.tsx:12`) | Po złym haśle trzeba przepisać e-mail; po odmowie pobrania — wkleić URL ponownie | Opcjonalnie: e-mail/URL z powrotem w query albo `sessionStorage`; poza zakresem wizualnym — odłożyć |
| A9 | O | `middleware.ts:18-21`, `src/pages/auth/signin.astro` | Zalogowany na `/auth/signin` widzi formularz; wylogowany na `/dashboard` dostaje 302 bez `?next=` i bez komunikatu | Po wejściu z linku do chronionej strony i zalogowaniu użytkownik nie wraca tam, gdzie chciał | Odłożone: logika auth (S-01), nie UI |
| A10 | O | `Welcome.astro:22`, `:56`, `:79`, `:101` | `h1` → `h3` bez `h2` | Nawigacja po nagłówkach w czytniku ekranu przeskakuje poziom | Znika, jeśli karty startera znikną (A2); inaczej `h2` |

**Wejścia sprawdzone (pytanie 4)**, zero-config i z sesją:
- Wylogowany na `/` widzi `Layout` → `Welcome`: Topbar „Nie zalogowano / Zaloguj” (`Topbar.astro:27-32`), hero z „Sign In” i karty startera. Baner braku konfiguracji stoi nad całością (`Layout.astro:23-36`).
- Wylogowany na `/dashboard` dostaje 302 na `/auth/signin` (`middleware.ts:4`, `:18-21`; smoke `scripts/smoke.mjs:62`), bez informacji, dlaczego tam trafił.
- `/auth/signin?error=…` renderuje `ServerError` z tekstem z URL-a pod polem hasła (`SignInForm.tsx:80`). Bez Supabase wysłanie formularza wraca z `?error=Supabase is not configured` (`signin.ts:16-18`), więc ścieżka zero-config działa i nie daje 500.
- Z sesją `/auth/signin` renderuje formularz bez przekierowania (A9).

**Rama dla widoków (pytanie 4)**: dashboard → `AppLayout` (A3), `/` → `AppLayout` (A4), signin → zostaje na `Layout` z wyśrodkowanym `Card`. `AppLayout` renderuje Topbar bez warunku (`AppLayout.astro:19`), więc niezalogowany na `/auth/signin` widziałby link „Zaloguj” do bieżącej strony. `body` ma już `bg-background` z `@layer base` (`global.css:158-160`), więc signin potrzebuje tylko wyrzucenia `bg-cosmic`. Parametr `lang` przychodzi z `Layout` (`Layout.astro:8`, `:11`) i zależy od decyzji A5.

## Macierz 7 stanów (pytanie 3)

Legenda: **jest** = osiągalny w kodzie dziś; **brak** = powinien istnieć, nie istnieje; **n/d** = nie dotyczy (z uzasadnieniem).

| Stan | `SignInForm` | `AddOfferForm` |
| --- | --- | --- |
| default | **jest** — pola z placeholderem, ikony (`SignInForm.tsx:44-78`; zrzut `before-signin.png`) | **jest** — `AddOfferForm.tsx:38-50` (zrzut `before-dashboard.png`) |
| hover | **jest** dla przycisku (`SubmitButton.tsx:21`, literał) i przełącznika (`PasswordToggle.tsx:13`, literał); pola: **n/d** — `Input` z rejestru nie ma hovera | **jest** dla przycisku; pole: **n/d** |
| focus | **jest** na polach, ale literałem (`FormField.tsx:6`, `:53` — `focus:ring-purple-400`); przycisk z tokenu (`button.tsx:8`); przełącznik tylko globalny outline (`global.css:156`, K4) | **jest**, jak obok (bez przełącznika) |
| disabled | **brak** — przycisk blokuje się tylko przy `pending`, którego `SignInForm` nie dostarcza (A1); pola nigdy nie są `disabled` | **jest** dla przycisku w trakcie wysyłki (`AddOfferForm.tsx:33`, `:54` → `SubmitButton.tsx:20`); pole edytowalne w trakcie (n/d — nie szkodzi, POST już wysłany) |
| error | **jest, bez a11y** — walidacja klienta (`SignInForm.tsx:18-30`) w `FormField.tsx:58-62` bez `aria-invalid`/`aria-describedby`; błąd serwera z `?error=` w `ServerError` bez `role="alert"` (`signin.astro:5`, `:14`) | **jest, bez a11y** — pusty URL (`AddOfferForm.tsx:28-31`), serwer przez `?error=` (`dashboard.astro:6`, `:20`; komunikaty `api/offers.ts:44-97`) |
| empty | **jest** jako ścieżka walidacji: wysłanie pustego formularza → „Email is required” / „Password is required” (`SignInForm.tsx:20-27`); pusty formularz sam w sobie = default | **jest**: pusty URL → „Wklej adres ogłoszenia z otodom.pl” (`AddOfferForm.tsx:28-31`) |
| loading | **brak** — `pendingText="Signing in..."` (`SignInForm.tsx:82`) nieosiągalny (A1) | **jest** — spinner + „Pobieram ogłoszenie…” (`SubmitButton.tsx:23-27`, `AddOfferForm.tsx:54`); trwa do 45 s (timeout pobrania, archiwum `paste-listing-to-card/plan.md:244`) |

**Konsekwencje dla kitchen sinka** (to wymagania do planu, nie zarzuty):
- `SignInForm` przyjmuje tylko `serverError` (`SignInForm.tsx:8-10`), a `AddOfferForm` tylko `serverError` (`AddOfferForm.tsx:7-9`). Błąd pola, `disabled` i `loading` żyją w `useState`, więc strona dev nie wyrenderuje ich z propsów. Plan musi wybrać: kitchen sink składa stany z lokalnych kompozytów (`FormField` z `error`, `SubmitButton` z `pending`) albo formularze dostają opcjonalne propsy stanu początkowego.
- `scripts/ui-screenshots.mjs` osiąga fokus prawdziwymi naciśnięciami Tab (`:28`, `:206-210`). Hovera nie wymusza (brak `CSS.forcePseudoState` i ruchu myszy w skrypcie). Stan hover w bramce wymaga rozszerzenia narzędzia albo zostaje stanem sprawdzanym ręcznie. To trzeba nazwać w planie.
- Strona dev: `/dev/offer-card` jest wzorcem (404 poza `astro dev`, smoke `scripts/smoke.mjs:5`). Nowa strona formularzy potrzebuje tego samego kroku 404 w smoke (`CLAUDE.md` `## Testing`: zmiana powierzchni tras → smoke).

## Detailed Findings

### Literały w plikach z `ignores` (pytanie 1)

Regex `COLOUR_LITERAL` z `eslint.config.js:76-77` uruchomiony linia po linii (liczba linii z trafieniem): `Welcome.astro` 19, `dashboard.astro` 7, `FormField.tsx` 5, `signin.astro` 4, `SubmitButton.tsx` 2, `PasswordToggle.tsx` 1, `ServerError.tsx` 1, `button.tsx` 1, `badge.tsx` 1 — razem 41. `SignInForm.tsx`, `AddOfferForm.tsx`: 0. Mapowanie literał → token: tabele T1–T6.

**Czego lint nie złapie po zdjęciu plików z listy** (inspekcja tych samych plików szerszym wzorcem):
- `Welcome.astro:14`: pole gwiazd z `rgba(255,255,255,…)` w atrybucie `style`. Regex działa na nazwach klas, a ten string nie zawiera żadnej.
- `Welcome.astro:7-9`: `blur-[120px]`/`[100px]`/`[140px]` (filtr, nie `backdrop-blur`), więc regex łapie w tych liniach tylko `bg-purple-500/20` itd.
- `SubmitButton.tsx:25`: `border-t-white`. Regex zna `border-`, ale nie `border-t-`/`border-x-`, a w tej linii łapie tylko sąsiednie `border-white/30`.

Wniosek dla kryterium „gotowe” z `change.md`: pusta lista `ignores` nie gwarantuje braku literałów. Plan potrzebuje grepa uzupełniającego (`rgba(`, `#hex`, `blur-[`, `border-[trblxy]-`) albo rozszerzenia regexu. Rozszerzenie regexu to zmiana reguły dotykająca całego `src/`, a nie tylko migrowanych plików.

`@utility bg-cosmic` (`global.css:150-152`) ma dziś dokładnie trzech konsumentów: `signin.astro:9`, `dashboard.astro:10`, `Welcome.astro:5` (grep `src/`). Po migracji utility można usunąć bez skutków ubocznych.

### Kontrast `destructive` i pól w `.dark` (pytanie 1)

Źródło wartości: `global.css:55-101`. Skrypt w scratchpadzie (`contrast.mjs`) liczy oklch → sRGB, alfę nakłada w sRGB (jak przeglądarka) i zwraca wynik wg WCAG 2. To szacunek bez renderu.

| Para (`.dark`) | na `card` | na `background` | Próg |
| --- | --- | --- | --- |
| biały na `destructive/60` (wariant przycisku/badge dziś) | 6,03 | 6,48 | 4,5 ✅ |
| `oklch(0.985 0 0)` na `destructive/60` (proponowany `--destructive-foreground`) | 5,77 | 6,20 | 4,5 ✅ |
| biały na `destructive/90` (gdyby hover działał) | 3,43 | 3,48 | 4,5 ❌ |
| biały na `destructive` 100% | 2,89 | 2,89 | 4,5 ❌ |
| `text-destructive` (błąd pola) | 6,19 | 6,84 | 4,5 ✅ |
| `text-destructive/90` (`AlertDescription`) | 5,22 | 5,68 | 4,5 ✅ |
| `text-destructive` na `destructive/15` (Baner `error`) | 5,05 | 5,76 | 4,5 ✅ |
| `muted-foreground` (etykiety pomocnicze) | 6,91 | 7,63 | 4,5 ✅ |
| placeholder `muted-foreground` na wypełnieniu `input/30` | 6,17 | 7,04 | 4,5 ✅ |
| obramowanie `border-input` (15%) wobec tła | 1,57 | 1,47 | 3 ❌ (T8) |
| pierścień `ring/50` | 3,95 | 3,99 | 3 ✅ |
| pierścień `destructive/40` (fokus na polu błędnym) | 1,98 | 1,95 | 3 ❌ (T9) |
| `primary-foreground` na `primary` (przycisk po migracji) | 6,97 | — | 4,5 ✅ |

Przed migracją, dla porównania (`white/10` na `#0f1529`): `text-red-300` 7,18; placeholder i ikony `white/40` 3,05; biały na `purple-600` 5,53; obramowanie `white/20` 1,90.

Jasny `:root` sprawdzony tylko dla jednej pary: biały na `destructive` `oklch(0.577 0.245 27.325)` = 4,76:1. Jasny motyw nie jest renderowany (`Layout.astro:15`, ciemny jedyny), więc wartość `:root` nowego tokenu wystarczy uzasadnić komentarzem.

**Odpowiedź**: w `.dark` kontrast nie wymusza `--destructive-foreground`, bo biały na `destructive/60` przechodzi. Para jest potrzebna z dwóch innych powodów. Pierwszy to lint: `text-white` trzyma `button.tsx` i `badge.tsx` na liście `ignores`, a `change.md` wymaga pustej listy. Drugi to reguła z `lessons.md:23` („nowy token roli z parą `-foreground` i ≥4,5:1”). Wartość `oklch(0.985 0 0)` (= `--foreground`) spełnia próg w `.dark` z zapasem.

### Kolejność wariantów w CSS (T7, T9)

Kompilacja Tailwinda (`tailwindcss` z `node_modules`, `@custom-variant dark (&:is(.dark *))` jak `global.css:5`) dla klas z `button.tsx:14` i kopii `input.tsx:11-12` daje pozycje w wyjściu: `hover:bg-destructive` 116 < `dark:bg-destructive` 864; `focus-visible:ring-ring` 399 < `aria-invalid:ring-destructive` 618 < `dark:aria-invalid:ring-destructive` 1093. Przy równej specyficzności (`.x:hover` i `.x:is(.dark *)` mają po 0,2,0) wygrywa reguła późniejsza. Stąd wnioski T7 i T9. W przeglądarce tego nie sprawdzono, więc potwierdzi to dopiero zrzut kitchen sinka.

### Język (pytanie 4, A5)

- `context/archive/2026-09-21-closed-team-sign-in/plan.md:76`: „UI pozostaje po angielsku”, w kontrakcie tekstów S-01 (Topbar, Welcome, `/auth/signin`). Wtedy dotyczyło to całego UI, bo polskiego jeszcze nie było.
- `context/archive/2026-09-23-ui-offer-card/plan.md` (Key Discoveries i „What We're NOT Doing”): polski Topbar „wszędzie”, a hero Welcome i `Layout` `lang="en"` zostają po angielsku „do czasu odłożonej migracji”. Mieszanie języków nazwano tam świadomie jako stan przejściowy.
- `context/foundation/prd.md`: grep `language|English|Polish|polsk|angiel` nie znajduje wymagania o języku UI. Są tylko wzmianki o polskiej terminologii ogłoszeń w audycie (`:47`, `:98`, `:122`).
- Smoke sprawdza statusy i `Location` (dokładne lub prefiks, `scripts/smoke.mjs:62-124`), nie treść stron, więc zmiana tekstów go nie zepsuje.

## Code References

- `eslint.config.js:76-77` — `COLOUR_LITERAL`; `:82-94` — lista `ignores`; `:91` — uzasadnienie `button`/`badge`
- `src/pages/auth/signin.astro:5`, `:8-17` — `?error=`, rama z `bg-cosmic`/blur/gradient
- `src/pages/dashboard.astro:9-31` — `Layout`, powitanie, formularz, drugi „Sign out”
- `src/components/Welcome.astro:5-15` — tło, orby, pole gwiazd (`style` z `rgba`); `:18` — Topbar; `:29-34` — CTA „Sign In”; `:39-106` — karty startera
- `src/components/auth/FormField.tsx:5-6`, `:37-62` — pole ręczne, błąd bez powiązań a11y
- `src/components/auth/SubmitButton.tsx:9`, `:14-15`, `:21`, `:25` — `useFormStatus`, nadpisanie koloru, spinner
- `src/components/auth/PasswordToggle.tsx:10-17`; `ServerError.tsx:10-15`
- `src/components/auth/SignInForm.tsx:13-16`, `:18-30`, `:80-84` — stan lokalny, walidacja, brak `pending`
- `src/components/offers/AddOfferForm.tsx:3-5`, `:14-25`, `:33`, `:54` — importy z `auth/`, `submitting` + `pageshow`
- `src/components/ui/button.tsx:8`, `:14`; `badge.tsx:14` — pierścień fokusu, `destructive` z `text-white`
- `src/layouts/Layout.astro:11`, `:15`; `AppLayout.astro:16-27` — `lang`, `class="dark"`, rama ze slotem `notice`
- `src/components/Topbar.astro:12-33` — gałęzie zalogowany/niezalogowany
- `src/middleware.ts:4`, `:18-21`; `src/pages/api/auth/signin.ts:10`, `:17`, `:22`, `:25`
- `src/styles/global.css:55-101` (`.dark`), `:150-152` (`bg-cosmic`), `:154-163` (`@layer base`)
- `scripts/ui-screenshots.mjs:28`, `:38-61`, `:206-210` — zestawy zrzutów, fokus przez Tab
- `scripts/smoke.mjs:62`, `:72-79`, `:92-96`, `:123-124` — kroki auth/dashboard

## Architecture Insights

- Kontrakt z ui-offer-card jest kompletny i działa: tokeny, `AppLayout`, `Card`/`Badge`, reguła lintu, bramka `/dev/offer-card`. Ta zmiana niczego nie projektuje od nowa. Jedyne nowe elementy kontraktu to `--destructive-foreground` (T6), ewentualnie mocniejszy `--input` (T8) i rozszerzenie rytuału o `Label` (K1).
- Formularze to druga warstwa komponentów po karcie. Ich pierwszy nowy konsument to S-03 (`lessons.md:21`), więc wzorzec powstający tutaj (lokalny `FormField` na `Input`/`Label`, `SubmitButton` z działającym `pending`, `Alert` dla `?error=`) będzie kopiowany. Z tego powodu A1 i K1 są rdzeniowe, choć jeden ekran logowania „działa”.
- Dwa zarzuty rdzeniowe (A1, A2) nie są wizualne w wąskim sensie. To zachowanie przycisku i cel przekierowania. `/10x-ui` każe je nazwać, bo to kategoria „accidental architecture”. Nie każe jednak ich naprawiać w zmianie wizualnej, więc plan może przenieść A2 do osobnej decyzji.
- Widoczna zmiana charakteru: jak przy karcie, granat `bg-cosmic` i fioletowe akcenty ustąpią neutralnemu `oklch(0.145 0 0)` z cyan. Ekran logowania straci „kosmiczny” wygląd. To zgodne z presetem, ale warto to nazwać przed zrzutem.

## Historical Context (from prior changes)

- `context/archive/2026-09-23-ui-offer-card/research.md`, tabela „Odłożone”: wszystkie jej wiersze pokrywają się z tym audytem i nadal obowiązują. Wiersz `FormField`/`PasswordToggle`/`ServerError` („linie z trafieniem: 5, 1, 1”) zgadza się z dzisiejszym wynikiem. Uwaga „po włączeniu `.dark` `SubmitButton` … do sprawdzenia screenshotem” jest rozstrzygnięta: `SubmitButton` nadal jest fioletowy (zrzut `before-signin.png`, zgodnie z kryterium 2.5 archiwalnego planu).
- `context/archive/2026-09-23-ui-offer-card/plan.md`, „What We're NOT Doing”: tamta zmiana odłożyła signin, dashboard, stronę główną, drugi „Sign out” i `SubmitButton.tsx:21`. Ta zmiana zamyka ten dług w całości, zgodnie z `change.md`.
- `context/archive/2026-09-23-ui-offer-card/reviews/impl-review.md`: F1 (link Banera bez pierścienia 3 px) to ten sam wzorzec co K4 (`PasswordToggle`). F6 (`badge` `link` na `text-primary`) naprawione, dziś `badge.tsx:17` = `text-link`. F2 (napis „Oferty” prowadzi na formularz) jest zapisany w `roadmap.md:160` i wpływa na nagłówek dashboardu (A3).
- `context/archive/2026-09-22-paste-listing-to-card/plan.md:270`: tam ustalono, że `useFormStatus()` nie zgłasza `pending` dla natywnego POST-a. `AddOfferForm` dostał obejście, a `SignInForm` celowo „nie jest w tej zmianie dotykany”. A1 to niedomknięta konsekwencja tamtej decyzji, nie nowy błąd.
- `context/archive/2026-09-21-closed-team-sign-in/plan.md:76`: „UI pozostaje po angielsku”. Ocena: nadal prawdziwe dla signin, ale od ui-offer-card już nie dla ramy (A5).
- `context/foundation/lessons.md:19-24`: reguła tokenów i pułapka „nie reużywać `FormField`/`SubmitButton`/`PasswordToggle`/`ServerError`, dopóki są na liście `ignores`”. Po tej zmianie pułapka traci przedmiot i wpis trzeba zaktualizować, bo rejestr jest append-only, więc chodzi o nowy wpis albo dopisek, a nie edycję.

## Related Research

- `context/archive/2026-09-23-ui-offer-card/research.md`: audyt karty, preset `b1s91W2me`, pułapki `shadcn add`.

## Open Questions

Decyzje dla `/10x-plan` (nierozstrzygane tutaj):

1. **Język ekranów (A5)**: polski wszędzie (`lang="pl"` domyślnie w `Layout`, tłumaczenie signin/dashboard/Welcome, mapowanie `error.message` z Supabase w `signin.ts:22`) czy angielski signin zgodnie z S-01? Za polskim przemawia to, że rama, karta, formularz ofert i komunikaty `/api/offers` już są po polsku. PRD tego nie rozstrzyga.
2. **Strona główna (A2, A4)**: po co jest `/`? Opcje: przekierowanie zalogowanego na `/dashboard`, hero z CTA zależnym od sesji, albo `signin.ts:25` → `/dashboard` (wtedy także krok smoke `scripts/smoke.mjs:91-95`, który dziś oczekuje `location: "/"`). Karty startera („Modern Stack”, „Developer Experience”) opisują szablon. Czy zostają z nową treścią, czy znikają?
3. **`label` (K1)**: `@radix-ui/react-label` jako nowa zależność (rozszerza rytuał w `CLAUDE.md` `### UI`) czy `label.tsx` na natywnym `<label>`?
4. **Stan ładowania (A1)**: wspólny mechanizm `submitting` + `pageshow` (hook albo `SubmitButton`) i usunięcie `useFormStatus()`, czy obejście skopiowane do `SignInForm`?
5. **Kitchen sink formularzy**: stany z propsów formularzy czy z lokalnych kompozytów; hover w bramce (rozszerzenie `scripts/ui-screenshots.mjs` o `CSS.forcePseudoState` albo stan sprawdzany ręcznie).
6. **Luki lintu**: grep uzupełniający w kryteriach planu czy rozszerzenie `COLOUR_LITERAL` o `border-[trblxy]-`, `rgba(` w `style`, `blur-[`? To drugie jest zmianą reguły dla całego `src/`.
7. **`--input` (T8)** i pierścień pola błędnego (T9): odstępstwo od presetu czy świadome przyjęcie wartości shadcn?
8. **Umiejscowienie komponentów formularza (A7)**: przenieść z `src/components/auth/` przy migracji czy zostawić?
9. **A6/A8/A9** proponuję odłożyć jako logikę tras/auth. Plan powinien je wpisać do „What We're NOT Doing”, żeby nie zniknęły.
