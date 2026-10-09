import { describe, expect, it } from "vitest";
import {
  AUDIT_BROWSER_LIMIT_MS,
  AUDIT_FAILURE_REASONS,
  AUDIT_HEARTBEAT_MS,
  AUDIT_OUTCOME,
  AUDIT_PROVIDER_DEADLINE_MS,
  AUDIT_STALE_ATTEMPT_MS,
  auditFailureMessage,
  isAuditFailureReason,
} from "@/lib/audit/failure";

// Expected values are written by hand from the Phase 3 contract in
// context/changes/grounded-listing-audit/plan.md („Powody niepowodzenia": the twenty-two reasons,
// one distinguishable message each, the four time constants) and its „Critical Implementation
// Details" (provider deadline < stale threshold < browser limit), and from CLAUDE.md, Conventions
// (a refusal the product expects is `info`, a failure is `error`).

describe("the reasons an audit can end without a result", () => {
  // Written out by hand, in the plan's order.
  it("are the twenty-two the plan names, and `unexpected` after them", () => {
    expect([...AUDIT_FAILURE_REASONS]).toEqual([
      "unconfigured_supabase",
      "unconfigured_provider",
      "invalid_offer",
      "offer_not_found",
      "offer_read_failed",
      "criteria_read_failed",
      "settings_read_failed",
      "busy",
      "claim_failed",
      "provider_auth",
      "provider_credit",
      "provider_rate_limited",
      "provider_unavailable",
      "provider_rejected",
      "provider_refused",
      "provider_truncated",
      "provider_malformed",
      "provider_timeout",
      "provider_network",
      "save_failed",
      "claim_lost",
      "interrupted",
      "unexpected",
    ]);
  });

  it("tells a stored reason it knows from anything else", () => {
    for (const reason of AUDIT_FAILURE_REASONS) expect(isAuditFailureReason(reason)).toBe(true);
    for (const other of [
      "",
      "unknown",
      "BUSY",
      "busy ",
      "provider",
      null,
      undefined,
      5,
      ["busy"],
      { reason: "busy" },
    ]) {
      expect(isAuditFailureReason(other)).toBe(false);
    }
  });
});

describe("auditFailureMessage: one reason, one distinguishable message", () => {
  const messages = AUDIT_FAILURE_REASONS.map((reason) => auditFailureMessage(reason));

  it("gives every reason a sentence of its own", () => {
    expect(new Set(messages).size).toBe(23);
    for (const message of messages) {
      expect(message.trim()).toBe(message);
      expect(message.length).toBeGreaterThan(20);
      expect(message.endsWith(".")).toBe(true);
      expect(message).not.toContain("undefined");
    }
  });

  // No message is the beginning of another: a card showing one can never be read as the other.
  it("gives no reason a message that another one starts with", () => {
    for (const [index, message] of messages.entries()) {
      for (const [otherIndex, other] of messages.entries()) {
        if (index !== otherIndex) expect(other.startsWith(message)).toBe(false);
      }
    }
  });

  it("never names a reason's code in what a member reads", () => {
    for (const message of messages) {
      for (const reason of AUDIT_FAILURE_REASONS) expect(message).not.toContain(reason);
    }
  });

  // A reached spend limit or an empty balance is a billing state, and reads like one.
  it("says that an exhausted balance is a billing state, not a broken audit", () => {
    expect(auditFailureMessage("provider_credit")).toBe(
      "Konto u dostawcy modelu nie ma środków albo osiągnęło limit wydatków. To stan rozliczeń, a nie usterka audytu — po doładowaniu konta lub podniesieniu limitu uruchom audyt ponownie.",
    );
  });

  it("says that an audit of the offer is already running, and that no second one was started", () => {
    expect(auditFailureMessage("busy")).toBe(
      "Audyt tej oferty już trwa. Drugi nie został uruchomiony — poczekaj na wynik i odśwież kartę.",
    );
  });

  // Two causes share the reason: a read the database failed, which passes, and a stored row that
  // does not read as an offer, which lasts until the row is fixed. The sentence is true for both.
  it("names both causes of an offer that could not be read, and promises nothing about a moment", () => {
    const message = auditFailureMessage("offer_read_failed");

    expect(message).toBe(
      "Nie udało się odczytać danych tej oferty — baza danych nie odpowiedziała albo zapisane dane oferty są nieczytelne. Audyt nie został uruchomiony; jeśli kolejna próba skończy się tak samo, dane tej oferty trzeba poprawić.",
    );
    expect(message).not.toContain("za chwilę");
    // The control: a read that only fails for a while does say so.
    expect(auditFailureMessage("criteria_read_failed")).toContain("za chwilę");
  });

  // `interrupted` is the card's word for an earlier attempt whose request is gone. The route's own
  // unexpected end is about the attempt the member has just started, and must not read as that.
  it("tells an unexpected end of this attempt from an interrupted earlier one", () => {
    expect(auditFailureMessage("unexpected")).toBe(
      "Audyt przerwał nieoczekiwany błąd aplikacji, zanim zapisał wynik. Możesz uruchomić audyt ponownie.",
    );
    expect(auditFailureMessage("unexpected")).not.toContain("Poprzednia");
  });

  it("says that an interrupted attempt can be run again", () => {
    expect(auditFailureMessage("interrupted")).toBe(
      "Poprzednia próba audytu została przerwana, zanim zapisała wynik. Możesz uruchomić audyt ponownie.",
    );
  });

  it("names the 165 seconds the model was given", () => {
    expect(auditFailureMessage("provider_timeout")).toBe(
      "Model nie odpowiedział w ciągu 165 sekund. Audyt został przerwany — spróbuj ponownie.",
    );
  });

  // The member has to know before retrying: the model has already been paid for once.
  it("warns that running the audit again after a failed save is a new paid call", () => {
    expect(auditFailureMessage("save_failed")).toBe(
      "Model odpowiedział, ale wyniku nie udało się zapisać w bazie danych. Ponowne uruchomienie to nowe, płatne zapytanie do modelu.",
    );
  });

  it("tells the two missing configurations apart", () => {
    expect(auditFailureMessage("unconfigured_supabase")).toBe(
      "Supabase nie jest skonfigurowany — nie można uruchomić audytu.",
    );
    expect(auditFailureMessage("unconfigured_provider")).toBe(
      "Audyt AI jest wyłączony — aplikacja nie ma klucza dostawcy modelu.",
    );
  });
});

