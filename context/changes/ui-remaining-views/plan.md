# Pozostałe widoki i formularze na tokenach — plan implementacji

## Overview

Logowanie, dashboard i strona główna oraz komponenty formularzy (`FormField`, `PasswordToggle`, `SubmitButton`, `ServerError`) przechodzą z literałów, `bg-cosmic` i `backdrop-blur` na kontrakt z `context/archive/2026-09-23-ui-offer-card/`: tokeny ról w `src/styles/global.css`, prymitywy z `src/components/ui`, rama `AppLayout`. Przy okazji zmiana domyka zarzuty architektoniczne, które widać na tych ekranach: brak stanu ładowania przy logowaniu (A1), stronę startera po zalogowaniu (A2), dashboard poza ramą (A3) i mieszankę angielskiego z polskim (A5). Koniec zmiany: lista `ignores` w `tokensOnlyConfig` jest pusta, `@utility bg-cosmic` nie istnieje, a `/dev/forms` pokazuje oba formularze we wszystkich nazwanych stanach.

## Current State Analysis

Pełny audyt: `context/changes/ui-remaining-views/research.md` (zarzuty T1–T9, K1–K6, A1–A10, macierz stanów, tabela kontrastów). Skrót:

- 41 linii z literałem koloru w 9 plikach z `ignores` (`eslint.config.js:82-94`). `button.tsx` i `badge.tsx` są na liście tylko przez `text-white` w wariancie `destructive` (`button.tsx:14`, `badge.tsx:14`), bo preset nie ma `--destructive-foreground` (T6).
- `FormField.tsx:5-62` to ręczne `<label>` i `<input>` z fioletowym fokusem. Błąd nie jest powiązany z polem: brak `aria-invalid`, `aria-describedby` i `id` komunikatu (K1). `SubmitButton.tsx:21` nadpisuje `Button` fioletem (T2/K2). `ServerError` nie ma `role="alert"` (K3). `PasswordToggle` ma tylko globalny outline (K4).
- `SignInForm` polega na `useFormStatus()` (`SubmitButton.tsx:14`), które przy natywnym POST-cie nigdy nie zgłasza `pending`. Po „Sign in” przycisk się nie zmienia (A1). `AddOfferForm.tsx:14-25` ma działające obejście (`submitting` + `pageshow`).
- `signin.ts:25` przekierowuje na `/`. Tam `Welcome.astro` pokazuje zalogowanemu „Sign In” i trzy karty reklamujące starter (A2). Dashboard renderuje się w `Layout` bez Topbara i ma drugi przycisk „Sign out” (A3, K5). `Layout.astro:11` ma domyślnie `lang="en"` (A5).
- `.dark` `--input` (15%) daje obramowanie pola 1,57:1 wobec `card` (T8). Pierścień fokusu pola z błędem ma 1,98:1, bo `dark:aria-invalid:ring-destructive/40` stoi w CSS po `focus-visible:ring-ring/50` (T9). W `.dark` `hover:bg-destructive/90` przegrywa z `dark:bg-destructive/60` (T7).
- Regex `COLOUR_LITERAL` (`eslint.config.js:76-77`) nie łapie `border-t-white` ani `rgba(`/hexów w atrybucie `style` (`Welcome.astro:14`).

## Desired End State

- Signin, dashboard i `/` nie zawierają literału koloru, `bg-cosmic` ani `backdrop-blur`. Lista `ignores` w `tokensOnlyConfig` jest pusta, a reguła łapie też `border-[trblxy]-<paleta>` i `rgba(`/hex w `style`. `npm run lint` przechodzi na całym `src/`.
- Formularze składają się z `src/components/form/` (`FormField` na `Input` + `Label`, `PasswordToggle` na `Button ghost icon`, `SubmitButton` na `Button` default, `ServerError` na `Alert destructive`) i ze wspólnego hooka stanu wysyłki. Pole z błędem ma `aria-invalid` i `aria-describedby` wskazujące na komunikat. Po kliknięciu „Zaloguj” przycisk się blokuje i pokazuje „Loguję…”.
- Całe UI jest po polsku: `Layout` ma domyślnie `lang="pl"`, a `signin.ts` mapuje błędy Supabase na polskie komunikaty. Kontrakt `?error=` się nie zmienia.
- Zalogowany na `/` dostaje 302 na `/dashboard`. Wylogowany widzi polski hero z CTA „Zaloguj” w `AppLayout`. Dashboard renderuje się w `AppLayout`, bez drugiego „Wyloguj”.
- `/dev/forms` (tylko `astro dev`, gdzie indziej 404) pokazuje macierz stanów. Zrzuty z `node scripts/ui-screenshots.mjs forms context/changes/ui-remaining-views/screenshots` są bramką.

Weryfikacja: automatyczne kontrole w każdej fazie, smoke na podglądzie produkcyjnym, bramka zrzutów `/dev/forms` przed review i ponownie po triażu `/10x-impl-review`.

### Key Discoveries:

- `return Astro.redirect()` we frontmatterze `.astro` to top-level `return`, który wywraca `@typescript-eslint/no-misused-promises` (CLAUDE.md `### Framework`). Przekierowanie zalogowanego z `/` trafia więc do `src/middleware.ts` (`:18-22` ma już ten wzorzec dla chronionych tras).
- `scripts/ui-screenshots.mjs:241-242` rzuca błąd, gdy strona przekieruje. Istniejące zestawy robią zrzut `/` z sesją (`before-home` `:41`, `after-p2-home` `:47`, `after-p3-home` `:53`), więc po A2 przestaną działać, jeśli `/` nie dostanie `auth: false`. `signIn()` (`:98`) oczekuje `location: "/"`, co decyzja „signin nadal na `/`” zachowuje.
- Kontrast policzony (oklch → sRGB, alfa w sRGB, WCAG 2; skrypt `c.mjs` w scratchpadzie sesji planowania):
  - `--input` = `oklch(1 0 0 / 40%)`: obramowanie 3,82:1 na `card`, 3,77:1 na `background`; placeholder `muted-foreground` na wypełnieniu `input/30` 4,88:1.
  - Pierścień `destructive/70`: 3,62:1 na `card`, 3,80:1 na `background`. Dla porównania `/60` daje 2,97:1 (za mało), a dziś jest `/40` = 1,98:1.
  - `--destructive-foreground` = `oklch(0.985 0 0)` na `destructive/60`: 5,77:1 na `card` (research). Na `/50`, czyli ciemniejszym tle hovera, kontrast jest wyższy.
