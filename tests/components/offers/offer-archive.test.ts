import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import OfferArchive from "@/components/offers/OfferArchive.astro";
import OfferArchiveItem from "@/components/offers/OfferArchiveItem.astro";
import RecentlyArchived from "@/components/offers/RecentlyArchived.astro";
import type { Saver } from "@/lib/members";
import type { ArchivedOffer, ArchiveResult } from "@/lib/offer-archive";
import type { OfferImage, OfferRow } from "@/lib/otodom/types";
import { fullOffer, memberSaver, unknownOffer } from "@/pages/dev/_offer-fixtures";

// The archive beside the board and on its own page (FR-014). Expected outcomes are written by hand
// from the contract in context/changes/archive-and-restore/plan.md (Phase 4): the section under
// the board counts every archived offer and lists only the recent ones, a failed read is never an
// empty archive, and a row of the archive page names who archived the offer and when, restores it
// with a button that is not inside a link, and never shows a fact the listing does not state as 0.
// Which offers are recent is `loadArchive`'s decision (tests/lib/offer-archive.test.ts): the views
// take `recent` as given, so the tests here state it themselves.

const UNSTATED = "nie podano w ogłoszeniu";
const RESTORE = "Przywróć";
const DELETED_ACCOUNT = "usuniętym kontem";
/** 16:20 UTC on 10 October 2026 — 18:20 in Poland, the same day. */
const ARCHIVED_AT = "2026-10-10T16:20:00Z";
const ARCHIVED_ON = "10 października 2026";

let container: AstroContainer;

