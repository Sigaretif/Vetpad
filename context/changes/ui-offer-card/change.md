---
change_id: ui-offer-card
title: Karta oferty jako widok wzorcowy — tokeny z presetu shadcn, ciemny motyw, wspólna rama
status: impl_reviewed
created: 2026-09-23
updated: 2026-09-23
archived_at: null
---

## Notes

Karta oferty /offers/[id] (src/pages/offers/[id].astro + src/components/offers/*) jako widok wzorcowy. Zakres globalny: tokeny z presetu shadcn b1s91W2me (https://ui.shadcn.com/create?template=astro&preset=b1s91W2me) przeniesione do istniejących zmiennych w src/styles/global.css, bez shadcn init (repo ma już system: components.json new-york/neutral, :root/.dark/@theme inline, ale widoki używają literałów white/10); ciemny motyw jako jedyny; wspólna rama (Layout.astro, Topbar.astro); brakujące prymitywy przez npx shadcn add do src/components/ui; reguła w CLAUDE.md, że nowe slice'y budują UI tylko z tokenów i src/components/ui. Poza zakresem: signin, dashboard, strona główna. Znany problem: backdrop-blur-xl daje ok. 9 fps przy przewijaniu bez GPU (60 fps bez rozmycia). Na karcie: [id].astro:64 i :70, OfferParameters.astro:60, OfferDescription.astro:9, OfferGallery.astro:21. Poza zakresem, do zapisania jako odłożone: signin.astro:10, dashboard.astro:11, Welcome.astro:40/62/85. Research ma dać listę zarzutów w trzech kategoriach z /10x-ui (brakujące tokeny, brakujący komponent, przypadkowa architektura), każdy z plik:linia i wpływem na użytkownika.
