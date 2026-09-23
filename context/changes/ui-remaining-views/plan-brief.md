# Pozostałe widoki i formularze na tokenach — Plan Brief

> Full plan: `context/changes/ui-remaining-views/plan.md`
> Research: `context/changes/ui-remaining-views/research.md`

## What & Why

Logowanie, dashboard, strona główna i komponenty formularzy nadal malują się fioletem, granatem `bg-cosmic` i `backdrop-blur`, poza kontraktem tokenów z `ui-offer-card`. Do tego logowanie nie ma stanu ładowania, zalogowany ląduje na stronie startera, dashboard jest poza ramą, a trzy ekrany są po angielsku. Zmiana przenosi resztę aplikacji na tokeny, prymitywy shadcn i `AppLayout`, żeby S-03 i kolejne formularze miały z czego budować.

## Starting Point

Kontrakt istnieje: tokeny w `src/styles/global.css`, `AppLayout`, `Card`/`Badge`, reguła lintu `tokensOnlyConfig` i bramka `/dev/offer-card`. Na liście `ignores` zostało 9 plików z 41 liniami literałów. Kompozyty formularzy leżą w `src/components/auth/`, choć używa ich też formularz ofert.

## Desired End State

Każdy ekran jest po polsku i ma kolory tylko z tokenów. Lista `ignores` jest pusta, a `bg-cosmic` nie istnieje. Pola mają powiązany z nimi błąd (`aria-invalid`, `aria-describedby`), a oba formularze blokują przycisk i pokazują postęp wysyłki. Zalogowany na `/` trafia na `/dashboard`, a dashboard ma Topbar jak karta. `/dev/forms` pokazuje oba formularze w 7 stanach, a zrzut tej strony jest bramką.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Język | Polski wszędzie, `lang="pl"` domyślnie; `signin.ts` mapuje `error.code` Supabase na polskie komunikaty | Rama, karta i formularz ofert już są po polsku, a kontrakt `?error=` się nie zmienia | Research → użytkownik |
| Strona główna | Zalogowany dostaje 302 na `/dashboard` (w middleware), wylogowany widzi polski hero z „Zaloguj”; karty startera znikają | `return Astro.redirect()` we frontmatterze łamie lint; `signin.ts` i krok smoke logowania bez zmian | Użytkownik + Plan |
| `label` | Natywny `<label>`, bez `@radix-ui/react-label` | Zero nowych zależności; rytuał w CLAUDE.md rozszerzony o `Label` | Użytkownik |
| Stan ładowania | Hook `usePendingSubmit` (`submitting` + `pageshow`) dla obu formularzy, `useFormStatus()` usunięty | Jedyny mechanizm, który działa przy natywnym POST-cie | Użytkownik |
| Położenie kompozytów | `src/components/form/`, hook obok nich | Formularz ofert i S-03 nie szukają pól w folderze logowania | Użytkownik + Plan |
| `--input` | `oklch(1 0 0 / 40%)` w `.dark` | Obramowanie 3,82:1 na `card`, placeholder 4,88:1; zmienia się tylko alfa presetu | Użytkownik + Plan (obliczenie) |
| Pierścień pola z błędem | `dark:aria-invalid:ring-destructive/70` w `input.tsx` | 3,62:1 na `card` (`/60` daje 2,97:1) | Użytkownik + Plan (obliczenie) |
| `destructive` | Nowy `--destructive-foreground` = `oklch(0.985 0 0)`; hover `dark:hover:bg-destructive/50` | Zdejmuje `button`/`badge` z `ignores` i naprawia martwy hover w `.dark` | Research |
| Lint | Regex łapie też `border-[trblxy]-<paleta>`, selektor na `rgba(`/hex tylko w atrybucie `style` | Pusta lista `ignores` ma znaczyć brak literałów; zawężenie do `style` omija kotwice `#…` | Użytkownik + Plan |
| Kitchen sink | `/dev/forms` ze stanami z kompozytów + oba formularze w default; bez propsów tylko dla testów | Strona dev renderuje te same pliki co produkcja | Użytkownik |
| `disabled` | Ten sam render co `loading`; pola „nie dotyczy” | `SubmitButton` blokuje się tylko w trakcie wysyłki | Plan |
| Hover w bramce | `CSS.forcePseudoState` w `scripts/ui-screenshots.mjs` | Hover przycisku sprawdzany zrzutem, nie ręcznie | Użytkownik |
| Dashboard | `AppLayout` + `Card` „Nowa oferta” z formularzem; błąd w `Alert` w formularzu | Jeden „Wyloguj” (Topbar); tablica to S-06 | Research + Plan |
| A6, A8, A9 | Poza zakresem | Logika tras i auth, nie UI | Użytkownik |

