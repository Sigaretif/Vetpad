import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import ArchiveNotice from "@/components/offers/ArchiveNotice.astro";
import DeleteNotice from "@/components/offers/DeleteNotice.astro";
import DuplicateNotice from "@/components/offers/DuplicateNotice.astro";
import NoteDeleteNotice from "@/components/offers/NoteDeleteNotice.astro";
import OfferAudit from "@/components/offers/OfferAudit.astro";
import OfferBoardItem from "@/components/offers/OfferBoardItem.astro";
import OfferCard from "@/components/offers/OfferCard.astro";
import OfferGallery from "@/components/offers/OfferGallery.astro";
import OfferView from "@/components/offers/OfferView.astro";
import RefetchNotice from "@/components/offers/RefetchNotice.astro";
import type { AuditFreshness } from "@/lib/audit/freshness";
import type { StoredFindings } from "@/lib/audit/schema";
import type { AuditAttempt, OfferAudit as OfferAuditData, StoredAudit } from "@/lib/audit/store";
import type { Saver } from "@/lib/members";
import type { OfferArchiveState } from "@/lib/offer-archive";
import type { OfferImage, OfferRow } from "@/lib/otodom/types";
import {
  archivedByDeletedOffer,
  archivedOffer,
  failedNotes,
  fullNotes,
  fullOffer,
  malformedImagesOffer,
  memberSaver,
  noAudits,
  noLimits,
  noNotes,
  othersOnlyNotes,
  outsideCityOffer,
  streetOnlyOffer,
  unknownOffer,
} from "@/pages/dev/_offer-fixtures";

// The stored row, not the ingest, is the attack surface (lessons.md): any member can PATCH any
// `offers` column, so these renders feed the views hostile and broken values directly, with no
// mapper in between. Expected values are written by hand from the rule — only an https URL
// reaches href/src, and a URL that fails renders no link or image — never copied from output.

const NO_PHOTOS = "Ogłoszenie nie zawiera zdjęć.";
const SOURCE_LINK = "Otwórz oryginał";

const JS = "javascript:alert(1)";
const THUMB = "https://picsum.photos/seed/render-test/320/240";
const MEDIUM = "https://picsum.photos/seed/render-test/655/491";
const LARGE = "https://picsum.photos/seed/render-test/800/600";
const VALID: OfferImage = { thumbnail: THUMB, medium: MEDIUM, large: LARGE };
/** A photo saved before `medium` was stored: the gallery falls back to `large`. */
const VALID_LEGACY: OfferImage = { thumbnail: THUMB, large: LARGE };

let container: AstroContainer;

beforeAll(async () => {
  // The views render React `Card`/`Badge` server-side, so the container needs the React renderer.
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/**
 * Every `href`/`src` value in the markup, and every candidate URL of every `srcset`. The count of
 * attribute names guards the extraction: an attribute the pattern cannot read (unquoted,
 * single-quoted) fails the test instead of slipping past the whitelist.
 */
function urlsIn(html: string): string[] {
  const values = Array.from(html.matchAll(/(?<![\w-])(href|src|srcset)\s*=\s*"([^"]*)"/gi), ([, name, value]) =>
    name.toLowerCase() === "srcset" ? srcsetUrls(value) : [value],
  );
  const names = html.match(/(?<![\w-])(?:href|src|srcset)\s*=/gi) ?? [];
  expect(values).toHaveLength(names.length);
  return values.flat();
}

/**
 * The candidate URLs of a `srcset`, each followed by a width descriptor. A URL with whitespace in
 * it would split into tokens that are not descriptors, so the descriptor check fails the test
 * rather than letting part of a URL past the whitelist. A URL ending in a comma is checked too:
 * the browser's parser ends the candidate there and reads the descriptor as a URL.
 */
function srcsetUrls(srcset: string): string[] {
  const tokens = srcset.trim().split(/\s+/);
  expect(tokens.length % 2).toBe(0);
  return tokens.flatMap((token, index) => {
    if (index % 2 === 0) {
      expect(token).not.toMatch(/,$/);
      return [token];
    }
    expect(token).toMatch(index === tokens.length - 1 ? /^\d+w$/ : /^\d+w,$/);
    return [];
  });
}

function imgAttributesIn(html: string, name: "srcset" | "sizes"): string[] {
  return Array.from(html.matchAll(new RegExp(`<img\\b[^>]*?\\s${name}="([^"]*)"`, "gi")), (match) => match[1]);
}

function hrefsIn(html: string): string[] {
  return Array.from(html.matchAll(/(?<![\w-])href\s*=\s*"([^"]*)"/gi), (match) => match[1]);
}

function imgSrcsIn(html: string): string[] {
  return Array.from(html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi), (match) => match[1]);
}

/** The `props` attribute of every island in the markup, with Astro's `&quot;` escaping undone. */
function islandPropsIn(html: string): string[] {
  return Array.from(html.matchAll(/<astro-island\b[^>]*?\sprops="([^"]*)"/g), (match) =>
    match[1].replaceAll("&quot;", '"').replaceAll("&amp;", "&"),
  );
}

/** Every string anywhere in serialised island props, in document order. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(stringsIn);
}

function countTags(html: string, tag: string): number {
  return html.match(new RegExp(`<${tag}\\b`, "gi"))?.length ?? 0;
}

/**
 * The whitelist: an absolute https URL, or an internal path. `//host` and `/\host` are
 * protocol-relative in a browser, so a path must not start with a second slash or a backslash.
 */
function expectOnlySafeUrls(html: string): void {
  for (const url of urlsIn(html)) {
    expect(url).toMatch(/^(?:https:\/\/|\/(?![/\\]))/);
  }
}

/**
 * The markup without the two inline scripts Astro emits before a page's first island — its
 * hydration runtime, each an immediately invoked arrow function. A script of any other shape stays.
 */
