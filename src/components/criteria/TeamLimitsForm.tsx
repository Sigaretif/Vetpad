import React, { useId, useState } from "react";
import { Banknote, Eraser, MapPin, Ruler, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/form/FormField";
import { ServerError } from "@/components/form/ServerError";
import { SubmitButton } from "@/components/form/SubmitButton";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import { LIMIT_FIELDS, parseLimitsForm, type LimitField, type LimitsFormValues, type TeamLimits } from "@/lib/criteria";

interface Props {
  /** The limits as stored: the form opens with them, so saving without a change keeps them as they are. */
  limits: TeamLimits;
  /** A failed save or clear, from the page's `?error=`. */
  serverError?: string | null;
}

type FieldErrors = Partial<Record<LimitField, string>>;

const NO_VALUES: LimitsFormValues = { city: "", price_min: "", price_max: "", area_min: "" };

const CLEAR_CONFIRMATION = "Wyczyścić wszystkie limity zespołu? Zmiana dotyczy całego zespołu.";

/** 850000 → „850 000", with a plain space: the parser drops every space, so it reads back the same. */
function groupThousands(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** A stored limit as the parser takes it back, so an unchanged save writes the same values. */
function initialValues(limits: TeamLimits): LimitsFormValues {
  return {
    city: limits.city ?? "",
    price_min: limits.priceMin === null ? "" : groupThousands(limits.priceMin),
    price_max: limits.priceMax === null ? "" : groupThousands(limits.priceMax),
    area_min: limits.areaMin === null ? "" : String(limits.areaMin).replace(".", ","),
  };
}

/**
 * Each field's own error, from the same parser the route runs: every field is parsed alone, and
 * only when all of them pass is the reversed price range reported — on „Cena od", which it names.
 */
function fieldErrors(values: LimitsFormValues): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of LIMIT_FIELDS) {
    const parsed = parseLimitsForm({ ...NO_VALUES, [field]: values[field] });
    if (!parsed.ok) errors[field] = parsed.error;
  }
  if (Object.keys(errors).length === 0) {
    const parsed = parseLimitsForm(values);
    if (!parsed.ok) errors.price_min = parsed.error;
  }
  return errors;
}

/**
 * The team's shared limits (FR-002): four optional fields saved through `POST /api/criteria` (a
 * native POST, so it also works with JavaScript off), and „Wyczyść limity", which sends
 * `intent=clear` after a confirmation. Empty means no limit. Ids come from `useId()` because the
 * kitchen sinks render several forms on one page.
 */
export default function TeamLimitsForm({ limits, serverError }: Props) {
  const [values, setValues] = useState<LimitsFormValues>(() => initialValues(limits));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [clearing, setClearing] = useState(false);
  const { pending, markPending } = usePendingSubmit();

  const baseId = useId();
  const fieldId = (field: LimitField) => `${baseId}-${field}`;

  function change(field: LimitField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    // Clearing writes four nulls, whatever the fields hold: nothing to validate.
    const isClear = e.nativeEvent.submitter?.getAttribute("value") === "clear";
    if (!isClear) {
      const next = fieldErrors(values);
      if (Object.keys(next).length > 0) {
        e.preventDefault();
        setErrors(next);
        return;
      }
    }
    setClearing(isClear);
    markPending();
  }

  function confirmClear(e: React.MouseEvent<HTMLButtonElement>) {
    if (!window.confirm(CLEAR_CONFIRMATION)) e.preventDefault();
  }

  const field = (name: LimitField) => ({
    id: fieldId(name),
    name,
    value: values[name],
    onChange: (value: string) => {
      change(name, value);
    },
    error: errors[name],
  });

  return (
    <form method="POST" action="/api/criteria" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField {...field("city")} label="Miasto" placeholder="np. Warszawa" icon={<MapPin className="size-4" />} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          {...field("price_min")}
          label="Cena od (zł)"
          inputMode="numeric"
          placeholder="np. 600 000"
          icon={<Banknote className="size-4" />}
        />
        <FormField
          {...field("price_max")}
          label="Cena do (zł)"
          inputMode="numeric"
          placeholder="np. 900 000"
          icon={<Banknote className="size-4" />}
        />
      </div>
      <FormField
        {...field("area_min")}
        label="Minimalny metraż (m²)"
        inputMode="decimal"
        placeholder="np. 45"
        icon={<Ruler className="size-4" />}
      />
      <p className="text-muted-foreground text-xs">Puste pole oznacza brak limitu.</p>

      <ServerError message={serverError} />

      {/* „Zapisz limity" comes first: Enter in a field submits with the form's first submit button. */}
      <div className="flex flex-col gap-2">
        <SubmitButton
          pending={pending}
          pendingText={clearing ? "Czyszczę limity…" : "Zapisuję…"}
          icon={<Save className="size-4" />}
        >
          Zapisz limity
        </SubmitButton>
        <Button type="submit" name="intent" value="clear" variant="outline" onClick={confirmClear} disabled={pending}>
          <Eraser />
          Wyczyść limity
        </Button>
      </div>
    </form>
  );
}
