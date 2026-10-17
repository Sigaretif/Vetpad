# Zmiana trybu pobierania ogłoszeń w Supabase

Vetpad pobiera ogłoszenie z otodom.pl na dwa sposoby: bezpośrednio, jak dotąd, albo przez
Apify (`apify/cheerio-scraper`), gdy otodom zablokuje bezpośrednie zapytanie. Którego używa,
decyduje jeden wiersz tabeli `public.ingestion_settings`. Aplikacja nie ma do tego formularza:
członkowie zespołu tryb tylko widzą (sekcja trybu pobierania na `/criteria`), a zmienia go
administrator bezpośrednio w hostowanym projekcie Supabase.

## Trzy tryby

| Wartość `mode`         | Co robi                                                                                                                                       | Kiedy używać                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `direct_with_fallback` | Najpierw pobranie bezpośrednie. Gdy otodom je zablokuje, nie odpowie albo zwróci stronę bez danych, jedno pobranie przez Apify. **Domyślny.** | Na co dzień.                                                                                                     |
| `apify_only`           | Od razu przez Apify, bez próby bezpośredniej.                                                                                                 | Gdy otodom blokuje nas stale i próba bezpośrednia tylko wydłuża dodanie oferty.                                  |
| `direct_only`          | Tylko bezpośrednio, Apify nigdy.                                                                                                              | Wyłącznik kosztów, albo gdy otodom zmienił stronę i Apify też nic nie pobiera (`detail: both_sources` w logach). |

Bez `APIFY_TOKEN` każdy tryb działa jak `direct_only`, a aplikacja pokazuje to w banerze
i na `/criteria`. Gdy wiersza nie da się odczytać (usunięty, literówka w wartości), aplikacja
też pobiera tylko bezpośrednio — nigdy nie odmawia dodania oferty.

## Kroki

1. Wejdź na <https://supabase.com/dashboard> i wybierz **hostowany** projekt Vetpad.
2. Zmień wartość jednym z dwóch sposobów:
   - **Table Editor:** w lewym pasku kliknij **Table Editor**, u góry wybierz schemat
     **public**, kliknij tabelę **`ingestion_settings`** (ma jeden wiersz), kliknij dwukrotnie
     komórkę **`mode`**, wpisz jedną z trzech wartości i zatwierdź Enterem albo **Save**.
   - **SQL Editor:** kliknij **SQL Editor**, potem **New query**, wklej polecenie z wybraną
     wartością i kliknij **Run**:

     ```sql
     update public.ingestion_settings set mode = 'direct_with_fallback' where id;
     ```

3. Sprawdź wynik na <https://vetpad.vetpad.workers.dev/criteria>, w sekcji trybu pobierania.
   Zmiana działa od następnego dodania lub odświeżenia oferty, bez deployu.

## Zasady

- Wpisz wartość dokładnie tak jak w tabeli: małe litery, podkreślenia. Inną baza odrzuci.
- Nie usuwaj wiersza i nie dodawaj drugiego — tabela ma zawsze dokładnie jeden wiersz.
- Nie dopisuj polityk RLS pozwalających członkom zmieniać tryb. Brak polityk zapisu jest
  zamierzony: tryb to ustawienie administratora (`CLAUDE.md`, reguła RLS).
- Każde pobranie przez Apify kosztuje ok. $0.001–0.002, także nieudane. Plan Free Apify ma
  twardy limit $5 miesięcznie; po jego wyczerpaniu Apify zwraca 402 i aplikacja pobiera
  tylko bezpośrednio do nowego cyklu.

## Zobacz też

- `context/foundation/deployment-runbook.md`, sekcja „Ingestion starts failing (otodom)” —
  objawy błędów Apify i co z nimi zrobić, rotacja tokena.
- `context/foundation/ingestion/otodom_apify.md` — jak działa pobieranie przez Apify.
