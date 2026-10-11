import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import OfferBoard from "@/components/offers/OfferBoard.astro";
import OfferBoardItem from "@/components/offers/OfferBoardItem.astro";
import type { AuditFreshness, BoardFreshness } from "@/lib/audit/freshness";
import type { AuditIndex } from "@/lib/audit/store";
import { parseBoardSort } from "@/lib/offer-board";
import type { OfferRow } from "@/lib/otodom/types";
import { fullOffer, noAudits, noFreshness, noLimits, unknownOffer } from "@/pages/dev/_offer-fixtures";

// Unknown, not zero (prd.md, Success Criteria → Guardrails): a price or an area the listing does
// not state reads „nie podano w ogłoszeniu" (prd.md, Open Questions, resolved 2026-09-22 in S-02),
// never "0 zł", "0 m²" or an empty value. Expected values are written by hand from that rule and
// the fixture input, never copied from the rendered output. The stored row is fed to the view
// directly — any member can PATCH it, so a `null` price beside a stated currency is a real row.

const UNSTATED = "nie podano w ogłoszeniu";

let container: AstroContainer;

beforeAll(async () => {
  // The row renders React `Card`/`Badge` server-side, so the container needs the React renderer.
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

async function rowHtml(offer: OfferRow, audits: AuditIndex, freshness: BoardFreshness): Promise<string> {
  return container.renderToString(OfferBoardItem, { props: { offer, limits: noLimits, audits, freshness } });
}

/** The row's visible text: tags dropped, every run of whitespace (NBSP included) one space. */
async function rowText(
  offer: OfferRow,
  audits: AuditIndex = noAudits,
  freshness: BoardFreshness = noFreshness,
): Promise<string> {
  const html = await rowHtml(offer, audits, freshness);
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function occurrences(text: string, phrase: string): number {
  return text.split(phrase).length - 1;
}

/**
 * No zero or empty-looking stand-in for a fact: a bare 0 (or 0,00 / 0.0) before a currency or an
 * area unit, and no leaked `NaN`/`null`/`undefined`. The lookbehind lets "890 000 zł" through.
 */
function expectNoZeroOrEmptyValue(text: string): void {
  expect(text).not.toMatch(/(?<!\d)0(?:[.,]0+)?\s*(?:zł|PLN|m²|m2)/i);
  expect(text).not.toMatch(/\b(?:NaN|null|undefined)\b/);
}

describe("OfferBoardItem: an unstated price or area reads as unstated, never as 0 (#1)", () => {
  it.each<[string, OfferRow]>([
    ["price null, currency kept", { ...fullOffer, price: null }],
    ["price and currency null", { ...fullOffer, price: null, price_currency: null }],
  ])("shows the price as unstated for %s, and the stated area", async (_case, offer) => {
    const text = await rowText(offer);

    expect(text).toContain(`Cena: ${UNSTATED}`);
    expect(occurrences(text, UNSTATED)).toBe(1);
    expect(text).toMatch(/\b57\s*m²/);
    expectNoZeroOrEmptyValue(text);
  });

  it("shows the area as unstated, and the stated price", async () => {
    const text = await rowText({ ...fullOffer, area_m2: null });

    expect(text).toContain(`Metraż: ${UNSTATED}`);
    expect(occurrences(text, UNSTATED)).toBe(1);
    expect(text).toMatch(/890\s*000\s*zł/);
    expectNoZeroOrEmptyValue(text);
  });

  it("shows price, area and location as unstated for the nothing-stated fixture", async () => {
    const text = await rowText(unknownOffer);

    expect(text).toContain(`Cena: ${UNSTATED}`);
    expect(text).toContain(`Metraż: ${UNSTATED}`);
    expect(text).toContain(`Lokalizacja: ${UNSTATED}`);
    expect(occurrences(text, UNSTATED)).toBe(3);
    expectNoZeroOrEmptyValue(text);
  });

  it("keeps a stated price and area as stated (the control case)", async () => {
    const text = await rowText(fullOffer);

    expect(occurrences(text, UNSTATED)).toBe(0);
    expect(text).toMatch(/890\s*000\s*zł/);
    expect(text).toMatch(/\b57\s*m²/);
  });
});

// The audit status on a row (FR-006), from the contract in
// context/changes/grounded-listing-audit/plan.md (Phase 5): „Audytowano" when the offer has a
// stored result, „Nie audytowano" when the audits were read and it has none, and „Nie udało się
// sprawdzić audytu" when they could not be read — which is never shown as „Nie audytowano".
describe("OfferBoardItem: the audit status is one of three, and a failed read is its own (#3)", () => {
  const AUDITED = "Audytowano";
  const NOT_AUDITED = "Nie audytowano";
  const UNKNOWN = "Nie udało się sprawdzić audytu";
  /** What an audit recorded for comparison; the row reads the freshness worked out from it. */
  const COMPARISON = { criteriaRevision: 7, listingFingerprint: `v1:${"0".repeat(64)}` };
  /** The offer's result is up to date. */
  const FRESH: BoardFreshness = { ok: true, byOffer: new Map([[fullOffer.id, { state: "fresh" }]]) };

  it("says the offer was audited when the index holds it", async () => {
    const text = await rowText(fullOffer, { ok: true, audited: new Map([[fullOffer.id, COMPARISON]]) }, FRESH);

    expect(text).toContain(AUDITED);
    expect(text).not.toContain(NOT_AUDITED);
    expect(text).not.toContain(UNKNOWN);
  });

  it.each<[string, AuditIndex]>([
    ["no offer has a result", { ok: true, audited: new Map() }],
    ["only another offer has a result", { ok: true, audited: new Map([[unknownOffer.id, COMPARISON]]) }],
  ])("says the offer was not audited when %s", async (_case, audits) => {
    const text = await rowText(fullOffer, audits);

    expect(text).toContain(NOT_AUDITED);
    expect(text).not.toContain(AUDITED);
    expect(text).not.toContain(UNKNOWN);
  });

  it("says the status could not be checked when the audits were not read, never that nobody audited", async () => {
    const text = await rowText(fullOffer, { ok: false });

    expect(text).toContain(UNKNOWN);
    expect(text).not.toContain(NOT_AUDITED);
    expect(text).not.toContain(AUDITED);
  });
});

// Whether a stored result is still up to date (FR-003, FR-009), from the contract in
// context/changes/refetch-and-stale-audit/plan.md (Phase 4): each status has its own words and its
// own value in `data-audit-status`, and an audited offer whose freshness is not known — the read
// failed, or holds no answer for it — never reads as the plain „Audytowano". The words are written
// by hand from `AuditStatusBadge.astro`'s contract, and agree with the card's („nieaktualny",
// „aktualności … nie udało się ustalić").
describe("OfferBoardItem: a stored result reads as up to date, stale or of unknown freshness (FR-003)", () => {
  const AUDITED = "Audytowano";
  const STALE = "Audyt nieaktualny";
  const FRESHNESS_UNKNOWN = "Aktualności audytu nie udało się ustalić";
  const NOT_AUDITED = "Nie audytowano";
  const COMPARISON = { criteriaRevision: 7, listingFingerprint: `v1:${"0".repeat(64)}` };
  const AUDITED_INDEX: AuditIndex = { ok: true, audited: new Map([[fullOffer.id, COMPARISON]]) };

  function freshnessOf(freshness: AuditFreshness): BoardFreshness {
    return { ok: true, byOffer: new Map([[fullOffer.id, freshness]]) };
  }

  /** The values of `data-audit-status` in the markup: a row carries exactly one. */
  function statuses(html: string): string[] {
    return [...html.matchAll(/data-audit-status="([^"]*)"/g)].map((match) => match[1]);
  }

  /** The badge that carries the status, as markup: its icon is inside it. */
  function badge(html: string): string {
    const found = /<span[^>]*data-audit-status=[^>]*>.*?<\/span>/s.exec(html);
    if (found === null) throw new Error("expected a badge with data-audit-status");
    return found[0];
  }

  function text(html: string): string {
    return html
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  it("control: a fresh result reads „Audytowano” and carries audited", async () => {
    const html = await rowHtml(fullOffer, AUDITED_INDEX, freshnessOf({ state: "fresh" }));

    expect(statuses(html)).toEqual(["audited"]);
    expect(text(html)).toContain(AUDITED);
    expect(text(html)).not.toContain(STALE);
    expect(text(html)).not.toContain(FRESHNESS_UNKNOWN);
  });

  it.each<[string, AuditFreshness]>([
    ["the listing changed", { state: "stale", reasons: ["listing"] }],
    ["the criteria changed", { state: "stale", reasons: ["criteria"] }],
    ["both changed", { state: "stale", reasons: ["listing", "criteria"] }],
  ])("says the audit is stale when %s, never the plain „Audytowano”", async (_case, freshness) => {
    const html = await rowHtml(fullOffer, AUDITED_INDEX, freshnessOf(freshness));

    expect(statuses(html)).toEqual(["stale"]);
    expect(text(html)).toContain(STALE);
    expect(text(html)).not.toContain(AUDITED);
    expect(text(html)).not.toContain(NOT_AUDITED);
    expect(text(html)).not.toContain(FRESHNESS_UNKNOWN);
  });

  it.each<[string, BoardFreshness]>([
    ["the comparison could not be made", freshnessOf({ state: "unknown" })],
    ["the freshness read failed", { ok: false }],
    ["the freshness read holds no answer for the offer", { ok: true, byOffer: new Map() }],
  ])("says the freshness could not be established when %s, never „Audytowano”", async (_case, freshness) => {
    const html = await rowHtml(fullOffer, AUDITED_INDEX, freshness);

    expect(statuses(html)).toEqual(["freshness_unknown"]);
    expect(text(html)).toContain(FRESHNESS_UNKNOWN);
    expect(text(html)).not.toContain(AUDITED);
    expect(text(html)).not.toContain(NOT_AUDITED);
    expect(text(html)).not.toContain(STALE);
  });

  // The freshness says nothing about an offer without a result, and nothing when the audits were not read.
  it.each<[string, AuditIndex, string]>([
    ["no result", { ok: true, audited: new Map() }, "not_audited"],
    ["a failed read of the audits", { ok: false }, "unknown"],
  ])("keeps the row's status for %s whatever the freshness read did", async (_case, audits, expected) => {
    expect(statuses(await rowHtml(fullOffer, audits, { ok: false }))).toEqual([expected]);
    expect(statuses(await rowHtml(fullOffer, audits, freshnessOf({ state: "stale", reasons: ["listing"] })))).toEqual([
      expected,
    ]);
  });

  // Readable without colour: each of the three has an icon, and no two share one.
  it("gives the three statuses of a stored result three different icons", async () => {
    const icons = await Promise.all(
      [
        freshnessOf({ state: "fresh" }),
        freshnessOf({ state: "stale", reasons: ["listing"] }),
        { ok: false } as const,
      ].map(
        async (freshness) =>
          /<svg[^>]*class="([^"]*)"/.exec(badge(await rowHtml(fullOffer, AUDITED_INDEX, freshness)))?.[1],
      ),
    );

    expect(icons.every((icon) => typeof icon === "string" && icon.includes("lucide"))).toBe(true);
    expect(new Set(icons).size).toBe(3);
  });
});

// The board's container says how the freshness read went, beside `data-audits-state`: a failed
// read renders with 200 and the same list, so only the attribute tells the two apart.
describe("OfferBoard: data-audit-freshness-state carries the freshness read (FR-003)", () => {
  const COMPARISON = { criteriaRevision: 7, listingFingerprint: `v1:${"0".repeat(64)}` };
  const AUDITED_INDEX: AuditIndex = { ok: true, audited: new Map([[fullOffer.id, COMPARISON]]) };
  const sort = parseBoardSort(new URLSearchParams());

  async function boardHtml(audits: AuditIndex, freshness: BoardFreshness): Promise<string> {
    return container.renderToString(OfferBoard, {
      props: { result: { ok: true, offers: [fullOffer, unknownOffer] }, limits: noLimits, audits, freshness, sort },
    });
  }

  function attribute(html: string, name: string): string | undefined {
    return new RegExp(`<section[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];
  }

  it("says ok for a read that succeeded, and the audited row follows its freshness", async () => {
    const html = await boardHtml(AUDITED_INDEX, {
      ok: true,
      byOffer: new Map([[fullOffer.id, { state: "stale", reasons: ["criteria"] }]]),
    });

    expect(attribute(html, "data-audit-freshness-state")).toBe("ok");
    expect(attribute(html, "data-audits-state")).toBe("ok");
    expect(html).toContain('data-audit-status="stale"');
    expect(html).toContain('data-audit-status="not_audited"');
  });

  it("says error for a read that failed, keeps the list, and no audited row reads as audited", async () => {
    const html = await boardHtml(AUDITED_INDEX, { ok: false });

    expect(attribute(html, "data-audit-freshness-state")).toBe("error");
    // The other reads' states are their own.
    expect(attribute(html, "data-board-state")).toBe("ok");
    expect(attribute(html, "data-audits-state")).toBe("ok");
    expect(html).toContain(`href="/offers/${fullOffer.id}"`);
    expect(html).toContain(`href="/offers/${unknownOffer.id}"`);
    expect(html).toContain('data-audit-status="freshness_unknown"');
    expect(html).toContain('data-audit-status="not_audited"');
    expect(html).not.toContain('data-audit-status="audited"');
  });

  it("keeps the two attributes apart: a failed read of the audits beside a freshness that says ok", async () => {
    const html = await boardHtml({ ok: false }, { ok: true, byOffer: new Map() });

    expect(attribute(html, "data-audits-state")).toBe("error");
    expect(attribute(html, "data-audit-freshness-state")).toBe("ok");
  });
});
