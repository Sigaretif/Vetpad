---
date: 2026-09-23T19:24:12+02:00
researcher: Claude (Opus 5.5) for Wiktor Ortel
git_commit: 27a41657d5045c9444cf8fcf89f65bd9cf99b6f0
branch: master
repository: 10xDevs4 (Vetpad)
topic: "Karta oferty /offers/[id] jako widok wzorcowy — audyt zarzutów (tokeny, komponenty, architektura) i preset shadcn b1s91W2me"
tags: [research, ui, design-tokens, shadcn, offer-card, layout, topbar, dark-mode]
status: complete
last_updated: 2026-09-23
last_updated_by: Claude (Opus 5.5)
---

# Research: karta oferty jako widok wzorcowy

**Date**: 2026-09-23T19:24:12+02:00
**Researcher**: Claude (Opus 5.5) for Wiktor Ortel
**Git Commit**: 27a41657d5045c9444cf8fcf89f65bd9cf99b6f0 (drzewo robocze: niezacommitowane zmiany w `CLAUDE.md`, `.claude/`, nowy `context/praca-nad-interfejsem-graficznym-aplikacji-ui.md`; `src/` czyste)
**Branch**: master
**Repository**: 10xDevs4 (Vetpad)

## Research Question

Z `change.md`: karta `/offers/[id]` (`src/pages/offers/[id].astro` + `src/components/offers/*`) jako widok wzorcowy; tokeny z presetu shadcn `b1s91W2me` przeniesione do istniejących zmiennych w `src/styles/global.css` bez `shadcn init`; ciemny motyw jako jedyny; wspólna rama (`Layout.astro`, `Topbar.astro`); brakujące prymitywy przez `npx shadcn add`; reguła w `CLAUDE.md`. Research ma dać listę zarzutów w trzech kategoriach z `/10x-ui` — każdy z plik:linia i wpływem na użytkownika — oraz listę odłożonych (signin, dashboard, strona główna).

## Summary

1. **Repo ma system, którego nikt nie czyta.** `global.css` ma kompletne `:root` / `.dark` / `@theme inline` (`src/styles/global.css:6-111`), ale w inspekcji `src/**/*.astro|tsx` jedynym plikiem używającym klas semantycznych (`bg-primary`, `text-muted-foreground` itd.) jest `src/components/ui/button.tsx`. Karta maluje się literałami (`white/10`, `blue-100/80`, `purple-300`) na tle `bg-cosmic` z hexami (`global.css:113-115`). To dokładnie przypadek „Fresh starter whose screens ignore its own tokens" z `/10x-ui`.
2. **Blok `.dark` jest martwy.** Żaden element nie dostaje klasy `dark` (grep `src/`: 0 trafień; `<html lang="en">` w `src/layouts/Layout.astro:14`), a wariant jest zdefiniowany jako `&:is(.dark *)` (`global.css:4`). Każdy komponent dodany przez `shadcn add` wyrenderuje się dziś w **jasnych** tokenach (`--card: oklch(1 0 0)`, `global.css:10`) — biała karta na granatowej stronie. Podłączenie ciemnego motywu jest warunkiem wstępnym, nie kosmetyką.
3. **Preset `b1s91W2me` zdekodowany** (shadcn CLI 4.21.0, `preset decode`): style `nova`, baseColor `neutral`, theme/chart `cyan`, ikony `lucide`, font `roboto`, radius `medium` (= 0.625rem, jak teraz). W `.dark` preset zmienia względem obecnych wartości **tylko** `primary`, `primary-foreground`, `secondary`, `chart-1..5`, `sidebar-primary`, `sidebar-primary-foreground`; reszta ciemnych tokenów jest identyczna. Surowe wartości: sekcja „Referencja: preset".
4. **Dwie pułapki `shadcn add` w tym repo** (sprawdzone na kopii konfiguracji w scratchpadzie, nie w repo): rejestr `new-york-v4` generuje `import { cn } from "cn"` (paczka npm `cn`, nie `@/lib/utils`) i dokłada zależność `radix-ui`; `separator.tsx` przyszedł z `"use client"` mimo `rsc: false`. Obie rzeczy łamią `CLAUDE.md:82` i `CLAUDE.md:42` — plan musi je poprawiać po każdym `add`.
5. **`backdrop-blur-xl` na karcie jest czystym kosztem.** Pięć wystąpień na karcie (`[id].astro:64`, `:70`, `OfferParameters.astro:60`, `OfferDescription.astro:9`, `OfferGallery.astro:21`); za sekcjami jest wyłącznie gradient `bg-cosmic` (`[id].astro:55`) o prawie jednolitym kolorze, więc rozmycie nie ma czego rozmywać. Pomiar użytkownika: ~9 fps przy przewijaniu bez GPU vs 60 fps bez rozmycia (`change.md`). Wniosek, że usunięcie jest wizualnie neutralne, to inferencja do potwierdzenia screenshotem.
6. **Najsłabiej czytelny tekst na karcie to guardrail produktu.** „nie podano w ogłoszeniu" (`text-white/40 italic`, 4 miejsca) ma szacunkowo ~3,5:1 kontrastu przy `text-sm` — poniżej 4,5:1. `muted-foreground` z presetu daje ~6,9:1 na `card`.

