<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Pozostałe widoki i formularze na tokenach

- **Plan**: context/changes/ui-remaining-views/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-26
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

## Evidence (uruchomione w review)

- `npm run lint` — exit 0; `npx astro sync && npx astro check` — 0 errors/warnings/hints; `npm run build` — Complete.
- Grepy z planu (`bg-cosmic|backdrop-blur`, `useFormStatus` i stare ścieżki kompozytów, `"use client"|from "cn"|from "radix-ui"` w `src/components/ui`) — puste. `package.json`/`package-lock.json` bez zmian w `fda73fb..HEAD`.
- Smoke na podglądzie produkcyjnym (`astro preview --port 4322`, lokalny Supabase): 22/22 PASS, w tym „home redirects signed-in user” i „dev forms kitchen sink is absent from the build”.
- Sonda bfcache (headless Chrome przez CDP, podgląd produkcyjny): poprawne hasło → przycisk `disabled`, „Loguję…” → `/dashboard` → `history.back()` → strona przywrócona z bfcache (`pageshow.persisted === true`), przycisk aktywny, „Zaloguj”. Złe hasło → `?error=` → Wstecz → świeże załadowanie (bfcache `CacheFlushed`), przycisk aktywny. `/auth/signin` nie wysyła `Cache-Control: no-store`, więc strona kwalifikuje się do bfcache.
- Serwer dev na :4321 nie działał w trakcie review (nic nie nasłuchiwało); nie był restartowany.

## Ocena świadomych odstępstw (pytanie 1)

| Odstępstwo | Ocena |
| --- | --- |
| Komórka „error” bez całego formularza z `serverError` | Słuszne. `SignInForm` ma na sztywno `id="email"`/`"password"`, a plan jednocześnie wymaga unikalnych id i zakazuje propsów tylko dla testów — plan był wewnętrznie sprzeczny. Koszt: odstęp pole→`Alert` w całym formularzu pokrywa tylko zestaw `views`. Nieudokumentowane w planie (F4). |
| Sekcje hover/focus/disabled tylko z podpisem | Zgodne z intencją macierzy (plan sam umieszcza te stany w zrzutach `forms-hover-button`/`forms-focus-*` i „disabled = render loading”). Nie jest dryfem. |
| `createElement` dla ikon i `PasswordToggle` w `forms.astro` | Słuszne. Element JSX w propie Reacta w `.astro` jest elementem Astro, nie Reacta; komentarz w pliku wyjaśnia. Alternatywa (nazwane sloty → propsy) dodałaby `<astro-slot>` do drzewa. |
| `--blink-settings=primaryHoverType=2,…` | Słuszne i konieczne: Tailwind 4 opakowuje `hover:` w `@media (hover: hover)`, headless Chrome go nie spełnia. Wartości poprawne (HoverType 2 = HOVER, PointerType 4 = FINE). Flaga działa na wszystkie zestawy, w tym `MOBILE`; `src/` nie ma zapytań `pointer`/`hover`, więc dziś bez skutku. |
| `PasswordToggle` `size-7` zamiast `size-9` | Słuszne. `size-9` = cała wysokość pola `h-9`; 28 px spełnia WCAG 2.5.8 (24 px) i mieści się w `pr-10`. Na `forms-focus-toggle` pierścień styka się z prawą krawędzią pola, ale jest widoczny. |
| Karta „Nowa oferta” na pełną szerokość | Słuszne: `OfferCard` na `/offers/[id]` to też `Card` na pełną szerokość ramy `max-w-4xl`. Pole i przycisk ~846 px są szerokie, ale spójne z ramą. |

## Findings

