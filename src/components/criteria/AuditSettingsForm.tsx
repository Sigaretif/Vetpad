import { useId, useState } from "react";
import { Save } from "lucide-react";
import { SelectField, type SelectFieldOption } from "@/components/form/SelectField";
import { ServerError } from "@/components/form/ServerError";
import { SubmitButton } from "@/components/form/SubmitButton";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import {
  AUDIT_EFFORTS,
  AUDIT_EFFORT_LABELS,
  AUDIT_MODELS,
  AUDIT_MODEL_LABELS,
  type AuditSettings,
  type AuditSettingsField,
  type AuditSettingsFormValues,
} from "@/lib/audit/settings";

interface Props {
  /** The settings as stored: the form opens with them, so saving without a change keeps them and their signature. */
  settings: AuditSettings;
  /** A failed save, from the page's `?error=`. */
  serverError?: string | null;
}

const MODEL_OPTIONS: SelectFieldOption[] = AUDIT_MODELS.map((model) => ({
  value: model,
  label: AUDIT_MODEL_LABELS[model].name,
  hint: AUDIT_MODEL_LABELS[model].hint,
}));

const EFFORT_OPTIONS: SelectFieldOption[] = AUDIT_EFFORTS.map((effort) => ({
  value: effort,
  label: AUDIT_EFFORT_LABELS[effort].name,
  hint: AUDIT_EFFORT_LABELS[effort].hint,
}));

/**
 * The team's audit settings (FR-010): the model and the reasoning effort, each chosen from a
 * closed list and saved through `POST /api/audit-settings` as a native POST. The two lists are
 * Radix selects, which submit through the hidden input `SelectField` describes — so the form has
 * nothing to validate: every value it can hold is on the list the route checks again, and before
 * the island hydrates it submits the stored values. One action, so no `intent` field, and the
 * button disabled on submit takes nothing out of the form data. Ids come from `useId()` because
 * the kitchen sinks render several forms on one page.
 */
export default function AuditSettingsForm({ settings, serverError }: Props) {
  const [values, setValues] = useState<AuditSettingsFormValues>({ model: settings.model, effort: settings.effort });
  const { pending, markPending } = usePendingSubmit();

  const baseId = useId();

  const field = (name: AuditSettingsField) => ({
    id: `${baseId}-${name}`,
    name,
    value: values[name],
    onChange: (value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));
    },
  });

  return (
    <form method="POST" action="/api/audit-settings" className="space-y-4" onSubmit={markPending}>
      <ServerError message={serverError} />

      <SelectField {...field("model")} label="Model" options={MODEL_OPTIONS} />
      <SelectField {...field("effort")} label="Poziom rozumowania" options={EFFORT_OPTIONS} />
      <p className="text-muted-foreground text-xs">
        Zmiana dotyczy następnych audytów. Audyty już wykonane zostają bez zmian i nie są oznaczane jako nieaktualne.
      </p>

      <SubmitButton pending={pending} pendingText="Zapisywanie…" icon={<Save className="size-4" />}>
        Zapisz ustawienia
      </SubmitButton>
    </form>
  );
}