describe("AUDIT_OUTCOME: a refusal the product expects, or a failure somebody has to look at", () => {
  // Written out by hand. Refused: turned away before anything was spent, for a reason the
  // product provides for. Everything else is a failure.
  it("sorts every reason", () => {
    expect(AUDIT_OUTCOME).toEqual({
      unconfigured_supabase: "refused",
      unconfigured_provider: "refused",
      invalid_offer: "refused",
      offer_not_found: "refused",
      offer_read_failed: "failed",
      criteria_read_failed: "failed",
      settings_read_failed: "failed",
      busy: "refused",
      claim_failed: "failed",
      provider_auth: "failed",
      provider_credit: "failed",
      provider_rate_limited: "failed",
      provider_unavailable: "failed",
      provider_rejected: "failed",
      provider_refused: "failed",
      provider_truncated: "failed",
      provider_malformed: "failed",
      provider_timeout: "failed",
      provider_network: "failed",
      save_failed: "failed",
      claim_lost: "failed",
      interrupted: "failed",
      unexpected: "failed",
    });
  });

  it("has an entry for every reason and for nothing else", () => {
    expect(Object.keys(AUDIT_OUTCOME).sort()).toEqual([...AUDIT_FAILURE_REASONS].sort());
  });
});

describe("the time limits of one audit attempt", () => {
  it("are 165 s for the model, 175 s for a stale attempt, 180 s for the browser, and a sign of life every 5 s", () => {
    expect(AUDIT_PROVIDER_DEADLINE_MS).toBe(165_000);
    // The same 175 seconds as `interval '175 seconds'` in
    // supabase/migrations/20261007073300_create_offer_audits.sql.
    expect(AUDIT_STALE_ATTEMPT_MS).toBe(175_000);
    expect(AUDIT_BROWSER_LIMIT_MS).toBe(180_000);
    expect(AUDIT_HEARTBEAT_MS).toBe(5_000);
  });

  // A live request never loses its row before its own deadline, and a card reloaded at the
  // browser's limit already reads the attempt as interrupted.
  it("stand in the order provider deadline < stale threshold < browser limit", () => {
    expect(AUDIT_PROVIDER_DEADLINE_MS).toBeLessThan(AUDIT_STALE_ATTEMPT_MS);
    expect(AUDIT_STALE_ATTEMPT_MS).toBeLessThan(AUDIT_BROWSER_LIMIT_MS);
  });

  it("keep the whole attempt within the three minutes the PRD allows", () => {
    expect(AUDIT_BROWSER_LIMIT_MS).toBeLessThanOrEqual(3 * 60 * 1000);
  });
});