## Referencja: preset b1s91W2me

Źródło: `npx shadcn@4.21.0 preset decode b1s91W2me` i `npx shadcn@4.21.0 init --template astro --preset b1s91W2me` uruchomione w świeżym projekcie w scratchpadzie; CLI rozwiązuje preset przez `https://ui.shadcn.com/init?...&style=nova&baseColor=neutral&theme=cyan&...` (odpowiedź dla `base=base` i `base=radix` ma identyczne `cssVars`). Docs: <https://ui.shadcn.com/docs/changelog/2026-04-preset-commands>, <https://ui.shadcn.com/docs/cli>. Pełny wygenerowany CSS (`:root`, `.dark`, `@theme inline`) zdeponowany w `context/changes/ui-offer-card/preset-b1s91W2me.css` z linią źródła.

```
style nova · baseColor neutral · theme cyan · chartColor cyan · iconLibrary lucide
font roboto · fontHeading inherit · radius medium · menuAccent subtle · menuColor default
```

**Diff `.dark` względem `src/styles/global.css:41-73`** (wynik `shadcn apply b1s91W2me --only theme` na kopii i diff; wszystkie pozostałe ciemne tokeny bez zmian):

```css
--primary:                    oklch(0.922 0 0)          -> oklch(0.45 0.085 224.283)
--primary-foreground:         oklch(0.205 0 0)          -> oklch(0.984 0.019 200.873)
--secondary:                  oklch(0.269 0 0)          -> oklch(0.274 0.006 286.033)
--chart-1:                    oklch(0.488 0.243 264.376)-> oklch(0.865 0.127 207.078)
--chart-2:                    oklch(0.696 0.17 162.48)  -> oklch(0.715 0.143 215.221)
--chart-3:                    oklch(0.769 0.188 70.08)  -> oklch(0.609 0.126 221.723)
--chart-4:                    oklch(0.627 0.265 303.9)  -> oklch(0.52 0.105 223.128)
--chart-5:                    oklch(0.645 0.246 16.439) -> oklch(0.45 0.085 224.283)
--sidebar-primary:            oklch(0.488 0.243 264.376)-> oklch(0.715 0.143 215.221)
--sidebar-primary-foreground: oklch(0.985 0 0)          -> oklch(0.302 0.056 229.695)
```

