// Criteria and audit settings for the /dev/criteria kitchen sink (and the limits, requirements
// and audit settings columns of /dev/forms): one per named state of the view, so the visual gate
// renders without Supabase (zero-config). The `_` prefix keeps this file out of routing. Savers come from the offer
// fixtures — `example.com` addresses that name a role, never a person — and requirements talk
// about the flat only: no people, no phone numbers, no company names.

import { DEFAULT_AUDIT_SETTINGS, type AuditSettingsResult } from "@/lib/audit/settings";
import type { CriteriaResult, RequirementsView, TeamLimits } from "@/lib/criteria";
import type { Saver } from "@/lib/members";
import { deletedSaver, longEmailSaver, memberSaver, selfSaver, unknownSaver } from "@/pages/dev/_offer-fixtures";

/** A second member, so the full state shows two other members' requirements. */
export const otherMemberSaver: Saver = { kind: "member", email: "inny-czlonek-zespolu@example.com" };

/** Every limit set; the area has a fraction, so the form shows it with a decimal comma. */
export const fullLimits: TeamLimits = { city: "Warszawa", priceMin: 600000, priceMax: 950000, areaMin: 45.5 };

/** Nothing set: every limit reads „bez limitu" and the form opens empty. */
export const noLimits: TeamLimits = { city: null, priceMin: null, priceMax: null, areaMin: null };

/** Only an upper price and a minimum area. */
export const partialLimits: TeamLimits = { city: null, priceMin: null, priceMax: 900000, areaMin: 40 };

/** A city name with no break points, at the table's 100-character limit: it must wrap at 375 px. */
export const longCityLimits: TeamLimits = {
  city: "Bardzo-długa-nazwa-miejscowości-bez-spacji-do-sprawdzenia-zawijania-w-wąskim-widoku-na-telefonie-xx",
  priceMin: 450000,
  priceMax: 1200000,
  areaMin: 38,
};

/** The viewing member's own requirements, in preview. */
export const ownRequirements: RequirementsView = {
  author: selfSaver,
  body: "Balkon albo loggia.\nNie parter, najlepiej drugie–czwarte piętro.\nKuchnia z oknem.",
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-25T19:10:00Z",
};

/** Another member's requirements, signed with their email. */
export const memberRequirements: RequirementsView = {
  author: memberSaver,
  body: "Blisko tramwaju lub metra, do 10 minut pieszo.\nMiejsce w hali garażowej mile widziane.",
  createdAt: "2026-09-21T08:00:00Z",
  updatedAt: "2026-09-24T07:30:00Z",
};

/** A second member's requirements. */
export const otherMemberRequirements: RequirementsView = {
  author: otherMemberSaver,
  body: "Budynek po termomodernizacji, bez pieców w lokalu.",
  createdAt: "2026-09-22T12:00:00Z",
  updatedAt: "2026-09-22T12:00:00Z",
};

/** Requirements whose author could not be established: they name nobody and are never a deleted account. */
export const unknownRequirements: RequirementsView = {
  author: unknownSaver,
  body: "Oddzielna sypialnia od strony podwórza.",
  createdAt: "2026-09-23T16:00:00Z",
  updatedAt: "2026-09-23T16:00:00Z",
};

/** A very long author address. */
export const longEmailRequirements: RequirementsView = {
  author: longEmailSaver,
  body: "Winda w budynku, jeśli mieszkanie jest powyżej drugiego piętra.",
  createdAt: "2026-09-24T09:00:00Z",
  updatedAt: "2026-09-26T09:45:00Z",
};

/** A word with no break points and several paragraphs: nothing may scroll horizontally. */
export const longWordRequirements: RequirementsView = {
  author: selfSaver,
  body: [
    "Bardzo-długie-słowo-bez-spacji-do-sprawdzenia-zawijania-w-wąskiej-kolumnie-wymagań-na-telefonie-i-na-komputerze",
    ...Array.from(
      { length: 3 },
      (_, index) =>
        `Akapit ${index + 1}. Instalacja elektryczna po wymianie, piony wodno-kanalizacyjne wymienione, okna plastikowe w dobrym stanie.`,
    ),
  ].join("\n\n"),
  createdAt: "2026-09-19T18:00:00Z",
  updatedAt: "2026-09-26T21:00:00Z",
};

