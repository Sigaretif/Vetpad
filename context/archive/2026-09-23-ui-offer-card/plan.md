# Karta oferty jako widok wzorcowy — plan implementacji

## Overview

Karta `/offers/[id]` przechodzi z literałów (`white/10`, `blue-100/80`, `purple-300`, `bg-cosmic`, `backdrop-blur-xl`) na tokeny presetu shadcn `b1s91W2me` w istniejącym `src/styles/global.css`, z ciemnym motywem jako jedynym. Dostaje wspólną ramę `AppLayout` (tło, kontener, polski Topbar, miejsce na komunikat), prymitywy `card` i `badge` dodane przez `shadcn add` oraz kitchen sink `/dev/offer-card` jako bramkę wizualną. Nowe slice'y (S-04…S-09 lądują na karcie) dziedziczą ramę, tokeny i regułę w `CLAUDE.md`.

## Current State Analysis

Pełny audyt: `context/changes/ui-offer-card/research.md` (zarzuty T1–T9, K1–K4, A1–A5, tabela „Odłożone"). Skrót:

- `global.css:6-111` ma kompletne `:root` / `.dark` / `@theme inline`, ale jedynym czytelnikiem tokenów jest `src/components/ui/button.tsx`. Blok `.dark` jest martwy: nic nie dostaje klasy `dark` (`Layout.astro:14`), więc każdy dodany prymityw shadcn wyrenderuje się jasny.
- Karta maluje się literałami na `bg-cosmic` (`global.css:113-115`, `[id].astro:55`); pięć ram z `backdrop-blur-xl` kosztuje ~9 fps przy przewijaniu bez GPU (`change.md`).
- „Nie podano w ogłoszeniu" (`text-white/40 italic`) ma ~3,5:1 — guardrail produktu jest najmniej czytelnym tekstem na karcie (T5).
- Linki fioletowe spoza presetu; `primary` presetu jako tekst ma ~2,5:1 (T6). Fokus `ring/50` ~1,9:1 po włączeniu `.dark` (T7).
- Rama (tło, kontener, Topbar) żyje w każdym widoku osobno; `Layout` renderuje tylko banery i `<slot/>` (A1). Banery stoją nad ramą, poza kontenerem (A3). `lang="en"` przy polskiej treści, Topbar po angielsku (A4).
- Nagłówek oferty jest wpisany w `[id].astro:70-95`, więc nie da się go wyrenderować z danych testowych bez strony z Supabase.
- `shadcn add` w tym repo (sprawdzone na kopii) generuje `import { cn } from "cn"`, dokłada paczki `cn` i `radix-ui`, a `separator` przychodzi z `"use client"`.

## Desired End State

- Każdy ekran renderuje się w ciemnym motywie z tokenów (`<html class="dark">`, `color-scheme: dark`); wartości presetu `b1s91W2me` siedzą w `global.css` z linią źródła.
- Karta i jej rama nie zawierają ani jednego literału koloru, `bg-cosmic` ani `backdrop-blur`; sekcje to `Card`, udogodnienia to `Badge`, linki to `buttonVariants({ variant: "link" })` w kolorze `text-link`, „nie podano" to `Unstated` w `text-muted-foreground`.
- `AppLayout` daje `lang="pl"`, tło, kontener, polski Topbar i slot na komunikat strony pod Topbarem; karta go używa.
- `/dev/offer-card` w `astro dev` pokazuje kartę we wszystkich stanach z fixture'ów, bez Supabase; w buildzie produkcyjnym zwraca 404, co pilnuje krok w `scripts/smoke.mjs`.
- `CLAUDE.md` nakazuje nowym slice'om budować UI tylko z tokenów, `src/components/ui` i `AppLayout`, i opisuje rytuał po `shadcn add`.

Weryfikacja: automatyczne kontrole w każdej fazie + zrzut kitchen sinka (desktop, fokus) jako bramka i jeden zrzut mobilny jako kontrola.

### Key Discoveries:

- `global.css:4` — `@custom-variant dark (&:is(.dark *))`: klasa na `<html>` wystarcza, żeby włączyć `.dark` i warianty `dark:` w `button.tsx:14-18`.
- `button.tsx:19` — wariant `link` = `text-primary`; `buttonVariants` to czysta funkcja, wywoływalna w `.astro`, z wbudowanym `focus-visible:ring-[3px]` (rozwiązuje fokus linków).
- `Welcome.astro:2,18` — Topbar jest też na stronie głównej, więc polski Topbar zmienia ją (decyzja: polski wszędzie).
- `smoke` w `.github/workflows/ci.yml` buduje i biegnie po `npm run preview`, więc `import.meta.env.DEV` jest tam `false` — krok 404 dla `/dev/offer-card` testuje build produkcyjny.
- `safeHttpsUrl` (`src/lib/safe-url.ts`) przepuszcza tylko absolutne `https:` — fixture'y zdjęć muszą mieć zewnętrzny host https; wpis z `http:`/`javascript:` sprawdza przy okazji filtr.
- `CardTitle` z rejestru new-york-v4 to `<div>`, nie nagłówek — semantyka `h1/h2/h3`, `header`, `section` musi zostać po stronie `.astro`.
- `CLAUDE.md` („Product invariants", pierwszy punkt) wskazuje `src/components/offers/OfferParameters.astro` jako wzorzec prezentacji „nieznane" — po wydzieleniu `Unstated.astro` referencja musi się przepiąć.

## What We're NOT Doing

- Signin, dashboard, strona główna zostają po staremu (odłożone, tabela „Odłożone" w research): `bg-cosmic`, ramy z blurem, nagłówki-gradienty, drugi „Sign out" w `dashboard.astro:23-28`, `SubmitButton.tsx:21`, literały w `FormField`/`PasswordToggle`/`ServerError`. Utility `bg-cosmic` zostaje w `global.css`, bo te widoki go używają (T2 rozwiązane tylko na karcie).
- Hero Welcome zostaje po angielsku, `Layout` domyślnie `lang="en"` — strona główna miesza języki (polski Topbar) do czasu odłożonej migracji.
- Bez przełącznika motywów i bez jasnego motywu w bramce: ciemny jest jedynym. **Świadome odstępstwo od lekcji** (`context/praca-nad-interfejsem-graficznym-aplikacji-ui.md:360` zakłada oba motywy w widoku testowym). Blok `:root` dostaje wartości presetu, ale nie jest sprawdzany zrzutem.
- Bez `shadcn init` i bez zmiany `style` w `components.json` (new-york zostaje; kolory nova, kształty new-york — nie piksel w piksel z podglądem presetu).
- Bez `shadcn add table` i `separator`: tabela parametrów jest semantyczna i nie ma zarzutu.
- Bez Playwright / testów zrzutowych — repo ich nie ma; bramka to zrzut z przeglądarki.
- Bez lightboxa galerii (`roadmap.md:265`).

## Implementation Approach

Kolejność z `/10x-ui`: najpierw środowisko (zależności, prymitywy), potem wartości w jednym źródle, dopiero potem jeden widok, na końcu stany i bramka. Motyw jest globalnym tokenem (bazowy `Layout`), rama — opcjonalną powłoką (`AppLayout`), żeby odłożone widoki nie zmieniły struktury. Karta zostaje rozbita na komponenty renderowalne z samych danych (`OfferCard`, `OfferNotFound`, `Unstated`), żeby kitchen sink używał dokładnie tych samych plików co `/offers/[id]`.

## Critical Implementation Details

- **Rytuał po `shadcn add`** (każdorazowo, w tej samej fazie): `cn` importowany z `@/lib/utils`; usunąć `"use client"`; `Slot` z `@radix-ui/react-slot` (jak `button.tsx:2`), nie z parasolowego `radix-ui`; z `package.json` i `package-lock.json` znikają `cn` i `radix-ui`, jeśli CLI je dodało. Sprawdzone w research: CLI robi wszystkie trzy rzeczy.
- **React w `.astro` bez `client:*`** renderuje statyczny HTML bez JS — `Card`/`Badge` nie łamią reguły o wyspach. Dzieci ze slotu Astro mogą zostać owinięte elementem pośrednim; sprawdzić w DOM, że `gap` w `Card` (flex-col) działa między sekcjami, zanim zacznie się poprawiać odstępy klasami.
- **Fokus w warstwie tokenów**: `ring-ring/50` jest mieszane przez `color-mix` w oklab, nie w sRGB — kontrast ≥3:1 dla ciemnego `--ring` przy 50% trzeba policzyć na wartości mieszanej (albo zmierzyć na zrzucie), nie na pełnym kolorze.
- **404 strony dev** przez `Astro.response.status = 404` i gałąź „nie znaleziono" (reguła „Framework" w `CLAUDE.md`, wzorzec `[id].astro:35-38`) — bez `return` we frontmatterze.

## Faza 1: Środowisko i biblioteka

### Overview

Zależności i prymitywy, które zużyją fazy 2–4, zanim ruszy jakikolwiek widok.

### Changes Required:

#### 1. Font Roboto

**File**: `package.json`, `package-lock.json`

**Intent**: Dodać `@fontsource-variable/roboto` — font presetu (decyzja 3). Import w CSS dochodzi w fazie 2.

**Contract**: nowa zależność w `dependencies`; nic poza nią.

#### 2. Prymitywy `card` i `badge`

**File**: `src/components/ui/card.tsx`, `src/components/ui/badge.tsx` (nowe, przez `npx shadcn@latest add card badge`)

**Intent**: Wspólna rama sekcji (K1) i znacznik (K2), dodane ścieżką stacku, nie ręcznie. Zaraz po `add` wykonać rytuał z „Critical Implementation Details".

**Contract**: `card.tsx` eksportuje `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` (+ ewentualnie `CardAction`); `badge.tsx` eksportuje `Badge`, `badgeVariants`. Oba importują `cn` z `@/lib/utils`, bez `"use client"`; `global.css` niezmieniony przez CLI (jeśli CLI go ruszy — cofnąć, tokeny są w fazie 2).

#### 3. Usunięcie `LibBadge`

**File**: `src/components/ui/LibBadge.astro` (usunięty)

**Intent**: A5 — martwy, niestokenizowany komponent w katalogu prymitywów zaprosiłby agentów po regule z fazy 4.

**Contract**: plik usunięty; brak konsumentów (grep potwierdzony w research).

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą
- `grep -rn 'from "cn"\|"use client"\|from "radix-ui"' src/components/ui` nic nie zwraca
- `package.json` nie zawiera `"cn"` ani `"radix-ui"`, zawiera `@fontsource-variable/roboto`
- `src/components/ui/LibBadge.astro` nie istnieje, `grep -rn LibBadge src` nic nie zwraca

#### Manual Verification:

- Diff `card.tsx`/`badge.tsx` względem wyjścia CLI ogranicza się do importów i dyrektywy

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne przed fazą 2.

---

## Faza 2: Tokeny

### Overview

Wartości presetu `b1s91W2me` w istniejącym źródle, motyw ciemny włączony globalnie, nowe role (`link`, `info`, `warning`), fokus poprawiony w warstwie tokenów.

### Changes Required:

#### 1. Źródło wartości

**File**: `src/styles/global.css`

**Intent**: Przenieść wartości z `context/changes/ui-offer-card/preset-b1s91W2me.css` do istniejących zmiennych (bez drugiej palety), dodać brakujące role i fokus.

**Contract**:
- Komentarz nad `:root` nazywający źródło: preset `b1s91W2me`, link `https://ui.shadcn.com/create?template=astro&preset=b1s91W2me`, plik depozytu w folderze zmiany.
- `:root` i `.dark`: wartości presetu (w `.dark` zmieniają się `primary`, `primary-foreground`, `secondary`, `chart-1..5`, `sidebar-primary`, `sidebar-primary-foreground` — diff w research; `:root` analogicznie z depozytu). Oba bloki zostają (decyzja 2).
- `.dark` dostaje `color-scheme: dark`.
- Nowy `--link` w obu blokach: `.dark` = wartość `chart-2` presetu (`oklch(0.715 0.143 215.221)`, ~7,6:1 na `card`), `:root` = `oklch(0.52 0.105 223.128)` (`chart-4` presetu); publikacja `--color-link` w `@theme inline` (decyzja 1).
- Nowe `--info`, `--info-foreground`, `--warning`, `--warning-foreground` w obu blokach, opublikowane jako `--color-*` (decyzja 7). `info` z rodziny cyan presetu (np. ciemne tło `oklch(0.302 0.056 229.695)` — `sidebar-primary-foreground` presetu — z jasnym tekstem `oklch(0.984 0.019 200.873)`); `warning` spoza presetu (preset nie ma bursztynu) — wartość z domyślnej palety Tailwind v4 (`amber-*`), z komentarzem źródła. Warunek: tekst `-foreground` na tle ≥4,5:1 w `.dark`.
- `.dark --ring` = `oklch(0.865 0.127 207.078)` (`chart-1` presetu) zamiast neutralnego `0.556`, z komentarzem: odstępstwo od presetu, bo `ring/50` z `button.tsx` i `outline-ring/50` z `@layer base` muszą mieć ≥3:1 na `background` i `card` (T7). Wartość do potwierdzenia obliczeniem na mieszance oklab.
- `@theme inline`: `--font-sans: 'Roboto Variable', sans-serif`; skala promieni nova (`--radius-sm/md/xl` jako `calc(var(--radius) * 0.6 / 0.8 / 1.4)`, dodane `--radius-2xl/3xl/4xl` ×1.8/2.2/2.6) (decyzja 4).
- `@import "@fontsource-variable/roboto";` przy pozostałych importach; `html { @apply font-sans; }` w `@layer base`.
- `@utility bg-cosmic` zostaje (odłożone widoki).

#### 2. Motyw i język w bazowym layoucie

**File**: `src/layouts/Layout.astro`

**Intent**: Ciemny motyw to globalny token, nie część ramy — działa na każdym ekranie (A2, T1). `lang` staje się propem, żeby `AppLayout` mógł dać `pl`, a odłożone widoki zostały `en`.

**Contract**: `<html lang={lang} class="dark">`; `Props` = `{ title?: string; lang?: string }`, domyślnie `lang = "en"`. Banery braku konfiguracji bez zmian w miejscu (A3 dotyczy ramy karty, faza 3).

#### 3. Wariant `link` przycisku

**File**: `src/components/ui/button.tsx`

**Intent**: `text-primary` jako tekst ma ~2,5:1; link dostaje własny token, przyciski zostają na `primary` (decyzja 1).

**Contract**: wariant `link` = `text-link underline-offset-4 hover:underline`; nic innego w pliku.

#### 4. Baner na tokenach

**File**: `src/components/Banner.astro`

**Intent**: T9 — trzy warianty na hexach jasnej palety zamiast ról. Dotyczy wszystkich ekranów (baner braku konfiguracji), co jest zmianą globalnego komponentu, nie widoku.

**Contract**: `info` → `bg-info text-info-foreground`, `warning` → `bg-warning text-warning-foreground`, `error` → rola `destructive` (tło przygaszone, tekst ≥4,5:1); obramowanie z tego samego tokenu. Bez hexów w `<style>` (klasy Tailwind albo `var(--…)`). API (`variant`, `role`) bez zmian.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą
- `grep -n '#[0-9a-fA-F]\{3,6\}' src/components/Banner.astro` nic nie zwraca
- `grep -c 'class="dark"' src/layouts/Layout.astro` = 1; `global.css` zawiera `--color-link`, `--color-info`, `--color-warning` w `@theme inline`
- Skrypt kontrastu (scratchpad, oklch → sRGB, WCAG) potwierdza: `link` na `card`/`background` ≥4,5; `muted-foreground` na `card` ≥4,5; `info-foreground`/`warning-foreground` na swoich tłach ≥4,5; `ring` 50% na `card`/`background` ≥3

#### Manual Verification:

- Signin, dashboard i strona główna (bez sesji i bez Supabase — zero-config) wyglądają jak przed zmianą poza fontem, ciemnym banerem konfiguracji i ciemnymi kontrolkami natywnymi; `SubmitButton` nadal fioletowy (zrzut przed/po)
- Polskie znaki w Roboto renderują się fontem, nie fallbackiem (ą, ę, ł, ż na banerze)

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne przed fazą 3.

---

## Faza 3: Jeden widok — karta i rama

### Overview

Rama `AppLayout` i karta zbudowane wyłącznie z tokenów i `src/components/ui`; karta rozbita na komponenty renderowalne z danych.

### Changes Required:

#### 1. Rama aplikacji

**File**: `src/layouts/AppLayout.astro` (nowy)

**Intent**: A1 + A3 — jedna powłoka dla karty i przyszłych slice'ów: tło, kontener, Topbar, komunikat strony w szerokości kontenera pod Topbarem.

**Contract**: `Props` = `{ title?: string }`; renderuje `Layout` z `lang="pl"`, tło `bg-background text-foreground min-h-screen`, kontener `max-w-4xl` z paddingiem, `Topbar`, nazwany slot `notice` (komunikaty strony, np. baner duplikatu) i domyślny slot w `<main>`. Bez `bg-cosmic`, bez blur.

#### 2. Topbar po polsku, na tokenach

**File**: `src/components/Topbar.astro`

**Intent**: A4, T4, T6, K3, T7 — polski wszędzie (także na stronie głównej, decyzja w planie), landmark, linki z jednego źródła.

**Contract**: element `<header>` z `<nav aria-label="…">`; napisy: „Oferty" (link `/dashboard`), „Wyloguj", „Nie zalogowano", „Zaloguj"; e-mail w `text-muted-foreground`; powierzchnia z tokenów (`bg-card`/`border-border`); linki i przycisk wylogowania przez `cn(buttonVariants({ variant: "link" }), …)` z wyzerowaną wysokością/paddingiem rozmiaru domyślnego. Gałęzie zalogowany/niezalogowany bez zmian logiki.

#### 3. Prezentacja „nieznane"

**File**: `src/components/offers/Unstated.astro` (nowy)

**Intent**: K4 + T5 — jedno miejsce reguły „nie podano w ogłoszeniu" (guardrail z `prd.md`), czytelne (~6,9:1).

**Contract**: renderuje slot jako `<span>` w `text-muted-foreground italic`; używany w nagłówku (cena, cena/m², lokalizacja), w tabeli parametrów, w pustych udogodnieniach i w pustej galerii. Stała `unstated` z `[id].astro:50` znika.

#### 4. Karta oferty jako komponenty

**File**: `src/components/offers/OfferCard.astro` (nowy), `src/components/offers/OfferNotFound.astro` (nowy), `src/components/offers/OfferParameters.astro`, `src/components/offers/OfferDescription.astro`, `src/components/offers/OfferGallery.astro`

**Intent**: Nagłówek z `[id].astro:70-95` wraz z wyliczeniami (`price`, `pricePerM`, `sourceUrl`, `images`) trafia do `OfferCard`, który składa nagłówek + parametry + opis + galerię z samego `offer: OfferRow` — tak kitchen sink użyje tych samych plików. Gałąź 404 z `[id].astro:63-67` trafia do `OfferNotFound`. Wszystkie sekcje przechodzą na `Card` (K1, bez blur), tokeny (T3, T4), nagłówek bez gradientu (T8), udogodnienia na `Badge` (K2), linki na `buttonVariants` link (K3, T6).

**Contract**:
- `OfferCard` `Props` = `{ offer: OfferRow }`; `OfferNotFound` bez propsów.
- Semantyka zostaje: `h1` tytuł w `<header>`, `h2` sekcji w `<section>`, `h3` „Udogodnienia"; `CardTitle` (div) nie zastępuje nagłówków.
- Tytuł łamie się bez przewijania poziomego przy długim ciągu bez spacji (`break-words` / `overflow-wrap: anywhere`).
- Miniatury galerii: jawny `focus-visible:` ring z tokenu `ring`; obramowanie `border-border`.
- Każde `href`/`src` z wiersza nadal przez `safeHttpsUrl` (lessons.md).
- Po zmianie w tych plikach i w `Topbar`/`AppLayout` brak klas `white/`, `blue-`, `purple-`, `bg-cosmic`, `backdrop-blur`, `bg-gradient`, `text-transparent`.

#### 5. Strona karty

**File**: `src/pages/offers/[id].astro`

**Intent**: Strona zostaje ładowaniem danych i routingiem stanów: `loadOffer`, status 404, `duplicate` — reszta w komponentach.

**Contract**: `AppLayout` zamiast `Layout`; baner duplikatu w slocie `notice`; link „← Wróć do ofert" przez `buttonVariants` link; `offer === null` → `OfferNotFound`, inaczej `OfferCard`. Logika `loadOffer`, `UUID`, `Astro.response.status = 404` bez zmian.

#### 6. Referencja w `CLAUDE.md`

**File**: `CLAUDE.md`

**Intent**: Pierwszy punkt „Product invariants" wskazuje `OfferParameters.astro` jako wzorzec „nieznane" — po wydzieleniu wzorcem jest `Unstated.astro`.

**Contract**: ścieżka referencji zamieniona na `src/components/offers/Unstated.astro`; reszta punktu bez zmian.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą
- `grep -nE 'white/|blue-|purple-|bg-cosmic|backdrop-blur|bg-gradient|text-transparent' src/pages/offers/\[id\].astro src/components/offers/*.astro src/components/Topbar.astro src/layouts/AppLayout.astro` nic nie zwraca
- `grep -rn 'Unstated' src/components/offers` pokazuje użycie w `OfferCard`, `OfferParameters`, `OfferGallery`; `grep -n 'OfferParameters.astro' CLAUDE.md` nie wskazuje go już jako wzorca „nieznane"
- Smoke na buildzie produkcyjnym przechodzi (`npm run build`, `npm run preview`, `BASE_URL=http://localhost:4321 npm run smoke`; wymaga lokalnego Supabase) — kroki karty 404/302 bez zmian

#### Manual Verification:

- Prawdziwa karta (lokalny Supabase, zapisana oferta) na desktopie: ciemne tło z tokenów, sekcje `Card`, linki cyan, „nie podano" czytelne, baner `?duplicate=1` pod Topbarem w szerokości kontenera
- Przewijanie karty bez GPU płynne (blur usunięty; porównanie z ~9 fps sprzed zmiany)
- Strona główna pokazuje polski Topbar na tokenach i nie ma innych zmian

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne przed fazą 4.

---

## Faza 4: Stany i kitchen sink

### Overview

Bramka wizualna karty we wszystkich stanach, zabezpieczona przed wyciekiem na produkcję, oraz reguła dla następnych slice'ów.

### Changes Required:

#### 1. Dane testowe

**File**: `src/pages/dev/_offer-fixtures.ts` (nowy; prefiks `_` wyłącza plik z routingu)

**Intent**: Wiersze `OfferRow` dla każdego stanu karty, bez Supabase (zero-config).

**Contract**: eksportowane nazwane fixture'y: pełna oferta (wszystkie parametry, kilka udogodnień, kilka zdjęć), wszystko nieznane (każdy nullable = `null`, `features: []`, `images: []`, `source_url` niebędący https — brak linku), jedno zdjęcie, zdjęcia z jednym wpisem `http:` i jednym `javascript:` obok poprawnego (filtr musi przepuścić tylko poprawny), bardzo długi tytuł bez spacji z długim opisem. Adresy zdjęć: zewnętrzny placeholder `https://` (żaden adres otodom.pl, żaden `data:` ani ścieżka względna). Bez numerów telefonów i nazwisk (reguła danych osobowych).

#### 2. Strona kitchen sinka

**File**: `src/pages/dev/offer-card.astro` (nowa)

**Intent**: Jeden widok, wszystkie nazwane stany naraz — zrzut z przeglądarki jest bramką i dowodem do review.

**Contract**:
- W `astro dev` (`import.meta.env.DEV`): `AppLayout` z banerami `info` (tekst duplikatu), `warning` i `error` (tekst braku konfiguracji) w slocie `notice`; pod spodem, każdy pod podpisem stanu: `OfferCard` dla każdego fixture'a i `OfferNotFound`.
- Poza dev: `Astro.response.status = 404` i gałąź „nie znaleziono" (np. `OfferNotFound`), bez `return` we frontmatterze (reguła „Framework" w `CLAUDE.md`).
- Bez `prerender`, bez `client:*`.

#### 3. Smoke pilnuje wycieku

**File**: `scripts/smoke.mjs`, `README.md`

**Intent**: Smoke w CI biegnie po `npm run preview` (build produkcyjny), więc krok 404 przypilnuje, że strona testowa nie wyjdzie na produkcję.

**Contract**: nowy krok anonimowy przed logowaniem: `GET /dev/offer-card` → 404; komentarz nagłówka `smoke.mjs` wspomina tę kontrolę. README (sekcja smoke, `:181-188`): smoke uruchamia się na produkcyjnym preview; na `npm run dev` ten krok celowo się nie powiedzie. Job `smoke` w `ci.yml` bez zmian.

#### 4. Reguła dla nowych slice'ów

**File**: `CLAUDE.md`

**Intent**: Kontrakt design systemu zapisany tam, gdzie agent go przeczyta (cel z `change.md`).

**Contract**: w `## Conventions` (albo nowej podsekcji UI) reguły z nazwanymi referencjami, bez liczników:
- UI nowego widoku tylko z tokenów `src/styles/global.css` (klasy ról: `bg-card`, `text-muted-foreground`, `text-link`…) i komponentów `src/components/ui`; literał koloru w widoku to błąd. Ciemny motyw jest jedyny i włącza go `src/layouts/Layout.astro`.
- Nowy widok aplikacji używa `src/layouts/AppLayout.astro`; `src/pages/offers/[id].astro` jest referencją. `bg-cosmic` i blur to spuścizna odłożonych widoków, nie wzorzec.
- Brakujący prymityw: `npx shadcn add <name>`, potem rytuał (cn z `@/lib/utils`, bez `"use client"`, `Slot` z `@radix-ui/react-slot`, bez paczek `cn`/`radix-ui`).
- Zmiana wyglądu karty przechodzi przez `/dev/offer-card` (zrzut); strona dev zwraca 404 poza `astro dev`, pilnowane w `scripts/smoke.mjs`.

### Success Criteria:

#### Automated Verification:

- `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą
- Smoke na buildzie produkcyjnym przechodzi, w tym nowy krok `/dev/offer-card` → 404 (wymaga lokalnego Supabase)
- `curl -s -o /dev/null -w '%{http_code}' http://localhost:4321/dev/offer-card` na `npm run dev` bez `.env` zwraca 200 (zero-config)
- `grep -rn 'otodom.pl' src/pages/dev` nic nie zwraca

#### Manual Verification:

- Zrzut desktop `/dev/offer-card` pokazuje wszystkie stany: pełna, wszystko nieznane, 1 zdjęcie, filtr (tylko poprawne zdjęcie widoczne), długi tytuł bez przewijania poziomego, `OfferNotFound`, trzy banery
- Zrzut z fokusem (Tab do linku w Topbarze, linku oryginału i miniatury): pierścień widoczny na `card` i `background`
- Jeden zrzut mobilny (~375 px) jako kontrola, nie bramka: brak przewijania poziomego, tabela parametrów czytelna
- Checklist `.claude/skills/10x-ui/references/ui-quality-checklist.md` przejrzany; odstępstwo „tylko ciemny" i zarzuty odłożone nazwane

**Implementation Note**: Po automatycznej weryfikacji zatrzymać się na potwierdzenie ręczne; potem `/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- Brak runnera w repo (i bez zgody na dodanie) — logika się nie zmienia; kontrast tokenów liczy jednorazowy skrypt w scratchpadzie.

### Integration Tests:

- `scripts/smoke.mjs` na produkcyjnym preview: istniejące kroki karty (302 anonimowo, 404 dla złego/nieznanego id) + nowy krok `/dev/offer-card` → 404.

### Manual Testing Steps:

1. `npm run dev` bez `.env`: `/`, `/auth/signin` 200, `/dashboard` → `/auth/signin`, baner konfiguracji ciemny; `/dev/offer-card` renderuje wszystkie stany.
2. Zrzut kitchen sinka desktop + fokus (bramka), jeden zrzut mobilny (kontrola).
3. Z lokalnym Supabase: zapisać ofertę, otworzyć kartę, `?duplicate=1`, zły id → 404 w ramie.
4. Signin/dashboard/strona główna przed i po — różnice tylko font, baner, polski Topbar na stronie głównej.

## Performance Considerations

Usunięcie `backdrop-blur-xl` z pięciu sekcji karty to główny zysk (pomiar użytkownika ~9 → 60 fps bez GPU). Roboto Variable dokłada pliki woff2 ładowane per `unicode-range`; bez wpływu na CPU Workera.

## Migration Notes

Brak danych i migracji. Wycofanie = revert commitów fazy; tokeny i komponenty nie mają stanu.

## References

- Research: `context/changes/ui-offer-card/research.md`
- Depozyt presetu: `context/changes/ui-offer-card/preset-b1s91W2me.css`
- Skill: `.claude/skills/10x-ui/SKILL.md`, checklist `.claude/skills/10x-ui/references/ui-quality-checklist.md`
- Kontrakt karty: `context/archive/2026-09-22-paste-listing-to-card/plan.md:324-349`
- Lekcja: `context/praca-nad-interfejsem-graficznym-aplikacji-ui.md:349`, `:360`
- Wzorzec 404: `src/pages/offers/[id].astro:35-38`; wzorzec URL z wiersza: `src/lib/safe-url.ts`

## Addendum: poza planem

Dodane świadomie w trakcie implementacji, opisane po `/10x-impl-review` (F4, `reviews/impl-review.md`):

- `scripts/ui-screenshots.mjs` — zrzuty do bramki wizualnej: Chrome headless przez DevTools Protocol, bez zależności; zestawy `before`, `p2`, `p3`, `gate`. Loguje się kontem z `supabase/seed.sql`, więc wymaga lokalnego Supabase i działającego `npm run dev`. Narzędzie debugowania, nie test: nie biegnie w CI.
- `.gitignore`: `context/**/screenshots/*offer-real*` — zrzuty prawdziwego ogłoszenia z otodom (cudze zdjęcia i tekst) zostają lokalnie.
- `context/changes/ui-offer-card/screenshots/` — dowód bramki; w repo idą wszystkie zrzuty poza `*offer-real*`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Środowisko i biblioteka

#### Automated

- [x] 1.1 `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą — 08f1759
- [x] 1.2 `grep -rn 'from "cn"\|"use client"\|from "radix-ui"' src/components/ui` nic nie zwraca — 08f1759
- [x] 1.3 `package.json` nie zawiera `"cn"` ani `"radix-ui"`, zawiera `@fontsource-variable/roboto` — 08f1759
- [x] 1.4 `src/components/ui/LibBadge.astro` nie istnieje, `grep -rn LibBadge src` nic nie zwraca — 08f1759

#### Manual

- [x] 1.5 Diff `card.tsx`/`badge.tsx` względem wyjścia CLI ogranicza się do importów i dyrektywy — 08f1759

### Phase 2: Tokeny

#### Automated

- [x] 2.1 `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą — 29c6f3b
- [x] 2.2 `grep -n '#[0-9a-fA-F]\{3,6\}' src/components/Banner.astro` nic nie zwraca — 29c6f3b
- [x] 2.3 `grep -c 'class="dark"' src/layouts/Layout.astro` = 1; `global.css` zawiera `--color-link`, `--color-info`, `--color-warning` w `@theme inline` — 29c6f3b
- [x] 2.4 Skrypt kontrastu potwierdza progi dla `link`, `muted-foreground`, `info`/`warning`, `ring` 50% — 29c6f3b

#### Manual

- [x] 2.5 Signin, dashboard i strona główna bez zmian poza fontem, ciemnym banerem i kontrolkami natywnymi (zrzut przed/po) — 29c6f3b
- [x] 2.6 Polskie znaki renderują się w Roboto — 29c6f3b

### Phase 3: Jeden widok — karta i rama

#### Automated

- [x] 3.1 `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą — 3b0f18a
- [x] 3.2 Grep literałów (`white/`, `blue-`, `purple-`, `bg-cosmic`, `backdrop-blur`, `bg-gradient`, `text-transparent`) w karcie, Topbarze i AppLayout nic nie zwraca — 3b0f18a
- [x] 3.3 `Unstated` używany w `OfferCard`, `OfferParameters`, `OfferGallery`; `CLAUDE.md` wskazuje `Unstated.astro` jako wzorzec — 3b0f18a
- [x] 3.4 Smoke na buildzie produkcyjnym przechodzi (kroki karty bez zmian) — 3b0f18a

#### Manual

- [x] 3.5 Prawdziwa karta na desktopie: tokeny, `Card`, linki cyan, czytelne „nie podano", baner duplikatu pod Topbarem — 3b0f18a
- [x] 3.6 Przewijanie karty bez GPU płynne po usunięciu blur — 3b0f18a
- [x] 3.7 Strona główna: polski Topbar na tokenach, brak innych zmian — 3b0f18a

### Phase 4: Stany i kitchen sink

#### Automated

- [x] 4.1 `npx astro sync && npm run lint && npx astro check && npm run build` przechodzą — 46ba71a
- [x] 4.2 Smoke na buildzie produkcyjnym przechodzi, w tym `/dev/offer-card` → 404 — 46ba71a
- [x] 4.3 `/dev/offer-card` na `npm run dev` bez `.env` zwraca 200 — 46ba71a
- [x] 4.4 `grep -rn 'otodom.pl' src/pages/dev` nic nie zwraca — 46ba71a

#### Manual

- [x] 4.5 Zrzut desktop kitchen sinka pokazuje wszystkie stany, w tym działanie filtra URL — 46ba71a
- [x] 4.6 Zrzut z fokusem: pierścień widoczny na `card` i `background` — 46ba71a
- [x] 4.7 Jeden zrzut mobilny (~375 px) jako kontrola: brak przewijania poziomego — 46ba71a
- [x] 4.8 Checklist `ui-quality-checklist.md` przejrzany; odstępstwo i odłożone nazwane — 46ba71a