### F1 — Wstrzymany projekt Supabase nie trafia w komunikat „Serwer logowania nie odpowiada”

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/auth/signin.ts:7
- **Detail**: Plan (Key Discoveries, plan.md:38) zakłada, że wstrzymany projekt daje `AuthRetryableFetchError`. `auth-js` 2.116 (`dist/main/lib/fetch.js:32-34`) traktuje jako sieciowe tylko 500–504 i 520–530. Wstrzymany projekt odpowiada wg dokumentacji Supabase HTTP 540 → `AuthApiError` (status 540, bez `code`) albo `AuthUnknownError` przy ciele HTML (odtworzone przez agenta na serwerze-atrapie). Skutek: objaw nr 1 z `deployment-runbook.md:122` („Login fails, no banner”) pokazuje ogólne „Nie udało się zalogować. Spróbuj ponownie.”, które sugeruje ponowną próbę zamiast awarii serwera. Reszta mapowania zweryfikowana: kody `invalid_credentials`, `over_request_rate_limit`, `email_not_confirmed`, `user_banned` istnieją w `ErrorCode`; odmowa połączenia/DNS/503 dają `AuthRetryableFetchError`; surowe `error.message` nie wycieka; brak ścieżki do 500.
- **Fix**: W `signInErrorMessage` traktować jako „serwer nie odpowiada” także `(error.status ?? 0) >= 500` oraz `error.name === "AuthUnknownError"`; poprawić plan.md:38.
  - Strength: Pokrywa 540 i każdy przyszły kod bramki bez utrzymywania listy; kontrakt `?error=` i smoke bez zmian.
  - Tradeoff: 5xx z samego GoTrue (np. błąd bazy) też dostanie „nie odpowiada” — dla użytkownika to trafny opis.
  - Confidence: MED — kod 540 pochodzi z dokumentacji Supabase, nie z pomiaru na prawdziwie wstrzymanym projekcie.
  - Blind spot: Dokładna odpowiedź bramki Supabase dla wstrzymanego projektu (status i typ ciała) nieobserwowana na żywo.
- **Decision**: FIXED — warunek `status >= 500 || AuthUnknownError` w `signInErrorMessage` (signin.ts:7-9), plan.md:38 i wiersz tabeli :257 poprawione

### F2 — Reguła lintu przepuszcza palety Tailwind 4.3 i kolory arbitralne inne niż hex

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: eslint.config.js:76-82
- **Detail**: Pusta lista `ignores` ma znaczyć „brak literałów”, ale `COLOUR_LITERAL` nie łapie (sprawdzone `node -e` na regexie z pliku): palet `mauve`, `olive`, `mist`, `taupe` z zainstalowanego Tailwind 4.3.3 (`bg-mauve-500`), `ring-offset-white`, logicznych boków `border-s-`/`border-e-`, kolorów arbitralnych innych niż hex (`bg-[oklch(0.5_0.1_200)]`, `bg-[rgb(0,0,0)]`, `text-[white]`, `bg-[color:#fff]`). `STYLE_COLOUR` łapie tylko `rgb(a)(` i hex — przepuszcza `hsl(`, `oklch(`, `lab(`, `color-mix(` w `style`. Poza zasięgiem reguły (świadomie): obiekt stylu w zmiennej, `<style>`, zapisy w `<script>`. Fałszywe trafienia: tylko `\b` na końcu — `text-white-space` i przyszły token roli nazwany jak paleta (np. `bg-red-flag` dla audytu) zostaną odrzucone. Selektory `style` są poprawne i działają też w `.astro` (astro-eslint-parser emituje `JSXAttribute`); brak fałszywych trafień na `href="#add"`, `aria-describedby`, tokenach ról. Dziś w `src/` nie ma żadnego z tych literałów.
- **Fix**: Dopisać palety `mauve|olive|mist|taupe`, prefiksy `ring-offset` i `border(?:-(?:[trblxyse]|b[se]))?`, zamienić `-\[#` na `-\[(?:#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|hwb\(|color-mix\(|color:)`, rozszerzyć `STYLE_COLOUR` o te same funkcje; powtórzyć sondę `src/__lint-probe.tsx` z nowymi przypadkami.
- **Decision**: FIXED — `COLOUR_LITERAL`: palety mauve/olive/mist/taupe, `ring-offset`, `border-(s|e|bs|be)`, grupa arbitralna (hex, funkcje koloru, white/black, z `color:`); `STYLE_COLOUR` o hsl/oklch/oklab/lab/lch/hwb/color-mix. Sonda: 14/14 przypadków złapanych, 0 fałszywych trafień na tokenach ról, `text-[length:…]`, `w-[calc(…)]`, `href="#add"`; sonda usunięta