function withoutIslandRuntime(html: string): string {
  return html.replace(/<script>\(\(\)=>\{[\s\S]*?<\/script>/g, "");
}

function card(offer: OfferRow): Promise<string> {
  return container.renderToString(OfferCard, { props: { offer, saver: memberSaver } });
}

function gallery(images: unknown[]): Promise<string> {
  return container.renderToString(OfferGallery, { props: { images, title: fullOffer.title } });
}

function boardItem(images: unknown): Promise<string> {
  const offer = { ...fullOffer, images: images as OfferImage[] };
  return container.renderToString(OfferBoardItem, { props: { offer, limits: noLimits, audits: noAudits } });
}

describe("OfferCard: the source link (#7)", () => {
  it.each<unknown>([
    JS,
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "data:text/html,x",
    "http://www.otodom.pl/pl/oferta/x",
    "//evil.example/x",
    null,
    42,
  ])("renders no source link for the stored source_url %j", async (sourceUrl) => {
    const html = await card({ ...fullOffer, source_url: sourceUrl as string });

    expect(html).not.toContain(SOURCE_LINK);
    expectOnlySafeUrls(html);
  });

  it.each(["https://www.otodom.pl/pl/oferta/x", " https://www.otodom.pl/pl/oferta/x"])(
    "links the https source_url %j as the parsed URL",
    async (sourceUrl) => {
      const html = await card({ ...fullOffer, source_url: sourceUrl });

      expect(html).toContain(SOURCE_LINK);
      expect(hrefsIn(html).filter((href) => href.startsWith("https://www.otodom.pl/"))).toEqual([
        "https://www.otodom.pl/pl/oferta/x",
      ]);
      expectOnlySafeUrls(html);
    },
  );

  it("renders a stored images element that is not a photo without failing", async () => {
    const html = await card({ ...fullOffer, images: [null] as unknown as OfferImage[] });

    expect(html).toContain(NO_PHOTOS);
    expect(countTags(html, "img")).toBe(0);
    expectOnlySafeUrls(html);
  });

  it("renders the malformed-images fixture with no photo", async () => {
    const html = await card(malformedImagesOffer);

    expect(html).toContain(NO_PHOTOS);
    expect(countTags(html, "img")).toBe(0);
    expectOnlySafeUrls(html);
  });
});

describe("OfferCard: the map link", () => {
  const MAP_LINK = "Pokaż na mapie Google";
  const MAPS = "https://www.google.com/maps/search/";

  /** Every map-search `href` in the markup, with the attribute's entities decoded back to the URL. */
  function mapHrefsIn(html: string): string[] {
    return hrefsIn(html)
      .filter((href) => href.startsWith(MAPS))
      .map((href) => href.replace(/&amp;/g, "&"));
  }

  /** The decoded `query` of the card's one map link: the row's content may stand nowhere else in it. */
  function mapQuery(html: string): string | null {
    const hrefs = mapHrefsIn(html);
    expect(hrefs).toHaveLength(1);
    const url = new URL(hrefs[0]);
    expect(url.origin + url.pathname).toBe(MAPS);
    expect(Array.from(url.searchParams.keys())).toEqual(["api", "query"]);
    expect(url.searchParams.get("api")).toBe("1");
    return url.searchParams.get("query");
  }

  it("links the full offer's street and location label, in a new tab", async () => {
    const html = await card(fullOffer);

    expect(html).toContain(MAP_LINK);
    expect(mapQuery(html)).toBe("ul. Przykładowa, Warszawa, Mokotów, Stary Mokotów");

    const tags = (html.match(/<a\b[^>]*>/g) ?? []).filter((tag) => tag.includes(`href="${MAPS}`));
    expect(tags).toHaveLength(1);
    expect(tags[0]).toContain('target="_blank"');
    expect(tags[0]).toContain('rel="noopener noreferrer"');
    expectOnlySafeUrls(html);
  });

  it("links the label alone when the offer states no street", async () => {
    const html = await card(outsideCityOffer);

    expect(html).toContain(MAP_LINK);
    expect(mapQuery(html)).toBe("Ząbki, wołomiński, mazowieckie");
    expectOnlySafeUrls(html);
  });

  it.each<[string, OfferRow]>([
    ["states no location at all", unknownOffer],
    ["states only a street", streetOnlyOffer],
  ])("renders no map link for an offer that %s", async (_case, offer) => {
    const html = await card(offer);

    expect(html).not.toContain(MAP_LINK);
    expect(mapHrefsIn(html)).toEqual([]);
    expectOnlySafeUrls(html);
  });

  it("renders the map link without the source link when the stored source_url is refused", async () => {
    const html = await card({ ...fullOffer, source_url: JS });

    expect(html).toContain(MAP_LINK);
    expect(mapHrefsIn(html)).toHaveLength(1);
    expect(html).not.toContain(SOURCE_LINK);
    expectOnlySafeUrls(html);
  });

  it("renders the source link without the map link when the offer states no location", async () => {
    const html = await card(streetOnlyOffer);

    expect(html).toContain(SOURCE_LINK);
    expect(hrefsIn(html)).toContain("https://example.com/oferta/tylko-ulica");
    expect(html).not.toContain(MAP_LINK);
    expect(mapHrefsIn(html)).toEqual([]);
  });

  it.each(['"><script>alert(1)</script>', JS])(
    "keeps the stored location label %j inside the query, as text",
    async (label) => {
      const html = await card({ ...fullOffer, location_label: label });

      expectOnlySafeUrls(html);
      // The card mounts the re-fetch island, so Astro's own hydration runtime is on the page;
      // no other script may be.
      expect(withoutIslandRuntime(html)).not.toContain("<script");
      expect(html).toContain(MAP_LINK);
      expect(mapQuery(html)).toBe(`ul. Przykładowa, ${label}`);
    },
  );
});

describe("OfferGallery: a photo renders only when its thumbnail and large URLs are https (#7)", () => {
  it.each([
    ["a hostile thumbnail", { thumbnail: JS, large: LARGE }],
    ["a hostile large photo", { thumbnail: THUMB, large: JS }],
  ])("skips an entry with %s", async (_case, image) => {
    const html = await gallery([image]);

    expect(countTags(html, "img")).toBe(0);
    expect(html).toContain(NO_PHOTOS);
    expectOnlySafeUrls(html);
  });

  it.each<unknown>([null, 42, {}, "https://x.pl/a.jpg"])(
    "renders the element %j, which is not a photo, as no photo without failing",
    async (element) => {
      const html = await gallery([element]);

      expect(countTags(html, "img")).toBe(0);
      expect(html).toContain(NO_PHOTOS);
      expectOnlySafeUrls(html);
    },
  );

  it("renders exactly the one valid entry among broken and hostile ones", async () => {
    const html = await gallery([
      null,
      42,
      {},
      "https://x.pl/a.jpg",
      { thumbnail: JS, large: LARGE },
      VALID,
      { thumbnail: THUMB, large: "http://picsum.photos/seed/render-test/800/600" },
    ]);

    expect(imgSrcsIn(html)).toEqual([MEDIUM]);
    expect(hrefsIn(html)).toEqual([LARGE]);
    expect(countTags(html, "img")).toBe(1);
    expect(countTags(html, "a")).toBe(1);
    expect(html).not.toContain(NO_PHOTOS);
    expectOnlySafeUrls(html);
  });

  it("shows the medium variant in the grid, and the large one for a photo saved without it", async () => {
    const html = await gallery([VALID, VALID_LEGACY]);

    expect(imgSrcsIn(html)).toEqual([MEDIUM, LARGE]);
    expect(imgAttributesIn(html, "srcset")).toEqual([
      "https://picsum.photos/seed/render-test/655/491 655w, https://picsum.photos/seed/render-test/800/600 2048w",
      "https://picsum.photos/seed/render-test/800/600 2048w",
    ]);
    expect(imgAttributesIn(html, "sizes")).toEqual([
      "(min-width: 1024px) 223px, (min-width: 640px) 33vw, 50vw",
      "(min-width: 1024px) 223px, (min-width: 640px) 33vw, 50vw",
    ]);
    expect(hrefsIn(html)).toEqual([LARGE, LARGE]);
    expectOnlySafeUrls(html);
  });

  it("gives a single photo the width of the whole gallery", async () => {
    const html = await gallery([VALID]);

    expect(imgAttributesIn(html, "sizes")).toEqual(["(min-width: 1024px) 694px, 100vw"]);
    expect(html).toContain("grid-cols-1");
    expectOnlySafeUrls(html);
  });

  it.each([
    ["a script URL", JS],
    ["an http: URL", "http://picsum.photos/seed/render-test/655/491"],
    ["a non-string", 42],
  ])("renders the photo without a medium variant that is %s", async (_case, medium) => {
    const html = await gallery([{ thumbnail: THUMB, medium, large: LARGE }]);

    expect(imgSrcsIn(html)).toEqual([LARGE]);
    expect(imgAttributesIn(html, "srcset")).toEqual(["https://picsum.photos/seed/render-test/800/600 2048w"]);
    expect(hrefsIn(html)).toEqual([LARGE]);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("http://");
    expectOnlySafeUrls(html);
  });

  it("puts a medium URL with a space and a comma into srcset as one token", async () => {
    const html = await gallery([{ thumbnail: THUMB, medium: "https://x.pl/a b, 9999w", large: LARGE }]);

    expect(imgAttributesIn(html, "srcset")).toEqual([
      "https://x.pl/a%20b,%209999w 655w, https://picsum.photos/seed/render-test/800/600 2048w",
    ]);
    expectOnlySafeUrls(html);
  });

  it("encodes a trailing comma of a medium or large URL in srcset", async () => {
    const html = await gallery([{ thumbnail: THUMB, medium: "https://x.pl/a,", large: "https://x.pl/b," }]);

    expect(imgAttributesIn(html, "srcset")).toEqual(["https://x.pl/a%2C 655w, https://x.pl/b%2C 2048w"]);
    expectOnlySafeUrls(html);
  });

  it("hands the photo viewer island only the filtered URLs, never a rejected value", async () => {
    const html = await gallery([
      null,
      { thumbnail: JS, medium: MEDIUM, large: LARGE },
      { thumbnail: THUMB, medium: MEDIUM, large: JS },
      { thumbnail: THUMB, medium: "http://picsum.photos/seed/render-test/655/491", large: LARGE },
      { thumbnail: THUMB, medium: JS, large: LARGE },
      VALID,
      { thumbnail: THUMB, large: "http://picsum.photos/seed/render-test/800/600" },
    ]);
    const props = islandPropsIn(html);

    expect(props).toHaveLength(1);
    expect(props[0]).not.toContain("javascript:");
    expect(props[0]).not.toContain("http://");
    // Three photos survive the filter: two without their rejected medium variant, and VALID.
    expect(stringsIn(JSON.parse(props[0]))).toEqual([LARGE, LARGE, MEDIUM, LARGE, fullOffer.title]);
    expect(imgSrcsIn(html)).toEqual([LARGE, LARGE, MEDIUM]);
    expectOnlySafeUrls(html);
  });

  it("renders the grid alone on the server, with the viewer closed even when it opens on a photo", async () => {
    const html = await container.renderToString(OfferGallery, {
      props: { images: [VALID, VALID_LEGACY], title: fullOffer.title, openAt: 1 },
    });

    expect(html).toContain("<astro-island");
    expect(countTags(html, "img")).toBe(2);
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("Zdjęcia: ");
    expect(html).not.toContain("aria-live");
  });

  it("mounts no photo viewer island for an offer with no photos", async () => {
    const html = await gallery([{ thumbnail: JS, large: LARGE }]);

    expect(html).toContain(NO_PHOTOS);
    expect(html).not.toContain("<astro-island");
  });
});

describe("OfferBoardItem: the thumbnail and the row link (#7)", () => {
  const PLACEHOLDER = /<div\b[^>]*aria-hidden="true"[^>]*>\s*<\/div>/;
  const ROW_LINK = `/offers/${fullOffer.id}`;

  it("shows the first https thumbnail, past an element that is not a photo", async () => {
    const html = await boardItem([null, VALID]);

    expect(imgSrcsIn(html)).toEqual([THUMB]);
    expect(html).not.toMatch(PLACEHOLDER);
    expect(hrefsIn(html)).toEqual([ROW_LINK]);
    expectOnlySafeUrls(html);
  });

  it.each<[string, unknown]>([
    ["a javascript: thumbnail", [{ thumbnail: JS }]],
    ["an http: thumbnail", [{ thumbnail: "http://picsum.photos/seed/render-test/320/240" }]],
    ["no photos", []],
    ["images: null", null],
  ])("shows the placeholder and no image for %s", async (_case, images) => {
    const html = await boardItem(images);

    expect(countTags(html, "img")).toBe(0);
    expect(html).toMatch(PLACEHOLDER);
    expect(hrefsIn(html)).toEqual([ROW_LINK]);
    expectOnlySafeUrls(html);
  });
});

// The audit section of the offer card (FR-010, FR-011). Expected outcomes are written by hand from
// its contract in context/changes/grounded-listing-audit/plan.md (Phase 5: `data-audit-state`
// describes the audit's data and `data-audit-available` the provider key; an excerpt is rendered
// as text; an empty category says so; with `error` there is no button; a failed re-run leaves the
// earlier result in view) — never copied from the rendered output.
//
// The stored row is the attack surface here too: any member can PATCH `offer_audits.findings`, so
// the renders below feed the section findings that carry markup, with no grounding in between.

/** A hostile value per text a finding carries. None may reach the page as markup. */
const HOSTILE = {
  label: '<img src=x onerror="alert(1)">',
  excerpt: '<script>alert("cytat")</script> <b>pogrubienie</b>',
  question: '<a href="javascript:alert(1)">kliknij</a>',
  requirement: "<iframe src='//evil.example/x'></iframe>",
};

const NOTHING_FOUND: StoredFindings = { version: 1, missing: [], conditions: [], costs: [], red_flags: [] };

const FOUND: StoredFindings = {
  version: 1,
  missing: [
    { attribute: "ownership", requirement: null, question: "Jaka jest forma własności mieszkania?" },
    {
      attribute: "requirement",
      requirement: "Miejsce postojowe w garażu.",
      question: "Czy do mieszkania przynależy miejsce postojowe?",
    },
  ],
  conditions: [{ label: "Zadatek", excerpt: "wpłata zadatku w wysokości 10% ceny", source: "description" }],
  costs: [{ label: "Prowizja biura", excerpt: "prowizję biura w wysokości 2% ceny", source: "description" }],
  red_flags: [
    {
      label: "Mieszkanie z najemcą",
      excerpt: "umowa najmu obowiązuje do końca 2027 roku",
      source: "title",
      requirement: "Mieszkanie wolne od zaraz.",
    },
  ],
};

function stored(overrides: Partial<StoredAudit> = {}): StoredAudit {
  return {
    findings: FOUND,
    rejectedCount: 0,
    auditedAt: "2026-10-08T12:32:00Z",
    auditedBy: memberSaver,
    model: "claude-opus-5-5",
    effort: "medium",
    hadLimits: true,
    requirementsCount: 3,
    criteriaRevision: 7,
    listingFingerprint: `v1:${"0".repeat(64)}`,
    ...overrides,
  };
}

const NO_ATTEMPT: AuditAttempt = { kind: "none" };

function audited(overrides: Partial<StoredAudit> = {}, attempt: AuditAttempt = NO_ATTEMPT): OfferAuditData {
  return { state: "ok", attempt, result: stored(overrides) };
}

/** What the page passes for a result that still describes the listing and the criteria. */
const FRESH: AuditFreshness = { state: "fresh" };

const NEVER_AUDITED: OfferAuditData = { state: "ok", attempt: NO_ATTEMPT, result: null };
const READ_FAILED: OfferAuditData = { state: "error" };

const READ_ERROR = "Nie udało się wczytać audytu tej oferty.";
const RUN = "Uruchom audyt AI";
const RERUN = "Uruchom ponownie";
const NO_KEY = "Audyt AI jest wyłączony — aplikacja nie ma klucza dostawcy modelu.";
const TIMED_OUT = "Model nie odpowiedział w ciągu 165 sekund. Audyt został przerwany — spróbuj ponownie.";
const INTERRUPTED = "Poprzednia próba audytu została przerwana, zanim zapisała wynik. Możesz uruchomić audyt ponownie.";
const EMPTY_SENTENCES = {
  missing:
    "Model nie wskazał brakujących informacji. To nie znaczy, że ogłoszenie mówi wszystko, co ważne dla decyzji.",
  conditions:
    "Model nie wskazał w tekście ogłoszenia fragmentu, który stawia kupującemu warunek. To nie znaczy, że sprzedający żadnego nie stawia.",
  costs:
    "Model nie wskazał w tekście ogłoszenia fragmentu, który nazywa koszt poza ceną. To nie znaczy, że dodatkowych kosztów nie będzie.",
  red_flags:
    "Model nie wskazał w tekście ogłoszenia fragmentu, który byłby czerwoną flagą. To nie znaczy, że oferta nie niesie ryzyka.",
};

/**
 * The audit section's markup as the browser shows it before any script runs. An island's opening
 * tag also carries its props serialised for hydration, so the tag's attributes are dropped: a
 * message is counted where a member reads it, not where it is stored.
 */
async function auditSection(
  audit: OfferAuditData,
  {
    available = true,
    freshness = FRESH,
    ...props
  }: { available?: boolean; freshness?: AuditFreshness | null; runnerPreview?: unknown } = {},
): Promise<string> {
  const html = await container.renderToString(OfferAudit, {
    props: { offerId: fullOffer.id, audit, available, freshness, ...props },
  });
  const start = html.indexOf('<section id="audyt"');
  if (start === -1) throw new Error("expected the audit section to render");
  const end = html.indexOf("</section>", start);
  if (end === -1) throw new Error("expected the audit section to be closed");
  return html.slice(start, end).replace(/<astro-island\b[^>]*>/g, "<astro-island>");
}

/**
 * What a member reads: Astro's own `<script>` and `<style>` blocks, tags and comments dropped,
 * entities decoded, every run of whitespace one space.
 */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The value the result's meta row gives under `label`: the text of the `<dd>` that follows that `<dt>`. */
function metaValue(html: string, label: string): string {
  const match = new RegExp(`<dt\\b[^>]*>${label}:</dt>\\s*<dd\\b[^>]*>([\\s\\S]*?)</dd>`).exec(html);
  if (match === null) throw new Error(`expected the meta row to hold „${label}"`);
  return visibleText(match[1]);
}

/** The label of every button in the markup, and whether it is disabled. */
function buttonsIn(html: string): { label: string; disabled: boolean }[] {
  return Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g), (match) => ({
    label: visibleText(match[2]),
    disabled: /\sdisabled(?:=""|\s|$)/.test(match[1]),
  }));
}

