import type { APIRoute } from "astro";
import { isAuthRetryableFetchError, type AuthError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";

/** One Polish message per failure reason; Supabase's raw error.message is English and never reaches ?error=. */
function signInErrorMessage(error: AuthError): string {
  if (isAuthRetryableFetchError(error)) {
    return "Serwer logowania nie odpowiada. Spróbuj ponownie za chwilę.";
  }
  switch (error.code) {
    case "invalid_credentials":
      return "Nieprawidłowy e-mail lub hasło.";
    case "over_request_rate_limit":
      return "Zbyt wiele prób logowania. Spróbuj ponownie za kilka minut.";
    case "email_not_confirmed":
    case "user_banned":
      return "To konto jest nieaktywne. Skontaktuj się z administratorem zespołu.";
    default:
      return "Nie udało się zalogować. Spróbuj ponownie.";
  }
}

export const POST: APIRoute = async (context) => {
  let form: FormData;
  try {
    form = await context.request.formData();
  } catch {
    // A body that is not a form (a hand-crafted request) is a failed sign-in, never a 500.
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Nieprawidłowe żądanie logowania.")}`);
  }
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(
      `/auth/signin?error=${encodeURIComponent("Supabase nie jest skonfigurowany — logowanie jest wyłączone.")}`,
    );
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent(signInErrorMessage(error))}`);
  }

  return context.redirect("/");
};