### F3 — Komórki „empty” i „error” na `/dev/forms` odbiegają od renderu produkcyjnego

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dev/forms.astro:138-203
- **Detail**: Plan (macierz, plan.md:348) każe renderować kompozyty „z propsami, które przyjmuje w produkcji”. Komórki pomijają `placeholder`: w produkcji po wysłaniu pustego formularza pola pokazują „ty@przyklad.pl”, „Twoje hasło”, „https://www.otodom.pl/pl/oferta/…” obok błędu, a zrzut `forms-desktop` pokazuje puste pola — bramka utrwala stan, którego użytkownik nie widzi. Drugi problem: id komórek `email-error`/`url-error` pokrywają się z konwencją `FormField` (`<id>-error` dla komunikatu, `FormField.tsx:34`). Po wysłaniu pustego formularza w sekcji default strona ma dwa elementy `id="email-error"` (komunikat formularza i pole komórki error), co łamie kontrakt „id unikalne na stronie” (plan.md:368). Zrzuty obecne nie są dotknięte.
- **Fix**: Dodać w komórkach `placeholder` identyczne z `SignInForm`/`AddOfferForm` i zmienić id na prefiksowe (`error-email`, `error-url`, `empty-email`, `empty-password`, `empty-url`). Celowniki w `scripts/ui-screenshots.mjs` (`FOCUS.erroredField`) idą po `data-state` i `aria-invalid`, nie po id, więc skrypt się nie zmienia.
- **Decision**: FIXED — `forms.astro`: placeholdery z `SignInForm`/`AddOfferForm` w komórkach error/empty, id `error-email`, `error-url`, `empty-email`, `empty-password`, `empty-url`; zrzuty do powtórzenia w bramce 4.12

### F4 — Kryterium 4.10 jest błędne, a odstępstwa i hover nie są zapisane w planie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/ui-remaining-views/plan.md:410 (także :38, Progress)
- **Detail**: Pytanie 2 — to błąd planu, nie implementacji. `hover:bg-primary/90` to `primary` z alfą 0,9 nałożony na tło; tło (`background`/`card`) jest ciemniejsze niż `primary`, więc wynik zawsze jest ciemniejszy: (0,95,120) × 0,9 + (10,10,10) × 0,1 ≈ (1,86,109) — dokładnie zmierzona wartość. „Jaśniejszy” z planu jest niemożliwy dla tej klasy. Implementacja zgodna z rejestrem shadcn. Uwaga wizualna: różnica luminancji między stanami to ~1,07:1 — hover jest ledwo widoczny (WCAG go nie wymaga; mocniejszy hover to projektowanie, poza zakresem migracji). Ponadto sześć świadomych odstępstw (tabela wyżej) nie jest zapisanych w planie ani w `change.md`, a plan.md:38 zawiera fałszywe założenie o `AuthRetryableFetchError` (F1). Plan jest źródłem prawdy dla kolejnych review i archiwum.
- **Fix**: W plan.md poprawić kryterium 4.10 na „ciemniejszy (`primary/90` nad ciemnym tłem); różnica ~1,07:1 przyjęta jako domyślna rejestru” (wiersz 4.10 w Progress bez zmiany tytułu), dopisać sekcję „Odstępstwa przyjęte w implementacji” z sześcioma pozycjami i poprawić wiersz :38.
- **Decision**: FIXED — plan.md: kryterium 4.10 → „ciemniejszy (~1,07:1)”, nowa sekcja „Odstępstwa przyjęte w implementacji” (6 pozycji); :38 poprawione przy F1

### F5 — Kryterium 1.8 (odblokowanie po „Wstecz”) zaznaczone bez dowodu; teraz potwierdzone tylko w Chromium

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/form/use-pending-submit.ts:8-16; plan.md Progress 1.8
- **Detail**: Pytanie 3. Wiersz 1.8 był `[x]`, choć sonda CDP go nie objęła. Review to domknęło w Chromium (sekcja Evidence): przywrócenie z bfcache z `persisted === true` odblokowuje przycisk, a ścieżka bez bfcache montuje świeży stan. Niesprawdzone: Firefox (znane zachowanie przywracania stanu `disabled` kontrolek przy ładowaniu z historii bez bfcache — React przy hydracji nie poprawia atrybutu) i Safari. Pozostały przypadek brzegowy: zatrzymanie nawigacji (Esc / „Zatrzymaj”) w trakcie wysyłki zostawia przycisk zablokowany do przeładowania — to samo było w `AddOfferForm` przed zmianą. Uwaga pomocnicza: `SubmitButton` nie może dostać `name`, bo blokada w mikrozadaniu po `submit` wyrzuca wartość przycisku z formularza.
- **Fix**: Dopisać przy 1.8 dowód z sondy (Chromium) i jednorazowo sprawdzić ręcznie w Firefoksie: logowanie → `/dashboard` → Wstecz → przycisk aktywny.
- **Decision**: FIXED — dowód z sondy Chromium dopisany pod 1.8 w Progress; ręczny test w Firefoksie po stronie użytkownika (otwarty)

