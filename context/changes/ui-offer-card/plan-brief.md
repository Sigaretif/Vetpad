# Karta oferty jako widok wzorcowy — Plan Brief

> Full plan: `context/changes/ui-offer-card/plan.md`
> Research: `context/changes/ui-offer-card/research.md`

## What & Why

Karta `/offers/[id]` ma się stać widokiem wzorcowym. Budujemy ją z tokenów presetu shadcn `b1s91W2me`, w ciemnym motywie jako jedynym, we wspólnej ramie i z prymitywów shadcn w repo. Po karcie wylądują S-04…S-09. Dziś każdy z nich skopiowałby literały, rozmycie i ramę od nowa. Guardrail „nie podano w ogłoszeniu” jest przy tym najmniej czytelnym tekstem na stronie.

## Starting Point

`global.css` ma kompletne `:root`/`.dark`/`@theme inline`, ale czyta je tylko `button.tsx`. Blok `.dark` jest martwy, bo nic nie dostaje klasy `dark`. Karta używa literałów (`white/10`, `purple-300`), tła `bg-cosmic` i pięciu ram z `backdrop-blur-xl`, co daje ~9 fps bez GPU. Rama (Topbar, kontener) jest kopiowana osobno w każdym widoku.

## Desired End State

Każdy ekran jest ciemny z tokenów. Karta i jej rama `AppLayout` nie mają ani jednego literału koloru ani rozmycia: sekcje to `Card`, udogodnienia to `Badge`, linki są w kolorze `text-link`, a „nie podano” jest czytelne (`Unstated`). Pod `/dev/offer-card` (tylko w dev, w produkcji 404 pilnowane przez smoke) widać kartę we wszystkich stanach bez Supabase. `CLAUDE.md` nakazuje nowym slice'om to samo.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Kolor linku | Nowy token `--link` = cyan `chart-2` (~7,6:1), wariant `link` na `text-link`, przyciski na `primary` | `primary` presetu jako tekst ma ~2,5:1 | Research / Plan |
| Tylko ciemny | `class="dark"` w bazowym `Layout`, `color-scheme: dark`, oba bloki zostają | Motyw to globalny token, nie rama; warianty `dark:` shadcn działają | Research / Plan |
| Font, promienie | Roboto (`@fontsource-variable/roboto`), skala nova | Pełny preset, nie tylko kolory | Research / Plan |
| Rama | Nowy `AppLayout` (Layout `lang="pl"` + tło + kontener + Topbar + slot `notice`) | Nowe widoki dostają ramę jednym importem, odłożone widoki nietknięte | Plan |
| Język Topbara | Polski wszędzie, także na stronie głównej | Jeden komponent, jeden zestaw napisów; hero Welcome zostaje po angielsku | Plan |
| Po `shadcn add` | `cn` z `@/lib/utils`, bez `"use client"`, `Slot` z `@radix-ui/react-slot`, bez paczek `cn`/`radix-ui` | CLI łamie reguły repo (sprawdzone na kopii) | Research / Plan |
| Baner | Tokeny `info`/`warning` (+ `-foreground`), `error` na `destructive` | Hexy jasnej palety na ciemnej stronie | Research / Plan |
| Fokus | Ciemne `--ring` = `chart-1` presetu (odstępstwo, z komentarzem) | `ring/50` musi mieć ≥3:1 bez edycji każdego komponentu | Plan |
| Kitchen sink | `/dev/offer-card`, fixture'y z placeholderem `https://` i wpisami `http:`/`javascript:`; poza dev 404 przez `Astro.response.status` | Stała bramka bez Supabase, która przy okazji sprawdza `safeHttpsUrl` | Plan |
| Wyciek strony dev | Krok smoke `/dev/offer-card` → 404; README: smoke tylko na preview | CI smoke biegnie po buildzie produkcyjnym | Plan |
| Mobile, dark-only | Jeden zrzut mobilny jako kontrola; brak jasnego motywu w bramce to świadome odstępstwo od lekcji | PRD obiecuje desktop; ciemny jest jedynym motywem | Research / Plan |

## Scope

**In scope:** tokeny presetu i nowe role w `global.css`; `Layout` (dark, `lang`); `AppLayout`; polski Topbar; `Banner`; `card`/`badge`; `OfferCard`, `OfferNotFound`, `Unstated`; karta bez literałów i blur; usunięcie `LibBadge`; kitchen sink, krok smoke, README; reguły w `CLAUDE.md`. Zarzuty: T1, T3–T9, K1–K4, A1–A5; T2 tylko na karcie.

**Out of scope:** signin, dashboard, strona główna (poza Topbarem): `bg-cosmic`, blur, gradienty, `SubmitButton`, formularze auth; jasny motyw i przełącznik; `shadcn init`/zmiana stylu; `table`/`separator`; Playwright; lightbox.

## Architecture / Approach

Wartości żyją w jednym źródle (`global.css`: `:root`/`.dark` → `@theme inline`). Motyw włącza bazowy `Layout`, a ramę daje opcjonalny `AppLayout`. Strona `[id].astro` ładuje dane i wybiera stan, a wyglądem zajmują się `OfferCard` i `OfferNotFound`. Kitchen sink renderuje te same komponenty z fixture'ów, więc zrzut sprawdza dokładnie ten kod, który trafia na produkcję.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Środowisko i biblioteka | Roboto, `card`/`badge` po rytuale, bez `LibBadge` | CLI po cichu doda `cn`/`radix-ui` albo ruszy `global.css` |
| 2. Tokeny | Preset, `link`/`info`/`warning`/`ring`, dark w `Layout`, `Banner` na tokenach | Zmiana globalna widoczna na odłożonych ekranach (zrzut przed/po) |
| 3. Karta i rama | `AppLayout`, polski Topbar, karta na `Card`/`Badge`/`Unstated`, bez blur | Utrata semantyki nagłówków (`CardTitle` = div); owijka slotu w `Card` |
| 4. Stany i kitchen sink | `/dev/offer-card`, krok smoke, reguła w `CLAUDE.md`, zrzuty | Zewnętrzny placeholder zdjęć niedostępny offline |

**Prerequisites:** czyste `src/`; lokalny Supabase tylko do smoke i zrzutu prawdziwej karty.
**Estimated effort:** ~3–4 sesje, po jednej na fazę.

## Open Risks & Assumptions

- Wartość `--ring` i tokenów `warning` trzeba jeszcze potwierdzić obliczeniem na mieszance oklab albo zrzutem.
- To, że usunięcie blur jest wizualnie neutralne, to inferencja. Potwierdzi ją zrzut.
- „Kosmiczny” granat zniknie z karty (neutralny preset). To zamierzone, ale widoczne.
- Strona główna do czasu odłożonej pracy miesza języki (polski Topbar, angielskie hero).

## Success Criteria (Summary)

- Karta czyta wyłącznie tokeny i `src/components/ui`, a grep literałów i blur w jej plikach jest pusty.
- Zrzut `/dev/offer-card` pokazuje każdy stan, w tym czytelne „nie podano”, widoczny fokus i odfiltrowane niebezpieczne URL-e.
- Smoke w CI potwierdza, że strona testowa nie jest serwowana w produkcji.
