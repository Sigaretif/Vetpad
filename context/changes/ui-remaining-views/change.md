---
change_id: ui-remaining-views
title: Migrate remaining views and auth form components to design tokens
status: impl_reviewed
created: 2026-09-23
updated: 2026-09-26
archived_at: null
---

## Notes

Zakres: wszystkie pliki z listy ignores w tokensOnlyConfig (eslint.config.js): src/pages/auth/signin.astro, src/pages/dashboard.astro, src/components/Welcome.astro, src/components/auth/FormField.tsx, PasswordToggle.tsx, ServerError.tsx, SubmitButton.tsx (konsumenci: SignInForm.tsx i offers/AddOfferForm.tsx) oraz wariant destructive w src/components/ui/button.tsx i badge.tsx.
Świadome odstępstwo od „jeden widok na zmianę": jedna zmiana na całą resztę — kontrakt (tokeny, AppLayout, Card/Badge, reguła lintu) istnieje z context/archive/2026-09-23-ui-offer-card/, ta zmiana migruje widoki, nie projektuje systemu od nowa.
Źródło tokenów: src/styles/global.css (preset shadcn b1s91W2me, ciemny motyw jako jedyny); bez nowego presetu i bez shadcn init.
Gotowe, gdy: lista ignores w tokensOnlyConfig pusta; @utility bg-cosmic usunięte z global.css; npm run lint, npx astro check, npm run build i smoke przechodzą; strona testowa pod /dev pokazuje formularze logowania i dodawania oferty w 7 stanach (default, hover, focus, disabled, error, empty, loading), stany nieobecne nazwane w planie jako „nie dotyczy"; bramka powtórzona po triażu /10x-impl-review.
Otwarte decyzje dla planu: język ekranu logowania (S-01 zostawił angielski, Topbar jest polski); czy dashboard i strona główna przechodzą do AppLayout.