Poza kolorami preset niesie:
- **Font Roboto**: `@fontsource-variable/roboto` + `--font-sans: 'Roboto Variable', sans-serif` w `@theme inline` + `html { @apply font-sans; }`. `apply --only theme` fontu nie przenosi. To nowa zależność — decyzja użytkownika.
- **Skala promieni nova**: `--radius-sm/md/xl` jako `calc(var(--radius) * 0.6 / 0.8 / 1.4)` plus `--radius-2xl..4xl`. Repo ma `calc(var(--radius) - 4px)` itd. (`global.css:76-79`). `apply --only theme` dodał tylko `2xl..4xl`, istniejących nie ruszył.
- **Styl `nova` ≠ `new-york`** (`components.json:3`). Styl nie zmienia się po inicjalizacji (<https://ui.shadcn.com/docs/components-json>), więc `shadcn add` w repo generuje kształty `new-york-v4` (np. card: `gap-6 rounded-xl border bg-card py-6 shadow-sm`), a nie nova (`ring-1 ring-foreground/10`, prop `size`). Wynik: kolory nova, kształty new-york — nie będzie identyczny piksel w piksel z podglądem na ui.shadcn.com.

**Kontrast tokenów presetu w ciemnym motywie** (obliczone z oklch → sRGB, WCAG; `scratchpad/oklch.mjs`, szacunek bez renderu):

| Para | Kontrast | Uwaga |
| --- | --- | --- |
| `primary` jako tekst na `background` / `card` | 2,73 / 2,47 | **poniżej 4,5** — linki `text-primary` (np. `button.tsx:19`, wariant `link`) będą nieczytelne |
| `primary-foreground` na `primary` (przycisk) | 6,97 | OK |
| `muted-foreground` na `card` / `background` | 6,91 / 7,63 | OK — kandydat dla „nie podano" i tekstu drugorzędnego |
| `chart-2` (`oklch 0.715 cyan`) na `card` | 7,58 | ewentualny kolor linku, gdyby dodać osobny token |
| `ring` (pełny) na `card` / `ring/50` na `card` | 3,79 / 1,87 | `outline-ring/50` z `global.css:119` daje fokus prawie niewidoczny |

## Zarzuty

Numeracja stała, żeby plan mógł się do nich odwoływać. „Wpływ" = jedno zdanie o skutku dla użytkownika. Zakres: karta + wspólna rama (`Layout.astro`, `Topbar.astro`, `Banner.astro`, `global.css`).

### Kategoria 1 — brakujące tokeny

| # | Plik:linia | Co jest | Token, który powinien to pokryć | Wpływ na użytkownika |
| --- | --- | --- | --- | --- |
| T1 | `src/layouts/Layout.astro:14`, `src/styles/global.css:4`, `:41-73` | Ciemne wartości istnieją, ale nigdzie nie ma klasy `dark` ani `color-scheme: dark` (grep `src/`: 0 trafień dla obu); `body` dostaje jasne `bg-background` (`global.css:122`). Ciemny wygląd karty pochodzi z hexów `bg-cosmic`, nie z tokenów | `.dark` aktywne globalnie (lub ciemne wartości w `:root`) + `color-scheme: dark` | Każdy dodany prymityw shadcn będzie jasny na ciemnej stronie; natywne kontrolki i scrollbar zostają jasne |
| T2 | `src/styles/global.css:113-115`, `src/pages/offers/[id].astro:55` | `@utility bg-cosmic` z trzema hexami (`#0a0e1a`, `#0f1529`) — surowe wartości w pliku tokenów, poza `:root`/`.dark` | `bg-background` | Tło strony nie reaguje na zmianę tokenów; preset nie dotrze do tła karty |
| T3 | `[id].astro:64`, `:70`; `OfferParameters.astro:60`, `:65`, `:85`; `OfferDescription.astro:9`; `OfferGallery.astro:21`, `:33` | Powierzchnie i obramowania literałami `bg-white/10`, `bg-white/5`, `border-white/10`, `border-white/15` | `bg-card`, `border-border` (`--border` ciemny = `oklch(1 0 0 / 10%)`, czyli dziś ta sama wartość) | Zmiana motywu nie dociera do sekcji karty; dwa różne „subtelne" obramowania (10% i 15%) bez roli |
| T4 | `[id].astro:66`, `:78`, `:82`; `OfferParameters.astro:66`, `:85`; `OfferDescription.astro:12`; `Topbar.astro:5`, `:8`, `:22` | Tekst drugorzędny w pięciu odcieniach: `blue-100/80`, `blue-100/70`, `blue-50/90`, `blue-50`, `white/80` | `text-muted-foreground` / `text-foreground` | Hierarchia tekstu jest przypadkowa — etykieta parametru, lokalizacja i opis mają różne kolory bez różnicy znaczenia |
| T5 | `[id].astro:50` (stała `unstated`), `OfferParameters.astro:70`, `:81`; `OfferGallery.astro:24` | „Nie podano" jako `text-white/40 italic` — szacunkowo ~3,5:1 na panelu (`scratchpad/contrast.mjs`, blend `white/10` na `#0a0e1a`/`#0f1529`) | `text-muted-foreground` (~6,9:1 na `card` w presecie) | Guardrail z `prd.md:179` („nie podano w ogłoszeniu") jest najmniej czytelnym tekstem na karcie, poniżej AA dla `text-sm` |
| T6 | `[id].astro:59`, `:90`; `Topbar.astro:10`, `:14`, `:23` | Linki `text-purple-300 hover:text-purple-100` — brak tokenu akcentu dla linku; `primary` z presetu jako tekst ma 2,5–2,7:1 | Decyzja w planie: link na `primary` jest nieczytelny (patrz tabela kontrastu) — potrzebny osobny token albo inny kolor z presetu | Fiolet nie należy do presetu cyan; prosta podmiana na `text-primary` pogorszy czytelność linków |
| T7 | `src/styles/global.css:119`; brak `focus-visible:` na linkach `[id].astro:59`, `:90`, `OfferGallery.astro:29-34`, `Topbar.astro:10`, `:14`, `:23` | Fokus = domyślny outline przeglądarki z kolorem `ring/50`; dziś (jasny `--ring`, bo `.dark` nieaktywne) ~2,4–2,7:1 na tle karty, po włączeniu `.dark` ~1,9:1 | `--ring` o kontraście ≥3:1 i jawny `focus-visible:ring-*` na linkach | Użytkownik klawiatury słabo lub wcale nie widzi, gdzie jest (renderowanie outline'u z `outline-style: auto` zależy od przeglądarki — do potwierdzenia screenshotem) |
| T8 | `[id].astro:71` | Nagłówek jako gradient `from-blue-200 to-purple-200 bg-clip-text text-transparent` | `text-foreground` (lub token nagłówka) | Tytuł oferty wygląda jak generyczny „AI look" wymieniony w lekcji (`context/praca-nad-interfejsem-graficznym-aplikacji-ui.md:12`); gradient nie należy do presetu |
| T9 | `src/components/Banner.astro:27-41` | Trzy warianty banera na hexach jasnej palety (`#dbeafe`, `#fef3c7`, `#fee2e2`…) | `destructive` istnieje; brak tokenów `info`/`warning` — do dodania w źródle albo zmapowania na istniejące | Na karcie baner „oferta była już zapisana" (`[id].astro:54`) i baner braku konfiguracji (`Layout.astro:23`) to jasne pastelowe pasy nad ciemną stroną |

### Kategoria 2 — brakujący wspólny komponent

| # | Plik:linia | Duplikat | Komponent, który zastępuje | Wpływ na użytkownika |
| --- | --- | --- | --- | --- |
| K1 | `[id].astro:64`, `:70`; `OfferParameters.astro:60`; `OfferDescription.astro:9`; `OfferGallery.astro:21` | Pięć kopii ramy sekcji `rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl` | `npx shadcn add card` → `src/components/ui/card.tsx` (new-york-v4: `rounded-xl border bg-card py-6 shadow-sm`, bez blur) | Przewijanie karty bez GPU ~9 fps zamiast 60 (pomiar użytkownika, `change.md`); rozmycie nad jednolitym gradientem nie daje widocznego efektu (inferencja) |
| K2 | `OfferParameters.astro:83-87` | Chipy udogodnień `rounded-full border border-white/15 bg-white/5 px-3 py-1` | `npx shadcn add badge` (wariant `outline`/`secondary`) | Chip wygląda inaczej niż każdy przyszły znacznik (status audytu S-04, „stale" S-09 — `roadmap.md:126`, `:190`) |
| K3 | `[id].astro:59`, `:90`; `Topbar.astro:10`, `:14`, `:23` | Pięć kopii klas linku (w tym `<button>` wylogowania udający link, `Topbar.astro:14`) | `buttonVariants({ variant: "link" })` z istniejącego `button.tsx:19` — czysta funkcja, wywoływalna w `.astro` — z zastrzeżeniem T6 (kolor) | Każdy nowy slice kopiuje linki ręcznie; stany hover/focus rozjeżdżają się między widokami |
| K4 | `[id].astro:50`, `:75-83`; `OfferParameters.astro:70-72`, `:80-81`; `OfferGallery.astro:23-24` | Prezentacja „nieznane" (guardrail z `CLAUDE.md:55`) zakodowana w czterech miejscach tą samą parą klas i różnymi tekstami | Lokalny komponent repo (np. `src/components/offers/Unstated.astro`) — nie ma go w shadcn | S-04…S-09 lądują na karcie (`roadmap.md:126`, `:141`, `:165`, `:178`, `:190`) i każdy przepisze regułę sam; `CLAUDE.md:55` wskazuje `OfferParameters.astro` jako wzorzec — przy wydzieleniu trzeba przepiąć tę referencję |

Kandydat bez zarzutu: `OfferParameters.astro:62-77` to ręczna, ale semantyczna tabela (`<th scope="row">`); `npx shadcn add table` dałby tylko klasy. Nie wpływa na użytkownika — do decyzji w planie, nie zarzut.

### Kategoria 3 — przypadkowa architektura

| # | Ścieżka | Co jest | Co widzi użytkownik | Poprawka w punkcie wejścia |
| --- | --- | --- | --- | --- |
| A1 | `src/layouts/Layout.astro:21-37`; `[id].astro:55-57`; `Welcome.astro:5`, `:18`; `dashboard.astro:10`; `signin.astro:9` | Rama aplikacji (tło, kontener, Topbar) żyje w każdym widoku osobno; `Layout` renderuje tylko banery i `<slot/>`. Topbar jest na karcie i na stronie głównej, ale nie na dashboardzie (grep `Topbar`: `Welcome.astro:2,18`, `[id].astro:4,57`) | Przechodząc dashboard → karta użytkownik traci i odzyskuje pasek z e-mailem i wylogowaniem; każdy z 9 zaplanowanych slice'ów (S-03…S-11, `roadmap.md:42-54`) skopiuje ramę od nowa | Rama (klasa motywu, tło, kontener, Topbar) w `Layout.astro` lub w jednym komponencie-powłoce |
| A2 | `Layout.astro:14`, `global.css:4` | Motyw nie jest podpięty w punkcie wejścia (zob. T1); przez to warianty `dark:` w `button.tsx:14-18` nigdy nie działają | Pierwszy dodany prymityw shadcn (card, badge) pokaże się jasny na ciemnej karcie | `class="dark"` na `<html>` w `Layout.astro` albo ciemne wartości przeniesione do `:root` — do decyzji w planie |
| A3 | `Layout.astro:22-35`; `[id].astro:54` | Banery renderują się **nad** ramą strony, poza kontenerem `max-w-4xl`; baner duplikatu stoi nad Topbarem, oderwany od nagłówka oferty | Po przekierowaniu z formularza z `?duplicate=1` informacja pojawia się jako jasny pas na pełną szerokość, zanim użytkownik zobaczy, której oferty dotyczy | Miejsce na komunikat strony w ramie (np. pod Topbarem, w szerokości kontenera) |
| A4 | `Layout.astro:14` (`lang="en"`); `Topbar.astro:11`, `:15`, `:22`, `:24`; `[id].astro:60` | Dokument oznaczony jako angielski, rama po angielsku („Dashboard", „Sign out", „Not signed in", „Sign in"), treść karty po polsku („← Wróć do dashboardu") | Czytnik ekranu czyta polską treść z angielską fonetyką; w jednym pasku mieszają się dwa języki | Decyzja o języku ramy — S-01 zostawił UI logowania po angielsku świadomie („UI pozostaje po angielsku", `context/archive/2026-09-21-closed-team-sign-in/plan.md:76`), ale nic nie mówi o Topbarze na polskiej karcie |
| A5 | `src/components/ui/LibBadge.astro` | Komponent w katalogu prymitywów, który nie jest prymitywem shadcn, jest na literałach (`bg-blue-900/50`, `purple-500/30`) i nie ma konsumentów (grep `LibBadge` w `src/`: tylko sam plik) | Nic widocznego dziś; reguła „UI tylko z `src/components/ui`" zaprosi agentów do używania martwego, niestokenizowanego komponentu | Usunąć albo przenieść poza `ui/` przed dopisaniem reguły do `CLAUDE.md` |

**Sprawdzone wejścia bez zarzutu** (pytanie z `/10x-ui`: wylogowany / bez danych / z linku):
- Wylogowany → `/offers/*` jest w `PROTECTED_ROUTES` (`src/middleware.ts:4`), przekierowanie na `/auth/signin` (`:18-20`).
- Zły/nieistniejący id → 404 z gałęzią „Nie znaleziono oferty" w tej samej ramie (`[id].astro:21-38`, `:63-67`).
- Brak danych → każdy parametr ma wiersz (`OfferParameters.astro:33-55`), pusta galeria ma komunikat (`OfferGallery.astro:23-24`), puste udogodnienia mają komunikat (`OfferParameters.astro:80-81`).
- Bez Supabase → 404, nie 500 (`[id].astro:24`).

### Odłożone (poza zakresem, zapisane)

| Plik:linia | Zarzut | Kategoria |
| --- | --- | --- |
| `src/pages/auth/signin.astro:9-11` | `bg-cosmic`, rama `white/10` + `backdrop-blur-xl`, nagłówek-gradient | T2, K1, T8 |
| `src/pages/dashboard.astro:10-12` | j.w.; brak Topbara (A1) | T2, K1, T8, A1 |
| `src/pages/dashboard.astro:23-28` | Drugi przycisk „Sign out" z literałów zamiast `Button` | K |
| `src/components/Welcome.astro:5`, `:40`, `:62`, `:85` | `bg-cosmic`; trzy ramy `white/5` + `backdrop-blur-xl` | T2, K1 |
| `src/components/auth/SubmitButton.tsx:21` | `Button` nadpisany `bg-purple-600 … hover:bg-purple-500` — kolor spoza tokenów na jedynym konsumencie `ui/button` | T |
| `src/components/auth/FormField.tsx`, `PasswordToggle.tsx`, `ServerError.tsx` | Literały kolorów (linie z trafieniem wg grepa: 5, 1, 1); `AddOfferForm.tsx` sam ma 0 trafień — dziedziczy wygląd po `FormField`/`SubmitButton` | T |

Uwaga dla planu: po T1/A2 (włączenie `.dark`) i zmianie tokenów te widoki **nie** zmienią wyglądu, bo nie czytają tokenów — ale `SubmitButton` używa `button.tsx`, którego warianty `dark:` zaczną działać; jego klasy nadpisują jednak kolor tła. Do sprawdzenia screenshotem signin/dashboard po zmianie globalnej.

## Detailed Findings

### Źródło wartości i kto je czyta

- `:root` (`global.css:6-39`), `.dark` (`:41-73`), `@theme inline` publikujący `--color-*` (`:75-111`) — poprawna konstrukcja Tailwind v4 + shadcn; wartości to stock `neutral`.
- `@layer base` (`:117-124`): `* { border-border outline-ring/50 }`, `body { bg-background text-foreground }`.
- Klasy semantyczne w `src/**/*.astro|tsx`: jedyny plik to `src/components/ui/button.tsx` (grep na `bg|text|border|ring-(background|foreground|card|primary|…)`). Jedyny konsument `ui/button` to `src/components/auth/SubmitButton.tsx:3`.
- Pliki z literałami kolorów (grep `(white|blue|purple|…)-NNN|white/NN|#hex`, liczba linii z trafieniem): `Welcome.astro` 14, `[id].astro` 9, `Banner.astro` 9, `OfferParameters.astro` 6, `Topbar.astro` 6, `FormField.tsx` 5, `dashboard.astro` 5, `OfferGallery.astro` 3, `signin.astro` 3, `OfferDescription.astro` 2, `SubmitButton.tsx` 2, `LibBadge.astro` 2, `ServerError.tsx` 1, `PasswordToggle.tsx` 1, `global.css` 1.

### Katalog komponentów

- `src/components/ui/`: `button.tsx` (shadcn new-york), `LibBadge.astro` (niezwiązany ze shadcn, bez konsumentów).
- `components.json`: `style: new-york`, `baseColor: neutral`, `cssVariables: true`, `iconLibrary: lucide`, aliasy `@/components/ui`, `@/lib/utils`.
- Zależności już w `package.json`: `@radix-ui/react-slot` (`:22`), `class-variance-authority` (`:29`), `lucide-react` (`:31`), `tailwind-merge` (`:34`), `tw-animate-css` (`:36`).

### `shadcn add` w tym repo (sprawdzone na kopii w scratchpadzie)

`npx shadcn@4.21.0 add card badge table separator -y` na kopii `components.json`/`package.json`/`global.css`/`utils.ts`:
- utworzył 4 pliki, **nie zmienił** `global.css`;
- dodał zależności `cn@^0.4.0` i `radix-ui@^1.6.7`;
- wszystkie cztery pliki importują `cn` z `"cn"`, nie z `@/lib/utils` (zweryfikowane: `scratchpad/repocopy/src/components/ui/*.tsx:1-5`);
- `separator.tsx:1` = `"use client"`;
- `badge.tsx` bierze `Slot` z `radix-ui` (umbrella), a istniejący `button.tsx:2` z `@radix-ui/react-slot` — dwie ścieżki do tego samego prymitywu.

Runtime: `card.tsx` i `table.tsx` to zwykłe komponenty funkcyjne bez hooków; `badge.tsx` — `cva` + `Slot` tylko przy `asChild`; `separator.tsx` — Radix bez stanu/efektów. Komponent frameworka użyty w `.astro` bez `client:*` renderuje się do statycznego HTML bez JS (Astro docs: <https://github.com/withastro/docs/blob/main/src/content/docs/en/guides/framework-components.mdx>), więc nie łamie reguły „React island tylko przy stanie" (`CLAUDE.md:80`). Render w Astro nie był sprawdzony — tylko inspekcja źródeł.

### Rama

- `Layout.astro` przyjmuje tylko `title` (`:6-10`), renderuje banery z `missingConfigs` (`:22-35`) i `<slot/>`; styl `html, body { height: 100% }` (`:40-47`).
- `Topbar.astro` czyta `Astro.locals.user` (`:2`), ma gałąź zalogowany/niezalogowany (`:6-27`), jest `<div>` bez landmarku `<nav>`/`<header>`.

## Code References

- `src/styles/global.css:4` — `@custom-variant dark (&:is(.dark *))`
- `src/styles/global.css:41-73` — blok `.dark` (nieaktywny)
- `src/styles/global.css:113-115` — `bg-cosmic` z hexami
- `src/styles/global.css:119` — `outline-ring/50` (kolor fokusu)
- `src/layouts/Layout.astro:14` — `<html lang="en">` bez klasy motywu
- `src/pages/offers/[id].astro:50` — stała `unstated`
- `src/pages/offers/[id].astro:54-57` — baner duplikatu, tło, Topbar
- `src/pages/offers/[id].astro:64`, `:70` — sekcje z `backdrop-blur-xl`
- `src/pages/offers/[id].astro:71` — nagłówek-gradient
- `src/components/offers/OfferParameters.astro:60-88` — tabela parametrów, chipy
- `src/components/offers/OfferDescription.astro:9-12`
- `src/components/offers/OfferGallery.astro:21-47`
- `src/components/Topbar.astro:5-27`
- `src/components/Banner.astro:27-41` — hexy wariantów
- `src/components/ui/button.tsx:19` — wariant `link` = `text-primary`
- `src/middleware.ts:4`, `:18-20` — ochrona `/offers`

## Architecture Insights

- Kontrakt ma obie połówki (tokeny + komponenty w repo), ale widoki omijają pierwszą i prawie całą drugą. Zgodnie z `/10x-ui` („value source nothing reads") faza 1 to podpięcie istniejących tokenów, a dopiero potem preset — przy czym tutaj preset zmienia w `.dark` tylko 10 wartości, więc obie rzeczy mieszczą się w jednej fazie tokenów.
- **Widoczna zmiana motywu**: po przejściu na tokeny tło zmieni się z granatowego gradientu (`#0a0e1a`→`#0f1529`) na neutralny `oklch(0.145 0 0)`, a sekcje na `oklch(0.205 0 0)`. Preset `neutral` + `cyan` nie ma granatu — „kosmiczny" charakter zniknie. To zgodne z presetem, ale warto to nazwać przed screenshotem.
- Karta nie ma stanów interaktywnych poza hover/focus linków i miniatur — `disabled`/`loading`/`error` nie występują na tym widoku (404 to jedyny stan błędu). Kitchen sink musi pokryć: pełna oferta, wszystkie parametry nieznane, brak zdjęć, 1 zdjęcie, brak udogodnień, baner duplikatu, baner konfiguracji, 404, bardzo długi tytuł bez spacji, fokus na linkach.

## Historical Context (from prior changes)

- `context/archive/2026-09-22-paste-listing-to-card/plan.md:324-340` — kontrakt karty: 404 zamiast 500, `?duplicate=1` → `<Banner variant="info">`, sekcje nagłówek/parametry/opis/galeria, czyste `.astro` bez `client:` (`:349`). Nadal aktualne (zgadza się z `[id].astro`).
- `.../plan.md:332` i `prd.md:179` — „nie podano w ogłoszeniu" wyszarzone, każdy parametr ma wiersz. Aktualne; „wyszarzone" jest dziś realizowane kontrastem poniżej AA (T5).
- `context/archive/2026-09-21-closed-team-sign-in/plan.md:76` — „UI pozostaje po angielsku" dla ekranów logowania/Welcome. Dotyczy S-01; nie rozstrzyga języka ramy na polskiej karcie (A4).
- `context/archive/2026-09-22-paste-listing-to-card/reviews/impl-review.md:138-145` — 8 ustaleń, wszystkie naprawione, żadne wizualne; brak odłożonych ustaleń UI.
- `roadmap.md:265` — lightbox odłożony (m.in. ręczna obsługa fokusu); zdjęcia otwierają się w nowej karcie. Nadal aktualne (`OfferGallery.astro:29-34`).
- Brak w `context/**` jakiejkolwiek decyzji o motywie, kolorach, fontach, „cosmic", blur (przeszukane: `context/foundation/*`, `context/archive/**`, `context/changes/**` poza tym folderem, `README.md`).

## Related Research

Nie dotyczy — brak wcześniejszych `research.md` o UI w `context/changes/**` ani `context/archive/**`.

## Open Questions

Decyzje dla `/10x-plan` (nie rozstrzygane tutaj):

1. **Kolor linku** (T6/K3): `primary` presetu jako tekst ma ~2,5:1. Opcje: osobny token linku (np. wartość `chart-2`/`sidebar-primary` ~7,6:1), link w `foreground` z podkreśleniem, albo odejście od presetu dla `primary` w `.dark`.
2. **Mechanizm „tylko ciemny"** (T1/A2): `class="dark"` na `<html>` (zostawia oba bloki, zgodne ze shadcn) vs ciemne wartości w `:root` i usunięcie `.dark` (mniej ruchomych części, ale warianty `dark:` w komponentach shadcn przestają działać). Plus `color-scheme: dark`.
3. **Font Roboto**: przyjąć (nowa zależność `@fontsource-variable/roboto`) czy zostać przy systemowym?
4. **Skala promieni**: zostać przy formułach repo (`- 4px`) czy przejąć nova (`* 0.6`)?
5. **Język ramy** (A4): `lang="pl"` i polski Topbar na karcie, czy zostawić angielską ramę S-01?
6. **Po `shadcn add`**: poprawiać import `cn` na `@/lib/utils` i usuwać `"use client"` ręcznie po każdym `add` (i nie dokładać `cn`), czy przypiąć starszą wersję CLI/rejestru? `radix-ui` umbrella vs `@radix-ui/react-slot`.
7. **Tokeny `info`/`warning`** dla `Banner` (T9): dodać do źródła czy zmapować na istniejące role?
8. **Mobile**: PRD obiecuje tylko desktop (`prd.md:129`), lekcja wymaga jednej szerokości mobilnej na screenshocie (`context/praca-nad-interfejsem-graficznym-aplikacji-ui.md:349`) — screenshot mobilny jako sanity check, nie bramka?
9. **Dark-only vs lekcja**: lekcja zakłada oba motywy w widoku testowym (`praca-…-ui.md:360`); przy „ciemny jako jedyny" kitchen sink sprawdza tylko ciemny — do odnotowania w planie jako świadome odstępstwo.