- `input.tsx` z rejestru ustawia `ring-color` dwiema regułami: `focus-visible:ring-ring/50` i `aria-invalid:ring-destructive/…`. Szerokość pierścienia pojawia się tylko przy `focus-visible`, więc alfa `aria-invalid` zmienia wyłącznie fokus na polu z błędem.
- Wariantu `outline` przycisku, jedynego poza `Input` konsumenta `--input`, nikt nie używa (grep `src/`). Zmiana `--input` dotyka więc tylko pól.
- Supabase: `AuthError` ma `error.code` (`invalid_credentials`, `email_not_confirmed`, `over_request_rate_limit`, `user_banned`), a dokumentacja każe rozgałęziać po `code` (Context7, `/supabase/supabase`, „handling-errors-in-supabase-js”). Błąd sieci, np. przy wstrzymanym projekcie (`deployment-runbook.md`), przychodzi jako `AuthRetryableFetchError` bez kodu z serwera.
- `/dev/offer-card` (`src/pages/dev/offer-card.astro:18-21`) to wzorzec strony dev: `import.meta.env.DEV`, `Astro.response.status = 404` poza dev, krok 404 w `scripts/smoke.mjs:64`.

## What We're NOT Doing

- **A6**: `?error=` nadal renderuje się dosłownie. Ograniczenie do znanych kodów to zmiana kontraktu tras i smoke, nie UI.
- **A8**: po błędzie serwera e-mail i URL nie wracają do pola. To zachowanie formularza poza zakresem wizualnym.
- **A9**: zalogowany na `/auth/signin` nadal widzi formularz. Wylogowany na chronionej trasie nadal dostaje 302 bez `?next=`. To logika auth (S-01).
- Bez zmiany celu przekierowania w `signin.ts` (zostaje `/`, dalej robi to middleware). Krok smoke logowania się nie zmienia.
- Bez `@radix-ui/react-label` i bez nowych zależności w `package.json`.
- Bez propsów dodanych do `SignInForm`/`AddOfferForm` tylko po to, żeby kitchen sink wyrenderował stan.
- Hover na polach tekstowych: nie dotyczy (prymityw `Input` go nie ma, a dodanie go to projektowanie, nie migracja).
- Bez tablicy ofert na `/dashboard` (S-06). Dashboard nadal ma tylko formularz dodawania. Rozjazd „Oferty” → formularz jest zapisany w `roadmap.md` (S-06, Risk).
- Bez jasnego motywu. Wartości `:root` nowych tokenów są uzasadnione komentarzem, bez renderu.
- `context/foundation/lessons.md:23` (pułapka „nie reużywać `FormField`/… z `src/components/auth`”) traci przedmiot. Plan tylko to odnotowuje, wpis zaktualizuje użytkownik przez `/10x-lesson` po zmianie.

## Implementation Approach

Kolejność z `/10x-ui`: najpierw biblioteka (prymitywy, kompozyty, hook), potem wartości w jednym źródle i reguła lintu, dopiero potem widoki, a na końcu stany i bramka. Każda faza kończy się zielonym `npm run lint`, `npx astro check` i `npm run build`. Plik schodzi z listy `ignores` w tej fazie, w której przestaje mieć literały, więc lista maleje z fazy na fazę i nic do niej nie dochodzi. Kitchen sink składa stany z tych samych kompozytów, których używają formularze (`src/components/form/`), a oba formularze pokazuje w stanie domyślnym. Tak strona dev renderuje dokładnie te pliki, które widzi użytkownik.

## Critical Implementation Details

- **Rytuał po `shadcn add`**: CLI generuje `import { cn } from "cn"`, dopisuje paczki `cn` i `radix-ui`, a `label.tsx` importuje `Label` z `"radix-ui"` (research, „Mapowanie komponentów formularza”). W tej samej fazie `label.tsx` zostaje przepisany na natywny `<label>` z klasami rejestru, obie paczki wypadają z `package.json`/`package-lock.json`, a `"use client"` jest usuwane, jeśli przyszło.
- **Niezacommitowane zmiany w drzewie** (`CLAUDE.md`, `README.md`, `scripts/ui-screenshots.mjs`: wymagany argument katalogu wyjściowego) należą do tej zmiany, bo każde polecenie zrzutów w planie z nich korzysta. Lądują w commicie fazy 1.
- **Stan `disabled` przycisku to render stanu `loading`**: `SubmitButton` blokuje się tylko w trakcie wysyłki (`disabled` + spinner + tekst oczekiwania, `disabled:opacity-50` z `Button`). Przygaszony przycisk w trakcie wysyłki jest nieaktywną kontrolką, więc próg 4,5:1 go nie obejmuje (WCAG 1.4.3). Tekst oczekiwania powtarza jednak zmianę stanu dla każdego, kto patrzy.

## Faza 1: Biblioteka formularzy

### Overview

Prymitywy `input`, `label` i `alert` z rytuałem. Kompozyty przeniesione do `src/components/form/` i przebudowane na prymitywach, z powiązaniem błędu z polem. Jeden hook stanu wysyłki dla obu formularzy i usunięcie `useFormStatus()`. Po tej fazie oba formularze mają stan ładowania, a cztery kompozyty schodzą z listy `ignores`.

