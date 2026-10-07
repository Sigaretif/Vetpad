import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import CriteriaView from "@/components/criteria/CriteriaView.astro";
import type { AuditSettingsResult } from "@/lib/audit/settings";
import type { CriteriaResult } from "@/lib/criteria";

// The audit settings section of /criteria, rendered through the Container API. Expected outcomes
// are written by hand from the view's contract in context/changes/grounded-listing-audit/plan.md
// (Phase 2: the section has `id="audyt"` and `data-audit-settings-state="ok"|"error"`; with
// `error` the form does not render; the helper text says the change applies to the next audits
// and marks no existing one stale) and from the header of
// supabase/migrations/20261007073258_create_audit_settings.sql (a null signature with a date is
// a deleted account, with no date the settings were never changed).
//
// The state that must never be shown for a failed read is "the defaults": the section then
// renders no value and no form, because a form prefilled from a guess would overwrite the team's
// choice. Every failed read below stands beside the read that succeeds.

const SAVE_FAILED = "Nie udało się zapisać ustawień audytu. Spróbuj ponownie.";
const READ_FAILED = "Nie udało się wczytać ustawień audytu.";
const CRITERIA_READ_FAILED = "Nie udało się wczytać kryteriów.";
const FORM_ACTION = 'action="/api/audit-settings"';

const CRITERIA: CriteriaResult = {
  state: "ok",
  limits: { city: null, priceMin: null, priceMax: null, areaMin: null },
  limitsChangedBy: null,
  limitsChangedAt: null,
  own: null,
  others: [],
};
const CRITERIA_FAILED: CriteriaResult = { state: "error" };

/** A choice that is not the default in either field, signed by another member. */
const CHOSEN: AuditSettingsResult = {
  state: "ok",
  model: "claude-sonnet-5-5",
  effort: "high",
  changedBy: { kind: "member", email: "anna@example.test" },
  changedAt: "2026-10-06T10:00:00Z",
};
const SETTINGS_FAILED: AuditSettingsResult = { state: "error" };

let container: AstroContainer;

