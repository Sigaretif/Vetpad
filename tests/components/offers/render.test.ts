import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import OfferAudit from "@/components/offers/OfferAudit.astro";
import OfferBoardItem from "@/components/offers/OfferBoardItem.astro";
import OfferCard from "@/components/offers/OfferCard.astro";
import OfferGallery from "@/components/offers/OfferGallery.astro";
import OfferView from "@/components/offers/OfferView.astro";
import type { StoredFindings } from "@/lib/audit/schema";
import type { AuditAttempt, OfferAudit as OfferAuditData, StoredAudit } from "@/lib/audit/store";
import type { Saver } from "@/lib/members";
import type { OfferImage, OfferRow } from "@/lib/otodom/types";
import {
  failedNotes,
  fullOffer,
  malformedImagesOffer,
  memberSaver,
  noAudits,
  noLimits,
  noNotes,
} from "@/pages/dev/_offer-fixtures";

// The stored row, not the ingest, is the attack surface (lessons.md): any member can PATCH any
// `offers` column, so these renders feed the views hostile and broken values directly, with no
// mapper in between. Expected values are written by hand from the rule — only an https URL
// reaches href/src, and a URL that fails renders no link or image — never copied from output.

const NO_PHOTOS = "Ogłoszenie nie zawiera zdjęć.";
const SOURCE_LINK = "Otwórz oryginał";

const JS = "javascript:alert(1)";
const THUMB = "https://picsum.photos/seed/render-test/320/240";
const LARGE = "https://picsum.photos/seed/render-test/800/600";
const VALID: OfferImage = { thumbnail: THUMB, large: LARGE };

let container: AstroContainer;

beforeAll(async () => {
  // The views render React `Card`/`Badge` server-side, so the container needs the React renderer.
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

/**
 * Every `href`/`src` value in the markup. The count of attribute names guards the extraction: an
 * attribute the pattern cannot read (unquoted, single-quoted) fails the test instead of slipping
 * past the whitelist.
 */
function urlsIn(html: string): string[] {
  const values = Array.from(html.matchAll(/(?<![\w-])(?:href|src)\s*=\s*"([^"]*)"/gi), (match) => match[1]);
  const names = html.match(/(?<![\w-])(?:href|src)\s*=/gi) ?? [];
  expect(values).toHaveLength(names.length);
  return values;
}

function hrefsIn(html: string): string[] {
  return Array.from(html.matchAll(/(?<![\w-])href\s*=\s*"([^"]*)"/gi), (match) => match[1]);
}

function imgSrcsIn(html: string): string[] {
  return Array.from(html.matchAll(/<img\b[^>]*?\ssrc="([^"]*)"/gi), (match) => match[1]);
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

describe("OfferGallery: a photo renders only when both its URLs are https (#7)", () => {
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

    expect(imgSrcsIn(html)).toEqual([THUMB]);
    expect(hrefsIn(html)).toEqual([LARGE]);
    expect(countTags(html, "img")).toBe(1);
    expect(countTags(html, "a")).toBe(1);
    expect(html).not.toContain(NO_PHOTOS);
    expectOnlySafeUrls(html);
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
    ...overrides,
  };
}

const NO_ATTEMPT: AuditAttempt = { kind: "none" };

function audited(overrides: Partial<StoredAudit> = {}, attempt: AuditAttempt = NO_ATTEMPT): OfferAuditData {
  return { state: "ok", attempt, result: stored(overrides) };
}

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
  { available = true, ...props }: { available?: boolean; runnerPreview?: unknown } = {},
): Promise<string> {
  const html = await container.renderToString(OfferAudit, {
    props: { offerId: fullOffer.id, audit, available, ...props },
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
      props: { offer: fullOffer, saver: memberSaver, auditAvailable: true, ...props },
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