### Changes Required:

#### 1. Prymitywy shadcn

**File**: `src/components/ui/input.tsx`, `src/components/ui/label.tsx`, `src/components/ui/alert.tsx`, `package.json`, `package-lock.json`

**Intent**: `npx shadcn add input label alert` daje formularzom prymitywy z kontraktu (K1, K3). Zaraz po nim idzie rytuał z CLAUDE.md `### UI`. `label.tsx` zostaje na natywnym `<label>` (decyzja 3).

**Contract**: trzy pliki w `src/components/ui/`, każdy z `cn` z `@/lib/utils`, bez `"use client"`. `Label` to `React.ComponentProps<"label">` z `data-slot="label"` i klasami rejestru, bez importu z `radix-ui`. `package.json` bez `cn` i `radix-ui`, czyli bez nowych zależności względem dziś.

#### 2. Hook stanu wysyłki

**File**: `src/components/form/use-pending-submit.ts` (nowy)

**Intent**: Jeden mechanizm `submitting` + `pageshow` (wzorzec `AddOfferForm.tsx:14-25`) dla obu formularzy (A1, decyzja 4). Formularz zgłasza wysyłkę dopiero po przejściu walidacji klienta, a powrót z bfcache odblokowuje przycisk.

**Contract**: `usePendingSubmit(): { pending: boolean; markPending: () => void }`. Nasłuch `pageshow` ustawia `pending = false` i jest sprzątany przy odmontowaniu. Plik kebab-case obok kompozytów, które obsługuje.

#### 3. Kompozyty w `src/components/form/`

**File**: `src/components/form/FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx`, `ServerError.tsx` (przeniesione z `src/components/auth/`, stare pliki usunięte)

**Intent**: Wspólne pola wychodzą z folderu logowania (A7, decyzja 8) i przestają nieść fiolet (T2–T5, K1–K4).
- `FormField` to `Label` + `Input` z ikoną po lewej (`text-muted-foreground`) i `endContent` po prawej.
- `PasswordToggle` stoi na `Button variant="ghost" size="icon"`, z polskim `aria-label` i `aria-pressed`.
- `SubmitButton` to `Button` default bez nadpisań koloru i kształtu, pełnej szerokości, ze spinnerem `Loader2 animate-spin` zamiast ręcznego obramowania.
- `ServerError` to cienki wrapper na `Alert variant="destructive"`: dla pustego `message` nic nie renderuje, treść stoi w `AlertDescription` (`AlertTitle` ucina tekst przez `line-clamp-1`).

**Contract**:
- `FormField`: props bez zmian (`id`, `name`, `label`, `type`, `value`, `onChange`, `placeholder`, `error`, `hint`, `icon`, `endContent`). Przy `error` pole dostaje `aria-invalid` i `aria-describedby="<id>-error"`, a komunikat ma `id="<id>-error"` i `text-destructive`.
- `SubmitButton`: `{ pending: boolean; pendingText: string; icon: ReactNode; children: ReactNode }`. `pending` jest wymagany, a import `useFormStatus` znika.
- `ServerError`: `{ message?: string | null }`.

#### 4. Formularze na nowych kompozytach

**File**: `src/components/auth/SignInForm.tsx`, `src/components/offers/AddOfferForm.tsx`

**Intent**: Oba formularze importują kompozyty z `@/components/form/*` i stan wysyłki z hooka. `SignInForm` zgłasza `markPending()` po udanej walidacji i przekazuje `pending` do `SubmitButton`. Tak A1 znika. Teksty `SignInForm` przechodzą na polski już tutaj, bo zmieniają się te same linie (A5):
- „E-mail”, „Hasło”;
- placeholdery „ty@przyklad.pl”, „Twoje hasło”;
- walidacja „Podaj adres e-mail”, „Podaj poprawny adres e-mail”, „Podaj hasło”;
- przycisk „Zaloguj”, oczekiwanie „Loguję…”.

**Contract**: publiczne propsy obu formularzy bez zmian (`serverError?: string | null`). `AddOfferForm` nie ma już własnego `useState`/`useEffect` dla `submitting`.

#### 5. Lista `ignores` i odwołania

**File**: `eslint.config.js`, `CLAUDE.md`

**Intent**: Cztery ścieżki `src/components/auth/{FormField,PasswordToggle,ServerError,SubmitButton}.tsx` znikają z `ignores`. Nowe pliki w `src/components/form/` nie są na liście, więc lint je sprawdza. CLAUDE.md `### UI` dostaje rytuał rozszerzony o `Label` (natywny `<label>`, bez `@radix-ui/react-label`). `## Conventions` wskazuje kompozyty w `src/components/form/` jako wzorzec, zamiast starych ścieżek `src/components/auth/FormField.tsx`, `PasswordToggle.tsx`, `SubmitButton.tsx` (decyzja 8).

**Contract**: `ignores` zawiera po tej fazie `signin.astro`, `dashboard.astro`, `Welcome.astro`, `button.tsx`, `badge.tsx`. W CLAUDE.md nie zostaje żadne odwołanie do `src/components/auth/FormField.tsx` ani do pozostałych przeniesionych plików.

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi, a pliki w `src/components/form/` nie są na liście `ignores`
- `npx astro sync && npx astro check` przechodzi bez błędów
- `npm run build` przechodzi
- `grep -rn "useFormStatus\|components/auth/\(FormField\|PasswordToggle\|SubmitButton\|ServerError\)" src CLAUDE.md` nie zwraca nic
- `git diff package.json` nie dodaje zależności (`cn`, `radix-ui`, `@radix-ui/react-label` nieobecne)
- `grep -rn "\"use client\"\|from \"cn\"\|from \"radix-ui\"" src/components/ui` nie zwraca nic

#### Manual Verification:

