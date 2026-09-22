import React, { useEffect, useState } from "react";
import { Link, Plus } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

export default function AddOfferForm({ serverError }: Props) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  // Coming back through the browser's back/forward cache restores the page mid-submit; unlock the button.
  useEffect(() => {
    function handlePageShow() {
      setSubmitting(false);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!url.trim()) {
      e.preventDefault();
      setError("Wklej adres ogłoszenia z otodom.pl");
      return;
    }
    setSubmitting(true);
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

      <SubmitButton pending={submitting} pendingText="Pobieram ogłoszenie…" icon={<Plus className="size-4" />}>
        Dodaj ofertę
      </SubmitButton>
    </form>
  );
}