### F6 — Lekcja „Kolory widoku…” w lessons.md jest nieaktualna i przeczy CLAUDE.md

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/lessons.md:23
- **Detail**: Lekcja nadal mówi, że `ignores` to lista niezmigrowanych widoków, ostrzega przed reużyciem `FormField`/`SubmitButton`/… „z `src/components/auth`” (już nie istnieją) i każe nowemu formularzowi brać prymitywy z shadcn — a CLAUDE.md `## Conventions` wskazuje teraz kompozyty z `src/components/form/`. Lekcję czytają `/10x-plan` i `/10x-implement`, więc następny formularz (S-03) może zbudować pola od zera obok gotowych kompozytów. Plan (plan.md:52) świadomie zostawił aktualizację użytkownikowi.
- **Fix**: Użytkownik uruchamia `/10x-lesson`, aby zaktualizować wpis: `ignores` jest pusta, nowy formularz składa się z `src/components/form/`, ostrzeżenie o `src/components/auth` usunięte.
- **Decision**: ACCEPTED-AS-RULE: Formularz z kompozytów `src/components/form/`, tokeny ról nazwane od roli (lessons.md:26; stary wpis :19-24 bez zmian — append-only)

### F7 — `PasswordToggle` zmienia etykietę i jednocześnie ma `aria-pressed`

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/form/PasswordToggle.tsx:17-18
- **Detail**: WAI-ARIA APG: przycisk przełączający z `aria-pressed` ma stałą etykietę. Teraz czytnik ogłasza „Ukryj hasło, wciśnięty” — podwójna negacja stanu. Plan wymagał obu atrybutów (plan.md:94), więc to błąd planu przeniesiony do kodu.
- **Fix**: Stała etykieta „Pokaż hasło” + `aria-pressed={visible}`. `FOCUS.passwordToggle` celuje po `button[aria-pressed]`, więc zrzuty działają bez zmian.
- **Decision**: FIXED — stała etykieta „Pokaż hasło” + `aria-pressed={visible}` (PasswordToggle.tsx:17-19), plan.md:94 poprawione

### F8 — Wylogowany na `/` widzi dwa „Zaloguj” jeden nad drugim

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/Welcome.astro (CTA), src/components/Topbar.astro:29
- **Detail**: `views-home.png`: link „Zaloguj” w Topbarze i przycisk „Zaloguj” w hero, ~400 px od siebie. Plan świadomie wybrał CTA w hero, a Topbar ma link od zmiany ui-offer-card. Wizualnie to powtórzenie tej samej akcji na pustym ekranie; nie błąd, ale do decyzji.
- **Fix**: Zostawić (CTA jest główną akcją, link w Topbarze to nawigacja) albo ukryć link Topbara na `/` — decyzja produktowa, zapisać ją w planie przy F4.
- **Decision**: ACCEPTED — oba zostają: Topbar spójny na każdej stronie, CTA w hero to główna akcja

## Poza zakresem (odnotowane, nie jako findings)

- `?error=` renderowany dosłownie w `role="alert"` (spreparowany link może wyświetlić dowolny tekst, bez XSS) — to A6 z „What We're NOT Doing”. Teraz, gdy trasa emituje stały zbiór komunikatów, przejście na klucze jest tanie; to zmiana konwencji z CLAUDE.md.
- Podwójne przekierowanie po logowaniu (`302 /` → `302 /dashboard`, dwa `getUser()`) — świadoma decyzja planu (plan.md:46), chroni krok smoke i `signIn()` w skrypcie zrzutów.
- Błędy walidacji klienta i tekst „Loguję…” nie są ogłaszane (brak live region, fokus nie przechodzi do pierwszego błędnego pola) — sprzed zmiany.
- Stały `DEBUG_PORT` 9334 w `scripts/ui-screenshots.mjs` — pozostawiony Chrome na tym porcie dostałby sesję konta z seeda (hasło i tak publiczne).

## Triage summary (2026-09-26)

- Fixed: F1, F2, F3, F4, F5, F7 (6)
- Accepted: F6 (lekcja przez `/10x-lesson` po triażu), F8 (oba „Zaloguj” zostają) (2)
- Po poprawkach: `npm run lint`, `npx astro check`, `npm run build` przechodzą. Do zrobienia przez użytkownika: bramka `forms` i `views` (Progress 4.12), ręczny test „Wstecz” w Firefoksie (F5).