- Na `/auth/signin` (`npm run dev`) wysłanie pustego formularza pokazuje „Podaj adres e-mail” i „Podaj hasło”. W DevTools pole ma `aria-invalid="true"` i `aria-describedby` wskazujące na komunikat
- Wysłanie poprawnego formularza blokuje przycisk i pokazuje „Loguję…”. Po powrocie przyciskiem „Wstecz” przycisk jest znowu aktywny
- Na `/dashboard` „Dodaj ofertę” dalej pokazuje „Pobieram ogłoszenie…” w trakcie wysyłki

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne. Widoki mają w tej fazie jeszcze tło `bg-cosmic`, więc niespójny wygląd jest oczekiwanym stanem przejściowym.

---

## Faza 2: Tokeny i reguła lintu

### Overview

Brakujące wartości kontraktu w jednym źródle: `--destructive-foreground`, mocniejszy `--input` i dwie poprawki kolejności wariantów w prymitywach. Po tej fazie `button.tsx` i `badge.tsx` schodzą z `ignores`, a reguła lintu łapie literały, które dziś przepuszcza.

### Changes Required:

#### 1. Nowe i zmienione tokeny

**File**: `src/styles/global.css`

**Intent**: Para `destructive` dostaje `-foreground` (T6, reguła z `lessons.md:23`). `--input` w `.dark` jest mocniejszy, żeby obramowanie pola miało ≥3:1 wobec `card` i `background` (T8, decyzja 7). Każde odstępstwo od presetu dostaje komentarz w miejscu z wartością kontrastu, jak istniejące `--ring` i `--link`.

**Contract**:
- `--destructive-foreground` w `:root` i `.dark` = `oklch(0.985 0 0)` (5,77:1 na `destructive/60` nad `card` w `.dark`; w `:root` biały na `destructive` 4,76:1 — komentarz).
- `--color-destructive-foreground` w `@theme inline`.
- `.dark --input: oklch(1 0 0 / 40%)` (preset: 15%). Obramowanie 3,82:1 na `card`, 3,77:1 na `background`, placeholder na wypełnieniu 4,88:1. Implementujący sprawdza te trzy liczby tym samym sposobem liczenia, zanim zatwierdzi wartość.

#### 2. Wariant `destructive` na tokenie

**File**: `src/components/ui/button.tsx`, `src/components/ui/badge.tsx`

**Intent**: `text-white` → `text-destructive-foreground`, więc oba pliki schodzą z `ignores` (T6). W `button.tsx` hover działa w `.dark` (T7): `dark:hover:bg-destructive/50` stoi w CSS po `dark:bg-destructive/60`, a kontrast tekstu na ciemniejszym tle rośnie.

**Contract**: klasy wariantu `destructive` w obu `cva`, bez zmian API. Komentarz przy wariancie przycisku mówi, dlaczego hover jest w `dark:`.

#### 3. Pierścień fokusu pola z błędem

**File**: `src/components/ui/input.tsx`

**Intent**: Fokus na polu z błędem ma pierścień ≥3:1 (T9, decyzja 7). Poprawka siedzi w prymitywie, bo tam leży kolejność reguł, więc dotyczy każdego przyszłego pola.

**Contract**: `dark:aria-invalid:ring-destructive/40` → `dark:aria-invalid:ring-destructive/70` (3,62:1 na `card`) z komentarzem odstępstwa od rejestru. `aria-invalid:border-destructive` bez zmian.

#### 4. Szersza reguła lintu

**File**: `eslint.config.js`

**Intent**: Pusta lista `ignores` ma znaczyć brak literałów (decyzja 6). Regex dostaje prefiksy `border-t|r|b|l|x|y-<paleta>`, a nowy selektor łapie `rgba(` i hex w atrybucie `style` (w `.astro` i w obiekcie `style={{…}}` w JSX). `button.tsx` i `badge.tsx` wychodzą z `ignores`.

**Contract**: `COLOUR_LITERAL` z grupą prefiksów rozszerzoną o `border-[trblxy]`. Selektor `style` jest zawężony do atrybutu, bo hex w dowolnym stringu łapałby kotwice (`href="#add"`):

```js
// prefix group: …|border(?:-[trblxy])?|ring|…
const STYLE_COLOUR = "/rgba?\\(|#[0-9a-fA-F]{3,8}\\b/";
{ selector: `JSXAttribute[name.name="style"] Literal[value=${STYLE_COLOUR}]`, message: COLOUR_MESSAGE },
{ selector: `JSXAttribute[name.name="style"] TemplateElement[value.raw=${STYLE_COLOUR}]`, message: COLOUR_MESSAGE },
```

`ignores` po tej fazie: `signin.astro`, `dashboard.astro`, `Welcome.astro`. Komentarz `:91` znika razem z wpisami.

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi, a `ignores` zawiera dokładnie `signin.astro`, `dashboard.astro` i `Welcome.astro`
- Tymczasowy plik `src/__lint-probe.tsx` z `className="border-t-white"`, `style={{ color: "#fff" }}` i `style={{ background: "rgba(0,0,0,.5)" }}` daje w `npx eslint src/__lint-probe.tsx` 3 błędy `COLOUR_MESSAGE`. Plik usunięty po sprawdzeniu
- `npx astro check` przechodzi
- `npm run build` przechodzi
- `grep -n "destructive-foreground" src/styles/global.css` zwraca wpisy w `:root`, `.dark` i `@theme inline`

#### Manual Verification:

- Kontrast potwierdzony obliczeniem dla wartości z pliku: obramowanie `--input` ≥3:1 na `card` i `background`, placeholder na wypełnieniu ≥4,5:1, pierścień `destructive/70` ≥3:1, `destructive-foreground` na `destructive/60` i `/50` ≥4,5:1. Liczby wpisane w komentarze w `global.css` i `input.tsx`
- `/dev/offer-card` wygląda jak przed zmianą: `node scripts/ui-screenshots.mjs gate context/changes/ui-remaining-views/screenshots` i porównanie z `context/archive/2026-09-23-ui-offer-card/screenshots/gate-*.png`

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne.

