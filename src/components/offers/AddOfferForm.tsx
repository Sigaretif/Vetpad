import React, { useState } from "react";
import { Link, Plus } from "lucide-react";
import { FormField } from "@/components/form/FormField";
import { SubmitButton } from "@/components/form/SubmitButton";
import { ServerError } from "@/components/form/ServerError";
import { usePendingSubmit } from "@/components/form/use-pending-submit";

interface Props {
  serverError?: string | null;
}

export default function AddOfferForm({ serverError }: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | undefined>();
  const { pending, markPending } = usePendingSubmit();

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!url.trim()) {
      e.preventDefault();
      setError("Wklej adres ogłoszenia z otodom.pl");
      return;
    }
    markPending();
  }

  return (
    <form method="POST" action="/api/offers" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="url"
        type="url"
        label="Adres ogłoszenia"
        value={url}
        onChange={(v) => {
          setUrl(v);
          if (error) setError(undefined);
        }}
        placeholder="https://www.otodom.pl/pl/oferta/…"
        error={error}
        icon={<Link className="size-4" />}
      />

      <ServerError message={serverError} />

      <SubmitButton pending={pending} pendingText="Pobieram ogłoszenie…" icon={<Plus className="size-4" />}>
        Dodaj ofertę
      </SubmitButton>
    </form>
  );
}
