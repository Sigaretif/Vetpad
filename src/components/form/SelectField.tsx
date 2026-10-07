import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface SelectFieldOption {
  value: string;
  /** The option's name: shown in the list and, once chosen, on the trigger. */
  label: string;
  /** What choosing it means, under the name in the list only. */
  hint?: string;
}

interface SelectFieldProps {
  id: string;
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectFieldOption[];
}

/**
 * A closed list with its label, accessible the way `FormField` is: the label names the trigger
 * through `htmlFor`.
 *
 * Radix `Select` is not a native control, so the value a native POST submits travels in a
 * controlled hidden input, as `intent` does in `TeamLimitsForm`. Radix has a field of its own for
 * this — given a `name` inside a `<form>` it renders a visually hidden `<select>` — but fills it
 * with options only from effects (@radix-ui/react-select 2.3.8, `SelectBubbleInput`): in the
 * server's HTML that select is empty, and a form submitted before the island hydrates, or with
 * JavaScript off, would carry no value at all. The hidden input holds the stored value from the
 * first byte, so such a submit saves what was already there. Radix gets no `name`, and its own
 * select stays out of the form data.
 *
 * The chosen option's name is passed to `SelectValue` as its child for the same reason: left to
 * itself, Radix copies it from the list only after hydration, and the server-rendered trigger
 * would be empty. Pattern: FormField.tsx.
 */
export function SelectField({ id, name, label, value, onChange, options }: SelectFieldProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <div>
      <Label htmlFor={id} className="mb-1">
        {label}
      </Label>
      <input type="hidden" name={name ?? id} value={value} />
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{selected?.label ?? value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="flex flex-col gap-0.5">
                <span>{option.label}</span>
                {option.hint ? <span className="text-muted-foreground text-xs">{option.hint}</span> : null}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