---

## Faza 3: Widoki

### Overview

Trzy ekrany przechodzą na tokeny i polski. Dashboard i strona główna trafiają do `AppLayout`. Zalogowany na `/` jest przekierowywany na `/dashboard`. Lista `ignores` robi się pusta, a `bg-cosmic` znika z `global.css`.

### Changes Required:

#### 1. Język domyślny

**File**: `src/layouts/Layout.astro`, `src/layouts/AppLayout.astro`

**Intent**: `lang` domyślnie `"pl"` (A5, decyzja 1). `AppLayout` przestaje go przekazywać, bo wartość jest taka sama.

**Contract**: `Props.lang` zostaje opcjonalny, domyślnie `"pl"`.

#### 2. Logowanie

**File**: `src/pages/auth/signin.astro`

**Intent**: Zostaje na `Layout`, bo Topbar niezalogowanego linkowałby do bieżącej strony. Wyśrodkowany `Card` zamiast panelu z blurem i nagłówka-gradientu (T1). Treść:
- tytuł strony „Logowanie — Vetpad”;
- `h1` „Zaloguj się” w `text-foreground`;
- pod formularzem „Konta zakłada administrator zespołu.” w `text-muted-foreground`.

**Contract**: `?error=` przekazywany do `SignInForm` jak dziś. Plik wychodzi z `ignores`.

#### 3. Komunikaty trasy logowania

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Na `?error=` wraca polski komunikat zamiast surowego `error.message` z Supabase (A5, decyzja 1). Kontrakt przekierowań się nie zmienia.

**Contract**:

| Warunek | Komunikat |
| --- | --- |
| treść żądania nie jest formularzem | „Nieprawidłowe żądanie logowania.” |
| Supabase nie jest skonfigurowany | „Supabase nie jest skonfigurowany — logowanie jest wyłączone.” |
| `invalid_credentials` | „Nieprawidłowy e-mail lub hasło.” |
| `over_request_rate_limit` | „Zbyt wiele prób logowania. Spróbuj ponownie za kilka minut.” |
| `email_not_confirmed`, `user_banned` | „To konto jest nieaktywne. Skontaktuj się z administratorem zespołu.” |
| `isAuthRetryableFetchError(error)` | „Serwer logowania nie odpowiada. Spróbuj ponownie za chwilę.” |
| każdy inny błąd | „Nie udało się zalogować. Spróbuj ponownie.” |

Mapowanie to jedna funkcja w pliku trasy. Każda porażka dalej kończy się `302 /auth/signin?error=<encoded>`, a sukces `302 /`.

#### 4. Przekierowanie zalogowanego ze strony głównej

**File**: `src/middleware.ts`

**Intent**: Zalogowany na `/` dostaje 302 na `/dashboard` (A2, decyzja 2). Przekierowanie siedzi w middleware, bo `return Astro.redirect()` we frontmatterze łamie lint (Key Discoveries).

**Contract**: `context.url.pathname === "/" && context.locals.user` → `context.redirect("/dashboard")`. Przy braku Supabase `user` to `null`, więc wylogowany zawsze dostaje hero.

#### 5. Strona główna

**File**: `src/pages/index.astro`, `src/components/Welcome.astro`

**Intent**: `/` renderuje się w `AppLayout` (A4). `Welcome.astro` to tylko polski hero na tokenach (A2, K6 i A10 znikają razem z kartami startera), bez orbów, pola gwiazd i własnego Topbara. Treść hero:
- `h1` „Vetpad”;
- akapit „Wspólna tablica zespołu do sprawdzania ogłoszeń mieszkań: zapisujecie ofertę z otodom.pl, zlecacie jej audyt i dopisujecie notatki.” w `text-muted-foreground`;
- CTA „Zaloguj” jako `<a href="/auth/signin">` z `buttonVariants({ size: "lg" })`.

**Contract**: `index.astro` = `AppLayout title="Vetpad"` + `Welcome`. Plik `Welcome.astro` wychodzi z `ignores`.

#### 6. Dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: `AppLayout` jak `src/pages/offers/[id].astro` (A3). Topbar niesie e-mail i „Wyloguj”, więc powitanie, tekst startera i drugi przycisk wylogowania znikają (K5). Formularz stoi w `Card`:
- `h1` „Nowa oferta”;
- opis „Wklej adres ogłoszenia sprzedaży mieszkania z otodom.pl.”;
- `AddOfferForm` z `?error=` (błąd serwera w `ServerError` w formularzu, jak na logowaniu).

**Contract**: tytuł strony „Nowa oferta — Vetpad”. Plik wychodzi z `ignores`.

#### 7. Sprzątanie kontraktu

**File**: `eslint.config.js`, `src/styles/global.css`, `CLAUDE.md`

**Intent**: Lista `ignores` jest pusta, a `@utility bg-cosmic` znika, bo nie ma już konsumentów (T1, `change.md`). Z CLAUDE.md `### UI` znika zdanie o `bg-cosmic`/`backdrop-blur` „na widokach jeszcze niezmigrowanych”, a opis listy mówi, że jest pusta i nic się do niej nie dopisuje.

**Contract**: `tokensOnlyConfig` bez klucza `ignores` albo z pustą tablicą i komentarzem, że nic się do niej nie dopisuje. `COLOUR_LITERAL` dalej odrzuca `bg-cosmic`.

#### 8. Smoke: przekierowanie zalogowanego

**File**: `scripts/smoke.mjs`

**Intent**: Zmiana zachowania trasy `/` dostaje krok smoke (CLAUDE.md `## Testing`, decyzja 2). Kroki logowania zostają bez zmian.

