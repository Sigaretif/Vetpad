---
project: vetpad
planned_at: 2026-09-20
context_type: deployment
platform: Cloudflare Workers
auto_deploy: Cloudflare Workers Builds
scope: infrastructure-only
sources:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
  - context/foundation/prd.md
---

# Plan wdrożenia Vetpad na Cloudflare Workers

> **Ten dokument jest artefaktem jednej zmiany i trafi do `context/archive/`.** Wiedza operacyjna, która ma przeżyć archiwizację — procedury, rollback, logi, pułapki o mylących objawach i warunki wyzwalające dla Apify oraz planu płatnego — mieszka w `@context/foundation/deployment-runbook.md`. Jeśli szukasz „jak wdrożyć" albo „dlaczego produkcja się zachowuje dziwnie", tamten plik jest właściwy; ten opisuje, jak doszło do pierwszego wdrożenia.

## Kontekst

Repozytorium jest skonfigurowane pod Cloudflare Workers (`wrangler.jsonc`, `@astrojs/cloudflare` ^14.3, `wrangler` ^4.131), ale nigdy nie zostało wdrożone: nie ma konta Cloudflare, nie ma hostowanego Supabase, nie ma produkcyjnych sekretów. `@context/foundation/infrastructure.md` wybrał platformę i spisał rejestr ryzyk — ten plan zamyka lukę między drzewem plików a działającą produkcją.

Celem jest **wdrożenie szablonu projektu**, nie funkcji produktowych. Po wykonaniu planu pod publicznym adresem działa: strona główna, logowanie na wstępnie utworzone konta (FR-001), chroniony `/dashboard`, oraz auto-deploy po pushu do `master` sterowany przez Cloudflare — nie przez GitHub Actions.

### Decyzje wyjściowe

| Decyzja | Wybór |
| --- | --- |
| Auto-deploy | Cloudflare **Workers Builds** + zachowany ręczny `npx wrangler deploy`. GitHub Actions zostaje wyłącznie bramką jakości. |
| Zakres | Wyłącznie infrastruktura. Zero implementacji FR-004 / FR-010. |
| Supabase | Pełny provisioning. |
| Anthropic API | Odroczone do implementacji FR-010. |
| otodom | Jednorazowy preflight egresu, bez kodu w repo (Faza 8). |
| Apify | Nieprovisionowane; zapisany warunek wyzwalający (Faza 8). |
| Supabase Data API | Wszystkie trzy opcje włączone (Data API, automatyczne wystawianie tabel, automatyczny RLS). RLS jest w efekcie jedyną bramką — patrz C.2. |
| Plan Cloudflare | **Workers Free.** Pomiar zużycia CPU odłożony do czasu, aż powstaną FR-004 i FR-010 — patrz „Kiedy wrócić do pytania o plan płatny". |

### Dlaczego otodom teraz, a Apify nie

