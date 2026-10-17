# Live calls — otodom-apify-fallback

Written by `scripts/apify-verify.mjs`, row by row: each row is written before its call, with the
result `pending`, and completed after it. Do not edit a row by hand except to fill in `cost`
(Console → Runs → Usage, plan prerequisite P5).

## Limits

- Apify: 15 requests (every request sent to the Apify API, billed or not), raised once to 25
  by one `raise-budget` row.
- otodom direct: 15 requests, raised once to 25 the same way.

## Rules

- Calls are sequential; two requests that may reach otodom are at least 30 s apart.
- A case runs once per target and listing; a repeat prints `ALREADY_RECORDED` and calls nothing.
- The first 403, 429 or `cf-mitigated` answer from otodom, on either leg, is `BLOCKED`: nothing
  that reaches otodom is called after it.
- `SKIPPED` (no token or no address) and `BLOCKED` rows that are not calls carry `-` in
  `billed` and `reached_otodom` and count toward no limit.
- `listing` holds the listing's ID token only. No row holds an address, a path or listing text.
- In `result`, the token values `http` and `http_denied` are written `HTTP` and `HTTP_denied`,
  so that no row contains the lowercase scheme.

## Calls

| time                     | target | case          | purpose                                                               | listing | billed | reached_otodom | result                                                                                                                                                   | cost   | count |
| ------------------------ | ------ | ------------- | --------------------------------------------------------------------- | ------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----- |
| 2026-10-17T19:58:48.086Z | apify  | invalid-token | junk token refused before a run starts                                | ID4DzV5 | no     | no             | apify_status=401 apify_error=user-or-token-not-found apify_failure=HTTP                                                                                  |        | 1/15  |
| 2026-10-17T19:58:57.435Z | otodom | sale          | direct ad of a flat for sale, the reference for the comparison        | ID4DzV5 | no     | yes            | status=200 landing=offer reason=ok gate=pass ad_keys=62                                                                                                  |        | 1/15  |
| 2026-10-17T19:59:28.977Z | apify  | sale          | Apify ad of the same flat, compared key-wise and through mapAdToOffer | ID4DzV5 | yes    | yes            | apify_status=201 status=200 landing=offer_same reason=ok gate=pass keys_equal=yes missing_keys=none differing_keys=none extra_keys=none mapped_equal=yes |        | 2/15  |
| 2026-10-17T19:59:59.981Z | apify  | rental        | flat for rent refused by the gate                                     | ID4DzRm | yes    | yes            | apify_status=201 status=200 landing=offer_same reason=ok gate=not_for_sale                                                                               |        | 3/15  |
| 2026-10-17T20:00:30.997Z | apify  | expired       | expired offer read as not_found                                       | ID4AkRi | yes    | yes            | apify_status=201 status=410 landing=offer_same reason=not_found                                                                                          |        | 4/15  |
| 2026-10-17T20:01:02.003Z | apify  | redirect      | sale address with an altered slug lands on the same listing           | ID4DzV5 | yes    | yes            | apify_status=201 status=200 landing=offer_same reason=ok gate=pass slug_sent=altered                                                                     |        | 5/15  |
| 2026-10-17T20:01:33.016Z | apify  | run-timeout   | run timeout of 1 s, answered without reaching otodom                  | ID4DzV5 | no     | yes            | apify_status=400 apify_error=run-failed apify_failure=HTTP                                                                                               | $0.000 | 6/15  |