**Contract**: po „signin accepts correct password” nowy krok `["home redirects signed-in user", () => request("/"), { status: 302, location: "/dashboard" }]`. Krok „home renders” (wylogowany, 200) zostaje.

#### 9. Zrzuty `/` bez sesji

**File**: `scripts/ui-screenshots.mjs`

**Intent**: Istniejące zestawy przestałyby działać na przekierowaniu zalogowanego z `/`. Każdy zrzut `/` dostaje `auth: false`. Dochodzi zestaw `views` dla tej zmiany.

**Contract**: `views` = `views-signin` (`/auth/signin`, bez sesji), `views-signin-error` (`/auth/signin?error=Nieprawid%C5%82owy%20e-mail%20lub%20has%C5%82o.`, bez sesji), `views-signin-mobile` (`/auth/signin`, bez sesji, `MOBILE`), `views-home` (`/`, bez sesji), `views-dashboard`, `views-dashboard-error` (`/dashboard?error=…`). `USAGE` opisuje nowy zestaw.

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi przy pustej liście `ignores`
- `grep -rn "bg-cosmic\|backdrop-blur" src` nie zwraca nic
- `grep -rn "rgba(\|#[0-9a-fA-F]\{3,8\}\b" src --include=*.astro --include=*.tsx` nie zwraca koloru w widoku
- `npx astro check` przechodzi
- `npm run build` przechodzi
- Smoke na podglądzie produkcyjnym z lokalnym Supabase przechodzi, w tym „home redirects signed-in user”: `npm run build && npm run preview -- --port 4321` oraz `BASE_URL=http://localhost:4321 npm run smoke`
- Zero-config: bez `.env` i `.dev.vars` `/` i `/auth/signin` zwracają 200, `/dashboard` 302 na `/auth/signin`, a wysłanie logowania wraca z `?error=` z polskim komunikatem o braku konfiguracji
- `node scripts/ui-screenshots.mjs views context/changes/ui-remaining-views/screenshots` zapisuje wszystkie zrzuty

#### Manual Verification:

- Zrzuty `views-*` w porównaniu z `before-*`: brak granatu, fioletu i gradientu; przyciski główne w kolorze `primary`; Topbar na `/` i `/dashboard` w tej samej ramie co na karcie
- Na `/dashboard` jest dokładnie jeden „Wyloguj” (w Topbarze), a przejście karta → „Oferty” zachowuje pasek
- Logowanie złym hasłem pokazuje „Nieprawidłowy e-mail lub hasło.” w `Alert`, czytnik ekranu ogłasza go jako alert
- `views-signin-mobile`: brak przewijania poziomego przy 375 px

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne.

---

## Faza 4: Stany i kitchen sink `/dev/forms`

### Overview

Strona testowa pokazuje oba formularze w macierzy 7 stanów, złożonej z tych samych kompozytów, których używają formularze. Skrypt zrzutów umie wymusić hover, a zestaw `forms` jest bramką wizualną zmiany.

### Macierz stanów

Źródło każdej komórki na `/dev/forms`. „Kompozyt” to `FormField`/`SubmitButton`/`ServerError` z `src/components/form/`, wyrenderowany z propsami, które przyjmuje w produkcji.

| Stan | `SignInForm` | `AddOfferForm` |
| --- | --- | --- |
| default | cały formularz (`client:load`), puste pola | cały formularz (`client:load`), puste pole |
| hover | przycisk „Zaloguj” (`CSS.forcePseudoState`), zrzut `forms-hover-button`; pola: **nie dotyczy** — `Input` nie ma stanu hover, a pole sygnalizuje interakcję fokusem | przycisk „Dodaj ofertę”: ten sam `SubmitButton`/`Button`, więc pokryty zrzutem obok; pole: **nie dotyczy** (jak obok) |
| focus | pole e-mail, przełącznik hasła, przycisk (prawdziwe naciśnięcia Tab); pole z błędem (T9) | pole URL i przycisk: te same `FormField`/`SubmitButton`, co zrzuty obok |
| disabled | przycisk: **ten sam render co loading** — `SubmitButton` blokuje się tylko w trakcie wysyłki, a osobny `disabled` byłby propsem tylko dla testów; pola: **nie dotyczy** — nigdy nie są blokowane, bo POST jest już wysłany, a strona się przeładuje | jak obok |
| error | kompozyt: e-mail z „Podaj poprawny adres e-mail” + `ServerError` z „Nieprawidłowy e-mail lub hasło.”; cały formularz z `serverError` (prop produkcyjny) | kompozyt: URL z komunikatem błędu z `/api/offers` + cały formularz z `serverError` |
| empty | kompozyty po wysłaniu pustego formularza: „Podaj adres e-mail”, „Podaj hasło”; pusty formularz przed wysłaniem = default | kompozyt: „Wklej adres ogłoszenia z otodom.pl” |
| loading | kompozyt `SubmitButton pending` z „Loguję…” | kompozyt `SubmitButton pending` z „Pobieram ogłoszenie…” |

### Changes Required:

#### 1. Strona kitchen sinka

**File**: `src/pages/dev/forms.astro` (nowy)

**Intent**: Jedna strona, wszystkie komórki macierzy naraz, w `AppLayout`. Wzorzec: `src/pages/dev/offer-card.astro`, czyli `import.meta.env.DEV`, 404 poza dev przez `Astro.response.status`, podpisy „Stan: …” w `text-muted-foreground`. Stany z kompozytów renderują się serwerowo (bez `client:*`), a dwa formularze w default są wyspami `client:load`. Stany z komórek „nie dotyczy” mają podpis z powodem, żeby zrzut sam się tłumaczył.

**Contract**: każda sekcja stanu ma `data-state="<nazwa>"`, a formularz `data-form="signin|offer"`, bo po tych atrybutach skrypt zrzutów celuje w elementy. Identyfikatory pól są unikalne na stronie (`id` kompozytów z sufiksem stanu). Poza `astro dev` strona renderuje `AppLayout` z komunikatem „Nie znaleziono”, ze statusem 404.

