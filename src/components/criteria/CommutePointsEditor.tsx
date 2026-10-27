import React, { useEffect, useId, useRef, useState } from "react";
import { MapPin, Pencil, Plus, Save, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/form/FormField";
import { ServerError } from "@/components/form/ServerError";
import { SubmitButton } from "@/components/form/SubmitButton";
import { usePendingSubmit } from "@/components/form/use-pending-submit";
import DeletePointForm from "@/components/criteria/DeletePointForm";
import {
  COMMUTE_POINTS_MAX,
  type CommutePoint,
  type CommutePointField,
  type CommutePointValues,
  commutePointErrors,
} from "@/lib/commute/points";

interface Props {
  /** The team's points, oldest first, from a successful read. */
  points: CommutePoint[];
  /** A failed save or delete, from the page's `?error=…&form=points`. */
  serverError?: string | null;
  /** For the /dev kitchen sinks alone: the point whose edit form is open on the first render. */
  editingId?: string | null;
}

interface PointFormProps {
  /** The point to change, or `null` for the form that adds one. */
  point: CommutePoint | null;
  /** The ids of the form's two fields, so the editor can move focus into it. */
  nameId: string;
  addressId: string;
  headingId: string;
  /** „Anuluj" of an edit form; the add form has none. */
  onCancel?: () => void;
}

type FieldErrors = Partial<Record<CommutePointField, string>>;

/**
 * One point's fields, saved through `POST /api/commute-points` (a native POST, so it also works with
 * JavaScript off). `id` is empty for a new point. The intent travels in a hidden field the form
 * renders itself, never only on the submit button: the button is disabled on submit, and Firefox
 * leaves a disabled submitter out of the form data (`TeamLimitsForm.tsx` is the reference).
 */
function PointForm({ point, nameId, addressId, headingId, onCancel }: PointFormProps) {
  const [values, setValues] = useState<CommutePointValues>({ name: point?.name ?? "", address: point?.address ?? "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const { pending, markPending } = usePendingSubmit();

  function change(field: CommutePointField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    // Checked as the route will store it: both fields trimmed.
    const next = commutePointErrors(values);
    if (Object.keys(next).length > 0) {
      e.preventDefault();
      setErrors(next);
      return;
    }
    markPending();
  }

  return (
    <form
      method="POST"
      action="/api/commute-points"
      className="space-y-4"
      aria-labelledby={headingId}
      onSubmit={handleSubmit}
      noValidate
    >
      <input type="hidden" name="intent" value="save" />
      <input type="hidden" name="id" value={point?.id ?? ""} />

      <FormField
        id={nameId}
        name="name"
        label="Nazwa"
        value={values.name}
        onChange={(value) => {
          change("name", value);
        }}
        placeholder="np. Praca Ani"
        error={errors.name}
        icon={<Tag className="size-4" />}
      />
      <FormField
        id={addressId}
        name="address"
        label="Adres"
        value={values.address}
        onChange={(value) => {
          change("address", value);
        }}
        placeholder="np. ul. Prosta 20, Warszawa"
        error={errors.address}
        hint={
          <p className="text-muted-foreground mt-1 text-xs">
            Ulica z numerem i miasto — Google szuka dokładnie tego, co tu wpiszesz.
          </p>
        }
        icon={<MapPin className="size-4" />}
      />

      <div className="flex flex-col gap-2">
        <SubmitButton
          pending={pending}
          pendingText="Zapisuję…"
          icon={point ? <Save className="size-4" /> : <Plus className="size-4" />}
        >
          {point ? "Zapisz punkt" : "Dodaj punkt"}
        </SubmitButton>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            Anuluj
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * The team's commute points (FR-016): a card per point with „Edytuj" (an inline form) and „Usuń"
 * (a confirmation, `DeletePointForm`), and below them the form that adds a point while the team has
 * fewer than six. Any member changes any point. Names and addresses are rendered as text. Ids come
 * from `useId()` because the kitchen sinks render several editors on one page. Pattern:
 * `RequirementsEditor.tsx`, without its `window.confirm`.
 */
export default function CommutePointsEditor({ points, serverError, editingId = null }: Props) {
  const [editing, setEditing] = useState<string | null>(editingId);

  const baseId = useId();
  const ids = (key: string) => ({
    nameId: `${baseId}-${key}-name`,
    addressId: `${baseId}-${key}-address`,
    headingId: `${baseId}-${key}-heading`,
    editId: `${baseId}-${key}-edit`,
  });

  // Switching a card to its form replaces the DOM, so focus would fall to <body>: move it to where
  // the member is going — the name field after „Edytuj", back to „Edytuj" after „Anuluj". Not on
  // the first render.
  const focusAfterSwitch = useRef<string | null>(null);
  useEffect(() => {
    const target = focusAfterSwitch.current;
    if (target === null) return;
    focusAfterSwitch.current = null;
    document.getElementById(target)?.focus();
  }, [editing]);

  function startEdit(point: CommutePoint) {
    focusAfterSwitch.current = ids(point.id).nameId;
    setEditing(point.id);
  }

  function cancel(point: CommutePoint) {
    focusAfterSwitch.current = ids(point.id).editId;
    setEditing(null);
  }

  const full = points.length >= COMMUTE_POINTS_MAX;
  const add = ids("new");

  return (
    <div className="flex flex-col gap-4">
      <ServerError message={serverError} />

      {points.length > 0 ? (
        <ol className="flex flex-col gap-4" aria-label="Punkty dojazdu zespołu">
          {points.map((point) => {
            const pointIds = ids(point.id);
            return (
              <li key={point.id} data-commute-point={point.id}>
                {editing === point.id ? (
                  <Card className="gap-4">
                    <CardHeader>
                      <h3 id={pointIds.headingId} className="leading-snug font-semibold wrap-anywhere">
                        Zmień punkt
                      </h3>
                    </CardHeader>
                    <CardContent>
                      <PointForm
                        point={point}
                        nameId={pointIds.nameId}
                        addressId={pointIds.addressId}
                        headingId={pointIds.headingId}
                        onCancel={() => {
                          cancel(point);
                        }}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="gap-4">
                    <CardHeader>
                      <h3 className="leading-snug font-semibold wrap-anywhere">{point.name}</h3>
                      <CardDescription className="wrap-anywhere">{point.address}</CardDescription>
                      <CardAction>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            id={pointIds.editId}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              startEdit(point);
                            }}
                          >
                            <Pencil />
                            Edytuj
                          </Button>
                          <DeletePointForm pointId={point.id} pointName={point.name} />
                        </div>
                      </CardAction>
                    </CardHeader>
                  </Card>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-muted-foreground text-sm">Zespół nie dodał jeszcze żadnego punktu.</p>
      )}

      {full ? (
        <p className="text-muted-foreground text-sm" data-commute-points-full>
          Zespół ma już {COMMUTE_POINTS_MAX} punktów — to limit. Usuń któryś, żeby dodać nowy.
        </p>
      ) : (
        <Card className="gap-4">
          <CardHeader>
            <h3 id={add.headingId} className="leading-snug font-semibold">
              Dodaj punkt
            </h3>
            <CardDescription>
              Miejsce, do którego zespół liczy dojazdy z ofert — najwyżej {COMMUTE_POINTS_MAX}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PointForm point={null} nameId={add.nameId} addressId={add.addressId} headingId={add.headingId} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
