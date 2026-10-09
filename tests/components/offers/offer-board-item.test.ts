import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import OfferBoardItem from "@/components/offers/OfferBoardItem.astro";
import type { AuditIndex } from "@/lib/audit/store";
import type { OfferRow } from "@/lib/otodom/types";
import { fullOffer, noAudits, noLimits, unknownOffer } from "@/pages/dev/_offer-fixtures";

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

/** The row's visible text: tags dropped, every run of whitespace (NBSP included) one space. */
async function rowText(offer: OfferRow, audits: AuditIndex = noAudits): Promise<string> {
  const html = await container.renderToString(OfferBoardItem, { props: { offer, limits: noLimits, audits } });
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

  it("says the offer was audited when the index holds it", async () => {
    const text = await rowText(fullOffer, { ok: true, audited: new Set([fullOffer.id]) });

    expect(text).toContain(AUDITED);
    expect(text).not.toContain(NOT_AUDITED);
    expect(text).not.toContain(UNKNOWN);
  });

  it.each<[string, AuditIndex]>([
    ["no offer has a result", { ok: true, audited: new Set() }],
    ["only another offer has a result", { ok: true, audited: new Set([unknownOffer.id]) }],
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