#### 2. Smoke pilnuje wycieku

**File**: `scripts/smoke.mjs`

**Intent**: Nowa trasa dostaje krok smoke (CLAUDE.md `## Testing`, decyzja 5), a komentarz nagłówka wymienia obie strony dev.

**Contract**: `["dev forms kitchen sink is absent from the build", () => request("/dev/forms"), { status: 404 }]` obok kroku `/dev/offer-card`.

#### 3. Hover i zestaw `forms` w skrypcie zrzutów

**File**: `scripts/ui-screenshots.mjs`

**Intent**: Bramka pokrywa hover bez ręcznego sprawdzania (decyzja 5). Pole zrzutu `hover: "<selektor CSS>"` wymusza `:hover` przez CDP na elemencie wskazanym selektorem.

**Contract**: `DOM.enable` i `CSS.enable` przy starcie, potem `DOM.getDocument`, `DOM.querySelector({ nodeId: root, selector })` i `CSS.forcePseudoState({ nodeId, forcedPseudoClasses: ["hover"] })`. Brak dopasowania kończy zrzut błędem, jak brak celu fokusu. Zrzuty hover i fokus obejmują tylko viewport. Nowe cele `FOCUS` celują w sekcję `[data-state=default]`: pole e-mail, przełącznik hasła i przycisk `SignInForm`. Pole z błędem celuje w `[data-state=error]`. Zestaw `forms`: `forms-desktop`, `forms-mobile` (`MOBILE`), `forms-focus-field`, `forms-focus-toggle`, `forms-focus-button`, `forms-focus-field-error`, `forms-hover-button`. `USAGE` opisuje zestaw i pole `hover`.

#### 4. Dokumentacja bramki

**File**: `CLAUDE.md`, `README.md`

**Intent**: Zmiana wyglądu formularza przechodzi przez `/dev/forms` tak jak karta przez `/dev/offer-card`. Nowy stan formularza dostaje tam sekcję. W CLAUDE.md `### UI` dochodzi reguła obok reguły karty, a `## Testing` (punkt o `scripts/ui-screenshots.mjs`) wymienia zestaw `forms` i pole `hover`. README, sekcja „Screenshots for the visual gate”, opisuje oba zestawy.

**Contract**: CLAUDE.md wskazuje `src/pages/dev/forms.astro` jako wzorzec (ścieżka, bez liczby stanów).

### Success Criteria:

#### Automated Verification:

- `npm run lint` przechodzi
- `npx astro check` przechodzi
- `npm run build` przechodzi
- Smoke na podglądzie produkcyjnym przechodzi, w tym „dev forms kitchen sink is absent from the build” (404)
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/dev/forms` pod `npm run dev` zwraca 200
- `node scripts/ui-screenshots.mjs forms context/changes/ui-remaining-views/screenshots` zapisuje wszystkie 7 zrzutów (exit 0)
- `node scripts/ui-screenshots.mjs gate context/changes/ui-remaining-views/screenshots` zapisuje wszystkie zrzuty karty (regresja)

#### Manual Verification:

- Bramka: każda komórka macierzy jest widoczna na `forms-desktop`, a komórki „nie dotyczy” mają podpis z powodem
- `forms-focus-field`, `forms-focus-toggle`, `forms-focus-button`: pierścień 3 px widoczny na każdej kontrolce. `forms-focus-field-error`: pierścień czerwony, wyraźny na `card`
- `forms-hover-button`: przycisk jaśniejszy niż w `forms-desktop` (`primary/90`)
- `forms-mobile`: brak przewijania poziomego przy 375 px, przełącznik hasła mieści się w polu
- Po triażu `/10x-impl-review` zestawy `forms` i `views` są wykonane ponownie przed commitem, a zrzuty porównane z tymi sprzed poprawek

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne, potem `/10x-impl-review`. Bramka jest powtarzana po triażu review, przed commitem poprawek.

---

## Testing Strategy

### Unit Tests:

- Brak runnera testów jednostkowych w repo (CLAUDE.md `## Testing`). Nie dodajemy go.

### Integration Tests:

- `scripts/smoke.mjs` na podglądzie produkcyjnym, z dwoma nowymi krokami: zalogowany na `/` → 302 `/dashboard` oraz `/dev/forms` → 404. Kroki logowania (`location: "/"`, `locationPrefix: "/auth/signin?error="`) zostają bez zmian i pilnują, że kontrakt `?error=` przetrwał polskie komunikaty.
- Sonda lintu z fazy 2 dowodzi, że rozszerzony regex i selektor `style` łapią to, czego dziś nie łapią.

### Manual Testing Steps:

1. Wylogowany: `/` pokazuje hero z „Zaloguj” → `/auth/signin` → złe hasło → polski `Alert` → poprawne hasło → przycisk „Loguję…” → `/` → `/dashboard`.
2. Na `/dashboard`: Topbar z e-mailem i „Wyloguj”, jeden „Wyloguj”. Pusty URL daje błąd pola z `aria-invalid`, obcy host daje `Alert` z komunikatem `/api/offers`.
3. Klawiatura: Tab przez pola, przełącznik hasła i przycisk na `/auth/signin`. Każda kontrolka ma pierścień 3 px, a pole z błędem ma czerwony pierścień.
4. Bramka zrzutów `forms` i `views`, potem ponownie po triażu `/10x-impl-review`.

## Performance Considerations

Z trzech widoków znika 5 paneli z `backdrop-blur-xl`, trzy rozmyte orby i pole gwiazd. Na karcie ten sam wzorzec dawał ~9 fps przy przewijaniu bez GPU (archiwum `ui-offer-card`). Tutaj tego nie mierzymy, a spadek kosztu wynika z usunięcia efektów.

## Migration Notes