## Scope

**In scope:**
- `shadcn add input label alert` + rytuał; kompozyty w `src/components/form/`; hook stanu wysyłki
- Tokeny: `--destructive-foreground`, `--input`, pierścień błędu, hover `destructive`; szerszy lint
- Signin (Card), dashboard i `/` w `AppLayout`, polskie teksty, mapowanie błędów logowania, przekierowanie z `/`
- `/dev/forms`, zestawy zrzutów `views` i `forms`, 2 nowe kroki smoke, CLAUDE.md i README

**Out of scope:**
- A6 (`?error=` jako kody), A8 (przywracanie wpisanej wartości), A9 (`?next=`, zalogowany na signin)
- Tablica ofert na `/dashboard` (S-06), jasny motyw, nowe zależności
- Edycja `lessons.md:23` — użytkownik przez `/10x-lesson` po zmianie

## Architecture / Approach

Kolejność z `/10x-ui`: biblioteka → wartości w jednym źródle → widoki → stany i bramka. Każdy plik schodzi z `ignores` w fazie, w której traci literały (9 → 5 → 3 → 0). Formularze (`SignInForm`, `AddOfferForm`) składają się z kompozytów w `src/components/form/` na prymitywach `src/components/ui/`. Kitchen sink renderuje te same kompozyty serwerowo dla stanów, których nie da się osiągnąć propsami, i oba formularze jako wyspy dla stanu domyślnego.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Biblioteka formularzy | Prymitywy, kompozyty w `form/` z a11y błędu, hook ładowania, polski `SignInForm` | Rytuał `shadcn add` (paczki `cn`/`radix-ui`, import `Label`) przeoczony |
| 2. Tokeny i reguła lintu | `--destructive-foreground`, `--input`, pierścień błędu, szerszy lint; `button`/`badge` z `ignores` | Selektor `style` w `astro-eslint-parser` nie łapie — sonda lintu to wykrywa |
| 3. Widoki | Signin, dashboard, `/` na tokenach i po polsku; przekierowanie; pusta lista `ignores`, bez `bg-cosmic` | Zestawy zrzutów z `/` z sesją psują się na przekierowaniu — `auth: false` |
| 4. Stany i kitchen sink | `/dev/forms` z macierzą 7×2, hover w skrypcie, zestaw `forms`, smoke 404 | Cele fokusu/hover niejednoznaczne na stronie z wieloma polami — `data-state` |

**Prerequisites:** lokalny Supabase z seedem (smoke, zrzuty), `google-chrome`, `npm run dev` dla zrzutów. Niezacommitowane zmiany w `CLAUDE.md`, `README.md` i `scripts/ui-screenshots.mjs` (wymagany katalog zrzutów) wchodzą w commit fazy 1.
**Estimated effort:** ~2–3 sesje, 4 fazy.

## Open Risks & Assumptions

- Kontrast policzony, nie zmierzony w przeglądarce. Kolejność reguł (T7, T9) potwierdzi dopiero zrzut `forms-focus-field-error` i hover.
- `forms-focus-field-error` wykracza poza listę zrzutów podaną w decyzji 5. Dodałem go, bo T9 inaczej nie ma dowodu wizualnego.
- Przygaszony przycisk w trakcie wysyłki (`disabled:opacity-50`) ma kontrast poniżej 4,5:1. WCAG zwalnia z progu nieaktywne kontrolki, a tekst oczekiwania i tak niesie zmianę stanu.
- Ekran logowania traci „kosmiczny” wygląd na rzecz neutralnego presetu z cyan. To świadoma, widoczna zmiana charakteru.

## Success Criteria (Summary)

- `npm run lint` przechodzi przy pustej liście `ignores`, a `bg-cosmic`/`backdrop-blur` nie występują w `src/`.
- Członek zespołu loguje się po polsku, widzi reakcję przycisku i trafia na dashboard w tej samej ramie co karta.
- `/dev/forms` pokazuje każdy stan z macierzy, a bramka zrzutów przechodzi przed review i ponownie po triażu.