beforeAll(async () => {
  // The rows render React `Card` and the `ArchiveForm` island server-side, so the container needs the React renderer.
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

function entry(
  id: string,
  title: string,
  archiver: Saver,
  archivedAt = ARCHIVED_AT,
  base: OfferRow = fullOffer,
): ArchivedOffer {
  return {
    offer: { ...base, id, title, archived_at: archivedAt, archived_by: archiver.kind === "deleted" ? null : "x" },
    archivedAt,
    archiver,
  };
}

const RECENT_1 = entry("00000000-0000-4000-8000-0000000000a1", "Pierwsza świeżo zarchiwizowana", memberSaver);
const RECENT_2 = entry("00000000-0000-4000-8000-0000000000a2", "Druga świeżo zarchiwizowana", { kind: "self" });
const OLD = entry(
  "00000000-0000-4000-8000-0000000000a3",
  "Dawno zarchiwizowana",
  { kind: "deleted" },
  "2026-09-01T08:00:00Z",
);

const EMPTY: ArchiveResult = { ok: true, offers: [], recent: [] };
const FAILED: ArchiveResult = { ok: false };

/** The markup with every island's serialised props dropped: what the browser shows before any script runs. */
function withoutIslandProps(html: string): string {
  return html.replace(/<astro-island\b[^>]*>/g, "<astro-island>");
}

/** What a member reads: scripts, styles and tags dropped, entities decoded, whitespace collapsed. */
function visibleText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(html: string, name: string): string | undefined {
  return new RegExp(`<section[^>]*\\s${name}="([^"]*)"`).exec(html)?.[1];
}

function archivedIds(html: string): string[] {
  return Array.from(html.matchAll(/data-archived-offer="([^"]*)"/g), (match) => match[1]);
}

function hrefsIn(html: string): string[] {
  return Array.from(html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g), (match) => match[1]);
}

/** The `value` of every hidden field called `name`. */
function hiddenValues(html: string, name: string): string[] {
  return Array.from(
    html.matchAll(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`, "g")),
    (match) => /\bvalue="([^"]*)"/.exec(match[0])?.[1] ?? "",
  );
}

function recently(result: ArchiveResult): Promise<string> {
  return container.renderToString(RecentlyArchived, { props: { result } });
}

async function item(archived: ArchivedOffer): Promise<string> {
  return withoutIslandProps(await container.renderToString(OfferArchiveItem, { props: { entry: archived } }));
}

describe("RecentlyArchived: the link counts the whole archive, the list names only the recent (FR-014)", () => {
  it("counts every archived offer and lists the recent ones, each linked to its card and signed", async () => {
    const html = await recently({ ok: true, offers: [RECENT_1, RECENT_2, OLD], recent: [RECENT_1, RECENT_2] });
    const text = visibleText(html);

    expect(attribute(html, "data-archive-state")).toBe("ok");
    expect(text).toContain("Archiwum (3)");
    expect(archivedIds(html)).toEqual([RECENT_1.offer.id, RECENT_2.offer.id]);
    expect(hrefsIn(html)).toEqual(["/offers/archive", `/offers/${RECENT_1.offer.id}`, `/offers/${RECENT_2.offer.id}`]);
    expect(text).toContain(RECENT_1.offer.title);
    expect(text).toContain(`Zarchiwizowana przez czlonek-zespolu@example.com · ${ARCHIVED_ON}`);
    expect(text).toContain(`Zarchiwizowana przez Ciebie · ${ARCHIVED_ON}`);
    // The older offer is counted and not listed.
    expect(text).not.toContain(OLD.offer.title);
    expect(html).not.toContain(OLD.offer.id);
  });

  it("holds no button and no form: an offer is restored from its card or from the archive page", async () => {
    const html = await recently({ ok: true, offers: [RECENT_1], recent: [RECENT_1] });

    expect(html).not.toContain("<button");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<astro-island");
  });

  it("says nothing was archived in the last 7 days when the archive holds only older offers", async () => {
    const html = await recently({ ok: true, offers: [OLD], recent: [] });
    const text = visibleText(html);

    expect(attribute(html, "data-archive-state")).toBe("ok");
    expect(text).toContain("Archiwum (1)");
    expect(text).toContain("W ostatnich 7 dniach nic nie zarchiwizowano.");
    expect(text).not.toContain("Archiwum jest puste");
    expect(archivedIds(html)).toEqual([]);
  });

  it("control: an empty archive says ok, counts zero and says the archive is empty", async () => {
    const html = await recently(EMPTY);
    const text = visibleText(html);

    expect(attribute(html, "data-archive-state")).toBe("ok");
    expect(text).toContain("Archiwum (0)");
    expect(text).toContain("Archiwum jest puste.");
    expect(html).not.toContain('role="alert"');
    expect(hrefsIn(html)).toEqual(["/offers/archive"]);
  });

  it("says error for a failed read: a link without a number, and never an empty archive", async () => {
    const html = await recently(FAILED);
    const text = visibleText(html);

    expect(attribute(html, "data-archive-state")).toBe("error");
    expect(html).toContain('role="alert"');
    expect(text).toContain("Nie udało się wczytać archiwum");
    expect(text).not.toContain("Archiwum jest puste");
    expect(text).not.toContain("nic nie zarchiwizowano");
    expect(text).not.toMatch(/Archiwum \(\d+\)/);
    // The archive page stays one click away.
    expect(hrefsIn(html)).toEqual(["/offers/archive"]);
    expect(archivedIds(html)).toEqual([]);
  });
});

describe("OfferArchive: the list, the empty archive and a failed read are three states (FR-014)", () => {
  function archive(result: ArchiveResult): Promise<string> {
    return container.renderToString(OfferArchive, { props: { result } });
  }

  it("lists every archived offer in the order of the read, with the count in the heading", async () => {
    const html = await archive({ ok: true, offers: [RECENT_1, RECENT_2, OLD], recent: [RECENT_1, RECENT_2] });

    expect(attribute(html, "data-archive-state")).toBe("ok");
    expect(visibleText(html)).toContain("Zarchiwizowane oferty (3)");
    expect(archivedIds(html)).toEqual([RECENT_1.offer.id, RECENT_2.offer.id, OLD.offer.id]);
  });

  it("control: an empty archive says ok and says it is empty", async () => {
    const html = await archive(EMPTY);

    expect(attribute(html, "data-archive-state")).toBe("ok");
    expect(visibleText(html)).toContain("Zarchiwizowane oferty (0)");
    expect(visibleText(html)).toContain("Archiwum jest puste.");
    expect(html).not.toContain('role="alert"');
  });

  it("says error for a failed read, with no count and never an empty archive", async () => {
    const html = await archive(FAILED);
    const text = visibleText(html);

    expect(attribute(html, "data-archive-state")).toBe("error");
    expect(html).toContain('role="alert"');
    expect(text).toContain("Nie udało się wczytać archiwum.");
    expect(text).not.toContain("Archiwum jest puste");
    expect(text).not.toMatch(/\(\d+\)/);
    expect(archivedIds(html)).toEqual([]);
  });
});

describe("OfferArchiveItem: what the offer is, who archived it, and the restore beside the link (FR-014)", () => {
  it("shows the stated price, area and location, the signature, and carries the offer's id", async () => {
    const html = await item(RECENT_1);
    const text = visibleText(html);

    expect(archivedIds(html)).toEqual([RECENT_1.offer.id]);
    expect(text).toContain(RECENT_1.offer.title);
    expect(text).toMatch(/890\s*000\s*zł/);
    expect(text).toMatch(/\b57\s*m²/);
    expect(text).toContain("Warszawa, Mokotów, Stary Mokotów, ul. Przykładowa");
    expect(text).toContain(`Zarchiwizowana przez czlonek-zespolu@example.com · ${ARCHIVED_ON}`);
    expect(text).not.toContain(UNSTATED);
  });

  it.each<[string, Partial<OfferRow>, string]>([
    ["price null, currency kept", { price: null }, "Cena"],
    ["price and currency null", { price: null, price_currency: null }, "Cena"],
    ["area null", { area_m2: null }, "Metraż"],
  ])("reads %s as unstated, never as 0", async (_case, overrides, label) => {
    const text = visibleText(
      await item(entry(RECENT_1.offer.id, "Oferta", memberSaver, ARCHIVED_AT, { ...fullOffer, ...overrides })),
    );

    expect(text).toContain(`${label}: ${UNSTATED}`);
    expect(text.split(UNSTATED).length - 1).toBe(1);
    expect(text).not.toMatch(/(?<!\d)0(?:[.,]0+)?\s*(?:zł|PLN|m²|m2)/i);
    expect(text).not.toMatch(/\b(?:NaN|null|undefined)\b/);
  });

  it("reads price, area and location as unstated for the nothing-stated fixture, with no image", async () => {
    const html = await item(entry(RECENT_1.offer.id, "Bez parametrów", memberSaver, ARCHIVED_AT, unknownOffer));
    const text = visibleText(html);

    expect(text).toContain(`Cena: ${UNSTATED}`);
    expect(text).toContain(`Metraż: ${UNSTATED}`);
    expect(text).toContain(`Lokalizacja: ${UNSTATED}`);
    expect(text).not.toMatch(/(?<!\d)0(?:[.,]0+)?\s*(?:zł|PLN|m²|m2)/i);
    expect(html).not.toContain("<img");
  });

  it("puts only safe addresses into href and src", async () => {
    const safe = "https://picsum.photos/seed/vetpad-valid/320/240";
    const images = [
      { thumbnail: "http://picsum.photos/seed/vetpad-http/320/240", large: "x" },
      { thumbnail: "javascript:alert(1)", large: "javascript:alert(1)" },
      null,
      { thumbnail: safe, large: "javascript:alert(2)" },
    ] as unknown as OfferImage[];
    const html = await item(
      entry(RECENT_1.offer.id, "Filtr zdjęć", memberSaver, ARCHIVED_AT, {
        ...fullOffer,
        images,
        source_url: "javascript:alert(3)",
      }),
    );

    expect(Array.from(html.matchAll(/<img\b[^>]*\ssrc="([^"]*)"/g), (match) => match[1])).toEqual([safe]);
    expect(hrefsIn(html)).toEqual([`/offers/${RECENT_1.offer.id}`]);
    expect(html).not.toContain("javascript:");
    // The icon's SVG namespace is the only `http://` left: the http: photo is in no attribute.
    expect(html).not.toContain("vetpad-http");
  });

  it("renders no image when no thumbnail is safe", async () => {
    const images = [{ thumbnail: "javascript:alert(1)", large: "https://example.com/a.jpg" }];
    const html = await item(
      entry(RECENT_1.offer.id, "Bez zdjęcia", memberSaver, ARCHIVED_AT, { ...fullOffer, images }),
    );

    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
  });

  it("keeps the restore button outside the link, and sends intent=restore and return=archive", async () => {
    const html = await item(RECENT_1);
    const links = Array.from(html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g), (match) => match[0]);
    const buttons = Array.from(html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g), (match) => visibleText(match[1]));

    expect(links).toHaveLength(1);
    expect(links[0]).not.toContain("<button");
    expect(links[0]).not.toContain("<form");
    expect(links[0]).not.toContain("<input");
    expect(buttons).toEqual([RESTORE]);
    // The whole row opens the card: the title's link is stretched over the positioned row, and the
    // restore form stands above that layer, so a click on the button never lands on the link.
    expect(links[0]).toContain("after:absolute after:inset-0");
    const row = /<[^>]*data-archived-offer="[^"]*"[^>]*>/.exec(html)?.[0] ?? "";
    expect(row).toMatch(/class="[^"]*\brelative\b/);
    expect(html).toMatch(/<div class="relative z-10[^"]*">\s*(<style>[\s\S]*?<\/script>)?\s*<astro-island/);
    expect(html).toContain('action="/api/offer-archive"');
    expect(hiddenValues(html, "offer_id")).toEqual([RECENT_1.offer.id]);
    expect(hiddenValues(html, "intent")).toEqual(["restore"]);
    expect(hiddenValues(html, "return")).toEqual(["archive"]);
  });

  it("shows no audit status and no limit marks", async () => {
    const html = await item(RECENT_1);

    expect(html).not.toContain("data-audit-status");
    expect(html).not.toContain("data-limit-breach");
    expect(visibleText(html)).not.toMatch(/audyt/i);
    expect(visibleText(html)).not.toMatch(/limit/i);
  });

  it("renders an archiver's address and a title that hold HTML as the text they are", async () => {
    const email = '<img src=x onerror=alert(1)>"@example.com';
    const title = "<script>alert(2)</script>";
    const html = await item(entry(RECENT_1.offer.id, title, { kind: "member", email }));

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert(2)");
    expect(visibleText(html)).toContain(`Zarchiwizowana przez ${email} · ${ARCHIVED_ON}`);
    expect(visibleText(html)).toContain(title);
  });
});

describe("the archiver: a deleted account and one that could not be established read differently", () => {
  const DELETED = entry(RECENT_1.offer.id, "Oferta", { kind: "deleted" });
  const UNKNOWN = entry(RECENT_1.offer.id, "Oferta", { kind: "unknown" });

  it.each<[string, (archived: ArchivedOffer) => Promise<string>]>([
    ["a row of the archive page", item],
    ["a row of the board's section", (archived) => recently({ ok: true, offers: [archived], recent: [archived] })],
  ])("in %s", async (_case, render) => {
    const deleted = visibleText(await render(DELETED));
    const unknown = visibleText(await render(UNKNOWN));

    expect(deleted).toContain(`Zarchiwizowana przez osobę z usuniętym kontem · ${ARCHIVED_ON}`);
    // Nobody is named, the date stays, and a failed read of the name is never a deleted account.
    expect(unknown).toContain(`Zarchiwizowana · ${ARCHIVED_ON}`);
    expect(unknown).not.toContain(DELETED_ACCOUNT);
    expect(unknown).not.toContain("przez");
    expect(deleted).not.toBe(unknown);
  });
});