Brak danych do migracji. Zakładki na `/` dla zalogowanych prowadzą teraz na `/dashboard`. `context/foundation/lessons.md:23` traci przedmiot, bo kompozyty już nie niosą starego stylu i nie leżą w `src/components/auth/`. Wpis aktualizuje użytkownik przez `/10x-lesson` po zmianie; plan go nie edytuje.

## References

- Research: `context/changes/ui-remaining-views/research.md`
- Kontrakt i wzorzec: `context/archive/2026-09-23-ui-offer-card/plan.md`, `src/pages/offers/[id].astro`, `src/pages/dev/offer-card.astro`
- Obejście `pending`: `src/components/offers/AddOfferForm.tsx:14-25`; ustalenie `context/archive/2026-09-22-paste-listing-to-card/plan.md:270`
- Reguła tokenów: `context/foundation/lessons.md:19-24`, CLAUDE.md `### UI`
- Zrzuty „przed”: `context/changes/ui-remaining-views/screenshots/before-*.png`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Biblioteka formularzy

#### Automated

- [x] 1.1 `npm run lint` przechodzi, a pliki w `src/components/form/` nie są na liście `ignores` — 2573520
- [x] 1.2 `npx astro sync && npx astro check` przechodzi bez błędów — 2573520
- [x] 1.3 `npm run build` przechodzi — 2573520
- [x] 1.4 grep na `useFormStatus` i stare ścieżki kompozytów w `src` i `CLAUDE.md` nie zwraca nic — 2573520
- [x] 1.5 `git diff package.json` nie dodaje zależności — 2573520
- [x] 1.6 grep na `"use client"`, `from "cn"`, `from "radix-ui"` w `src/components/ui` nie zwraca nic — 2573520

#### Manual

- [x] 1.7 Pusty formularz logowania pokazuje polskie błędy pól z `aria-invalid` i `aria-describedby` — 2573520
- [x] 1.8 Wysłanie logowania blokuje przycisk z „Loguję…”, a powrót „Wstecz” go odblokowuje — 2573520
- [x] 1.9 „Dodaj ofertę” dalej pokazuje „Pobieram ogłoszenie…” w trakcie wysyłki — 2573520

### Phase 2: Tokeny i reguła lintu

#### Automated

- [x] 2.1 `npm run lint` przechodzi, a `ignores` zawiera dokładnie `signin.astro`, `dashboard.astro` i `Welcome.astro` — 59de3fa
- [x] 2.2 Sonda lintu `src/__lint-probe.tsx` daje 3 błędy `COLOUR_MESSAGE` i jest usunięta — 59de3fa
- [x] 2.3 `npx astro check` przechodzi — 59de3fa
- [x] 2.4 `npm run build` przechodzi — 59de3fa
- [x] 2.5 `destructive-foreground` jest w `:root`, `.dark` i `@theme inline` — 59de3fa

#### Manual

- [x] 2.6 Kontrast `--input`, pierścienia błędu i `destructive-foreground` potwierdzony obliczeniem i wpisany w komentarze — 59de3fa
- [x] 2.7 Zrzuty `gate` karty bez regresji względem archiwum `ui-offer-card` — 59de3fa

### Phase 3: Widoki

#### Automated

- [x] 3.1 `npm run lint` przechodzi przy pustej liście `ignores` — 3d223d0
- [x] 3.2 grep na `bg-cosmic` i `backdrop-blur` w `src` nie zwraca nic — 3d223d0
- [x] 3.3 grep na `rgba(` i hex w widokach nie zwraca koloru — 3d223d0
- [x] 3.4 `npx astro check` przechodzi — 3d223d0
- [x] 3.5 `npm run build` przechodzi — 3d223d0
- [x] 3.6 Smoke na podglądzie produkcyjnym przechodzi, w tym „home redirects signed-in user” — 3d223d0
- [x] 3.7 Zero-config: `/` i `/auth/signin` 200, `/dashboard` 302, logowanie wraca z polskim `?error=` — 3d223d0
- [x] 3.8 Zestaw zrzutów `views` zapisany w `context/changes/ui-remaining-views/screenshots` — 3d223d0

#### Manual

- [x] 3.9 Zrzuty `views-*` wobec `before-*`: tokeny, `primary`, Topbar w ramie — 3d223d0
- [x] 3.10 Na `/dashboard` jeden „Wyloguj”, przejście karta → „Oferty” zachowuje pasek — 3d223d0
- [x] 3.11 Złe hasło daje polski komunikat w `Alert` ogłaszanym jako alert — 3d223d0
- [x] 3.12 `views-signin-mobile` bez przewijania poziomego przy 375 px — 3d223d0

### Phase 4: Stany i kitchen sink `/dev/forms`

#### Automated

- [x] 4.1 `npm run lint` przechodzi
- [x] 4.2 `npx astro check` przechodzi
- [x] 4.3 `npm run build` przechodzi
- [x] 4.4 Smoke na podglądzie produkcyjnym przechodzi, w tym `/dev/forms` → 404
- [x] 4.5 `/dev/forms` pod `npm run dev` zwraca 200
- [x] 4.6 Zestaw zrzutów `forms` zapisuje wszystkie 7 zrzutów
- [x] 4.7 Zestaw zrzutów `gate` karty zapisuje wszystkie zrzuty

#### Manual

- [x] 4.8 Bramka: każda komórka macierzy widoczna na `forms-desktop`, „nie dotyczy” z podpisem
- [x] 4.9 Zrzuty fokusu: pierścień 3 px na polu, przełączniku i przycisku, czerwony na polu z błędem
- [x] 4.10 `forms-hover-button` pokazuje hover przycisku
- [x] 4.11 `forms-mobile` bez przewijania poziomego, przełącznik w polu
- [ ] 4.12 Bramka `forms` i `views` powtórzona po triażu `/10x-impl-review` przed commitem