**otodom.** Najwyżej punktowany wiersz rejestru ryzyk („otodom zwraca 403 na egres Cloudflare") da się zamknąć bez jednej linijki kodu w projekcie: jednorazowy, wyrzucany Worker w katalogu tymczasowym, jeden `fetch`, odczyt kodu HTTP, `wrangler delete`. Zamienia hipotezę z pre-mortemu w fakt **zanim** ktokolwiek napisze ingestię.

**Apify.** Tu „bez kodu" się nie da: sam `APIFY_TOKEN` w Workers Secrets nie ma konsumenta, a wpis w `src/lib/config-status.ts` to już zmiana w `src/`. Zamiast martwego sekretu plan zapisuje warunek wyzwalający, żeby przełączenie było decyzją, a nie paniką.

---

## Warunki wstępne

To wszystko, co musisz **kliknąć ręcznie w przeglądarce**, zanim cokolwiek wdrożymy. Agent nie może za Ciebie założyć konta, podać numeru karty ani wygenerować klucza — te kroki są z definicji ludzkie. Kolejność ma znaczenie: Supabase musi istnieć, zanim będzie co wpisać do sekretów Cloudflare.

### Przegląd

| Usługa | Kiedy | Koszt | Czas | Bez tego nie zadziała |
| --- | --- | --- | --- | --- |
| **Cloudflare** | teraz | **0** (plan Free) | ~10 min | nie ma gdzie wdrożyć aplikacji |
| **GitHub** | teraz | 0 | ~5 min | CI i auto-deploy po pushu |
| **Supabase** | teraz | 0 (plan Free) | ~20 min | logowanie — aplikacja wstanie, ale z czerwonym banerem |
| Anthropic | dopiero przy FR-010 | wg zużycia | ~10 min | audyt AI (jeszcze nie implementujemy) |
| Apify | tylko jeśli preflight z Fazy 8 zwróci 403 | ~0 przy tej skali | ~10 min | awaryjna ścieżka ingestii |

Anthropic i Apify są w **załączniku na końcu tej sekcji** — nie zakładaj ich teraz.

### Zasada nadrzędna: gdzie trzymać hasła i klucze

- **Menedżer haseł** (Bitwarden, 1Password, KeePass — obojętnie który). Nie notatnik, nie plik na pulpicie, nie wiadomość do siebie.
- **Nigdy w repozytorium.** `.env` i `.dev.vars` są w `.gitignore` — możesz to sprawdzić: `git check-ignore -v .env` powinno wypisać regułę, nie pustkę.
- **Nigdy w czacie z agentem.** Jeśli agent prosi o klucz, to błąd — klucze wpisujesz sam, do `wrangler secret put` albo do panelu.
- **Klucz pokazany raz zostaje pokazany raz.** Cloudflare i Anthropic pokazują token dokładnie jeden raz przy tworzeniu. Nie zamykaj okna, dopóki nie wkleisz go do menedżera haseł.

---

### A. Cloudflare — platforma docelowa

#### A.1 Konto

1. Wejdź na <https://dash.cloudflare.com/sign-up>.
2. Podaj e-mail i hasło → **Sign Up**.
3. Odbierz maila i kliknij link potwierdzający. Bez tego nie przejdziesz dalej.

> Cloudflare zapyta po drodze, czy chcesz dodać domenę. **Pomiń to** — nie potrzebujemy własnej domeny. Aplikacja dostanie darmowy adres `vetpad.<twoja-nazwa>.workers.dev`.

#### A.2 Dwuskładnikowe logowanie (2FA)

To konto będzie miało prawo wdrażać kod na produkcję — włącz 2FA od razu.

1. Prawy górny róg → **My Profile** → zakładka **Authentication**.
2. **Two-Factor Authentication** → **Enable**.
3. Zeskanuj kod QR aplikacją (Google Authenticator, Aegis, 1Password — dowolną).
4. **Zapisz kody zapasowe (recovery codes) w menedżerze haseł.** To jedyna droga powrotu, jeśli stracisz telefon.

#### A.3 Plan — zostajemy na Free, nie podawaj karty

**Nie kupuj planu Workers Paid.** Świadoma decyzja, wbrew temu, co sugeruje `@context/foundation/infrastructure.md` — uzasadnienie w sekcji „Kiedy wrócić do pytania o plan płatny" na końcu planu.

Co daje plan Free i dlaczego to wystarcza na dziś:

| Limit | Workers Free | Ma znaczenie dla Vetpada? |
| --- | --- | --- |
| Czas CPU na wywołanie | **10 ms** | jedyny realny znak zapytania — mierzymy, gdy powstanie kod |
| Czas trwania żądania HTTP | **bez limitu** | trzyminutowy audyt AI mieści się bez problemu |
| Podżądania na wywołanie | 50 | używamy 2–3 |
| Żądania na dobę | 100 000 | trzy osoby |
| Workers Logs | w cenie, 200 tys. zdarzeń/dobę, 3 dni retencji | `wrangler tail` i panel działają |
| Workers Builds | 3 000 minut/mies., 1 build naraz | auto-deploy z Fazy 6 działa |

> **Najczęstsze nieporozumienie, warte zapamiętania:** Cloudflare liczy **czas CPU**, nie czas trwania żądania. Dokumentacja mówi wprost, że *oczekiwanie na `fetch()` nie wlicza się do czasu CPU*, a Workery wyzwalane HTTP *nie mają twardego limitu czasu trwania, dopóki klient pozostaje połączony* — i to dotyczy również planu Free. Worker, który trzy minuty czeka na odpowiedź modelu AI, zużywa ułamek milisekundy CPU. **Integracja z AI nie jest powodem, dla którego ktokolwiek kupuje plan płatny.**

#### A.4 Zalogowanie CLI

W terminalu, w katalogu projektu:

```bash
npx wrangler login
```

Co się stanie: otworzy się przeglądarka ze stroną Cloudflare z pytaniem o zgodę. Kliknij **Allow**. Terminal sam wykryje, że się udało.

Sprawdzenie:

```bash
npx wrangler whoami
```

Powinno wypisać Twój e-mail i **Account ID** — zanotuj go, przyda się w A.5.

> W tej sesji możesz napisać `! npx wrangler login`, żeby wynik komendy trafił wprost do rozmowy.

#### A.5 Token API — tylko jeśli `wrangler login` nie działa

Potrzebne, gdy pracujesz bez przeglądarki (serwer, kontener). W normalnym scenariuszu **pomiń ten krok** — Workers Builds z Fazy 6 generuje własny token automatycznie i nie trzeba go nigdzie wklejać.

1. **My Profile** → **API Tokens** → **Create Token**.
2. Znajdź szablon **Edit Cloudflare Workers** → **Use template**.
3. W sekcji **Account Resources** wybierz **Include → <Twoje konto>**.
4. W sekcji **Zone Resources**: nie masz domeny, więc zostaw **Include → All zones** albo usuń ten wiersz.
5. **Continue to summary** → **Create Token**.
6. **Skopiuj token natychmiast** — zobaczysz go tylko raz.

Użycie: `export CLOUDFLARE_API_TOKEN=<token>` przed komendami `wrangler`.

> **Czego nie robić:** nie używaj **Global API Key** z tej samej strony. To klucz do całego konta, bez ograniczenia zakresu, i nie da się go zawęzić. Token z szablonu można unieważnić bez ruszania reszty konta.

---

### B. GitHub — repozytorium i CI

Repozytorium już istnieje: `Sigaretif/Vetpad`. Potrzebujesz do niego **uprawnień administratora** (masz je, jeśli jesteś właścicielem konta).

#### B.1 Sekrety repozytorium

Job `ci` w `.github/workflows/ci.yml` wstrzykuje je do kroku budowania. **Wykonaj ten krok dopiero po sekcji C**, bo dopiero wtedy będziesz miał co wkleić.

1. Repozytorium na GitHubie → **Settings** → lewe menu **Secrets and variables** → **Actions**.
2. **New repository secret** → Name: `SUPABASE_URL`, Secret: adres projektu z kroku C.3 → **Add secret**.
3. Powtórz dla `SUPABASE_KEY`.

> Job `smoke` tych sekretów **nie potrzebuje** — startuje własną instancję Supabase w kontenerze. Nie trzeba nic dla niego konfigurować.

#### B.2 Instalacja aplikacji Cloudflare (Faza 6)

W Fazie 6 Cloudflare poprosi o zainstalowanie swojej aplikacji GitHub na tym repozytorium. To wymaga uprawnień właściciela repo — nic nie musisz robić wcześniej, tylko wiedzieć, że okno zgody się pojawi i dotyczy **tylko** tego jednego repozytorium (wybierz **Only select repositories**, nie **All repositories**).

> `gh` (GitHub CLI) **nie jest zainstalowane** w tym systemie i **nie jest potrzebne**. Wszystko powyżej robi się w przeglądarce.

---

### C. Supabase — baza danych i logowanie

#### C.1 Konto

1. <https://supabase.com/dashboard> → **Start your project**.
2. Najprościej: **Continue with GitHub** — jedno logowanie mniej do zapamiętania.

#### C.2 Projekt

1. **New project**. Jeśli to pierwszy projekt, Supabase poprosi najpierw o nazwę organizacji — wpisz cokolwiek (np. swoje nazwisko), plan **Free**.
2. **Name**: `vetpad`
3. **Database Password**: kliknij **Generate a password** i **natychmiast zapisz je w menedżerze haseł**.
   > To hasło do bazy Postgres, **nie** do aplikacji. Vetpad go nie używa — łączy się kluczem z C.3. Przyda się dopiero, gdybyś chciał wejść do bazy narzędziem SQL. Supabase nie pokaże go drugi raz.
4. **Region**: **Central EU (Frankfurt)** — najbliżej Polski i dane zostają w UE.
5. **Trzy checkboxy na ekranie tworzenia projektu** — zaznacz dokładnie tak:

   | Opcja | Decyzja | Dlaczego |
   | --- | --- | --- |
   | **Enable Data API** | ✅ **zaznaczone** | to interfejs, przez który `supabase-js` rozmawia z bazą; bez niego FR-002, FR-004 i FR-012 nie powstaną |
   | **Automatically expose new tables** | ✅ **zaznaczone** | Supabase sam nadaje uprawnienia nowym tabelom — patrz kompromis niżej |
   | **Enable automatic RLS** | ✅ **zaznaczone** | siatka bezpieczeństwa: włącza RLS na każdej nowej tabeli, nawet gdy migracja o tym zapomni |

6. **Create new project**. Provisioning trwa ~2 minuty.

> **Jaki kompromis został tu wybrany (decyzja z 2026-09-20).** Grants i RLS to dwie różne bramki: grants decydują, czy rola **w ogóle dotknie** tabeli, RLS — **które wiersze** zobaczy. Dokumentacja Supabase zaleca używać obu; tu świadomie zostawiono jedną.
>
> Włączone „automatically expose new tables" oznacza, że Supabase sam nadaje każdej nowej tabeli w schemacie `public` uprawnienia `select/insert/update/delete` dla ról `anon` i `authenticated`. Bramka grants przestaje więc filtrować cokolwiek. **Konsekwencja wiążąca każdą przyszłą migrację: polityka RLS jest jedyną rzeczą stojącą między publishable key a danymi** — tabela bez polityk jest dostępna dla każdego, kto ma ten klucz, łącznie z niezalogowanym gościem. Zapisane w `@CLAUDE.md` pod „Secrets and data access".
>
> Co ten wybór kupuje w zamian: znika błąd `42501 permission denied for table X`, czyli jedyny moment, w którym kusiłoby sięgnięcie po klucz `secret` / `service_role`. Ten klucz „naprawiłby" problem, bo omija wszystko — i cicho otworzyłby całą bazę. Przy trzech zaznaczonych opcjach ta pokusa w ogóle się nie pojawia.
>
> Automatyczny RLS domyka pozostałą bramkę: każda nowa tabela startuje z włączonym RLS, a RLS bez polityki blokuje wszystkich. Kierunek awarii jest więc bezpieczny, ale **nie zawsze głośny** — warto znać obie sygnatury:
>
> | Co widzisz | Przyczyna | Naprawa |
> | --- | --- | --- |
> | Pusta tablica `[]`, status 200 | RLS działa, brak polityki `select` | dopisz politykę do migracji — **wygląda jak brak danych, nie jak błąd uprawnień** |
> | `new row violates row-level security policy` | RLS działa, brak polityki `insert` | j.w. |
>
> Żadnego z nich nie naprawia się kluczem `secret`.
>
> Wszystkie trzy ustawienia zaczną cokolwiek robić dopiero przy pierwszej migracji — dziś aplikacja nie ma ani jednej tabeli. Da się je też później zmienić w panelu (Data API: **Integrations → Data API**); zmiana na „nie wystawiaj automatycznie" przywróciłaby drugą bramkę kosztem `grant` w każdej migracji.

#### C.3 Klucze — uwaga, nazewnictwo się zmieniło

**Settings** (ikona koła zębatego) → **API Keys**.

Potrzebujesz dokładnie dwóch rzeczy:

| Co | Gdzie | Jak wygląda | Trafia do |
| --- | --- | --- | --- |
| **Project URL** | Settings → **API** (lub **Data API**) | `https://abcdefgh.supabase.co` | `SUPABASE_URL` |
| **Publishable key** | Settings → **API Keys** | `sb_publishable_...` | `SUPABASE_KEY` |

Supabase wycofuje stare nazewnictwo do końca 2026. Na nowym projekcie zobaczysz **publishable** i **secret**; na starszym mogą być jeszcze **anon** i **service_role**. Mapowanie jest jeden do jednego:

- **publishable** = dawne **anon** → to bierzemy. Respektuje RLS, jest bezpieczny w przeglądarce.
- **secret** = dawne **service_role** → **nigdy tego nie kopiujemy.**

> **Dlaczego to ma znaczenie.** Klucz `secret` / `service_role` **omija RLS w całości**. Gdy w projekcie powstaną pierwsze tabele, RLS będzie jedyną rzeczą chroniącą dane — w kodzie Vetpada nie ma żadnej warstwy autoryzacji, do której można by się cofnąć. Wklejenie tego klucza zamiast publishable nie wywoła błędu; po prostu cicho otworzy całą bazę.
>
> Szybki test na pomyłkę: jeśli klucz zaczyna się od `eyJ`, to **stary** format (JWT). Jeśli od `sb_secret_`, to **zły** klucz. Właściwy zaczyna się od `sb_publishable_` albo — na starym projekcie — jest tym opisanym jako `anon` `public`.

#### C.4 Trzy wstępnie utworzone konta (FR-001)

Vetpad nie ma rejestracji dla użytkowników końcowych — konta zakłada administrator, czyli Ty.

1. Lewe menu → **Authentication** → **Users**.
2. **Add user** → **Create new user**.
3. E-mail i hasło (wygeneruj w menedżerze haseł).
4. **Zaznacz „Auto Confirm User".** Bez tego konto powstanie jako niepotwierdzone i logowanie zwróci „Invalid login credentials" mimo poprawnego hasła — to najczęstsza pułapka na tym etapie.
5. Powtórz trzy razy. Zapisz wszystkie trzy pary w menedżerze haseł.

> Nie ma flow resetu hasła i to świadoma decyzja (FR-001). Jesteś administratorem bazy — reset to jedno kliknięcie w tym samym panelu.

#### C.5 Plan Free usypia projekt

Projekt na planie Free **zostaje wstrzymany po ~7 dniach bez ruchu**. Objaw jest mylący: strona się ładuje, baner ostrzegawczy się **nie** pokazuje (bo zmienne są ustawione), a logowanie pada. Baner z `src/lib/config-status.ts` wykrywa tylko *brak konfiguracji*, nie *niedostępną usługę*.

Naprawa: panel Supabase → przycisk **Restore** / **Resume project**. Trwa ~2 minuty.

---

### D. Lokalna baza i pliki `.env` / `.dev.vars`

#### D.1 Która baza gdzie — to nie jest jedna baza

| Gdzie | Co to czyta | Która baza Supabase |
| --- | --- | --- |
| `.env` + `.dev.vars` (lokalnie) | `npm run dev`, `npm run preview`, `npm run smoke` | **lokalna** (`npx supabase start`) |
| Job `smoke` w CI | własna konfiguracja | **własna lokalna** — startuje kontener i nadpisuje oba pliki |
| Job `ci` w CI | krok `npm run build` | repository secrets (patrz uwaga w D.4) |
| Workers Secrets | produkcja | **chmurowa** (Faza 4) |

**Do pracy lokalnej używamy lokalnej bazy, nie chmurowej.** Trzy powody, wszystkie konkretne dla tego projektu:

1. **`npm run smoke` rejestruje nowe konto przy każdym uruchomieniu.** Wymierzony w projekt chmurowy zaśmieciłby produkcyjne `auth.users` kontami `smoke-<timestamp>@example.com`. Nie da się tego „uruchomić ostrożnie" — skrypt tak działa z założenia.
2. **Migracje i RLS rozwija się destrukcyjnie.** Pętla pracy to: napisz migrację → `supabase db reset` (kasuje bazę i odtwarza ją od zera lokalnie) → sprawdź polityki → dopiero potem `supabase db push` do chmury. `db reset` wymierzony w produkcję kasuje produkcję.
3. **CI już tak robi.** Job `smoke` startuje własne Supabase w kontenerze. Lokalna baza to ścieżka przetestowana, nie egzotyczna alternatywa.

Bonus: lokalna baza nie usypia po tygodniu bezczynności, w przeciwieństwie do planu Free w chmurze (C.5).

#### D.2 Uruchomienie lokalnej bazy

Wymaga Dockera. `supabase/config.toml` jest już w repo (`project_id = "vetpad"`), więc **`npx supabase init` jest zbędne** — to krok tylko dla świeżego projektu.

```bash
npx supabase start
```

Pierwsze uruchomienie pobiera kilka GB obrazów Dockera i trwa kilka minut. Na końcu CLI wypisze komplet adresów i kluczy. Studio (panel jak w chmurze) czeka pod `http://localhost:54323`.

Zatrzymanie, gdy skończysz pracę:

```bash
npx supabase stop
```

#### D.3 Wypełnienie `.env` i `.dev.vars`

Dwa pliki z tą samą zawartością, bo czytają je dwa różne procesy: `.env` czyta Astro, `.dev.vars` czyta lokalny runtime Cloudflare (workerd). Oba są w `.gitignore`.

```bash
cp .env.example .env
cp .env.example .dev.vars
```

W **obu** zastąp `###` wartościami wypisanymi przez `supabase start`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key z wyjścia CLI>
```

> **Nie zdziw się formatem klucza.** Lokalne Supabase wydaje klucz w **starym formacie** — długi JWT zaczynający się od `eyJ`, opisany jako `anon key`, a nie `sb_publishable_...`. To poprawne: nowe nazewnictwo z C.3 jest zmianą po stronie chmury. Lokalny klucz jest ten sam na każdej instalacji na świecie, jest publicznie znany i nie jest sekretem.

Sprawdzenie, że git ich nie widzi:

```bash
git check-ignore -v .env .dev.vars
```

Powinny wypisać się dwie linie z regułą z `.gitignore`. Pusty wynik = pliki **nie są** ignorowane i nie wolno nic commitować, dopóki tego nie naprawisz.

#### D.4 Konta deweloperskie w lokalnej bazie

`supabase/seed.sql` tworzy trzy konta przy każdym `supabase db reset` i przy świeżym `supabase start`. `[db.seed]` w `config.toml` był już włączony i wskazywał na ten plik — brakowało samego pliku.

Trzy konta odwzorowują trzyosobowy zespół z PRD (FR-001, Access Control), żeby dało się lokalnie sprawdzić atrybucję notatek (FR-013). Logowanie: `sigaretif1@vetpad.local` … `sigaretif3@vetpad.local`, hasło `qwerty123456`.

> **Domena `.local` jest celowa.** Plik jest commitowany do publicznego repozytorium, więc hasło w nim jest jawne. Prawdziwy adres e-mail w parze ze słabym hasłem byłby zaproszeniem do credential stuffingu; adres nieistniejący nie jest. Lokalne Supabase nie wysyła maili i ma wyłączone potwierdzanie adresu, więc domena nie ma znaczenia funkcjonalnego.
>
> **`supabase db reset --linked` skasowałby bazę produkcyjną i utworzył w niej te konta.** Seedy nie są automatycznie lokalne. Ostrzeżenie jest w nagłówku pliku. Migracje trafiają do chmury przez `supabase db push`, które seedów nie uruchamia.

#### D.5 Czego tu świadomie nie ma

- **Klucz chmurowy nie musi w ogóle trafić na Twój dysk.** Jedyny moment, w którym go potrzebujesz, to `npx wrangler secret put SUPABASE_KEY` w Fazie 4 — wklejasz go wtedy raz, prosto z panelu Supabase do promptu Wranglera.
- **Trzy wstępnie utworzone konta (C.4) należą do projektu chmurowego**, bo to produkcja. Lokalnie zakładasz dowolne konta testowe przez `/auth/signup` albo pozwalasz zrobić to skryptowi `npm run smoke`.
- **Repository secrets na GitHubie są dziś praktycznie dekoracyjne.** Oba pola w `astro.config.mjs` są `optional: true` i `access: "secret"`, a adapter Cloudflare dostarcza je dopiero w runtime — `npm run build` przechodzi bez nich (zweryfikowane w tym repo). Job `smoke` też ich nie potrzebuje, bo startuje własną bazę. Zostawiamy je, bo są w `ci.yml` ze startera i nie szkodzą; warto jednak, żeby wskazywały projekt chmurowy z poprawnym, gołym URL-em, zamiast wprowadzać w błąd.

> Aplikacja działa też **bez** `.env` i `.dev.vars` — to celowa właściwość, nie niedoróbka. Wtedy `/` i `/auth/signin` zwracają 200, `/dashboard` przekierowuje na logowanie, a na górze strony pojawia się czerwony baner. Brak konfiguracji jest wspieranym stanem, nie awarią.

---

### E. Lista kontrolna — gotowy do Fazy 1?

- [ ] Konto Cloudflare założone, e-mail potwierdzony
- [ ] 2FA włączone, kody zapasowe w menedżerze haseł
- [ ] `npx wrangler whoami` wypisuje Twój e-mail i Account ID
- [ ] Projekt Supabase utworzony w regionie Frankfurt
- [ ] Hasło do bazy Postgres zapisane
- [ ] **Project URL** i **publishable key** skopiowane (nie `secret`, nie `service_role`)
- [ ] Trzy konta użytkowników utworzone z **Auto Confirm User**
- [ ] `npx supabase start` działa, Studio odpowiada na `http://localhost:54323`
- [ ] `.env` i `.dev.vars` wypełnione **wartościami lokalnymi**, `git check-ignore` je widzi
- [ ] `SUPABASE_URL` i `SUPABASE_KEY` dodane jako sekrety repozytorium na GitHubie (wartości chmurowe, URL bez `/rest/v1/`)

Komplet? Faza 1 jest odblokowana.

---

### Załącznik: usługi na później — **nie zakładaj ich teraz**

#### Anthropic — dopiero przy FR-010 (audyt AI)

Nie ma sensu zakładać konta i generować klucza, który przez kilka tygodni będzie leżał nieużywany — a klucze modeli językowych są płatne od pierwszego wywołania. Gdy przyjdzie czas:

1. <https://console.anthropic.com> → załóż konto.
2. **Settings** → **Billing** → doładuj kredyty (bez tego klucz działa, ale każde wywołanie zwróci błąd).
3. **Settings** → **API Keys** → **Create Key** → skopiuj natychmiast, pokazywany jest raz. Zaczyna się od `sk-ant-`.

Wtedy też klucz trafi do **sześciu** miejsc naraz: `astro.config.mjs` (schemat), `.env`, `.dev.vars`, `.env.example`, Workers Secrets i sekrety repozytorium GitHub. Plus factory zwracająca `null`, gdy klucza brak, i wpis w `src/lib/config-status.ts`, żeby brak konfiguracji pokazał się w banerze zamiast wywalić stronę.

> **Klucz modelu jest wyłącznie serwerowy.** Nigdy nie wolno go użyć w komponencie React — wyspy Reacta lądują w przeglądarce razem z kluczem.

#### Apify — tylko jeśli preflight z Fazy 8 zwróci 403

Apify to giełda gotowych scraperów. Sięgamy po niego **wyłącznie**, jeśli okaże się, że otodom.pl blokuje adresy IP Cloudflare — a tego dowiemy się dopiero w Fazie 8. Zakładanie konta „na zapas" oznaczałoby martwy sekret bez konsumenta.

Gdyby doszło do przełączenia:

1. <https://apify.com> → **Sign up** (GitHub lub e-mail). Plan Free daje miesięczny kredyt, który przy tej skali w zupełności wystarcza — ~0,002 USD za jedno pobranie oferty.
2. **Settings** → **API & Integrations** → **Personal API tokens** → skopiuj token.
3. Zakres tokenu: jeśli zawęzisz go do konkretnego aktora, musi obejmować także operacje następcze (Apify dziedziczy zakres tokenu w webhookach). Zbyt wąski zakres objawia się jako `403 insufficient-permissions`, nie jako błąd konfiguracji.

Zweryfikowany kształt żądania, tryby awarii i koszty są w `@context/foundation/ingestion/otodom_apify.md`. **To jest decyzja do podjęcia z Tobą, nie automatyczne przełączenie** — drugi dostawca oznacza drugi sekret w sześciu miejscach i drugi tryb awarii.

---

### CLI i narzędzia lokalne

Wszystko, co potrzebne, jest już w `package.json` — nie instaluj niczego globalnie.

| Narzędzie | Stan | Działanie |
| --- | --- | --- |
| `wrangler` ^4.131.1 | w `devDependencies`, uruchamiany przez `npx` | nie instalować globalnie — przypięta wersja jest celowa |
| `supabase` ^2.23.4 | w `devDependencies` | brak |
| Node | lokalnie 22.23.2, zgodne z `.nvmrc` | brak |
| `gh` (GitHub CLI) | brak w systemie | niepotrzebne — wszystko przez przeglądarkę |
| Docker | wymagany tylko dla **lokalnego** Supabase | niepotrzebny, jeśli pracujesz na projekcie w chmurze |

> **Zakres tokenu.** Jeśli zamiast `wrangler login` używasz API tokenu (`CLOUDFLARE_API_TOKEN`), ogranicz go do *Workers Scripts: Edit* dla tego jednego projektu. Bez DNS, bez cudzych Workers Secrets, bez billingu. Workers Builds generuje własny token automatycznie — nie trzeba go wkładać do sekretów repo.

---

## Faza 1 — Konto, plan i pierwszy kontakt z platformą

Kroki klikane w panelu są rozpisane w **Warunkach wstępnych, sekcja A**. Tutaj tylko odhaczenie i jedna rzecz, której tam nie ma.

- [ ] Sekcja A odhaczona w całości (konto, 2FA, `wrangler whoami` działa). **Bez planu płatnego.**
- [ ] Sprawdź, czy nazwa `vetpad` jest wolna na `workers.dev` — przy pierwszym `wrangler deploy` Cloudflare poprosi o wybór subdomeny konta; adres aplikacji będzie miał postać `vetpad.<twoja-subdomena>.workers.dev`.

| Objaw | Przyczyna | Obsługa |
| --- | --- | --- |
| `wrangler login` kończy się timeoutem | headless / brak przeglądarki | użyj `CLOUDFLARE_API_TOKEN` w env zamiast OAuth |
| Nazwa `vetpad` zajęta na `workers.dev` | globalna przestrzeń nazw subdomen | **nie zmieniaj `name` po pierwszym deployu** — to stworzy drugiego Workera zamiast przenieść pierwszego. Zmień teraz, przed Fazą 3 |
| Cloudflare namawia na upgrade w panelu | marketing | zignoruj — plan Free jest tu świadomym wyborem, nie przeoczeniem |

---

## Faza 2 — Poprawki konfiguracji przed pierwszym deployem ✅

Wykonane 2026-09-20.

- [x] **`wrangler.jsonc` → bloku `limits` celowo NIE dodajemy.** `limits.cpu_ms` jest **odrzucane na planie Free** (błąd API 100328) i zablokowałoby deploy. Blok `"limits": { "cpu_ms": 300000 }` wchodzi w tej samej zmianie, która przełącza konto na Paid — domyślna wartość na Paid to 30 s, nie nagłówkowe 5 minut, więc bez tego bloku upgrade jest tylko połowiczny. Powód zapisany w komentarzu w `wrangler.jsonc`, żeby nikt go nie dodał odruchowo.
- [x] **`wrangler.jsonc` → `"preview_urls": false`.** Sekrety są **per-Worker, nie per-wersja**: każda wersja preview dostaje produkcyjne `SUPABASE_URL` / `SUPABASE_KEY`, a preview URL jest domyślnie publiczny. Po podłączeniu Workers Builds (Faza 6) każdy push na gałąź feature wystawiłby produkcyjne dane pod publicznym adresem. Gdy preview będą potrzebne: włącz je z powrotem i **wcześniej** postaw przed nimi Cloudflare Access (Worker → Settings → Domains & Routes → „Protect this Worker behind Access" → **Previews only**).
- [x] **`.nvmrc` `22.14.0` → `22.23.2`.** Obraz Workers Builds ma preinstalowane **tylko 22.23.2 i 24.18.0** (domyślnie 24). Dokładna wersja spoza tej dwójki zmusza obraz do pobrania i zbudowania Node'a — znany powód padania instalacji.
- [x] `README.md` — wersja Node i przepisana sekcja Deployment.

### Czego świadomie nie ruszamy

- `compatibility_date: "2026-05-08"` — zostaje. Data poprzedza zmianę z 2026-08-04, która uczyniła `nodejs_compat` domyślnym; jawna flaga jest obecna, więc działa. Każda zmiana tej daty to zmiana do przetestowania na wersji preview, nigdy rutynowy bump.
- `.github/workflows/ci.yml` — **bez joba deploy**. Oba joby (`ci`, `smoke`) zostają bramką jakości.
- `src/` — zero zmian. Powierzchnia `src/pages/api/` się nie zmienia, więc `scripts/smoke.mjs` zostaje nietknięty.

---

## Faza 3 — Pierwszy ręczny deploy ✅

**Wykonane 2026-09-20.** Worker: `vetpad`, adres **https://vetpad.vetpad.workers.dev**, Account ID `917c8d5693d671be4227202d2ceb42ed`, plan **Free**.

Wynik weryfikacji: `/`, `/auth/signin`, `/auth/signup` → 200; `/dashboard` → 302 na `/auth/signin`; `/favicon.png` → 200; baner konfiguracyjny widoczny (sekrety nieustawione — stan oczekiwany); czasy odpowiedzi 55–65 ms.

**Bez błędu 1102 — SSR mieści się w limicie 10 ms CPU planu Free.** To pierwszy z trzech pomiarów z sekcji „Kiedy wrócić do pytania o plan płatny"; aplikacja jest na tym etapie lekka, więc pomiar trzeba powtórzyć po FR-004 i FR-010.

Dwie rzeczy zaobserwowane przy pierwszym uruchomieniu, obie zgodne z przewidywaniami planu:

- Wrangler sam utworzył namespace KV `vetpad-session` (binding `SESSION`, id `1fecd2e7802c43e8a66148ebcb2044b5`) — bez interakcji, bez pytania.
- **Przez pierwsze ~2 minuty adres zwracał błąd TLS (`curl` kod 35, `sslv3 alert handshake failure`), nie 200.** To nie awaria: wildcard `*.workers.dev` pokrywa tylko jeden poziom, a adres ma dwa, więc Cloudflare musi wystawić osobny certyfikat dla nowej subdomeny konta. Worker był w tym czasie wdrożony i sprawny. Przy pierwszym deployu na świeżym koncie po prostu poczekaj i ponów.

### Oryginalny przebieg fazy

Ta faza **tworzy** Workera `vetpad`. Workers Builds z Fazy 6 wymaga, żeby nazwa Workera w panelu zgadzała się z `name` w `wrangler.jsonc` — najpewniej utworzyć go z CLI.

- [ ] `npm ci`
- [ ] `npx astro sync && npm run lint && npx astro check` — te dwie komendy CI **nie są** skryptami npm; uruchom je lokalnie, inaczej job `ci` padnie na czymś, czego `npm run lint` nie widzi.
- [ ] `npm run build`
- [ ] `npx wrangler deploy`
- [ ] `https://vetpad.<subdomena>.workers.dev/` → **200 plus czerwony baner** „Supabase nie jest skonfigurowany". To stan docelowy tej fazy, nie usterka — zero-config jest wspieranym stanem aplikacji.
- [ ] `https://.../dashboard` → 302 na `/auth/signin`.

> **`wrangler pages deploy` jest zakazane.** Adapter v14 nie wspiera Pages. Większość tutoriali i sporo odpowiedzi modeli podaje tę komendę — dla tego repo jest błędna.

**Czego się spodziewać przy pierwszym uruchomieniu:**

- Cloudflare poprosi o wybór **subdomeny konta** — jednorazowa decyzja, adres aplikacji będzie miał postać `vetpad.<subdomena>.workers.dev`.
- Wrangler **sam utworzy namespace KV o nazwie `SESSION`**. To nie jest pomyłka w konfiguracji: adapter `@astrojs/cloudflare` wstrzykuje ten binding i robi to nawet wtedy, gdy sesje Astro są wyłączone ([withastro/astro#15802](https://github.com/withastro/astro/issues/15802)). Nie da się tego „posprzątać" i nie warto próbować. KV działa na planie Free.
- W podsumowaniu deployu zobaczysz też binding `IMAGES` — z tego samego źródła.

| Objaw | Przyczyna | Obsługa |
| --- | --- | --- |
| `Error: Missing entry-point` | `dist/` nie zbudowany | `npm run build` przed `wrangler deploy` |
| Deploy odrzucony, błąd API **100328** | ktoś dodał blok `limits` do `wrangler.jsonc` | usuń go — na planie Free jest niedozwolony (Faza 2.1) |
| Żądania zwracają 1102 „Worker exceeded resource limits" | **przekroczony limit 10 ms CPU planu Free** | to jest ten pomiar, na który czekamy — patrz „Kiedy wrócić do pytania o plan płatny". Komunikat wygląda jak błąd w kodzie, a nim nie jest |
| 404 na zasobach statycznych | `assets.directory` / `public/.assetsignore` | `.assetsignore` ma zawierać `_worker.js` i `_routes.json` — tak jest dziś, nie ruszać |
| Deploy tworzy drugiego Workera | zmieniono `name` po pierwszym deployu | usuń zbędnego Workera w panelu i przywróć nazwę |

---

## Faza 4 — Hostowany Supabase i sekrety produkcyjne ✅

**Wykonane 2026-09-20.** Projekt chmurowy utworzony (Data API, automatyczne wystawianie tabel i automatyczny RLS — wszystkie trzy włączone, patrz C.2), trzy konta użytkowników założone, `SUPABASE_URL` i `SUPABASE_KEY` ustawione przez `wrangler secret put`. Każde `secret put` utworzyło nową wersję Workera i wdrożyło ją natychmiast — zgodnie z opisem poniżej.

### Oryginalny przebieg fazy

### 4.1 Projekt

Szczegółowe kroki klikane w panelu są w **Warunkach wstępnych, sekcja C**. Tutaj tylko to, co musi być odhaczone, zanim ruszy 4.3.

- [ ] Nowy projekt Supabase, region **Central EU (Frankfurt)**.
- [ ] `Project URL` skopiowany.
- [ ] **Publishable key** (`sb_publishable_...`) skopiowany — na starszym projekcie ten sam klucz nazywa się jeszcze `anon` `public`.

> **Nigdy `secret` / `service_role`.** Ten klucz omija RLS w całości. Gdy powstaną pierwsze tabele, RLS będzie **jedyną** warstwą chroniącą dane — w kodzie aplikacji nie ma warstwy autoryzacji, do której można by się cofnąć. Pomyłka nie wywoła błędu; po prostu cicho otworzy całą bazę. Test: właściwy klucz zaczyna się od `sb_publishable_`, nigdy od `sb_secret_`.

### 4.2 Trzy wstępnie utworzone konta (FR-001)

Rozpisane krok po kroku w **Warunkach wstępnych, sekcja C.4**.

- [ ] Authentication → Users → **Add user** × 3, z zaznaczonym **Auto Confirm User**.
- [ ] Hasła poza repo (menedżer haseł). Brak flow resetu hasła jest świadomy — autor jest administratorem bazy, reset to pojedyncze zapytanie SQL.

> Rejestracja zostaje **włączona** w tym wdrożeniu. FR-001 mówi „no registration", ale usunięcie `/auth/signup` i `/api/auth/signup` rozwaliłoby każdy krok `scripts/smoke.mjs`, który tworzy konto inline — a job `smoke` musiałby wtedy seedować konto sam. To zmiana w kodzie i w CI, poza zakresem tego planu. Zapisane w „Poza zakresem".

### 4.3 Sekrety w produkcji

- [ ] `npx wrangler secret put SUPABASE_URL`
- [ ] `npx wrangler secret put SUPABASE_KEY`

Każde `secret put` **tworzy nową wersję Workera i natychmiast ją wdraża**. Sekretów nie da się odczytać z powrotem — tylko nadpisać.

### 4.4 Gdzie jeszcze żyją te same sekrety

| Miejsce | Po co | Kto ustawia |
| --- | --- | --- |
| `.env` (lokalnie) | Astro / `astro:env` | deweloper — Warunki wstępne, sekcja D |
| `.dev.vars` (lokalnie) | runtime workerd | deweloper — Warunki wstępne, sekcja D |
| GitHub repository secrets | krok build w jobie `ci` | człowiek — Warunki wstępne, sekcja B.1 |
| Workers Secrets | produkcja | `wrangler secret put` (krok 4.3) |

Job `smoke` sekretów nie potrzebuje — startuje własne Supabase w kontenerze.

| Objaw | Przyczyna | Obsługa |
| --- | --- | --- |
| „Invalid login credentials" mimo dobrego hasła | użytkownik niepotwierdzony | włącz Auto Confirm albo potwierdź ręcznie w panelu |
| Po ~7 dniach ciszy logowanie pada, **a baner się nie pokazuje** | projekt Supabase Free **uśpiony po tygodniu bezczynności** | baner z `src/lib/config-status.ts` wykrywa tylko *nieustawione* zmienne, nie *nieodpowiadającą* usługę. Wznów projekt w panelu. Rozróżnienie „skonfigurowane, ale nieosiągalne" to przyszła zmiana w kodzie |
| `wrangler rollback` cofa też sekret | `secret put` to wersja jak każda inna | po rollbacku `wrangler secret list` i w razie potrzeby ustaw ponownie |
| Rotacja klucza publishable | — | `wrangler secret put` ponownie **oraz** aktualizacja sekretu w GitHubie, żeby się nie rozjechały |

---

## Faza 5 — Weryfikacja produkcyjna ✅

**Wykonane 2026-09-20** na `https://vetpad.vetpad.workers.dev`:

| Sprawdzenie | Wynik |
| --- | --- |
| `/`, `/auth/signin` | 200 |
| `/dashboard` anonimowo | 302 → `/auth/signin` |
| Baner konfiguracyjny | zniknął — sekrety wczytane |
| Złe hasło → `?error=Invalid%20login%20credentials` | Worker faktycznie rozmawia z chmurowym Supabase |
| 1102 / błąd Workera | brak |

> **Jak zweryfikowano logowanie bez znajomości haseł produkcyjnych.** Próba logowania **złym** hasłem jest wystarczającym dowodem, że ścieżka Worker → Supabase działa: nieosiągalne Supabase dałoby inny błąd albo 500, a nie poprawny komunikat `Invalid login credentials`. Samo udane logowanie na prawdziwe konto zostaje po stronie człowieka, w przeglądarce — agent nie przechowuje haseł produkcyjnych.

### Oryginalny przebieg fazy

- [ ] `/` → 200, **bez banera**.
- [ ] `/auth/signin` → 200.
- [ ] `/dashboard` anonimowo → 302 na `/auth/signin`.
- [ ] Logowanie jednym z trzech kont → `/dashboard` renderuje się z użytkownikiem.
- [ ] Wylogowanie → powrót na `/`.
- [ ] `npx wrangler tail --format json` w drugim terminalu przez cały przebieg — zero wyjątków.

> `npm run smoke` **nie nadaje się** do produkcji: rejestruje nowe konto przy każdym uruchomieniu i zaśmieciłby produkcyjną bazę użytkownikami. Zostaje testem lokalnym i CI.

---

## Faza 6 — Auto-deploy: Workers Builds ✅

**Skonfigurowane i zweryfikowane 2026-09-20.** Push na `master` (commit `1af2f73`) uruchomił build w Cloudflare, który zbudował i wdrożył aplikację bez udziału człowieka:

| Czas (UTC) | Zdarzenie | Źródło wg API |
| --- | --- | --- |
| 12:45:23 | wersja `941d57f8` utworzona | `version_upload` |
| 12:45:24 | deployment, **100% ruchu** na tej wersji | `deployment` |

> **Nie daj się zmylić etykietom.** `wrangler deploy` to dwa kroki: wgranie wersji, potem jej promocja. API zapisuje je osobno, więc na liście wersji widnieje `version_upload` — co wygląda jak `wrangler versions upload`, czyli polecenie dla gałęzi **nie**produkcyjnych. Rozstrzyga dopiero `wrangler deployments list`: jeśli nowa wersja obsługuje 100% ruchu, deploy się odbył.

Weryfikacja produkcji po automatycznym wdrożeniu: `/` i `/auth/signin` → 200, `/dashboard` → 302, baner konfiguracyjny nadal nieobecny, Supabase osiągalny, brak 1102.

**Sekrety przetrwały automatyczne wdrożenie** — potwierdzenie w praktyce tego, na czym oparto decyzję z Fazy 2.2: sekrety są per-Worker, nie per-wersja. Ta sama właściwość jest powodem, dla którego preview URL-e muszą zostać wyłączone.

### Konfiguracja, która zadziałała

> **Bezpośrednio po konfiguracji lista wersji się nie zmieni — i to nie jest objaw błędu.** Workers Builds uruchamia się **przy pushu**, nie w momencie podłączenia repozytorium. Jeśli konfigurujesz go po ostatnim pushu, nic się nie wydarzy aż do następnego, a `wrangler` nie ma komendy do Workers Builds (`wrangler builds` nie istnieje), więc z terminala nie da się tego podejrzeć. Cisza po konfiguracji nie odróżnia „działa" od „nie działa" — rozstrzyga dopiero push.

### Konfiguracja do odhaczenia

Dopiero **po** zielonej Fazie 5 — automatyzujemy ścieżkę, która została ręcznie potwierdzona.

- [ ] Worker `vetpad` → **Settings → Builds → Git Repository → Manage** → zainstaluj GitHub App na `Sigaretif/Vetpad`.
- [ ] **Production branch: `master`.** Domyślna wartość to `main` — najczęstsza cicha porażka tej konfiguracji: buildy nigdy nie odpalają, bo gałąź nie istnieje.
- [ ] Build command: `npm run build`
- [ ] Deploy command: `npx wrangler deploy` (domyślne)
- [ ] Non-production branch deploy command: `npx wrangler versions upload` (domyślne) — bezpieczne, bo Faza 2 wyłączyła publiczne preview URL-e.
- [ ] Root directory: puste (to nie monorepo).
- [ ] Build variables: **żadne**. Build nie potrzebuje sekretów Supabase — pola w `astro.config.mjs` są `optional: true`, a adapter dostarcza je dopiero w runtime.
- [ ] Pusty commit na `master` → build przechodzi i wdraża.

**Limity na planie Free:** 20 min timeout builda, **3 000 minut/mies.**, **1 build naraz**. Przy tempie tego projektu limit minut jest nieosiągalny; pojedynczy slot oznacza tylko, że dwa pushe pod rząd zbudują się jeden po drugim.

| Objaw | Przyczyna | Obsługa |
| --- | --- | --- |
| Push do `master` nie uruchamia builda | production branch wciąż `main` | popraw w Settings → Builds |
| Build pada na instalacji Node | `.nvmrc` spoza obrazu | Faza 2; awaryjnie `NODE_VERSION=22` jako zmienna build |
| Build pada: nazwa Workera ≠ config | `name` w `wrangler.jsonc` ≠ nazwa w panelu | wyrównaj — źródłem prawdy jest `wrangler.jsonc` |
| GitHub Actions i Workers Builds deployują naraz | dwa źródła prawdy | nie dodajemy joba deploy do `ci.yml`. Po Fazie 6 ręczny `wrangler deploy` to ścieżka **awaryjna** |
| Wdrożył się kod z niezielonego CI | Workers Builds nie czeka na GitHub Actions | świadomy kompromis: CI jest bramką na **PR**, a `master` ma gwarancję z przeglądu PR-a. Zakaz commitowania wprost na `master` jest tu elementem bezpieczeństwa deployu, nie tylko higieną |
| Trzeba wstrzymać auto-deploy | — | zmień deploy command na `npx wrangler versions upload` (buduje, nie promuje) |

---

## Faza 7 — Runbook operacyjny

```bash
npx wrangler tail --format json      # logi na żywo, wyjście do sparsowania
npx wrangler versions list           # kandydaci do rollbacku
npx wrangler rollback [version-id]   # powrót w sekundach
npx wrangler secret list             # co jest ustawione (nie: jakie wartości)
```

**Agent może bez pytania:** `astro build`, `wrangler deploy`, `wrangler versions upload`, `wrangler tail`, `wrangler rollback`.

**Wyłącznie człowiek, ręcznie:** założenie konta i tokenu, `wrangler login`, ustawianie i rotacja sekretu produkcyjnego, migracja Supabase na hostowanym projekcie, usunięcie Workera, zmiana planu.

> **Rollback cofa kod, nigdy dane.** Gdy powstaną migracje Supabase, wersja Workera sprzed migracji może nie umieć czytać nowego schematu — to ręczna naprawa, nie `wrangler rollback`.

---

## Faza 8 — Preflight egresu otodom ✅

**Wykonane 2026-09-20. Wynik: otodom obsługuje egres Cloudflare.**

Wyrzucany Worker `vetpad-egress-probe` wdrożony poza repozytorium, wywołany raz, usunięty (potwierdzone 404). Odpowiedź: **HTTP 200**, `__NEXT_DATA__` obecne, brak markerów captcha, brak nagłówka `cf-mitigated`, 1 235 304 B w 1 021 ms. Zapisane w `@context/foundation/ingestion/otodom_fetching.md` § 9.1, gdzie wcześniej widniało „Unverified".

**Konsekwencje:**

- Ingestia FR-004 idzie ścieżką bezpośrednią z § 7.1 — jeden `fetch`, jeden ograniczony `RegExp`, `JSON.parse`. Apify pozostaje nieprovisionowane, warunek wyzwalający bez zmian.
- **Poboczny, zachęcający sygnał dla pytania o CPU:** sonda zdekodowała 1,2 MB HTML-a i przeszła po nim wyszukiwaniem tekstowym **na planie Free, bez błędu 1102**. To nie zamyka sprawy — `JSON.parse` buduje obiekty i jest istotnie droższy niż skan podciągu — ale przesuwa oczekiwania w dobrą stronę.
- Jedna obserwacja to nie gwarancja trwałego dostępu. Blokowanie zakresów datacenter pojawia się zwykle stopniowo, więc loguj każdy status inny niż 200 osobno od błędu parsowania i powtórz sondę, jeśli ingestia zacznie zawodzić nieregularnie.

### Oryginalny przebieg fazy

Zamyka najwyżej punktowany wiersz rejestru ryzyk. Cały artefakt żyje w katalogu tymczasowym i znika po weryfikacji — w repo nie ląduje nic.

- [ ] W katalogu tymczasowym: minimalny Worker (`wrangler.jsonc` + jeden plik), który robi jeden `fetch` na kanoniczny adres oferty otodom z nagłówkami `User-Agent` (desktopowy Chrome) i `Accept-Language: pl-PL,pl;q=0.9`, i zwraca **wyłącznie kod HTTP oraz informację, czy w treści jest `__NEXT_DATA__`**.
- [ ] `npx wrangler deploy --name vetpad-egress-probe`
- [ ] Jedno wywołanie, zapis wyniku.
- [ ] `npx wrangler delete --name vetpad-egress-probe`
- [ ] Wynik dopisz do `@context/foundation/ingestion/otodom_fetching.md` § 9.1 (dziś „Unverified against Otodom as of 2026-09-19") wraz z datą.

| Wynik | Znaczenie | Konsekwencja |
| --- | --- | --- |
| `200` + `__NEXT_DATA__` obecne | egres Cloudflare przechodzi | ingestia FR-004 idzie ścieżką z § 7.1: jeden `fetch`, jeden ograniczony `RegExp`, `JSON.parse` |
| `403` / `429` / captcha | otodom blokuje zakresy Cloudflare | **przed** implementacją FR-004 podnieś z użytkownikiem decyzję o przejściu na Apify. To drugi dostawca, drugi sekret w sześciu miejscach i drugi tryb awarii — decyzja, nie odruch |
| `200`, brak `__NEXT_DATA__` | zmieniła się struktura strony | dokument wymaga rewizji, nie kod |

**Apify pozostaje nieprovisionowane.** Zweryfikowana ścieżka (kształt żądania, tryby awarii, koszt) jest w `@context/foundation/ingestion/otodom_apify.md`. Przy adopcji: projekcja pól po stronie serwera (`?fields=...`) jest **obowiązkowa**, nie optymalizacją — `sellerPhone` i `agencyName` niosą numer i nazwisko prywatnego sprzedawcy, a projekcja trzyma je poza Workerem w całości.

---

## Kiedy wrócić do pytania o plan płatny

Decyzja: **MVP startuje na planie Workers Free.** Ta sekcja zapisuje, na czym ta decyzja stoi i co ją unieważni — żeby za miesiąc nie trzeba było jej odtwarzać z pamięci.

### Co zostało ustalone

Cloudflare mierzy **czas CPU**, nie czas trwania żądania. Oczekiwanie na `fetch()` nie wlicza się do czasu CPU, a Worker wyzwalany HTTP nie ma twardego limitu czasu trwania, dopóki klient pozostaje połączony — również na planie Free. Wynikają z tego dwie rzeczy:

1. **Trzyminutowy audyt AI (FR-010) zmieści się na planie Free.** Worker przez te trzy minuty czeka, a nie liczy.
2. **Wybór modelu jest niezależny od planu Cloudflare.** Tańszy model obniżyłby rachunek u dostawcy modelu, a nie zapotrzebowanie Workera na CPU. To dwa rozłączne budżety. `@context/foundation/infrastructure.md` sugeruje inaczej — jego lens „devil's advocate" ocenił to bez pomiaru i ta ocena nie została zweryfikowana.

Rachunek za model przy ~200 audytach w całym poszukiwaniu: `claude-opus-5` ≈ 29 USD, `claude-sonnet-5` ≈ 12 USD, `claude-haiku-4-5` ≈ 6 USD. Zejście na słabszy model oszczędza kilkanaście dolarów przez całe poszukiwanie mieszkania, a PRD tę wymianę już rozstrzygnął na korzyść poprawności („Audit correctness takes precedence over both audit speed and audit cost"). Polska terminologia nieruchomościowa to dokładnie miejsce, w którym słabszy model produkuje pewne siebie, nieugruntowane ustalenia — nazwany w PRD tryb awarii, nie hipotetyczny.

### Co pozostaje niezmierzone

Jedyne realne pytanie brzmi: **czy praca obciążająca CPU mieści się w 10 ms.** Nikt tego nie zmierzył i dziś nie da się tego zrobić rzetelnie, bo najdrożsi kandydaci jeszcze nie istnieją:

| Operacja | Charakter | Status |
| --- | --- | --- |
| Renderowanie SSR przez Astro | CPU-bound | istnieje, ale aplikacja jest praktycznie pusta |
| `JSON.parse` nad `__NEXT_DATA__` (~500 KB) | **CPU-bound, największy konsument** | FR-004, nie istnieje |
| Parsowanie ustrukturyzowanej odpowiedzi modelu | CPU-bound, mała | FR-010, nie istnieje |
| Oczekiwanie na Supabase i na model | fetch — zero CPU | — |

### Wyzwalacze, które otwierają to pytanie na nowo

- [ ] **Błąd 1102 na produkcji.** Jednoznaczny sygnał. Komunikat brzmi „Worker exceeded resource limits" i wygląda jak błąd w kodzie — zanim zaczniesz debugować kod, sprawdź plan.
- [ ] **Merge FR-004 (ingestia).** `JSON.parse` nad pełnym `__NEXT_DATA__` to pojedynczo najcięższa operacja w całym projekcie. Zmierz zużycie CPU na najdłuższym realnym ogłoszeniu, zanim to trafi na `master`.
- [ ] **Merge FR-010 (audyt).** Parsowanie odpowiedzi modelu jest małe, ale dochodzi do już istniejącego budżetu.

### Co zrobić, gdy któryś się odpali

1. Włącz **Workers Paid** (Compute → Plans → Workers Paid, 5 USD/mies.).
2. **W tej samej zmianie** dodaj do `wrangler.jsonc`:
   ```jsonc
   "limits": { "cpu_ms": 300000 },
   ```
   Bez tego obowiązuje domyślne **30 s**, nie nagłówkowe 5 minut — a to jest dokładnie scenariusz z pre-mortemu w `@context/foundation/infrastructure.md`: audyt pada na najdłuższych ogłoszeniach, czyli tych, które najbardziej wymagały audytu, a diagnoza tygodniami idzie w stronę dostawcy modelu.
3. Jeśli 1102 utrzymuje się mimo Paid, to **nie** jest już limit planu — wtedy szukaj w kodzie.

### Uczciwy kontrargument, zapisany świadomie

Twardy termin to 2026-11-04, praca wyłącznie po godzinach. Najrzadszym zasobem w tym projekcie jest wieczór, nie pięć dolarów. Plan płatny kupiłby wyeliminowanie całej klasy awarii, której komunikat aktywnie myli. Ryzyko przyjęte świadomie: w zamian za to, że nie płacimy za zasób, którego być może nie potrzebujemy, przyjmujemy, że pierwsze zetknięcie z 1102 może kosztować wieczór. Ten akapit istnieje po to, żeby nie kosztowało — jeśli zobaczysz 1102, zacznij od planu.

---

## Weryfikacja end-to-end

1. **Bramka jakości lokalnie** — `npm ci && npx astro sync && npm run lint && npx astro check && npm run build` przechodzi.
2. **Bramka zero-config** — bez `.env` i `.dev.vars`: `/` i `/auth/signin` zwracają 200, `/dashboard` przekierowuje, baner z `missingConfigs` się renderuje.
3. **Bramka CI** — PR do `master`, oba joby (`ci`, `smoke`) zielone.
4. **Bramka produkcji** — lista z Fazy 5.
5. **Bramka auto-deployu** — commit na `master` przez `/git-ship` → build w Workers Builds → nowa wersja na produkcji.
6. **Bramka rollbacku** — `wrangler versions list`, `wrangler rollback`, potwierdzenie powrotu poprzedniej wersji, potem powrót do najnowszej.
7. **Bramka egresu** — Faza 8, wynik zapisany w dokumencie ingestii.

---

## Poza zakresem (świadomie)

- **Anthropic API / FR-010.** Klucz dostawcy modelu ląduje w sześciu miejscach (`astro.config.mjs`, `.env`, `.dev.vars`, `.env.example`, Workers Secrets, GitHub secrets) plus factory zwracająca `null` i wpis w `config-status.ts`. Provisioning nierozdzielny od implementacji — robimy go razem z FR-010. Wtedy `CLAUDE.md` dostaje nazwę SDK w linii o dostawcy modelu.
- **Apify.** Warunek wyzwalający w Fazie 8.
- **Usunięcie `/auth/signup` zgodnie z FR-001.** Wymaga przepisania `scripts/smoke.mjs` i zaseedowania konta testowego w jobie `smoke`.
- **Migracje Supabase i RLS.** Dziś aplikacja używa wyłącznie wbudowanego `auth.users`; `supabase/migrations/` nie istnieje. Pierwsza tabela przynosi ze sobą `enable row level security` i po jednej polityce na operację i rolę — w tej samej migracji, nie w późniejszym przebiegu utwardzania.
- **Cloudflare Access przed preview URL-ami.** Niepotrzebne, dopóki `preview_urls: false`. Wymagane, zanim ktokolwiek je włączy.
- **Widoczność postępu długich operacji.** PRD wymaga, żeby operacja w toku była stale widoczna jako trwająca, a przeglądarki i pośredniki potrafią zerwać ciche, trzyminutowe żądanie niezależnie od tego, że Cloudflare go nie ogranicza. Ten sam mechanizm (streaming albo polling) rozwiązuje oba problemy — decyzja architektoniczna audytu, podejmowana przy FR-010.

## Źródła

Wszystkie statusy sprawdzone 2026-09-20.

- [Workers Builds — CI/CD](https://developers.cloudflare.com/workers/ci-cd/)
- [Workers Builds — integracja Git](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [Workers Builds — obraz build i wersje Node](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/)
- [Workers Builds — limity i ceny](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)
- [Workers — limity platformy](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers — konfiguracja Wrangler (`limits`, `preview_urls`)](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Workers — Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
- [Workers — Cloudflare Access przed Workerem](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)
- [Node.js 24 domyślny w Workers Builds](https://developers.cloudflare.com/changelog/post/2026-07-30-workers-builds-nodejs-24/)
- [Cloudflare — tworzenie tokenu API i szablony](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
- [Supabase — klucze API: publishable i secret](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase — migracja ze starych kluczy anon / service_role](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Workers Logs — dostępność i limity na planie Free](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [`@astrojs/cloudflare` — sesje i automatyczny binding KV `SESSION`](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [withastro/astro#15802 — binding `SESSION` wstrzykiwany mimo wyłączonych sesji](https://github.com/withastro/astro/issues/15802)
- [Supabase — zabezpieczanie Data API: grants i RLS jako dwie warstwy](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase — zmiana: nowe tabele nie są domyślnie wystawiane w Data API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
