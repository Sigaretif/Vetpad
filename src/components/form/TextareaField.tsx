import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TextareaFieldProps {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength: number;
  rows?: number;
  /** Marks the field as failing validation; the message itself lives with the form (`describedBy`). */
  invalid?: boolean;
  /** The id of the element that explains the error, set only while `invalid`. */
  describedBy?: string;
}

/**
 * A multi-line field with its label and a character counter against `maxLength`, accessible the
 * way `FormField` is: `aria-invalid` and `aria-describedby` on the control. Pattern: FormField.tsx.
 */
export function TextareaField({
  id,
  name,
  label,
  value,
  onChange,
  maxLength,
  rows = 4,
  invalid,
  describedBy,
}: TextareaFieldProps) {
  return (
    <div>
      <Label htmlFor={id} className="mb-1">
        {label}
      </Label>
      <Textarea
        id={id}
        name={name ?? id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        maxLength={maxLength}
        rows={rows}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid && describedBy ? describedBy : undefined}
        className="min-h-24"
      />
      <p className="text-muted-foreground mt-1 text-right text-xs tabular-nums">
        {value.length} / {maxLength}
      </p>
    </div>
  );
}
