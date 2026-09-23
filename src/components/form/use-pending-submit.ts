import { useEffect, useState } from "react";

/** Shared submitting state for a native-POST form (pattern: AddOfferForm.tsx). */
export function usePendingSubmit() {
  const [pending, setPending] = useState(false);

  // Coming back through the browser's back/forward cache restores the page mid-submit; unlock the button.
  useEffect(() => {
    function handlePageShow() {
      setPending(false);
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  function markPending() {
    setPending(true);
  }

  return { pending, markPending };
}