/** Limits and own requirements set, two other members' requirements. */
export const fullCriteria: CriteriaResult = {
  state: "ok",
  limits: fullLimits,
  limitsChangedBy: memberSaver,
  limitsChangedAt: "2026-09-26T17:20:00Z",
  own: ownRequirements,
  others: [memberRequirements, otherMemberRequirements],
};

/** Nothing yet: no limits (never changed, so no signature), no requirements. */
export const emptyCriteria: CriteriaResult = {
  state: "ok",
  limits: noLimits,
  limitsChangedBy: null,
  limitsChangedAt: null,
  own: null,
  others: [],
};

/** Some limits, changed by the viewer; one other member's requirements. */
export const partialCriteria: CriteriaResult = {
  state: "ok",
  limits: partialLimits,
  limitsChangedBy: selfSaver,
  limitsChangedAt: "2026-09-25T11:00:00Z",
  own: null,
  others: [memberRequirements],
};

/** Limits last changed by an account that has since been deleted. */
export const deletedSaverCriteria: CriteriaResult = {
  state: "ok",
  limits: fullLimits,
  limitsChangedBy: deletedSaver,
  limitsChangedAt: "2026-09-18T09:00:00Z",
  own: ownRequirements,
  others: [],
};

/** The limits' author and another member's could not be established: nobody is named. */
export const unknownAuthorCriteria: CriteriaResult = {
  state: "ok",
  limits: partialLimits,
  limitsChangedBy: unknownSaver,
  limitsChangedAt: "2026-09-24T14:00:00Z",
  own: null,
  others: [unknownRequirements],
};

/** A failed read: the view renders no form. */
export const failedCriteria: CriteriaResult = { state: "error" };

/** A long city, a long address and a long word. */
export const longCriteria: CriteriaResult = {
  state: "ok",
  limits: longCityLimits,
  limitsChangedBy: longEmailSaver,
  limitsChangedAt: "2026-09-26T08:00:00Z",
  own: longWordRequirements,
  others: [longEmailRequirements],
};

/** The settings as the migration leaves them: the defaults, never changed, so no signature. */
export const defaultAuditSettings: AuditSettingsResult = {
  state: "ok",
  ...DEFAULT_AUDIT_SETTINGS,
  changedBy: null,
  changedAt: null,
};

/** The other model and the highest effort, chosen by another member. */
export const memberAuditSettings: AuditSettingsResult = {
  state: "ok",
  model: "claude-sonnet-5-5",
  effort: "high",
  changedBy: memberSaver,
  changedAt: "2026-10-06T16:40:00Z",
};

/** The lowest effort, chosen by the viewer. */
export const selfAuditSettings: AuditSettingsResult = {
  state: "ok",
  model: "claude-opus-5-5",
  effort: "low",
  changedBy: selfSaver,
  changedAt: "2026-10-05T09:15:00Z",
};

/** Settings last changed by an account that has since been deleted. */
export const deletedSaverAuditSettings: AuditSettingsResult = {
  state: "ok",
  model: "claude-sonnet-5-5",
  effort: "medium",
  changedBy: deletedSaver,
  changedAt: "2026-10-01T12:00:00Z",
};

/** Whoever changed the settings could not be established: the date stands, nobody is named. */
export const unknownAuthorAuditSettings: AuditSettingsResult = {
  state: "ok",
  model: "claude-opus-5-5",
  effort: "high",
  changedBy: unknownSaver,
  changedAt: "2026-10-02T18:30:00Z",
};

/** A very long address in the signature: it must wrap at 375 px. */
export const longEmailAuditSettings: AuditSettingsResult = {
  state: "ok",
  model: "claude-sonnet-5-5",
  effort: "low",
  changedBy: longEmailSaver,
  changedAt: "2026-10-03T07:05:00Z",
};

/** A failed read: the section renders no form, and never the defaults. */
export const failedAuditSettings: AuditSettingsResult = { state: "error" };