/** One category's block, from its marker to the next category's (or the end of the section). */
function category(html: string, key: string): string {
  const start = html.indexOf(`data-audit-category="${key}"`);
  if (start === -1) throw new Error(`expected the category ${key} to render`);
  const next = html.indexOf("data-audit-category=", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe("OfferAudit: a finding is rendered as text, whatever it carries (#3)", () => {
  const hostile = audited({
    findings: {
      version: 1,
      missing: [{ attribute: "requirement", requirement: HOSTILE.requirement, question: HOSTILE.question }],
      conditions: [{ label: HOSTILE.label, excerpt: HOSTILE.excerpt, source: "description" }],
      costs: [{ label: HOSTILE.label, excerpt: HOSTILE.excerpt, source: "title" }],
      red_flags: [
        { label: HOSTILE.label, excerpt: HOSTILE.excerpt, source: "description", requirement: HOSTILE.requirement },
      ],
    },
  });

  it("shows an excerpt, a label, a question and a requirement holding HTML as the text they are", async () => {
    const text = visibleText(await auditSection(hostile));

    // Were any of them markup, dropping the tags would have taken it out of the text.
    expect(text).toContain(HOSTILE.excerpt);
    expect(text).toContain(HOSTILE.label);
    expect(text).toContain(HOSTILE.question);
    expect(text).toContain(HOSTILE.requirement);
  });

  it("lets none of that markup into the page", async () => {
    const html = await auditSection(hostile);

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<a ");
    // As text, every quote of the hostile values is an entity: none of them opens an attribute.
    expect(html).not.toContain('onerror="');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain("src='//evil.example");
  });

  it("puts each excerpt in a blockquote, escaped", async () => {
    const html = await auditSection(hostile);

    expect(countTags(html, "blockquote")).toBe(3);
    for (const key of ["conditions", "costs", "red_flags"]) {
      expect(category(html, key)).toMatch(/<blockquote\b[^>]*>\s*&lt;script&gt;alert\(/);
    }
  });
});

describe("OfferAudit: a stored result is shown with what it was made against (#3)", () => {
  it("renders the result with no error message and offers a re-run", async () => {
    const html = await auditSection(audited());
    const text = visibleText(html);

    expect(html).toContain('data-audit-state="done"');
    expect(html).toContain('data-audit-available="true"');
    expect(text).toContain("wpłata zadatku w wysokości 10% ceny");
    expect(text).toContain("prowizję biura w wysokości 2% ceny");
    expect(text).toContain("umowa najmu obowiązuje do końca 2027 roku");
    expect(text).not.toContain("Nie udało się");
    expect(html).not.toContain('role="alert"');
    expect(buttonsIn(html)).toEqual([{ label: RERUN, disabled: false }]);
  });

  it("gives each of the four categories its own heading, with the number of its findings", async () => {
    const html = await auditSection(audited());

    expect(visibleText(category(html, "missing"))).toContain("Brakujące informacje (2)");
    expect(visibleText(category(html, "conditions"))).toContain("Warunki obowiązkowe (1)");
    expect(visibleText(category(html, "costs"))).toContain("Koszty nazwane w ogłoszeniu (1)");
    expect(visibleText(category(html, "red_flags"))).toContain("Czerwone flagi (1)");
    // Told apart without colour: every heading carries its own icon beside its own words.
    for (const key of ["missing", "conditions", "costs", "red_flags"]) {
      expect(category(html, key)).toMatch(/<h4\b[^>]*>\s*<svg\b/);
    }
  });

  it("names a missing attribute in Polish and a missing requirement by its text, each with its question", async () => {
    const text = visibleText(category(await auditSection(audited()), "missing"));

    expect(text).toContain("Ogłoszenie nie podaje: forma własności");
    expect(text).toContain("Jaka jest forma własności mieszkania?");
    expect(text).toContain("Ogłoszenie nie odpowiada na wymaganie zespołu");
    expect(text).toContain("Wymaganie: Miejsce postojowe w garażu.");
    expect(text).toContain("Czy do mieszkania przynależy miejsce postojowe?");
    // An absence cannot be quoted.
    expect(category(await auditSection(audited()), "missing")).not.toContain("<blockquote");
  });

  it("says where each excerpt comes from and which requirement a red flag concerns", async () => {
    const html = await auditSection(audited());

    expect(visibleText(category(html, "conditions"))).toContain("cytat z opisu ogłoszenia");
    expect(visibleText(category(html, "red_flags"))).toContain("cytat z tytułu ogłoszenia");
    expect(visibleText(category(html, "red_flags"))).toContain("Dotyczy wymagania: Mieszkanie wolne od zaraz.");
  });

  it("says when and by whom the audit was made, with which model and effort", async () => {
    const html = await auditSection(audited());

    // 12:32 UTC on 8 October is 14:32 in Poland.
    expect(metaValue(html, "Wykonano")).toBe("8 października 2026, 14:32 przez czlonek-zespolu@example.com");
    expect(metaValue(html, "Model")).toBe("Claude Opus 5.5");
    expect(metaValue(html, "Poziom rozumowania")).toBe("Średni");
  });

  it.each<[string, Saver, string]>([
    ["the viewer", { kind: "self" }, "8 października 2026, 14:32 przez Ciebie"],
    ["a deleted account", { kind: "deleted" }, "8 października 2026, 14:32 przez osobę z usuniętym kontem"],
  ])("names %s as the auditor", async (_case, auditedBy, expected) => {
    expect(metaValue(await auditSection(audited({ auditedBy })), "Wykonano")).toBe(expected);
  });

  it("names nobody when the auditor could not be established — never a deleted account", async () => {
    const html = await auditSection(audited({ auditedBy: { kind: "unknown" } }));

    expect(metaValue(html, "Wykonano")).toBe("8 października 2026, 14:32");
    expect(visibleText(html)).not.toContain("usuniętym kontem");
  });

  it("shows a model and an effort the lists do not hold as they are stored", async () => {
    const html = await auditSection(audited({ model: "claude-opus-4-1", effort: "max" }));

    expect(metaValue(html, "Model")).toBe("claude-opus-4-1");
    expect(metaValue(html, "Poziom rozumowania")).toBe("max");
  });

  it.each<[boolean, number, string]>([
    [true, 3, "z limitami zespołu, 3 wymagania"],
    [true, 1, "z limitami zespołu, 1 wymaganie"],
    [true, 5, "z limitami zespołu, 5 wymagań"],
    [true, 12, "z limitami zespołu, 12 wymagań"],
    [true, 22, "z limitami zespołu, 22 wymagania"],
    [false, 2, "bez limitów zespołu, 2 wymagania"],
    [true, 0, "z limitami zespołu, bez wymagań"],
    [false, 0, "bez limitów zespołu, bez wymagań"],
  ])("says what the audit was made against: limits %j, %d requirement(s)", async (hadLimits, count, expected) => {
    const html = await auditSection(audited({ hadLimits, requirementsCount: count }));

    expect(metaValue(html, "Kryteria w chwili audytu")).toBe(expected);
  });

  it.each<[number, string]>([
    [1, "Pominięto 1 znalezisko, bo jego cytatu nie znaleziono w treści ogłoszenia."],
    [2, "Pominięto 2 znaleziska, bo ich cytatów nie znaleziono w treści ogłoszenia."],
    [5, "Pominięto 5 znalezisk, bo ich cytatów nie znaleziono w treści ogłoszenia."],
  ])("says that %d finding(s) were left out for their excerpt", async (rejectedCount, expected) => {
    expect(visibleText(await auditSection(audited({ rejectedCount })))).toContain(expected);
  });

  it("says nothing about left-out findings when there were none", async () => {
    const html = await auditSection(audited({ rejectedCount: 0 }));

    expect(visibleText(html)).not.toContain("Pominięto");
    expect(html).not.toContain("data-audit-rejected");
  });
});

describe("OfferAudit: an empty category says so, and never reads as a fact about the flat (#3)", () => {
  it("control: a category with findings carries no such sentence", async () => {
    const text = visibleText(await auditSection(audited()));

    for (const sentence of Object.values(EMPTY_SENTENCES)) expect(text).not.toContain(sentence);
  });

  it("gives each empty category its own sentence, and no count of zero", async () => {
    const html = await auditSection(audited({ findings: NOTHING_FOUND }));

    for (const [key, sentence] of Object.entries(EMPTY_SENTENCES)) {
      const text = visibleText(category(html, key));
      expect(text).toContain(sentence);
      expect(text).not.toContain("(0)");
    }
    expect(html).toContain('data-audit-state="done"');
    expect(countTags(html, "blockquote")).toBe(0);
  });

  it("keeps the sentence to the categories that are empty", async () => {
    const html = await auditSection(audited({ findings: { ...NOTHING_FOUND, costs: FOUND.costs } }));

    expect(visibleText(category(html, "costs"))).not.toContain(EMPTY_SENTENCES.costs);
    expect(visibleText(category(html, "costs"))).toContain("Koszty nazwane w ogłoszeniu (1)");
    expect(visibleText(category(html, "conditions"))).toContain(EMPTY_SENTENCES.conditions);
    expect(visibleText(category(html, "red_flags"))).toContain(EMPTY_SENTENCES.red_flags);
    expect(visibleText(category(html, "missing"))).toContain(EMPTY_SENTENCES.missing);
  });
});

describe("OfferAudit: a failed read is never an offer nobody audited (#3)", () => {
  it("control: an offer nobody audited says so and offers the audit", async () => {
    const html = await auditSection(NEVER_AUDITED);

    expect(html).toContain('data-audit-state="none"');
    expect(visibleText(html)).toContain("Ta oferta nie ma jeszcze wyniku audytu.");
    expect(visibleText(html)).not.toContain(READ_ERROR);
    expect(buttonsIn(html)).toEqual([{ label: RUN, disabled: false }]);
  });

  it("says the read failed and renders no button", async () => {
    const html = await auditSection(READ_FAILED);

    expect(html).toContain('data-audit-state="error"');
    expect(visibleText(html)).toContain(READ_ERROR);
    expect(visibleText(html)).not.toContain("Ta oferta nie ma jeszcze wyniku audytu.");
    expect(buttonsIn(html)).toEqual([]);
    // No island at all: nothing on the card can start an audit from an unknown state.
    expect(html).not.toContain("<astro-island");
  });
});

describe("OfferAudit: a stored result that does not read can be replaced (#3)", () => {
  const BROKEN = "Zapisanego wyniku audytu tej oferty nie udało się odczytać, więc nie jest pokazywany.";
  const REPLACE = "Uruchom audyt ponownie, aby go zastąpić.";

  it("says the result does not read and offers the run that replaces it", async () => {
    const html = await auditSection({ state: "broken", attempt: NO_ATTEMPT });

    expect(html).toContain('data-audit-state="broken"');
    expect(visibleText(html)).toContain(`${BROKEN} ${REPLACE}`);
    expect(visibleText(html)).not.toContain(READ_ERROR);
    expect(visibleText(html)).not.toContain("Ta oferta nie ma jeszcze wyniku audytu.");
    expect(visibleText(html)).not.toContain("Wynik audytu");
    expect(buttonsIn(html)).toEqual([{ label: "Uruchom ponownie", disabled: false }]);
  });

  it("control: a failed read of the same offer renders no button", async () => {
    const html = await auditSection(READ_FAILED);

    expect(visibleText(html)).not.toContain(BROKEN);
    expect(buttonsIn(html)).toEqual([]);
  });
});

describe("OfferAudit: the latest attempt is told beside the result it did not replace (#3)", () => {
  const timedOut: AuditAttempt = { kind: "failed", reason: "provider_timeout", message: TIMED_OUT };

  it("shows why a re-run failed and keeps the earlier findings in view", async () => {
    const html = await auditSection(audited({}, timedOut));
    const text = visibleText(html);

    expect(html).toContain('data-audit-state="failed"');
    expect(text).toContain(TIMED_OUT);
    expect(text).toContain("Wynik poprzedniego audytu");
    expect(text).toContain("prowizję biura w wysokości 2% ceny");
    expect(buttonsIn(html)).toEqual([{ label: RERUN, disabled: false }]);
  });

  it("shows why a first attempt failed, with no result to show", async () => {
    const html = await auditSection({ state: "ok", attempt: timedOut, result: null });
    const text = visibleText(html);

    expect(html).toContain('data-audit-state="failed"');
    expect(text).toContain(TIMED_OUT);
    expect(text).toContain("Ta oferta nie ma jeszcze wyniku audytu.");
    expect(html).not.toContain("data-audit-category=");
    expect(buttonsIn(html)).toEqual([{ label: RUN, disabled: false }]);
  });

  it("says an interrupted attempt was interrupted and offers the audit again", async () => {
    const html = await auditSection({ state: "ok", attempt: { kind: "interrupted" }, result: null });

    expect(html).toContain('data-audit-state="failed"');
    expect(visibleText(html)).toContain(INTERRUPTED);
    expect(buttonsIn(html)).toEqual([{ label: RUN, disabled: false }]);
  });

  it("disables the button while an attempt runs, and says who started it and when", async () => {
    const running: AuditAttempt = { kind: "running", startedAt: "2026-10-09T12:31:00Z", startedBy: memberSaver };
    const html = await auditSection({ state: "ok", attempt: running, result: null });
    const text = visibleText(html);

    expect(html).toContain('data-audit-state="running"');
    // 12:31 UTC is 14:31 in Poland.
    expect(text).toContain("Audyt tej oferty jest w toku — uruchomiony przez czlonek-zespolu@example.com o 14:31.");
    expect(buttonsIn(html)).toEqual([
      { label: RUN, disabled: true },
      { label: "Odśwież kartę", disabled: false },
    ]);
  });

  it.each<[string, Saver, string]>([
    ["the viewer", { kind: "self" }, "uruchomiony przez Ciebie o 14:31."],
    ["a deleted account", { kind: "deleted" }, "uruchomiony przez osobę z usuniętym kontem o 14:31."],
    ["a member who could not be established", { kind: "unknown" }, "uruchomiony o 14:31."],
  ])("names %s as the starter of a running attempt", async (_case, startedBy, expected) => {
    const running: AuditAttempt = { kind: "running", startedAt: "2026-10-09T12:31:00Z", startedBy };

    expect(visibleText(await auditSection(audited({}, running)))).toContain(expected);
  });

  it("keeps the earlier findings in view while a re-run is in progress", async () => {
    const running: AuditAttempt = { kind: "running", startedAt: "2026-10-09T12:31:00Z", startedBy: memberSaver };
    const html = await auditSection(audited({}, running));

    expect(html).toContain('data-audit-state="running"');
    expect(visibleText(html)).toContain("prowizję biura w wysokości 2% ceny");
    expect(buttonsIn(html)[0]).toEqual({ label: RERUN, disabled: true });
  });
});

describe("OfferAudit: a missing provider key disables the audit and changes nothing else (#3)", () => {
  it.each<[string, OfferAuditData, string, string]>([
    ["an offer nobody audited", NEVER_AUDITED, "none", RUN],
    ["an audited offer", audited(), "done", RERUN],
  ])("keeps data-audit-state for %s, and disables the button with the reason", async (_case, audit, state, label) => {
    const withKey = await auditSection(audit, { available: true });
    const withoutKey = await auditSection(audit, { available: false });

    expect(withKey).toContain(`data-audit-state="${state}"`);
    expect(withoutKey).toContain(`data-audit-state="${state}"`);
    expect(withKey).toContain('data-audit-available="true"');
    expect(withoutKey).toContain('data-audit-available="false"');

    expect(buttonsIn(withKey)).toEqual([{ label, disabled: false }]);
    expect(buttonsIn(withoutKey)).toEqual([{ label, disabled: true }]);
    expect(visibleText(withoutKey)).toContain(NO_KEY);
    expect(visibleText(withKey)).not.toContain(NO_KEY);
  });

  it("still shows the stored findings without a key", async () => {
    const text = visibleText(await auditSection(audited(), { available: false }));

    expect(text).toContain("prowizję biura w wysokości 2% ceny");
  });
});

describe("AuditRunner: the states a run goes through, as the kitchen sink opens them (#3)", () => {
  it("shows the stage, the running time and the request not to close the tab while an audit runs", async () => {
    const html = await auditSection(NEVER_AUDITED, {
      runnerPreview: { kind: "progress", stage: "model", elapsedSeconds: 74 },
    });
    const text = visibleText(html);

    expect(text).toContain("Etap 2 z 3: model analizuje ogłoszenie");
    expect(text).toContain("Upłynęło: 1 min 14 s.");
    expect(text).toContain("Nie zamykaj tej karty przeglądarki do końca audytu");
    expect(buttonsIn(html)).toEqual([{ label: "Audyt trwa…", disabled: true }]);
  });

  it("offers a refresh and no retry after an answer that is not the audit's stream", async () => {
    const html = await auditSection(NEVER_AUDITED, { runnerPreview: { kind: "unreadable", status: 503 } });
    const text = visibleText(html);

    expect(text).toContain("kod odpowiedzi 503");
    expect(text).toContain("Nie wiadomo, czy audyt się rozpoczął");
    // The outage is not a sign-out and not a failed audit: no link to sign-in, no button that runs one.
    expect(html).not.toContain("/auth/signin");
    expect(buttonsIn(html)).toEqual([{ label: "Odśwież kartę", disabled: false }]);
  });
});

describe("OfferView: the audit stands above the notes, whatever the notes' read did (#3)", () => {
  function view(props: Record<string, unknown>): Promise<string> {
    return container.renderToString(OfferView, {
      props: { offer: fullOffer, saver: memberSaver, auditAvailable: true, freshness: FRESH, ...props },
    });
  }

  it.each([
    ["read", noNotes, 'data-notes-state="ok"'],
    ["failed to read", failedNotes, 'data-notes-state="error"'],
  ])("renders the audit's result when the notes were %s", async (_case, notes, notesMarker) => {
    const html = await view({ notes, audit: audited() });

    expect(html).toContain(notesMarker);
    expect(html).toContain('data-audit-state="done"');
    expect(visibleText(html)).toContain("prowizję biura w wysokości 2% ceny");
    const auditAt = html.indexOf('<section id="audyt"');
    const notesAt = html.indexOf('<section id="notatki"');
    expect(auditAt).toBeGreaterThan(-1);
    expect(notesAt).toBeGreaterThan(auditAt);
  });

  it("renders the notes when the audit failed to read", async () => {
    const html = await view({ notes: noNotes, audit: READ_FAILED });

    expect(html).toContain('data-audit-state="error"');
    expect(html).toContain('data-notes-state="ok"');
  });
});

// The freshness mark of the audit section (FR-003, FR-009). Expected outcomes are written by hand
// from the contract in context/changes/refetch-and-stale-audit/plan.md (Phase 3):
// `data-audit-freshness` is `none` without a result to judge — `error` and `broken` included —
// and otherwise what the page worked out; a stale result is marked with its reason and a prompt
// to run the audit again, which goes while an attempt runs; `unknown` says so quietly; `fresh`
// says nothing. Neither of the section's two other attributes changes with it.

const STALE = {
  listing: "Ten wynik jest nieaktualny: od wykonania audytu zmieniły się dane ogłoszenia.",
  criteria: "Ten wynik jest nieaktualny: od wykonania audytu zmieniły się kryteria zespołu.",
  both: "Ten wynik jest nieaktualny: od wykonania audytu zmieniły się dane ogłoszenia i kryteria zespołu.",
};
const STALE_WORD = "nieaktualny";
const RERUN_PROMPT = "Uruchom audyt ponownie, aby wynik odpowiadał temu, co jest teraz.";
const FRESHNESS_UNKNOWN = "Aktualności tego wyniku nie udało się ustalić";

const STALE_LISTING: AuditFreshness = { state: "stale", reasons: ["listing"] };
const STALE_CRITERIA: AuditFreshness = { state: "stale", reasons: ["criteria"] };
const STALE_BOTH: AuditFreshness = { state: "stale", reasons: ["listing", "criteria"] };
const UNKNOWN: AuditFreshness = { state: "unknown" };

describe("OfferAudit: a stored result made on older data or criteria is marked, never removed (#3)", () => {
  const timedOut: AuditAttempt = { kind: "failed", reason: "provider_timeout", message: TIMED_OUT };
  const running: AuditAttempt = { kind: "running", startedAt: "2026-10-09T12:31:00Z", startedBy: memberSaver };

  it("control: a fresh result carries no mark and no prompt", async () => {
    const html = await auditSection(audited(), { freshness: FRESH });
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="fresh"');
    expect(text.toLowerCase()).not.toContain(STALE_WORD);
    expect(text).not.toContain(RERUN_PROMPT);
    expect(text).not.toContain(FRESHNESS_UNKNOWN);
  });

  it.each<[string, AuditFreshness, string]>([
    ["the listing changed", STALE_LISTING, STALE.listing],
    ["the criteria changed", STALE_CRITERIA, STALE.criteria],
    ["both changed", STALE_BOTH, STALE.both],
  ])("marks the result stale when %s, with that reason and the prompt to re-run", async (_case, freshness, reason) => {
    const html = await auditSection(audited(), { freshness });
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="stale"');
    expect(text).toContain(reason);
    for (const other of Object.values(STALE)) {
      if (other !== reason) expect(text).not.toContain(other);
    }
    expect(text).toContain(RERUN_PROMPT);
    // The mark stands above the button, and the result stays in view below it.
    expect(html.indexOf(reason)).toBeLessThan(html.indexOf("<button"));
    expect(text).toContain("prowizję biura w wysokości 2% ceny");
    // Marked, never re-run or removed: the section's other attributes say what they said.
    expect(html).toContain('data-audit-state="done"');
    expect(html).toContain('data-audit-available="true"');
    expect(buttonsIn(html)).toEqual([{ label: RERUN, disabled: false }]);
  });

  it("says quietly that the freshness could not be established, and never calls the result stale", async () => {
    const html = await auditSection(audited(), { freshness: UNKNOWN });
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="unknown"');
    expect(text).toContain(FRESHNESS_UNKNOWN);
    expect(text.toLowerCase()).not.toContain(STALE_WORD);
    expect(text).not.toContain(RERUN_PROMPT);
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('data-audit-state="done"');
    expect(buttonsIn(html)).toEqual([{ label: RERUN, disabled: false }]);
  });

  it("reads a result whose freshness nobody passed as unknown, never as fresh", async () => {
    const html = await container.renderToString(OfferAudit, {
      props: { offerId: fullOffer.id, audit: audited(), available: true },
    });

    expect(html).toContain('data-audit-freshness="unknown"');
    expect(html).not.toContain('data-audit-freshness="fresh"');
  });

  it.each<[string, OfferAuditData, string]>([
    ["an offer nobody audited", NEVER_AUDITED, "none"],
    ["a first attempt that failed", { state: "ok", attempt: timedOut, result: null }, "failed"],
    ["a failed read", READ_FAILED, "error"],
    ["a stored result that does not read", { state: "broken", attempt: NO_ATTEMPT }, "broken"],
  ])("has nothing to judge for %s, whatever freshness is passed", async (_case, audit, state) => {
    for (const freshness of [null, FRESH, STALE_BOTH, UNKNOWN]) {
      const html = await auditSection(audit, { freshness });
      const text = visibleText(html);

      expect(html).toContain('data-audit-freshness="none"');
      expect(html).toContain(`data-audit-state="${state}"`);
      expect(text.toLowerCase()).not.toContain(STALE_WORD);
      expect(text).not.toContain(FRESHNESS_UNKNOWN);
    }
  });

  it("keeps the mark and drops the prompt while an attempt is running", async () => {
    const html = await auditSection(audited({}, running), { freshness: STALE_LISTING });
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="stale"');
    expect(html).toContain('data-audit-state="running"');
    expect(text).toContain(STALE.listing);
    expect(text).not.toContain(RERUN_PROMPT);
    expect(buttonsIn(html)[0]).toEqual({ label: RERUN, disabled: true });
  });

  it("keeps the mark beside the earlier result after a re-run that failed", async () => {
    const html = await auditSection(audited({}, timedOut), { freshness: STALE_CRITERIA });
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="stale"');
    expect(html).toContain('data-audit-state="failed"');
    expect(text).toContain(STALE.criteria);
    expect(text).toContain(RERUN_PROMPT);
    expect(text).toContain(TIMED_OUT);
    // The result's own heading carries the mark too.
    expect(html).toMatch(/Wynik poprzedniego audytu\s*<\/h3>\s*<span\b[^>]*data-slot="badge"[^>]*>[\s\S]*?Nieaktualny/);
    expect(buttonsIn(html)).toEqual([{ label: RERUN, disabled: false }]);
  });

  it("control: a fresh earlier result carries no mark beside a re-run that failed", async () => {
    const text = visibleText(await auditSection(audited({}, timedOut), { freshness: FRESH }));

    expect(text).toContain("Wynik poprzedniego audytu");
    expect(text.toLowerCase()).not.toContain(STALE_WORD);
  });

  it("marks a stale result without a provider key, and lets the button say why it is disabled", async () => {
    const html = await auditSection(audited(), { available: false, freshness: STALE_BOTH });
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="stale"');
    expect(html).toContain('data-audit-available="false"');
    expect(text).toContain(STALE.both);
    expect(text).toContain(NO_KEY);
    expect(buttonsIn(html)).toEqual([{ label: RERUN, disabled: true }]);
  });

  it("passes the freshness from the view down to the section", async () => {
    const html = await container.renderToString(OfferView, {
      props: {
        offer: fullOffer,
        saver: memberSaver,
        notes: noNotes,
        audit: audited(),
        auditAvailable: true,
        freshness: STALE_CRITERIA,
      },
    });

    expect(html).toContain('data-audit-freshness="stale"');
    expect(visibleText(html)).toContain(STALE.criteria);
  });
});

// The re-fetch block of the offer card, the notice after a re-fetch and the duplicate notice
// (FR-005, FR-009). Everything the address carries is typed by whoever wants to: `lost` is read
// through the whitelist of the audit's columns and shown by names from code, `refetched` only
// picks one of three sentences, and an error message is text. Expected outcomes are written by
// hand from the plan's contract (Phase 3), never copied from the rendered output.

const REFETCH = "Pobierz ponownie z otodom.pl";
const OVERWRITE = "Nadpisz mimo utraty tych pól";
const LOST_WARNING = "nie podaje pól, które zapisane ogłoszenie podaje";

/** The markup with every island's serialised props dropped: what the browser shows before any script runs. */
function withoutIslandProps(html: string): string {
  return html.replace(/<astro-island\b[^>]*>/g, "<astro-island>");
}

/** The `value` of every hidden field called `name`. */
function hiddenValues(html: string, name: string): string[] {
  return Array.from(
    html.matchAll(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`, "g")),
    (match) => /\bvalue="([^"]*)"/.exec(match[0])?.[1] ?? "",
  );
}

/** The card's re-fetch block: from its id to the delete block that follows it. */
function refetchBlock(html: string): string {
  const start = html.indexOf('id="pobranie"');
  if (start === -1) throw new Error("expected the re-fetch block to render");
  const end = html.indexOf('id="usuwanie"', start);
  if (end === -1) throw new Error("expected the delete block to follow the re-fetch block");
  return withoutIslandProps(html.slice(start, end));
}

function cardWith(props: Record<string, unknown>): Promise<string> {
  return container.renderToString(OfferCard, { props: { offer: fullOffer, saver: memberSaver, ...props } });
}

describe("OfferCard: the re-fetch block", () => {
  it("says when the data was fetched and offers a re-fetch of this offer", async () => {
    // 21:05 UTC on 3 October is 23:05 in Poland.
    const block = refetchBlock(await cardWith({ offer: { ...fullOffer, fetched_at: "2026-10-03T21:05:00Z" } }));
    const text = visibleText(block);

    expect(block).toContain('data-refetch-state="default"');
    expect(text).toContain("3 października 2026, 23:05");
    expect(block).toContain('action="/api/offer-refetch"');
    expect(block).toMatch(/<form\b[^>]*method="POST"/i);
    expect(hiddenValues(block, "offer_id")).toEqual([fullOffer.id]);
    expect(hiddenValues(block, "accept_lost")).toEqual([""]);
    expect(buttonsIn(block)).toEqual([{ label: REFETCH, disabled: false }]);
    expect(text).not.toContain(LOST_WARNING);
    expect(block).not.toContain('role="alert"');
  });

  it("carries nothing in the submit button but its type", async () => {
    const block = refetchBlock(await cardWith({ lost: "price" }));
    const button = /<button\b[^>]*>/.exec(block)?.[0] ?? "";

    expect(button).toContain('type="submit"');
    expect(button).not.toMatch(/\sname=/);
    expect(button).not.toMatch(/\svalue=/);
  });

  it("names the lost fields in the card's order and asks for a deliberate overwrite of exactly those", async () => {
    const block = refetchBlock(await cardWith({ lost: "features,rent,price" }));
    const text = visibleText(block);

    expect(block).toContain('data-refetch-state="lost"');
    expect(text).toContain(LOST_WARNING);
    expect(text).toContain("Nic nie zostało zapisane.");
    expect(Array.from(block.matchAll(/<li\b[^>]*>([^<]*)<\/li>/g), (match) => match[1])).toEqual([
      "Cena",
      "Czynsz",
      "Udogodnienia",
    ]);
    expect(hiddenValues(block, "accept_lost")).toEqual(["price,rent,features"]);
    expect(buttonsIn(block)).toEqual([{ label: OVERWRITE, disabled: false }]);
  });

  it.each([
    ["an empty value", ""],
    ["unknown tokens", "nope,PRICE, price ,id,created_by"],
    ["markup", '<script>alert(1)</script>,"><img src=x onerror=alert(1)>'],
  ])("shows no warning for a `lost` that names no column: %s", async (_case, lost) => {
    const html = await cardWith({ lost });
    const block = refetchBlock(html);

    expect(block).toContain('data-refetch-state="default"');
    expect(visibleText(block)).not.toContain(LOST_WARNING);
    expect(hiddenValues(block, "accept_lost")).toEqual([""]);
    expect(buttonsIn(block)).toEqual([{ label: REFETCH, disabled: false }]);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("onerror");
  });

  it("keeps only the known columns of a hostile `lost`, and renders none of the rest", async () => {
    const html = await cardWith({ lost: '<script>alert(1)</script>,rent,"><img src=x onerror=alert(1)>,nope,rent' });
    const block = refetchBlock(html);

    expect(Array.from(block.matchAll(/<li\b[^>]*>([^<]*)<\/li>/g), (match) => match[1])).toEqual(["Czynsz"]);
    expect(hiddenValues(block, "accept_lost")).toEqual(["rent"]);
    // Dropped, not escaped: the value never reaches the page, not even as an island's prop.
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("nope");
  });

  it("shows a failed re-fetch in the block, as the text it is", async () => {
    const message = 'Nie udało się <b>pobrać</b> <script>alert("x")</script>';
    const html = await cardWith({ refetchError: message });
    const block = refetchBlock(html);

    expect(visibleText(block)).toContain(message);
    expect(block).toContain('role="alert"');
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>alert");
    expect(buttonsIn(block)).toEqual([{ label: REFETCH, disabled: false }]);
  });
});

describe("OfferView: a re-fetch error and a note error each land in their own place", () => {
  const MESSAGE = "Komunikat testowy o nieudanej akcji.";

  function view(props: Record<string, unknown>): Promise<string> {
    return container.renderToString(OfferView, {
      props: {
        offer: fullOffer,
        saver: memberSaver,
        notes: noNotes,
        audit: NEVER_AUDITED,
        auditAvailable: true,
        freshness: null,
        ...props,
      },
    });
  }

  function notesSection(html: string): string {
    const start = html.indexOf('<section id="notatki"');
    if (start === -1) throw new Error("expected the notes section to render");
    return withoutIslandProps(html.slice(start));
  }

  it("shows a re-fetch error in the re-fetch block and not beside the notes", async () => {
    const html = await view({ refetchError: MESSAGE });

    expect(visibleText(refetchBlock(html))).toContain(MESSAGE);
    expect(visibleText(notesSection(html))).not.toContain(MESSAGE);
  });

  it("shows a note error beside the notes and not in the re-fetch block", async () => {
    const html = await view({ noteError: MESSAGE });

    expect(visibleText(notesSection(html))).toContain(MESSAGE);
    expect(visibleText(refetchBlock(html))).not.toContain(MESSAGE);
  });
});

describe("RefetchNotice: the address only picks one of three sentences", () => {
  function notice(refetched: string | null): Promise<string> {
    return container.renderToString(RefetchNotice, { props: { refetched } });
  }

  it("says something different for each of the three results", async () => {
    const changed = visibleText(await notice("changed"));
    const unchanged = visibleText(await notice("unchanged"));
    const saved = visibleText(await notice("saved"));

    expect(changed).toContain("zmieniły się");
    expect(unchanged).toContain("bez zmian");
    expect(saved).toContain("Nie udało się ustalić, czy różnią się");
    expect(new Set([changed, unchanged, saved]).size).toBe(3);
    for (const text of [changed, unchanged, saved]) expect(text).toContain("Ogłoszenie pobrano ponownie");
    expect(unchanged).not.toContain("zmieniły się");
    expect(changed).not.toContain("bez zmian");
  });

  it.each<[string, string | null]>([
    ["no value", null],
    ["an empty value", ""],
    ["an unknown value", "deleted"],
    ["another case", "CHANGED"],
    ["an inherited key", "constructor"],
    ["markup", "<script>alert(1)</script>"],
    ["markup around a known value", 'changed"><img src=x onerror=alert(1)>'],
  ])("renders nothing for %s", async (_case, refetched) => {
    const html = await notice(refetched);

    expect(visibleText(html)).toBe("");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("data-refetch-result");
  });
});

describe("DuplicateNotice: the notice offers a manual re-fetch (FR-005)", () => {
  function notice(saver: Saver): Promise<string> {
    return container.renderToString(DuplicateNotice, { props: { saver, offerId: fullOffer.id } });
  }

  it("keeps the sentence about who saved the offer and adds the re-fetch form for that offer", async () => {
    const html = withoutIslandProps(await notice(memberSaver));

    expect(visibleText(html)).toContain(
      "Ta oferta była już zapisana przez czlonek-zespolu@example.com — otwieramy istniejącą kartę.",
    );
    expect(html).toContain('action="/api/offer-refetch"');
    expect(hiddenValues(html, "offer_id")).toEqual([fullOffer.id]);
    expect(hiddenValues(html, "accept_lost")).toEqual([""]);
    expect(buttonsIn(html)).toEqual([{ label: REFETCH, disabled: false }]);
  });

  it("offers the same form when the saver cannot be named", async () => {
    const html = withoutIslandProps(await notice({ kind: "unknown" }));

    expect(visibleText(html)).toContain("Ta oferta była już zapisana — otwieramy istniejącą kartę.");
    expect(visibleText(html)).not.toContain("usuniętym kontem");
    expect(buttonsIn(html)).toEqual([{ label: REFETCH, disabled: false }]);
  });
});

// The archive on the offer card (FR-014, FR-005, FR-010). Expected outcomes are written by hand
// from the contract in context/changes/archive-and-restore/plan.md (Phase 3): whether an offer is
// archived is the row's `archived_at` and stands in `data-offer-archived`; the card says since
// when and by whom, as text, and holds the form that changes the state; in the archive the audit
// section renders no island in any state of the audit's data while the stored result and its mark
// stay; `?archive=` only picks one of four sentences; the duplicate notice of an archived offer
// offers the restore. `archivedOffer` was archived at 16:20 UTC on 10 October 2026 — 18:20 in Poland.

const ARCHIVE = "Zarchiwizuj";
const RESTORE = "Przywróć";
const ARCHIVED_ON = "10 października 2026";
const AUDIT_AFTER_RESTORE = "Ta oferta jest w archiwum — audyt będzie można uruchomić po jej przywróceniu.";
const DELETED_ACCOUNT = "usuniętym kontem";

function archivedBy(archiver: Saver): OfferArchiveState {
  return { archivedAt: "2026-10-10T16:20:00Z", archiver };
}

/** The card's archive block: from its id to the re-fetch block that follows it. */
function archiveBlock(html: string): string {
  const start = html.indexOf('id="archiwum"');
  if (start === -1) throw new Error("expected the archive block to render");
  const end = html.indexOf('id="pobranie"', start);
  if (end === -1) throw new Error("expected the re-fetch block to follow the archive block");
  return withoutIslandProps(html.slice(start, end));
}

function offerView(props: Record<string, unknown>): Promise<string> {
  return container.renderToString(OfferView, {
    props: {
      offer: fullOffer,
      saver: memberSaver,
      notes: noNotes,
      audit: NEVER_AUDITED,
      auditAvailable: true,
      freshness: null,
      ...props,
    },
  });
}

describe("OfferView: the archive state is the row's, with the form that changes it (FR-014)", () => {
  it("control: a live offer says it is not archived and offers to archive it", async () => {
    const html = await offerView({});
    const block = archiveBlock(html);

    expect(html).toContain('data-offer-archived="false"');
    expect(html).not.toContain('data-offer-archived="true"');
    expect(visibleText(block)).not.toContain("W archiwum");
    expect(block).toContain('action="/api/offer-archive"');
    expect(block).toMatch(/<form\b[^>]*method="POST"/i);
    expect(hiddenValues(block, "offer_id")).toEqual([fullOffer.id]);
    expect(hiddenValues(block, "intent")).toEqual(["archive"]);
    expect(hiddenValues(block, "return")).toEqual(["card"]);
    expect(buttonsIn(block)).toEqual([{ label: ARCHIVE, disabled: false }]);
  });

  it("says since when and by whom an archived offer is archived, and offers to restore it", async () => {
    const html = await offerView({ offer: archivedOffer, archive: archivedBy(memberSaver) });
    const block = archiveBlock(html);

    expect(html).toContain('data-offer-archived="true"');
    expect(html).not.toContain('data-offer-archived="false"');
    expect(visibleText(block)).toContain(
      `W archiwum od ${ARCHIVED_ON} — zarchiwizowana przez czlonek-zespolu@example.com.`,
    );
    expect(hiddenValues(block, "offer_id")).toEqual([archivedOffer.id]);
    expect(hiddenValues(block, "intent")).toEqual(["restore"]);
    expect(hiddenValues(block, "return")).toEqual(["card"]);
    expect(buttonsIn(block)).toEqual([{ label: RESTORE, disabled: false }]);
  });

  it("carries nothing in the submit button but its type", async () => {
    const block = archiveBlock(await offerView({ offer: archivedOffer, archive: archivedBy(memberSaver) }));
    const button = /<button\b[^>]*>/.exec(block)?.[0] ?? "";

    expect(button).toContain('type="submit"');
    expect(button).not.toMatch(/\sname=/);
    expect(button).not.toMatch(/\svalue=/);
  });

  it.each<[string, Saver, string]>([
    ["the viewer", { kind: "self" }, `W archiwum od ${ARCHIVED_ON} — zarchiwizowana przez Ciebie.`],
    [
      "a deleted account",
      { kind: "deleted" },
      `W archiwum od ${ARCHIVED_ON} — zarchiwizowana przez osobę z usuniętym kontem.`,
    ],
  ])("names %s as the archiver", async (_case, archiver, expected) => {
    const html = await offerView({ offer: archivedByDeletedOffer, archive: archivedBy(archiver) });

    expect(visibleText(archiveBlock(html))).toContain(expected);
  });

  it("names nobody when the archiver could not be established — never a deleted account", async () => {
    const html = await offerView({ offer: archivedOffer, archive: archivedBy({ kind: "unknown" }) });
    const text = visibleText(archiveBlock(html));

    expect(html).toContain('data-offer-archived="true"');
    expect(text).toContain(`W archiwum od ${ARCHIVED_ON}.`);
    expect(text).not.toContain("przez");
    expect(text).not.toContain(DELETED_ACCOUNT);
    expect(buttonsIn(archiveBlock(html))).toEqual([{ label: RESTORE, disabled: false }]);
  });

  it("reads the state from the row when nobody named the archiver, and names nobody", async () => {
    const html = await offerView({ offer: archivedOffer });
    const text = visibleText(archiveBlock(html));

    expect(html).toContain('data-offer-archived="true"');
    expect(text).toContain(`W archiwum od ${ARCHIVED_ON}.`);
    expect(text).not.toContain(DELETED_ACCOUNT);
    expect(hiddenValues(archiveBlock(html), "intent")).toEqual(["restore"]);
  });

  it("renders an archiver's address that holds HTML as the text it is", async () => {
    const email = '<img src=x onerror="alert(1)">@example.com';
    const html = await offerView({ offer: archivedOffer, archive: archivedBy({ kind: "member", email }) });

    // Were it markup, dropping the tags would have taken it out of the text.
    expect(visibleText(archiveBlock(html))).toContain(`zarchiwizowana przez ${email}.`);
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('onerror="');
    // Text in one place: not an attribute's value and not a prop of the island beside it.
    expect(html.split("onerror")).toHaveLength(2);
  });

  it("shows a failed archiving in the archive block, as text, and nowhere else", async () => {
    const message = 'Nie udało się <b>zarchiwizować</b> <script>alert("x")</script>';
    const html = await offerView({ archiveError: message });

    expect(visibleText(archiveBlock(html))).toContain(message);
    expect(archiveBlock(html)).toContain('role="alert"');
    expect(visibleText(refetchBlock(html))).not.toContain(message);
    expect(visibleText(withoutIslandProps(html.slice(html.indexOf('<section id="notatki"'))))).not.toContain(message);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>alert");
    expect(buttonsIn(archiveBlock(html))).toEqual([{ label: ARCHIVE, disabled: false }]);
  });

  it("keeps the notes and the re-fetch working on an archived offer", async () => {
    const html = await offerView({ offer: archivedOffer, archive: archivedBy(memberSaver) });

    expect(html).toContain('data-notes-state="ok"');
    expect(html).toContain('action="/api/notes"');
    expect(buttonsIn(refetchBlock(html))).toEqual([{ label: REFETCH, disabled: false }]);
  });
});

describe("OfferAudit: in the archive nothing can start an audit, and the stored result stays (FR-010)", () => {
  const timedOut: AuditAttempt = { kind: "failed", reason: "provider_timeout", message: TIMED_OUT };
  const running: AuditAttempt = { kind: "running", startedAt: "2026-10-09T12:31:00Z", startedBy: memberSaver };

  function archivedSection(
    audit: OfferAuditData,
    options: { available?: boolean; freshness?: AuditFreshness | null } = {},
  ): Promise<string> {
    return auditSection(audit, { ...options, archived: true } as Parameters<typeof auditSection>[1]);
  }

  const DATA_STATES: [string, OfferAuditData, string][] = [
    ["an offer nobody audited", NEVER_AUDITED, "none"],
    ["an audited offer", audited(), "done"],
    ["a re-run in progress", audited({}, running), "running"],
    ["a first attempt in progress", { state: "ok", attempt: running, result: null }, "running"],
    ["a re-run that failed", audited({}, timedOut), "failed"],
    ["an interrupted attempt", { state: "ok", attempt: { kind: "interrupted" }, result: null }, "failed"],
    ["a stored result that does not read", { state: "broken", attempt: NO_ATTEMPT }, "broken"],
    ["a failed read", READ_FAILED, "error"],
  ];

  it.each(DATA_STATES)("renders no island and no button for %s", async (_case, audit, state) => {
    const html = await archivedSection(audit);

    expect(html).not.toContain("<astro-island");
    expect(html).not.toContain("data-audit-runner");
    expect(buttonsIn(html)).toEqual([]);
    // The audit's own attributes say what they said for a live offer.
    expect(html).toContain(`data-audit-state="${state}"`);
    expect(html).toContain('data-audit-available="true"');
  });

  it.each(DATA_STATES.filter(([, , state]) => state !== "error"))(
    "control: the same section of a live offer holds the island for %s",
    async (_case, audit, state) => {
      const html = await auditSection(audit);

      expect(html).toContain("<astro-island");
      expect(html).toContain("data-audit-runner");
      expect(buttonsIn(html).length).toBeGreaterThan(0);
      expect(html).toContain(`data-audit-state="${state}"`);
      expect(visibleText(html)).not.toContain(AUDIT_AFTER_RESTORE);
    },
  );

  it("says in the island's place that the audit can run once the offer is restored", async () => {
    const text = visibleText(await archivedSection(NEVER_AUDITED));

    expect(text).toContain("Ta oferta nie ma jeszcze wyniku audytu.");
    expect(text).toContain(AUDIT_AFTER_RESTORE);
    expect(text).not.toContain(RUN);
  });

  it("keeps the stored result readable", async () => {
    const html = await archivedSection(audited());
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="fresh"');
    expect(text).toContain("Wynik audytu");
    expect(text).toContain("prowizję biura w wysokości 2% ceny");
    expect(text).toContain("umowa najmu obowiązuje do końca 2027 roku");
    expect(metaValue(html, "Wykonano")).toBe("8 października 2026, 14:32 przez czlonek-zespolu@example.com");
    expect(text).toContain(AUDIT_AFTER_RESTORE);
    expect(text).not.toContain(RERUN);
  });

  it("keeps the stale mark and lets the prompt to re-run give way to the archive sentence", async () => {
    const html = await archivedSection(audited(), { freshness: STALE_CRITERIA });
    const text = visibleText(html);

    expect(html).toContain('data-audit-freshness="stale"');
    expect(html).toContain('data-audit-state="done"');
    expect(text).toContain(STALE.criteria);
    expect(html).toMatch(/Wynik audytu\s*<\/h3>\s*<span\b[^>]*data-slot="badge"[^>]*>[\s\S]*?Nieaktualny/);
    expect(text).not.toContain(RERUN_PROMPT);
    expect(text.split(AUDIT_AFTER_RESTORE)).toHaveLength(2);
    expect(text).toContain("prowizję biura w wysokości 2% ceny");
  });

  it("control: the same stale result of a live offer carries the prompt and not the archive sentence", async () => {
    const text = visibleText(await auditSection(audited(), { freshness: STALE_CRITERIA }));

    expect(text).toContain(RERUN_PROMPT);
    expect(text).not.toContain(AUDIT_AFTER_RESTORE);
  });

  it("still says that an attempt is running, who started it and when", async () => {
    const html = await archivedSection(audited({}, running), { freshness: STALE_LISTING });
    const text = visibleText(html);

    // 12:31 UTC is 14:31 in Poland.
    expect(text).toContain("Audyt tej oferty jest w toku — uruchomiony przez czlonek-zespolu@example.com o 14:31.");
    expect(text).toContain(STALE.listing);
    expect(text).toContain("prowizję biura w wysokości 2% ceny");
    expect(text).toContain(AUDIT_AFTER_RESTORE);
  });

  it("names nobody as the starter of a running attempt who could not be established", async () => {
    const attempt: AuditAttempt = {
      kind: "running",
      startedAt: "2026-10-09T12:31:00Z",
      startedBy: { kind: "unknown" },
    };
    const text = visibleText(await archivedSection({ state: "ok", attempt, result: null }));

    expect(text).toContain("Audyt tej oferty jest w toku — uruchomiony o 14:31.");
    expect(text).not.toContain(DELETED_ACCOUNT);
  });

  it("still says why the latest attempt failed, beside the result it did not replace", async () => {
    const html = await archivedSection(audited({}, timedOut));
    const text = visibleText(html);

    expect(text).toContain(TIMED_OUT);
    expect(text).toContain("Wynik poprzedniego audytu");
    expect(text).toContain("prowizję biura w wysokości 2% ceny");
    expect(text).toContain(AUDIT_AFTER_RESTORE);
  });

  it("does not offer to replace a stored result that does not read", async () => {
    const text = visibleText(await archivedSection({ state: "broken", attempt: NO_ATTEMPT }));

    expect(text).toContain("Zapisanego wyniku audytu tej oferty nie udało się odczytać");
    expect(text).not.toContain("Uruchom audyt ponownie");
    expect(text).toContain(AUDIT_AFTER_RESTORE);
  });

  it("says nothing about the provider key, which is not why the audit cannot run", async () => {
    const html = await archivedSection(audited(), { available: false });

    expect(html).toContain('data-audit-available="false"');
    expect(visibleText(html)).not.toContain(NO_KEY);
    expect(visibleText(html)).toContain(AUDIT_AFTER_RESTORE);
  });

  it("gets the state from the view: an archived row's audit section holds no island", async () => {
    const section = (html: string) =>
      html.slice(html.indexOf('<section id="audyt"'), html.indexOf('<section id="notatki"'));
    const archived = section(await offerView({ offer: archivedOffer, audit: audited(), freshness: FRESH }));
    const live = section(await offerView({ audit: audited(), freshness: FRESH }));

    expect(archived).not.toContain("<astro-island");
    expect(visibleText(archived)).toContain(AUDIT_AFTER_RESTORE);
    expect(visibleText(archived)).toContain("prowizję biura w wysokości 2% ceny");
    expect(live).toContain("<astro-island");
    expect(live).toContain("data-audit-runner");
    expect(visibleText(live)).not.toContain(AUDIT_AFTER_RESTORE);
  });
});

describe("ArchiveNotice: the address only picks one of four sentences, and never the state", () => {
  function notice(result: string | null, archive: OfferArchiveState | null): Promise<string> {
    return container.renderToString(ArchiveNotice, { props: { result, archive } });
  }

  it("says something different for each of the four results", async () => {
    const archived = visibleText(await notice("archived", archivedBy({ kind: "self" })));
    const restored = visibleText(await notice("restored", null));
    const alreadyArchived = visibleText(await notice("already-archived", archivedBy(memberSaver)));
    const alreadyLive = visibleText(await notice("already-live", null));

    expect(archived).toContain("Oferta trafiła do archiwum.");
    expect(restored).toContain("Oferta została przywrócona z archiwum.");
    expect(alreadyArchived).toBe(
      `Ta oferta była już w archiwum od ${ARCHIVED_ON} — zarchiwizowana przez czlonek-zespolu@example.com. Nic się nie zmieniło.`,
    );
    expect(alreadyLive).toContain("Ta oferta nie była w archiwum");
    expect(new Set([archived, restored, alreadyArchived, alreadyLive]).size).toBe(4);
  });

  it.each<[string, Saver, string]>([
    ["the viewer", { kind: "self" }, "zarchiwizowana przez Ciebie. Nic się nie zmieniło."],
    ["a deleted account", { kind: "deleted" }, "zarchiwizowana przez osobę z usuniętym kontem. Nic się nie zmieniło."],
  ])("names %s as the one who archived the offer earlier", async (_case, archiver, expected) => {
    expect(visibleText(await notice("already-archived", archivedBy(archiver)))).toContain(expected);
  });

  it("names nobody when the earlier archiver could not be established — never a deleted account", async () => {
    const text = visibleText(await notice("already-archived", archivedBy({ kind: "unknown" })));

    expect(text).toBe(`Ta oferta była już w archiwum od ${ARCHIVED_ON}. Nic się nie zmieniło.`);
    expect(text).not.toContain(DELETED_ACCOUNT);
  });

  it("renders the earlier archiver's address that holds HTML as text", async () => {
    const email = '<img src=x onerror="alert(1)">@example.com';
    const html = await notice("already-archived", archivedBy({ kind: "member", email }));

    expect(visibleText(html)).toContain(`zarchiwizowana przez ${email}.`);
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="');
  });

  it.each<[string, string | null]>([
    ["no value", null],
    ["an empty value", ""],
    ["an unknown value", "deleted"],
    ["another case", "ARCHIVED"],
    ["an inherited key", "constructor"],
    ["markup", "<script>alert(1)</script>"],
    ["markup around a known value", 'archived"><img src=x onerror=alert(1)>'],
  ])("renders nothing for %s, whatever the row says", async (_case, result) => {
    for (const archive of [null, archivedBy(memberSaver)]) {
      const html = await notice(result, archive);

      expect(visibleText(html)).toBe("");
      expect(html).not.toContain("alert(1)");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("data-archive-result");
    }
  });

  it.each<[string, OfferArchiveState | null]>([
    ["archived", null],
    ["already-archived", null],
    ["restored", archivedBy(memberSaver)],
    ["already-live", archivedBy(memberSaver)],
  ])("renders nothing for „%s” when the row says otherwise", async (result, archive) => {
    expect(visibleText(await notice(result, archive))).toBe("");
  });
});

describe("DuplicateNotice: an archived offer's notice says so and offers the restore (FR-005)", () => {
  function notice(props: Record<string, unknown>): Promise<string> {
    return container.renderToString(DuplicateNotice, {
      props: { saver: memberSaver, offerId: fullOffer.id, ...props },
    });
  }

  /** Every form's `action` in the markup, in order. */
  function actionsIn(html: string): string[] {
    return Array.from(html.matchAll(/<form\b[^>]*\baction="([^"]*)"/g), (match) => match[1]);
  }

  it("control: a live offer's notice holds the re-fetch form and no restore form", async () => {
    for (const props of [{}, { archive: null }]) {
      const html = withoutIslandProps(await notice(props));

      expect(actionsIn(html)).toEqual(["/api/offer-refetch"]);
      expect(html).not.toContain("/api/offer-archive");
      expect(hiddenValues(html, "intent")).toEqual([]);
      expect(visibleText(html)).not.toContain("archiwum");
      expect(buttonsIn(html)).toEqual([{ label: REFETCH, disabled: false }]);
    }
  });

  it("says the offer is archived, since when and by whom, with the restore form and the re-fetch form", async () => {
    const html = withoutIslandProps(await notice({ offerId: archivedOffer.id, archive: archivedBy({ kind: "self" }) }));
    const text = visibleText(html);

    expect(text).toContain(
      "Ta oferta była już zapisana przez czlonek-zespolu@example.com i jest w archiwum — otwieramy istniejącą kartę.",
    );
    expect(text).toContain(`W archiwum od ${ARCHIVED_ON} — zarchiwizowana przez Ciebie.`);
    expect(actionsIn(html)).toEqual(["/api/offer-archive", "/api/offer-refetch"]);
    expect(hiddenValues(html, "offer_id")).toEqual([archivedOffer.id, archivedOffer.id]);
    expect(hiddenValues(html, "intent")).toEqual(["restore"]);
    expect(hiddenValues(html, "return")).toEqual(["card"]);
    expect(buttonsIn(html)).toEqual([
      { label: RESTORE, disabled: false },
      { label: REFETCH, disabled: false },
    ]);
  });

  it("names a deleted account as the archiver, and nobody when the archiver could not be established", async () => {
    const deleted = visibleText(await notice({ archive: archivedBy({ kind: "deleted" }) }));
    const unknown = visibleText(await notice({ saver: { kind: "unknown" }, archive: archivedBy({ kind: "unknown" }) }));

    expect(deleted).toContain(`W archiwum od ${ARCHIVED_ON} — zarchiwizowana przez osobę z usuniętym kontem.`);
    expect(unknown).toContain("Ta oferta była już zapisana i jest w archiwum — otwieramy istniejącą kartę.");
    expect(unknown).toContain(`W archiwum od ${ARCHIVED_ON}.`);
    expect(unknown).not.toContain("przez");
    expect(unknown).not.toContain(DELETED_ACCOUNT);
  });

  it("renders an archiver's address that holds HTML as text", async () => {
    const email = '<img src=x onerror="alert(1)">@example.com';
    const html = await notice({ archive: archivedBy({ kind: "member", email }) });

    expect(visibleText(withoutIslandProps(html))).toContain(`zarchiwizowana przez ${email}.`);
    expect(html).not.toContain("<img src=x");
    expect(html.split("onerror")).toHaveLength(2);
  });
});

// Deleting an offer and the member's own note (FR-015). The buttons only open a confirmation: the
// form that deletes lives in the dialog, which a server render does not hold, so nothing here can
// be sent by one click or with JavaScript off. Expected outcomes are written by hand from the
// plan's contract (context/changes/delete-offer-and-notes/plan.md, Phase 2), never copied from the
// rendered output. What the dialog itself says and does is tests/e2e/delete-with-confirmation.spec.ts.

const DELETE_OFFER = "Usuń ofertę";
const DELETE_NOTE = "Usuń";
const EDIT_NOTE = "Edytuj";
const SAVE_NOTE = "Zapisz notatkę";
const TO_ARCHIVE_INSTEAD = "nadaje się do archiwum";

/** The card's delete block: from its id to the end of the card's header. */
function deleteBlock(html: string): string {
  const start = html.indexOf('id="usuwanie"');
  if (start === -1) throw new Error("expected the delete block to render");
  const end = html.indexOf("</header>", start);
  if (end === -1) throw new Error("expected the card's header to be closed");
  return withoutIslandProps(html.slice(start, end));
}

/** The notes section, to the end of the view. */
function notesBlock(html: string): string {
  const start = html.indexOf('<section id="notatki"');
  if (start === -1) throw new Error("expected the notes section to render");
  return withoutIslandProps(html.slice(start));
}

describe("OfferView: every offer's card offers its deletion, behind a confirmation (FR-015)", () => {
  it.each<[string, Record<string, unknown>, boolean]>([
    ["a live offer", {}, true],
    ["an archived offer", { offer: archivedOffer, archive: archivedBy(memberSaver) }, false],
    ["an offer archived by a deleted account", { offer: archivedByDeletedOffer }, false],
  ])("renders the delete block with its one button for %s", async (_case, props, live) => {
    const html = await offerView(props);
    const block = deleteBlock(html);

    expect(html.split("data-offer-delete")).toHaveLength(2);
    expect(buttonsIn(block)).toEqual([{ label: DELETE_OFFER, disabled: false }]);
    expect(visibleText(block)).toContain("Usunięcia nie da się cofnąć");
    expect(visibleText(block)).toContain("notatki wszystkich członków zespołu i wynik audytu");
    // Only a live offer can still go to the archive instead.
    expect(visibleText(block).includes(TO_ARCHIVE_INSTEAD)).toBe(live);
    expect(block).not.toContain('role="alert"');
  });

  it("puts no form and no field in the block: the button alone sends nothing", async () => {
    const html = await offerView({});
    const block = deleteBlock(html);

    expect(block).not.toContain("<form");
    expect(block).not.toContain("<input");
    expect(block).toMatch(/<button\b[^>]*type="button"/);
    expect(block).not.toMatch(/<button\b[^>]*type="submit"/);
    expect(html).not.toContain('action="/api/offer-delete"');
    // Controls: the blocks beside it do carry their forms, so the search above can find one.
    expect(archiveBlock(html)).toContain('action="/api/offer-archive"');
    expect(refetchBlock(html)).toContain('action="/api/offer-refetch"');
  });

  it("shows a failed deletion in the delete block, as text, and nowhere else", async () => {
    const message = 'Nie udało się <b>usunąć</b> <script>alert("x")</script>';
    const html = await offerView({ deleteError: message, notes: fullNotes });

    expect(visibleText(deleteBlock(html))).toContain(message);
    expect(deleteBlock(html)).toContain('role="alert"');
    expect(visibleText(archiveBlock(html))).not.toContain(message);
    expect(visibleText(refetchBlock(html))).not.toContain(message);
    expect(visibleText(notesBlock(html))).not.toContain(message);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>alert");
    // Not the note editor's error either: the member's note stays in preview.
    expect(notesBlock(html)).not.toContain("<textarea");
    expect(buttonsIn(deleteBlock(html))).toEqual([{ label: DELETE_OFFER, disabled: false }]);
  });

  it("control: the same card without an error shows no alert in any block", async () => {
    const html = await offerView({ notes: fullNotes });

    expect(deleteBlock(html)).not.toContain('role="alert"');
    expect(notesBlock(html)).not.toContain('role="alert"');
  });
});

describe("OfferNotes: only the member's own note can be deleted (FR-015)", () => {
  it("offers „Edytuj” and „Usuń” on the member's own note, and no action on anyone else's", async () => {
    // fullNotes: the viewer's note, a member's note and a note of a deleted account.
    const block = notesBlock(await offerView({ notes: fullNotes }));

    expect(buttonsIn(block)).toEqual([
      { label: EDIT_NOTE, disabled: false },
      { label: DELETE_NOTE, disabled: false },
    ]);
    expect(visibleText(block)).toContain("czlonek-zespolu@example.com");
    expect(visibleText(block)).toContain(DELETED_ACCOUNT);
    // The button only opens the confirmation: the form that deletes is not in the page.
    expect(block).not.toContain("<form");
    expect(block).not.toContain('value="delete"');
  });

  it("offers no deletion to a member who has no note: the form saves, and names that intent", async () => {
    // othersOnlyNotes: two notes, neither the viewer's.
    const block = notesBlock(await offerView({ notes: othersOnlyNotes }));

    expect(buttonsIn(block)).toEqual([{ label: SAVE_NOTE, disabled: false }]);
    expect(hiddenValues(block, "intent")).toEqual(["save"]);
    expect(hiddenValues(block, "offer_id")).toEqual([fullOffer.id]);
  });

  it("renders no action at all when the notes could not be read", async () => {
    const block = notesBlock(await offerView({ notes: failedNotes }));

    expect(block).toContain('data-notes-state="error"');
    expect(buttonsIn(block)).toEqual([]);
    expect(block).not.toContain("<form");
  });

  it("shows a failed deletion above the note, as text, without opening the editor", async () => {
    const message = 'Nie udało się <b>usunąć</b> notatki <script>alert("x")</script>';
    const html = await offerView({ notes: fullNotes, noteDeleteError: message });
    const block = notesBlock(html);

    expect(visibleText(block)).toContain(message);
    expect(block).toContain('role="alert"');
    expect(block).not.toContain("<textarea");
    expect(buttonsIn(block)).toEqual([
      { label: EDIT_NOTE, disabled: false },
      { label: DELETE_NOTE, disabled: false },
    ]);
    expect(visibleText(deleteBlock(html))).not.toContain(message);
    expect(visibleText(archiveBlock(html))).not.toContain(message);
    expect(visibleText(refetchBlock(html))).not.toContain(message);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>alert");
  });

  // Beside it: a failed save is the error that does open the editor.
  it("control: a failed save opens the editor on the same note", async () => {
    const block = notesBlock(await offerView({ notes: fullNotes, noteError: "Nie udało się zapisać notatki." }));

    expect(block).toContain("<textarea");
    expect(buttonsIn(block).map((button) => button.label)).toContain(SAVE_NOTE);
    expect(buttonsIn(block).map((button) => button.label)).not.toContain(DELETE_NOTE);
  });

  it("still tells a failed deletion when the notes could not be read", async () => {
    const message = "Nie udało się usunąć notatki.";
    const block = notesBlock(await offerView({ notes: failedNotes, noteDeleteError: message }));

    expect(visibleText(block)).toContain(message);
    expect(buttonsIn(block)).toEqual([]);
  });
});

/** Values an address can carry that are not on a notice's list. */
const OFF_THE_LIST: [string, string | null][] = [
  ["no value", null],
  ["an empty value", ""],
  ["an unknown value", "archived"],
  ["another case", "GONE"],
  ["an inherited key", "constructor"],
  ["markup", "<script>alert(1)</script>"],
  ["markup around a known value", 'gone"><img src=x onerror=alert(1)>'],
];

describe("DeleteNotice: the address only picks one of two sentences", () => {
  function notice(result: string | null): Promise<string> {
    return container.renderToString(DeleteNotice, { props: { result } });
  }

  it("says the offer was deleted with its notes and audit for `1`", async () => {
    const html = await notice("1");

    expect(visibleText(html)).toBe("Oferta została usunięta razem z notatkami zespołu i wynikiem audytu.");
    expect(html).toContain('data-delete-result="deleted"');
  });

  it("says the offer was already gone for `gone`, and never that the member deleted it", async () => {
    const html = await notice("gone");

    expect(visibleText(html)).toBe("Tej oferty już nie było — ktoś usunął ją wcześniej. Niczego nie usunięto.");
    expect(html).toContain('data-delete-result="already-gone"');
    expect(html).not.toContain('data-delete-result="deleted"');
    expect(visibleText(html)).not.toContain("została usunięta");
  });

  it.each<[string, string | null]>([...OFF_THE_LIST, ["the token of the other result", "deleted"], ["true", "true"]])(
    "renders nothing for %s",
    async (_case, result) => {
      const html = await notice(result);

      expect(visibleText(html)).toBe("");
      expect(html).not.toContain("alert(1)");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("data-delete-result");
    },
  );
});

describe("NoteDeleteNotice: the address only picks one of two sentences, and never whether a note exists", () => {
  function notice(result: string | null, hasOwnNote: boolean): Promise<string> {
    return container.renderToString(NoteDeleteNotice, { props: { result, hasOwnNote } });
  }

  it("says the note was deleted for `deleted`", async () => {
    const html = await notice("deleted", false);

    expect(visibleText(html)).toBe("Twoja notatka została usunięta.");
    expect(html).toContain('data-note-result="deleted"');
  });

  it("says the note was already gone for `gone`, and never that it was deleted", async () => {
    const html = await notice("gone", false);

    expect(visibleText(html)).toBe("Twojej notatki już nie było — niczego nie usunięto.");
    expect(html).toContain('data-note-result="gone"');
    expect(visibleText(html)).not.toContain("została usunięta");
  });

  // Beside the two above: the same addresses over a card whose member does have a note.
  it.each(["deleted", "gone"])("renders nothing for `%s` while the member has a note", async (result) => {
    const html = await notice(result, true);

    expect(visibleText(html)).toBe("");
    expect(html).not.toContain("data-note-result");
  });

  it.each<[string, string | null]>([...OFF_THE_LIST, ["the offer notice's value", "1"]])(
    "renders nothing for %s",
    async (_case, result) => {
      const html = await notice(result, false);

      expect(visibleText(html)).toBe("");
      expect(html).not.toContain("alert(1)");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("data-note-result");
    },
  );
});