beforeAll(async () => {
  // The view renders React cards and its form islands server-side, so the container needs the React renderer.
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

interface ViewProps {
  criteria?: CriteriaResult;
  auditSettings: AuditSettingsResult;
  serverError?: string;
  serverErrorFor?: "limits" | "requirements" | "audit";
}

/**
 * The view's markup as the browser shows it before any script runs. An island's opening tag also
 * carries its props serialised for hydration — the server error among them — so the tags'
 * attributes are dropped: a message is counted where a member reads it, not where it is stored.
 */
async function view({ criteria = CRITERIA, ...props }: ViewProps): Promise<string> {
  const html = await container.renderToString(CriteriaView, { props: { criteria, ...props } });
  return html.replace(/<astro-island\b[^>]*>/g, "<astro-island>");
}

/** The audit settings section alone: from its opening tag to its closing one. It is the view's last section. */
function auditSection(html: string): string {
  const start = html.indexOf('<section id="audyt"');
  if (start === -1) throw new Error("expected the view to render the audit settings section");
  const end = html.indexOf("</section>", start);
  if (end === -1) throw new Error("expected the audit settings section to be closed");
  return html.slice(start, end);
}

function count(html: string, text: string): number {
  return html.split(text).length - 1;
}

describe("CriteriaView: the audit settings section after a successful read (FR-010)", () => {
  it("marks the section ok and names the stored model and effort in its attributes", async () => {
    const section = auditSection(await view({ auditSettings: CHOSEN }));

    expect(section).toContain('data-audit-settings-state="ok"');
    expect(section).toContain('data-audit-model="claude-sonnet-5-5"');
    expect(section).toContain('data-audit-effort="high"');
  });

  it("shows the stored model and effort by name, and not the options the team did not choose", async () => {
    const section = auditSection(await view({ auditSettings: CHOSEN }));

    expect(section).toContain("Claude Sonnet 5.5");
    expect(section).toContain("Wysoki");
    // The lists' other options are rendered only once a list is opened.
    expect(section).not.toContain("Claude Opus 5.5");
    expect(section).not.toContain("Średni");
    expect(section).not.toContain("Niski");
  });

  it("renders the form with the stored values on both lists, before any script runs", async () => {
    const section = auditSection(await view({ auditSettings: CHOSEN }));

    expect(count(section, FORM_ACTION)).toBe(1);
    expect(section).toContain('method="POST"');
    // The two Radix triggers, each already showing the stored option's name in the server's HTML.
    expect(count(section, 'role="combobox"')).toBe(2);
    expect(section).toMatch(/role="combobox"[^>]*>\s*<span[^>]*>Claude Sonnet 5\.5<\/span>/);
    expect(section).toMatch(/role="combobox"[^>]*>\s*<span[^>]*>Wysoki<\/span>/);
    // What a native POST submits, named as the route reads it: the stored values, so a form sent
    // before the island hydrates saves what was already there. Radix's own hidden select is empty
    // in the server's HTML and carries no name.
    expect(count(section, 'name="model"')).toBe(1);
    expect(count(section, 'name="effort"')).toBe(1);
    expect(section).toMatch(
      /<input\b(?=[^>]*type="hidden")(?=[^>]*name="model")(?=[^>]*value="claude-sonnet-5-5")[^>]*>/,
    );
    expect(section).toMatch(/<input\b(?=[^>]*type="hidden")(?=[^>]*name="effort")(?=[^>]*value="high")[^>]*>/);
    expect(section).not.toMatch(/<select\b[^>]*name=/);
    expect(section).toContain("Zapisz ustawienia");
  });

  it("says the change applies to the next audits and marks no existing audit stale", async () => {
    const section = auditSection(await view({ auditSettings: CHOSEN }));

    expect(section).toContain("Zmiana dotyczy następnych audytów.");
    expect(section).toContain("nie są oznaczane jako nieaktualne");
  });

  it("renders the section whatever the criteria read did", async () => {
    const html = await view({ criteria: CRITERIA_FAILED, auditSettings: CHOSEN });
    const section = auditSection(html);

    expect(html).toContain('data-criteria-state="error"');
    expect(html).toContain(CRITERIA_READ_FAILED);
    expect(section).toContain('data-audit-settings-state="ok"');
    expect(count(section, FORM_ACTION)).toBe(1);
    expect(section).not.toContain(CRITERIA_READ_FAILED);
  });
});

describe("CriteriaView: a failed settings read is never shown as the defaults (FR-010)", () => {
  it("control: a successful read renders the form and no read error", async () => {
    const section = auditSection(await view({ auditSettings: CHOSEN }));

    expect(count(section, FORM_ACTION)).toBe(1);
    expect(section).not.toContain(READ_FAILED);
  });

  it("marks the section error, says the read failed, and renders no form and no value", async () => {
    const html = await view({ auditSettings: SETTINGS_FAILED });
    const section = auditSection(html);

    expect(section).toContain('data-audit-settings-state="error"');
    expect(section).toContain(READ_FAILED);
    expect(html).not.toContain(FORM_ACTION);
    expect(section).not.toContain('role="combobox"');
    expect(section).not.toContain("data-audit-model");
    expect(section).not.toContain("data-audit-effort");
    for (const name of ["Claude Opus 5.5", "Claude Sonnet 5.5", "Niski", "Średni", "Wysoki"]) {
      expect(section).not.toContain(name);
    }
  });

  it("leaves the criteria forms in place when only the settings read failed", async () => {
    const html = await view({ auditSettings: SETTINGS_FAILED });

    expect(html).toContain('data-criteria-state="ok"');
    expect(html).toContain('action="/api/criteria"');
    expect(html).not.toContain(CRITERIA_READ_FAILED);
  });
});

describe("CriteriaView: a failed settings save is reported on the settings section", () => {
  it("shows the message once, inside the section, above the lists", async () => {
    const html = await view({ auditSettings: CHOSEN, serverError: SAVE_FAILED, serverErrorFor: "audit" });
    const section = auditSection(html);

    expect(count(html, SAVE_FAILED)).toBe(1);
    expect(section).toContain(SAVE_FAILED);
    expect(section.indexOf(SAVE_FAILED)).toBeGreaterThan(section.indexOf(FORM_ACTION));
    expect(section.indexOf(SAVE_FAILED)).toBeLessThan(section.indexOf('role="combobox"'));
  });

  // A failed save that landed on a failed read: the member still has to learn the save did not happen.
  it("still shows the message when the settings read failed too", async () => {
    const html = await view({ auditSettings: SETTINGS_FAILED, serverError: SAVE_FAILED, serverErrorFor: "audit" });
    const section = auditSection(html);

    expect(count(html, SAVE_FAILED)).toBe(1);
    expect(section).toContain(SAVE_FAILED);
    expect(section).toContain(READ_FAILED);
  });

  it("shows it in the settings section, not above the criteria alert, when the criteria read failed", async () => {
    const html = await view({
      criteria: CRITERIA_FAILED,
      auditSettings: CHOSEN,
      serverError: SAVE_FAILED,
      serverErrorFor: "audit",
    });

    expect(count(html, SAVE_FAILED)).toBe(1);
    expect(auditSection(html)).toContain(SAVE_FAILED);
  });

  it("keeps another form's message out of the settings section", async () => {
    const message = "Nie udało się zapisać limitów. Spróbuj ponownie.";
    const html = await view({ auditSettings: CHOSEN, serverError: message, serverErrorFor: "limits" });

    expect(count(html, message)).toBe(1);
    expect(auditSection(html)).not.toContain(message);
  });
});

describe("CriteriaView: who last changed the audit settings", () => {
  const SIGNED = "Ostatnio zmienione";

  it("names the member who changed them, with the date", async () => {
    const section = auditSection(await view({ auditSettings: CHOSEN }));

    expect(section).toContain(SIGNED);
    expect(section).toContain("przez anna@example.test,");
    expect(section).toContain('datetime="2026-10-06T10:00:00Z"');
    expect(section).toContain("6 października 2026");
  });

  it("carries no signature for settings that were never changed", async () => {
    const section = auditSection(
      await view({
        auditSettings: { state: "ok", model: "claude-opus-5-5", effort: "medium", changedBy: null, changedAt: null },
      }),
    );

    expect(section).toContain("Claude Opus 5.5");
    expect(section).not.toContain(SIGNED);
    expect(section).not.toContain("<time");
  });

  it("names the viewer as „Ciebie”", async () => {
    const section = auditSection(await view({ auditSettings: { ...CHOSEN, changedBy: { kind: "self" } } }));

    expect(section).toContain("przez Ciebie,");
  });

  it("names a deleted account as one", async () => {
    const section = auditSection(await view({ auditSettings: { ...CHOSEN, changedBy: { kind: "deleted" } } }));

    expect(section).toContain("przez osobę z usuniętym kontem,");
  });

  // `unknown` names nobody and is never shown as a deleted account: the date stands alone.
  it("names nobody when the member could not be established", async () => {
    const section = auditSection(await view({ auditSettings: { ...CHOSEN, changedBy: { kind: "unknown" } } }));

    expect(section).toContain(SIGNED);
    expect(section).toContain("6 października 2026");
    expect(section).not.toContain("przez");
    expect(section).not.toContain("usuniętym kontem");
  });
});
