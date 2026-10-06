---
title: "Debugowanie z AI: od stack trace'a do gotowego fixa"
course: "10xdevs-4"
language: "pl"
source: "Przeprogramowani.pl"
exported: "2026-10-05"
format: "markdown"
---

![Obraz 1](https://images.przeprogramowani.pl/lessons/m3-l5/assets/cover.jpg)

W poprzednich lekcjach 10xDevs zobaczyliśmy, jak duży wpływ agenci AI mają na tworzenie aplikacji. Potrafią zaplanować zmianę, napisać kod, uruchomić testy i doprowadzić nową funkcjonalność do wdrożenia. Aplikację trzeba jednak później utrzymywać. Użytkownik zgłasza błąd, workflow zatrzymuje się przed deploymentem albo ekran ładuje się coraz wolniej.

W takich zadaniach również możemy oddać agentowi sporą część pracy. Z odpowiednim kontekstem potrafi prześledzić problem, sprawdzić hipotezy i przygotować poprawkę. Musi mieć jednak dostęp do wnętrza aplikacji oraz wiedzieć, jak powinna działać. Bez tego podczas awarii będzie dopiero odkrywał, gdzie szukać logów, który endpoint obsługuje dany ekran i co właściwie oznacza poprawny wynik.

W tej lekcji przygotujemy aplikację i warsztat agenta do takiej pracy. Podłączymy źródła diagnostyki, przyjrzymy się analizie błędu w GitHub Actions, a na przykładzie 10xCards przejdziemy od pozornie poprawnego ekranu do audytu kodu i usunięcia jednej konkretnej luki.

## Najpierw ustalmy, jaki problem rozwiązujemy

Jako inżynierowie mamy tendencję do przedwczesnego rozwiązywania problemów. Widzimy zgłoszenie, rozpoznajemy znajomy objaw i już układamy poprawkę. Agent może jeszcze przyspieszyć ten odruch: zanim sprawdzimy założenia, będzie miał gotowy kod.

Troubleshooting zaczyna się wcześniej. Trzeba zrozumieć zgłoszenie, ustalić oczekiwane działanie i ocenić, gdzie rzeczywiście leży problem. Debugowanie, czyli szukanie technicznej przyczyny błędu, jest częścią tego procesu. Czasem rozwiązaniem zgłoszenia będzie wyjaśnienie działania funkcji, zmiana konfiguracji albo decyzja produktowa, a nie nowy deployment na produkcję.

### Kiedy kod działa jak należy

Opis sytuacji z perspektywy użytkownika to jednocześnie źródło cennych wskazówek jak i potencjalnych pułapek. Przykładowy ticket do 10xCards pt. „nie widzę fiszek” daje punkt zaczepienia, ale pozostawia kilka niewiadomych. Czy użytkownik wcześniej je utworzył? Czy jest na właściwym koncie? Czy strona pokazała pustą talię, komunikat błędu, czy w ogóle się nie załadowała?

Porównaj to, co użytkownik zobaczył, z uzgodnionym działaniem produktu. Jeśli wybrany filtr ukrywa część danych zgodnie z założeniami, wyjaśnienie działania filtra może rozwiązać zgłoszenie. Warto przy tym sprawdzić, czy jego stan jest jasny i zrozumiały. Działanie zgodne ze specyfikacją też może być źródłem ticketów supportowych albo nie odpowiadać na realną potrzebę użytkownika. Taka obserwacja może prowadzić do zmiany UX lub wymagań.

Jeśli aplikacja zachowuje się niezgodnie z ustalonymi regułami, mamy podstawę do szukania błędu. Gdy oczekiwania są niejasne, najpierw trzeba je doprecyzować. Sama etykieta „bug” w tickecie nie rozstrzyga, co należy zmienić.

### Proponowana poprawka też wymaga sprawdzenia

Zgłoszenie często zawiera od razu diagnozę i rozwiązanie. Wyobraźmy sobie taki opis: „Po zapisaniu nie widzę nowej fiszki. Pewnie lista trzyma stary cache, dodajcie automatyczne odświeżanie”. Możemy z niego wyodrębnić trzy różne informacje:

- **Obserwacja:** użytkownik nie widzi fiszki po zapisaniu.
- **Hipoteza przyczyny:** lista korzysta z nieaktualnego cache'a.
- **Propozycja rozwiązania:** automatyczne odświeżanie listy.

Zanim zaakceptujemy propozycję, trzeba sprawdzić cały przepływ: zapis, odczyt, filtrowanie i prezentację danych. Ponowne pobieranie może pomóc przy nieaktualnej liście, ale nie rozwiąże błędu zapisu ani celowego ukrycia rekordu przez filtr. Szerszy kontekst aplikacji może więc skierować nas do innego obszaru. Tak samo traktujemy pierwszą diagnozę kolegi z zespołu, agenta AI czy własną.

![Debugowanie biznesowe](https://images.przeprogramowani.pl/cms/8f0ea5c8-34c0-40ec-96ce-b4e0647872c9/bbb127d9d85172e81938a4e7b355670e5e21ab5d8b9b8b62bd669871e4fb5252.webp)

Oczywiście wraz z nabywaniem doświadczenia nie będziesz świadomie przechodzić przez cały ten algorytm przy każdym zgłoszeniu. Warto jednak wyrabiać sobie nawyk takiego działania. Między otrzymaniem zadania a reakcją zostaw sobie chwilę na przemyślenie, czy w ogóle warto je podejmować i czy proponowana praca odpowiada na rzeczywisty problem. Z czasem taka ocena stanie się naturalną częścią twojego warsztatu.

Diagram pokazuje tok pracy, do którego możemy wracać wraz z nowymi dowodami. Jeśli podczas debugowania okaże się, że źle zrozumieliśmy regułę produktu, trzeba ponownie ustalić oczekiwane zachowanie. Nie musimy też odrzucać propozycji użytkownika: sprawdzenie może potwierdzić, że od początku była trafna.

### Gdzie pomaga 10xWorkflow

Proces debugowania możesz rozpocząć tak jak inne typy pracy w 10xWorkflow: przez `/10x-new` zapisz nową intencję zmiany z krótkim opisem tego, co planujesz robić. Następnie przejdź do `/10x-research`, jeśli potrzebujesz lepiej poznać problem i kod, albo do `/10x-plan`, jeśli masz już wystarczające ustalenia. Tę ścieżkę przedstawialiśmy w module 2. Tutaj warto raz jeszcze podkreślić znaczenie `/10x-frame`: przy diagnozowaniu zgłoszeń, sprawdzenie założeń może mieć krytyczne znaczenie, bo od niego zależy, czy zajmiemy się właściwym problemem.

Skill `/10x-frame` służy właśnie sprawdzeniu założeń przed planowaniem. Rozdziela obserwację, domniemaną przyczynę i proponowany kierunek, bada możliwe źródła problemu oraz konfrontuje hipotezy z kodem, dokumentacją i wcześniejszymi decyzjami. Pomaga ustalić, co rzeczywiście powinniśmy rozwiązać. Dobór implementacji pozostawia etapowi planowania.

Przydaje się szczególnie wtedy, gdy zgłoszenie łączy objaw z gotową poprawką albo dotyczy obszaru, którego jeszcze dobrze nie znamy. Przykładowe wejście:

```text
/10x-frame

Użytkownik zgłasza, że po zapisaniu nowej fiszki nie widzi jej na liście.
Podejrzewa nieaktualny cache i proponuje automatyczne odświeżanie listy.
```

Wynikiem jest `context/changes/<change-id>/frame.md`: opis potwierdzonego lub przeformułowanego problemu, dowody i poziom pewności. Możesz przekazać go do `/10x-plan`. Jeśli dowodów brakuje, najpierw trzeba uzupełnić diagnozę. Przy prostej poprawce z potwierdzoną przyczyną nie ma potrzeby dokładać osobnego etapu framingu.

## Bugi ze źródłem w kodzie aplikacji

Wcześniej skupialiśmy się na analizie problemów od strony biznesowej. Teraz przejdźmy do scenariuszy, w których faktycznie strona techniczna nie dowozi określonych założeń, a objawami są niedziałające widoki, zepsute layouty, wolno realizowane operacje czy niespójne dane. Jak to naprawić przy pomocy Agenta?

Dzisiaj, w tego typu sytuacjach, ograniczeniem najczęściej nie jest AI, a kontekst, którego modelowi brakuje. To właśnie tę lukę musimy zaadresować, aby proces debugowania przy wsparciu AI był naprawdę efektywny. Już od pierwszych lekcji 10xDevs wskazujemy na potrzebę dostarczania modelowi informacji odpowiedniej jakości i w odpowiedniej objętości. Debugowanie jest jednym ze scenariuszy, gdzie widać to jak na dłoni.

Autonomiczny agent wykona za ciebie ogrom roboty wtedy, kiedy zrozumie co i dlaczego staramy się wspólnie rozwiązać. Kontekst może pochodzić wtedy z kilku źródeł:

### Dane o zgłoszeniu i działaniu aplikacji

| Źródło                                       | Czego możemy się dowiedzieć                                            |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| Ticket, screenshot lub nagranie              | Co zrobił użytkownik, co zobaczył i czego oczekiwał                    |
| Logi aplikacji i stack trace                 | Jaka operacja zawiodła, na którym etapie i z jakim błędem              |
| Identyfikatory żądań w rozproszonym systemie | Jak połączyć zdarzenia dotyczące jednej operacji w kilku serwisach     |
| Metryki techniczne i biznesowe               | Jak często występuje problem i jaki ma wpływ na korzystanie z produktu |
| Historia zmian i wdrożeń                     | Co zmieniło się przed pojawieniem się objawu                           |

### Wiedza o aplikacji dostępna w repozytorium

- `README`, `AGENTS.md` lub `CLAUDE.md` wskazują agentowi strukturę repozytorium, ważne komendy i sposób uruchomienia aplikacji.
- PRD i roadmapa opisują funkcje oraz reguły produktu. Dokument ze stosem technologicznym pomaga ustalić, jakie usługi uczestniczą w danym procesie.
- Nasz folder `context/changes/` pozwala sprawdzić cel i zakres niedawnej zmiany, zamiast odtwarzać je wyłącznie z diffów.
- `lessons.md` i pliki pamięci agenta mogą zachować wiedzę o trudnych miejscach: nietypowej obsłudze uprawnień, osobnej ścieżce renderowania czy konfiguracji, którą łatwo pomylić.

### Połącz agenta ze światem zewnętrznym

Poznane w poprzednich lekcjach CLI i MCP umożliwiają agentowi odczyt kolejnych danych bez czekania, aż wkleisz je do rozmowy. [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) daje dostęp do narzędzi Cloudflare, [GH CLI](https://cli.github.com/) do GitHuba, a integracja z systemem takim jak [Sentry przez MCP](https://mcp.sentry.dev/) pozwala sięgać po zebrane zdarzenia błędów.

Kontekst, który uda ci się zebrać przez te narzędzia, jest kluczem do efektywnego debugowania z agentem.

Zobaczmy teraz, co dwie przykładowe integracje oferują w kontekście debugowania - najpierw naprawimy lukę w logach Cloudflare, a następnie skorzystamy z Sentry MCP.

## Wpinanie się do logów Cloudflare

Zacznijmy od scenariusza, w którym wsparcie AI w debugowaniu jest ograniczone przez wspomniany na początku brak kontekstu. Za chwilę poznasz skill, który pomoże ci to zmienić.

<div style="padding:56.25% 0 0 0;position:relative;"><iframe src="https://player.vimeo.com/video/1230511574?badge=0&amp;autopause=0&amp;player_id=0&amp;app_id=58479" frameborder="0" allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share" referrerpolicy="strict-origin-when-cross-origin" style="position:absolute;top:0;left:0;width:100%;height:100%;" title="m3-observability"></iframe></div><script src="https://player.vimeo.com/api/player.js"></script>

### Observability - klucz do efektywnego debugowania

Cloudflare Workers może zapisywać zdarzenia Workera, komunikaty aplikacji i nieobsłużone wyjątki. Sprawdź konfigurację swojego projektu na UI Cloudflare, w sekcji "Observability", albo przez `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
  },
}
```

Według cennika sprawdzonego 24 września 2026 r. limity Workers Logs wyglądają następująco:

| Plan         | Zapis logów                                                               | Retencja |
| ------------ | ------------------------------------------------------------------------- | -------- |
| Workers Free | 200 000 zdarzeń dziennie                                                  | 3 dni    |
| Workers Paid | 20 mln zdarzeń miesięcznie w pakiecie; 0,60 USD za każdy dodatkowy milion | 7 dni    |

To limity i opłaty za logi; płatny plan Workers ma również własny koszt bazowy. Jedno żądanie może wygenerować kilka zdarzeń, dlatego liczba requestów nie odpowiada wprost liczbie płatnych logów. Przed konfiguracją sprawdź [aktualny cennik](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs).

W przypadku bazowania na innym stacku i hostingu, reguła jest taka sama - włączenie logowania i zaadresowanie luk observability przez skill `/10x-observability-audit` w istotny sposób zwiększy przejrzystość stanu aplikacji na produkcji.

### `/10x-observability-audit`

Skill `/10x-observability-audit` sprawdza ważne przepływy aplikacji pod kątem procesu ewentualnego debugowania i analizy logów. Śledzi obsługę błędu od miejsca jego wystąpienia przez kod i odpowiedź aż do logów lub systemu raportowania. Szuka między innymi ignorowanych wyników zapytań, przechwyconych wyjątków bez zachowanej przyczyny i awarii zamienianych na zwykłe puste wyniki.

Pobierz materiały tej lekcji przez 10xCLI w katalogu swojego projektu, korzystając z konfiguracji przygotowanej wcześniej w kursie:

```bash
10x get m3l5 --course 10xdevs-4
```

Jeśli potrzebujesz tylko nowego skilla:

```bash
10x get m3l5 --course 10xdevs-4 --type skills --name 10x-observability-audit
```

CLI zapisze artefakty w katalogu właściwym dla wybranego narzędzia AI. Składnię i dostępne profile opisuje [README 10xCLI](https://github.com/przeprogramowani/10x-cli#readme).

Następnie uruchom audyt dla ważnych obszarów aplikacji, na przykład:

```text
/10x-observability-audit deck review
```

Skill najpierw rozpoznaje sposób zbierania diagnostyki. Audytorzy poszczególnych obszarów sprawdzają całe przepływy, a osobny audytor analizuje wspólne elementy, takie jak logger i konfiguracja raportowania. Wyniki są sprawdzane, łączone i zapisywane w nowym raporcie:

```text
context/audits/observability/<data-godzina>-<obszary>.md
```

Raport wskazuje miejsca utraty informacji, konsekwencje i proponowany kierunek poprawki. Zawiera również badaną wersję kodu oraz zakres weryfikacji. Audyt nie zmienia kodu aplikacji. Jeśli podasz `--runtime`, może dodatkowo sprawdzić wybrane ustalenia w odizolowanej kopii z lokalnymi lub zastępczymi zależnościami.

## Sentry MCP — dane z produkcji

Przejdźmy teraz do kolejnego scenariusza, w którym Agenta zintegrujemy z usługą Sentry. Na start, zgłoszenie od użytkownika:

`Oceniam fiszkę jako »Dobre«, ale wciąż wraca do powtórki — ciągle widzę te same karty.`

Żadnego stack trace'a. Żadnego kodu błędu. Żadnego screenshota. Jedno zdanie i diagnoza do wyciągnięcia. Zobaczmy, jak można sobie z tym poradzić korzystając z usługi [Sentry](https://getsentry.com/)

Sentry to usługa do monitoringu błędów: SDK wpięty w aplikację przechwytuje wyjątki na produkcji i wysyła je razem ze stack trace'em, śladami zdarzeń poprzedzających błąd i kontekstem zapytania. Jeśli nie masz jeszcze Sentry na swoim projekcie, nie szkodzi — poniżej przejdziemy przez konfigurację krok po kroku.

### Pracujesz w innym stacku?

Sentry ma SDK dla większości popularnych języków i frameworków, więc u ciebie zmieni się głównie krok 2. Jeśli twój zespół korzysta z innego narzędzia, np. Datadoga, Rollbara czy Bugsnaga, szukaj w nim tych samych dwóch rzeczy: przechwytywania błędów i ostrzeżeń z produkcji oraz dostępu dla agenta przez MCP albo API. Sam przebieg, od zgłoszenia przez zdarzenie w monitoringu do konkretnej linii kodu, pozostaje taki sam, dlatego warto przejść ten przykład do końca.

### Krok 1: projekt w Sentry i DSN

Darmowy plan Sentry (Developer) daje możliwość zapisu do 5000 błędów miesięcznie, 30 dni retencji i pełen dostęp do API. Dla projektu kursowego to więcej niż wystarczy. Aktualne limity i ceny sprawdzisz na [stronie cennika](https://sentry.io/pricing/).

Na start załóż konto w Sentry i utwórz nowy projekt, wybierając platformę Astro. Po utworzeniu projektu skopiuj jego DSN, czyli adres, pod który SDK wysyła zdarzenia. Znajdziesz go w ustawieniach projektu, w sekcji **Client Keys (DSN)**.

![DSN Keys](https://images.przeprogramowani.pl/cms/8f0ea5c8-34c0-40ec-96ce-b4e0647872c9/182e4d4c46fe460981a486848566b3adccc69edacc8974239ba7122a596c1d74.png)

### Krok 2: SDK w aplikacji

Do projektu Astro na Cloudflare potrzebujesz dwóch pakietów. **@sentry/astro** obsługuje kod w przeglądarce, a **@sentry/cloudflare** kod serwera działający w Workerze.

```
npm install @sentry/astro @sentry/cloudflare
```

W **wrangler.jsonc** włącz flagę **nodejs\_compat** i dodaj DSN do zmiennych. Entry point zostaje domyślny, nie musisz go podmieniać:

```jsonc
{
  "main": "@astrojs/cloudflare/entrypoints/server",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "PUBLIC_SENTRY_DSN": "https://<klucz>@<host>.ingest.sentry.io/<id-projektu>",
  },
}
```

DSN nie jest sekretem. To tylko adres, pod który SDK wysyła zdarzenia, i tak czy inaczej trafi do kodu przeglądarki, więc może leżeć w **vars**. Prefiks **PUBLIC\_** pozwala Astro wstawić go do bundla klienta, dlatego ta sama wartość musi być dostępna także podczas budowania, np. w pliku **.env**.

W **astro.config.mjs** włączasz integrację Sentry tylko dla przeglądarki:

```js
import sentry from "@sentry/astro";

export default defineConfig({
  integrations: [
    sentry({
      // serwer obsługuje @sentry/cloudflare w middleware
      enabled: { client: true, server: false },
    }),
  ],
  adapter: cloudflare(),
});
```

Wyłączenie strony serwerowej to nie przeoczenie. Serwerowe SDK z **@sentry/astro** wysyła zdarzenia przez transport HTTP z Node, który na Cloudflare Workers po cichu je gubi. To ten sam rodzaj problemu, który diagnozujemy w tej lekcji, tylko w samym monitoringu.

Konfigurację przeglądarki trzymasz w **sentry.client.config.js**, który integracja wczytuje automatycznie:

```js
import * as Sentry from "@sentry/astro";

Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});
```

Stronę serwerową podpinasz w middleware Astro. Astro jest właścicielem entry pointu Workera, więc zamiast owijać cały Worker, owijasz każde żądanie przez **wrapRequestHandler**:

```ts
// src/middleware.ts
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";
import * as Sentry from "@sentry/cloudflare";

// wrapRequestHandler, w przeciwieństwie do withSentry, nie instaluje strategii
// kontekstu asynchronicznego, więc robimy to raz, przy ładowaniu modułu
Sentry.setAsyncLocalStorageAsyncContextStrategy();

export const onRequest = defineMiddleware((context, next) =>
  // osobny scope na każde żądanie, żeby zdarzenia nie mieszały się między requestami
  Sentry.withScope(() =>
    Sentry.wrapRequestHandler(
      {
        options: {
          dsn: env.PUBLIC_SENTRY_DSN,
          integrations: (defaults) => [
            ...defaults,
            // przekaż console.warn / console.error do Sentry jako zdarzenia
            Sentry.captureConsoleIntegration({ levels: ["warn", "error"] }),
          ],
        },
        request: context.request,
        context: context.locals.cfContext,
      },
      () => next(),
    ),
  ),
);
```

**wrapRequestHandler** daje trzy rzeczy, bez których zdarzenia z Workera nie dotrą do Sentry: transport oparty na **fetch**, osobny kontekst dla każdego żądania i wysłanie zaległych zdarzeń przez **waitUntil**, już po oddaniu odpowiedzi użytkownikowi.

Nie musisz konfigurować tego ręcznie. Możesz skorzystać ze ścieżki **/10x-new** → **/10x-plan** → **/10x-implement** z modułu 2, żeby agent przeprowadził cię przez cały setup.

### Krok 3: Sentry MCP w Claude Code

Mając skonfigurowane Sentry, agent odpyta je przez MCP server: przeszuka issues, pobierze stack trace i breadcrumbs bez opuszczania terminala.

Dlaczego MCP, a nie **sentry-cli**? CLI Sentry nie ma dedykowanej komendy do przeszukiwania issues. Robi to dopiero MCP server: wystawia issues, stack trace'y i breadcrumbs jako ustrukturyzowane dane, które agent odpytuje i od razu łączy w swojej pętli. Diagnoza zostaje po stronie agenta, zgodnie z tym, czego ta lekcja uczy.

Najprościej podłączyć zdalny serwer Sentry MCP. Logowanie odbywa się przez OAuth, więc nie musisz tworzyć ani przechowywać tokena:

```
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp
```

Następnie uruchom Claude Code, wpisz **/mcp**, wybierz **sentry** i zaloguj się w przeglądarce. Po autoryzacji serwer powinien mieć status **connected**.

![Sentry MCP](https://images.przeprogramowani.pl/cms/8f0ea5c8-34c0-40ec-96ce-b4e0647872c9/a1066534ff861001fe17c47d33561bd4c1e873a8259f77f832e8f0a4cf883895.png)

Alternatywą jest lokalny serwer (**@sentry/mcp-server**) uruchamiany z tokenem. Utwórz w Sentry User Auth Token z uprawnieniami tylko do odczytu: **org:read**, **project:read**, **team:read** i **event:read**, a potem uruchom serwer:

```
npx @sentry/mcp-server@latest --access-token=<TWOJ_TOKEN>
```

Sentry MCP jest pre-1.0. Nazwy narzędzi mogą się zmienić. Sprawdź [repozytorium](https://github.com/getsentry/sentry-mcp) przed pierwszym użyciem.

### Krok 4: agent szuka błędu

Mając połączone MCP, przekaż agentowi ticket i poproś o sprawdzenie Sentry:

```
Użytkownik zgłasza, że po ocenie fiszki jako „Dobre” ta sama karta wraca do powtórki.
Przeszukaj Sentry pod kątem nierozwiązanych issues związanych z ocenianiem kart.
Pobierz stack trace i breadcrumbs najbardziej pasującego issue i opisz, co pokazują.
Na tym etapie nie zmieniaj kodu.
```

Dwa główne narzędzia w procesie diagnostycznym:

**search\_issues** szuka issues pasujących do zapytania. Bez klucza LLM (OpenAI/Anthropic) narzędzie działa w trybie pass-through: przekazujesz zapytanie w składni Sentry bezpośrednio, np. **message:update\_failed is:unresolved**. Żaden dodatkowy klucz API nie jest potrzebny — wystarczy darmowe konto Sentry i access token.

**get\_sentry\_resource** to uniwersalne narzędzie do pobierania zasobów z dwoma trybami wywołania:

- **URL mode** — podajesz **url** (np. link do issue), typ zasobu wykrywany automatycznie

- **Explicit mode** — podajesz **resourceType** (np. **"issue"**), **resourceId** (short ID jak **PROJECT-123**) i **organizationSlug**

Przykładowy przebieg dla naszego buga:

```
search_issues(query="update_failed", organizationSlug="...", projectSlugOrId="...")
→ znajduje issue z short ID

get_sentry_resource(resourceType="issue", resourceId="PROJECT-123", organizationSlug="...")
→ pełny stack trace, tagi, breadcrumbs w formacie Markdown
```

W naszym scenariuszu Agent znalazł **review/rate: update\_failed**. Stack trace wskazał na **rate.ts**, na obsłudze wyniku zapisu do **review\_states**.

To pierwsza warstwa dowodów. Wiemy teraz, że:

- Błąd istnieje — nieudany UPDATE do **review\_states**
- Lokalizacja — **rate.ts**, obsługa wyniku zapisu
- Kontekst — błąd pojawia się przy ocenie karty

Bez monitoringu ta informacja byłaby zakopana gdzieś w logach serwera (o ile twój setup je przechowuje) albo najpewniej nigdzie.

### Najpierw test, który reprodukuje buga

Zanim agent zacznie naprawiać tego typu błąd, warto napisać test.

W lekcji Testy jednostkowe i integracyjne z agentem (M3L2) test zaczynał od ryzyka i pracował "do przodu": zidentyfikuj ryzyko → napisz asercję → sprawdź, czy kod je pokrywa. Tutaj pracujemy w odwrotną stronę: masz symptom → piszesz test, który go potwierdza → test pada → naprawiasz → test przechodzi.

Ta technika ma swoją nazwę: **test-driven bugfixing**. To ustalona praktyka w TDD — Kent Beck opisał ją dekady temu: kiedy znajdziesz buga, zanim go naprawisz, napisz test, który go reprodukuje, a potem doprowadź go do zielonego.

Jak doprowadzić agenta do takiego testu? Najpierw opisz mu objaw i zażądaj testu, który pada z właściwego powodu, czyli sprawdza trwały stan w bazie, a nie status odpowiedzi:

```
Mamy buga: ocena fiszki zwraca 200, ale harmonogram się nie zapisuje i karta wraca do powtórki.
Napisz test integracyjny dla endpointu oceniania (`rate`), który:
- zaseeduje wiersz w `review_states` z terminem `due` w przeszłości (karta od razu „do powtórki"),
- wywoła ocenę „Dobre" przez endpoint,
- odczyta z bazy ZAPISANY wiersz (nie odpowiedź API) i sprawdzi, że `due` przesunęło się
  w przyszłość, a `reps` wzrosło.
Test ma na tym etapie padać — to reprodukcja buga, nie jego naprawa.
```

To jest pętla debug-as-test: czerwony test, zanim ruszysz fix. Po stronie skilli sięgnij po **/10x-tdd** — prowadzi cykl „najpierw padający test, potem minimalny kod" dla testów jednostkowych i integracyjnych, czyli dokładnie naszego przypadku. Gdyby reprodukcja musiała iść przez przeglądarkę (bug widoczny dopiero w wyrenderowanym UI), warstwę E2E obsługuje **/10x-e2e** z lekcji Testy E2E (M3L4).

Ten test zostaje w repozytorium jako zabezpieczenie przed regresją. Co więcej, jest to pierwszy test poprawności przejść harmonogramu SRS — dokładnie ta warstwa, której w naszym testowym pipeline jeszcze nie było.

### Fix

Naprawa ma dwie części. Po pierwsze, przestajemy połykać błąd: zamiast zwracać 200 z kartą z pamięci, propagujemy awarię:

```
// przed:
if (updateError) {
  console.warn(`review/rate: update_failed ...`);
  return jsonResponse(200, { ok: true });
}

// po:
if (updateError) {
  console.warn(`review/rate: update_failed ...`);
  return jsonResponse(500, { error: "rate_failed" });
}
```

Po drugie, naprawiamy sam zapis, żeby UPDATE przechodził. Dopiero połączenie obu zmian daje kartę, która faktycznie znika z kolejki: samo odsłonięcie błędu (zamiast jego połykania) zamienia ciche 200 na widoczne 500, a poprawny zapis sprawia, że harmonogram naprawdę się przesuwa. To zresztą sedno tej klasy bugów. Najpierw przestajesz ukrywać, co dzieje się w systemie, a dopiero gdy błąd jest widoczny, możesz go porządnie obsłużyć i naprawić.

## Połknięte błędy — klasa problemów widoczna tylko w monitoringu

**Połknięty błąd (ang. swallowed error)** to błąd, który system połyka zamiast propagować. OWASP w edycji 2025 dodał tę klasę do Top 10 jako A10: Mishandling of Exceptional Conditions. To jeden z najczęstszych wzorców prowadzących do bugów, które użytkownicy zgłaszają tygodniami, zanim ktoś je namierzy.

Ten przypadek znaleźliśmy, bo użytkownik go zgłosił, a Sentry akurat widziało warning. Podobnych miejsc w kodzie może być więcej i nie warto czekać, aż każde z nich wypłynie w tickecie. Uruchom na krytycznych przepływach swojej aplikacji `/10x-observability-audit`, który omówiliśmy przy logach Cloudflare. Szuka on dokładnie takich wzorców: przechwyconych wyjątków bez zachowanej przyczyny, awarii zamienianych na 200 albo puste wyniki i ścieżek, których monitoring w ogóle nie widzi.

## Podsumowanie modułu

Na tym kończymy moduł trzeci. Przez pięć lekcji zbudowałeś pełny obraz jakości w pracy z agentem: od test planu i testów jednostkowych, przez hooki i testy E2E, aż po diagnostykę produkcyjną, która łapie to, czego proaktywne warstwy nie przewidziały. Proaktywny pipeline i reaktywne dochodzenie to dwie strony tej samej dyscypliny — jedna chroni przed znanymi ryzykami, druga domyka lukę, kiedy produkcja pokaże coś nowego.

Masz teraz wszystko, czego potrzeba, żeby pokryć swój projekt testami i zgłosić go po **odznakę Builder**. To naturalny moment, żeby to zrobić. Minimum do zgłoszenia to zrealizowana roadmapa MVP, czyli obsługa CRUD dla głównego zasobu i jedna funkcja z logiką biznesową, plus przynajmniej jeden zestaw testów dowolnego typu: jednostkowych, integracyjnych lub e2e. Szczegółowe warunki zgłoszenia znajdziesz w dedykowanym poście na kanale [Informacje i ogłoszenia \[10X4\]](https://bravecourses.circle.so/c/informacje-i-ogloszenia-10x4).

Na koniec jeszcze jedno przypomnienie. Skuteczne debugowanie z modelami AI w 2026 roku to przede wszystkim kontekst, a nie zaawansowane, tajemnicze prompty czy żonglowanie technikami. Do poprawnej diagnozy i naprawy wystarczy znana ci ścieżka 10xWorkflow: **/10x-new** → **/10x-plan** (i ew. research) → **/10x-implement**. Jeśli agentowi brakuje danych, podłącz go do źródeł przez MCP albo CLI i pozwól mu przejrzeć historię gita. A gdy wiesz, że coś kiedyś działało, a teraz nie działa, nie zapominaj o **git bisect** prowadzonym przez agenta: z testem reprodukującym buga jako kryterium (**git bisect run**) sam przejdzie przez kolejne commity i wskaże zmianę, która wprowadziła błąd.

## 🧑🏻‍💻 Zadania praktyczne

1. **Zidentyfikuj połknięty błąd we własnym projekcie.** Uruchom `/10x-observability-audit` dla jednego krytycznego przepływu swojej aplikacji. Z raportu wybierz jedno znalezisko, w którym błąd jest połykany albo zamieniany na sukces, i napraw je tak, żeby awaria trafiała do odpowiedzi API i do monitoringu.

2. **(Opcjonalnie) Skonfiguruj monitoring we własnym projekcie.** Jeśli nie masz jeszcze Sentry ani innego narzędzia do monitoringu, możesz je skonfigurować korzystając ze ścieżki **/10x-new** → **/10x-plan** → **/10x-implement**, którą znasz z modułu 2. Darmowy plan Sentry wystarczy na projekt kursowy. Szczegóły konfiguracji znajdziesz w sekcji o Sentry MCP.

## Odbierz swoją odznakę

Po ukończeniu tej lekcji odbierz odznakę w sekcji [10xDevs Mission Log](https://platforma.przeprogramowani.pl/mission-log) a następnie pochwal się swoim osiągnięciem!

## Deep dive: jak Anthropic przyspieszył claude.ai trzykrotnie

Aplikacja działa, testy przechodzą, a jednak z każdym tygodniem jest wolniej. Strona ładuje się dłużej, odpowiedź pojawia się z opóźnieniem, przewijanie się przycina. Nikt nie zgłasza błędu, bo formalnie żadnego nie ma, a użytkownicy coraz szybciej rezygnują. Takie problemy trudno debugować: nie ma stack trace'a ani alertu, jest tylko ogólne wrażenie, że „coś zwalnia”.

W sierpniu 2026 zespół claude.ai opisał na blogu, [jak w dwa tygodnie przyspieszył swoją aplikację](https://claude.dev/blog/how-we-made-claude-ai-faster/). Kluczowe ścieżki użytkownika działają teraz średnio 3,1 raza szybciej. Świeże ładowanie strony spadło z 3085 do 550 ms (75. percentyl), a wczytanie istniejącej rozmowy przyspieszyło nawet 3,5-krotnie. Zespół pracował z Claude'em w jednym kanale na Slacku, w ponad 150 równoległych wątkach. Weszło ponad 3000 zmian bez żadnego incydentu u klientów i bez rollbacku.

Opisany tam sposób pracy zamienia ogólne „jest wolno” w liczby, które agent może poprawiać, i przenosi się na każde debugowanie z agentem.

### Pętla pracy

Każdy wątek przechodził przez te same kroki:

1. Objaw widoczny dla użytkownika: nagranie albo zrzut ekranu wolnej ścieżki.
2. Powtarzalny benchmark, czyli test, który w kontrolowanym środowisku odtwarza wolną ścieżkę i za każdym razem mierzy ją w ten sam sposób. Pomiar zaczynał się od akcji użytkownika, kończył na wyrenderowanym wyniku i osobno pokazywał czas pracy przeglądarki i serwera. Dzięki temu od razu było widać, po której stronie szukać przyczyny.
3. Pull request z poprawką.
4. Wdrożenie za feature flagą: najpierw pracownicy, potem 1% użytkowników, na końcu wszyscy.
5. Porównanie danych z produkcji z punktem wyjścia.
6. Zaostrzenie progu benchmarku, żeby poprawka nie mogła się cofnąć.

To ta sama pętla, którą znasz z test-driven bugfixingu: najpierw odtwarzasz błąd, potem go naprawiasz, a test regresji zostaje w repozytorium i pilnuje, żeby problem nie wrócił. Zespół claude.ai przeniósł tę zasadę na wydajność. Dla każdej zoptymalizowanej ścieżki CI przechowywało górny limit liczby instrukcji procesora, jakie ta ścieżka może wykonać. Pull request, który ten limit przekraczał, nie przechodził CI. Raz dziennie automatyczne zadanie sprawdzało aktualne wyniki i jeśli ścieżka wykonywała mniej instrukcji niż wcześniej, obniżało limit do nowego poziomu. Dzięki temu każde przyspieszenie od razu stawało się obowiązującym standardem i kolejne zmiany nie mogły go już cofnąć.

### Daj agentowi liczbę, ale sprawdź, czy to właściwa liczba

Autorzy podsumowują swoje doświadczenie zdaniem „With Claude, measuring something makes it tractable”. Gdy agent dostaje liczbę do pobicia albo czerwony test do zazielenienia, może pracować sam. Według autorów człowiek najwięcej wnosi wtedy, gdy wymyśla, co jeszcze warto zmierzyć.

Pomiar musi jednak spełniać dwa warunki. Po pierwsze, musi być stabilny. Czas mierzony zegarem to dokładnie to, co czuje użytkownik, ale wynik skacze między uruchomieniami i nie nadaje się na bramkę w CI. Zespół szukał więc metryk deterministycznych: liczby instrukcji CPU (Valgrind z `node --predictable`), liczby renderów Reacta, przeliczeń stylów i przesunięć layoutu. Ten sam problem masz przy niestabilnych testach: dopóki wynik zależy od szczęścia, nie wiesz, czy poprawka zadziałała.

Po drugie, pomiar musi odpowiadać temu, co widzi użytkownik. Każdą zastępczą metrykę zespół najpierw porównał z czasem rzeczywistym. Przy składaniu drzewa wiadomości spadek liczby instrukcji o 48% dał czas krótszy o 78%. Benchmark, który był niestabilny albo nie szedł w parze z odczuwanym czasem, lądował w koszu, żeby Claude nie „wspinał się na złą górę”. Agent równie skutecznie optymalizuje błędną liczbę, więc wybór metryki zostaje po twojej stronie.

### Błędy chowają się tam, gdzie nic nie mierzysz

Żadnego z trzech poniższych znalezisk nie pokazywał istniejący wskaźnik.

- Claude prześledził kod wykonywany _po_ pierwszym wyrenderowaniu strony i znalazł zapomniane `location.reload()`. Powodowało pół miliona ukrytych przeładowań dziennie. Metryki ładowania ich nie widziały, bo mierzyły tylko pierwsze wejście.
- W próbkach profilera z _bezczynnych_ kart zobaczył, że te same snapshoty cache'a są dwa razy na minutę kopiowane do IndexedDB, w dodatku na głównym wątku.
- Pole do wpisywania wiadomości przeskakiwało o 15–20 px, gdy claude.ai otwierano w nowej karcie. Chrome renderował stronę z wyprzedzeniem w wysokości karty, na której była jeszcze 56-pikselowa stopka strony startowej. Testy w headless Chrome nie mogły tego odtworzyć.

Kiedy wszystkie wskaźniki są zielone, a użytkownicy dalej zgłaszają problem, zadaj sobie trzy pytania. Co dzieje się po zakończeniu pomiaru? Co robi aplikacja, gdy użytkownik nic nie klika? Czym środowisko testowe różni się od prawdziwego? Na tej samej intuicji opiera się `/10x-observability-audit`.

### Czasem przyczyna leży warstwę niżej

Podświetlanie składni w gotowym bloku kodu potrafiło zamrozić stronę na około sekundę. Kod aplikacji wyglądał poprawnie, a przyczyna siedziała w silniku V8. Jeśli odpowiedź zawierała choć jeden znak spoza Latin-1, na przykład długi myślnik albo typograficzny cudzysłów, V8 zapisywał cały tekst w UTF-16 i wszystkie wyrażenia regularne szły wolniejszą ścieżką. Poprawka zajęła około 20 linii: przed podświetleniem blok kodu jest kopiowany do jednobajtowego stringa. Blokada głównego wątku spadła z 1,0 do 0,35 s.

### Człowiek decyduje, co jest warte zachodu

Agent szukał i optymalizował, a ludzie oglądali nagrania przed zmianą i po niej przy wszystkim, co użytkownik mógł zauważyć. Pilnowali też, żeby wątki się nie nakładały. Odrzucili 900-liniowy PR, który oszczędzał 2 ms przy wysyłaniu wiadomości, bo zysk nie był wart złożoności. Jeden z inżynierów z kolei namawiał agenta do śmielszych zmian.

Przy twoim debugowaniu podział ról jest taki sam. Agent zbierze dane, sprawdzi hipotezy i przygotuje poprawkę. Ty decydujesz, który problem rozwiązać, po czym poznasz, że się udało, i czy poprawka jest warta swojej ceny.

## 📚 Materiały dodatkowe

- [Sentry MCP Server](https://github.com/getsentry/sentry-mcp) — repozytorium MCP servera Sentry: dostępne narzędzia, setup, konfiguracja z Claude Code

- [Sentry Pricing](https://sentry.io/pricing/) — aktualne plany i limity, w tym darmowy plan Developer

- [Sentry Astro + Cloudflare SDK Guide](https://docs.sentry.io/platforms/javascript/guides/cloudflare/frameworks/astro/) — oficjalny poradnik konfiguracji @sentry/astro z @sentry/cloudflare

- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) i [cennik](https://developers.cloudflare.com/workers/platform/pricing/#workers-logs) — zapis zdarzeń, próbkowanie, retencja i koszty.

- [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/) — wyszukiwanie i analiza historii oraz dostęp przez API.

- [OWASP A10:2025 — Mishandling of Exceptional Conditions](https://owasp.org/Top10/2025/A10_2025-Mishandling_of_Exceptional_Conditions/) — klasyfikacja swallowed errors w OWASP Top 10

- [Charity Majors — "I Test in Production"](https://www.infoq.com/presentations/testing-production-2018/) — talk o komplementarności testowania i monitoringu: "tests can't catch what they don't know to look for"

- [How we made claude.ai faster](https://claude.dev/blog/how-we-made-claude-ai-faster/) — jak zespół claude.ai z pomocą Claude'a przyspieszył aplikację trzykrotnie w dwa tygodnie: deterministyczne benchmarki, progi w CI, które mogą się tylko zaostrzać, i błędy ukryte przed metrykami

- [Test-Driven Bugfixing](https://evolveum.com/test-driven-bugfixing/) — opis techniki test-driven bugfixing w praktyce TDD

- Prework [\[2.3\]](https://platforma.przeprogramowani.pl/courses/10xdevs-foundations/pl/06) _Claude Code — Podstawy operacyjne_ — MCP servers jako narzędzia agenta, tutaj zastosowane do zbierania danych diagnostycznych
