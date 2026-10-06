import { defineMiddleware } from "astro:middleware";
import { classifyAuthError } from "@/lib/auth-error";
import { logEvent } from "@/lib/log";
import { type CookieSink, createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard", "/offers", "/criteria"];

/** After an exception Astro renders `500.astro` in a second pass through this middleware. */
const ERROR_ROUTE = "/500";

/** Paths that stay reachable while Auth is down: signing in and signing out. */
function isAuthPath(pathname: string): boolean {
  return pathname === "/auth" || pathname.startsWith("/auth/") || pathname.startsWith("/api/auth/");
}

export const onRequest = defineMiddleware(async (context, next) => {
  // The route's pattern, never the path: it holds no text from the user and no query string.
  const route = context.routePattern;
  const method = context.request.method;
  let userId: string | undefined;

  try {
    if (route === ERROR_ROUTE) {
      // No second question to Auth, no redirect and no rewrite: an outage during this pass would
      // replace the 500 page with the 503 one. The first pass may have thrown before it set the user.
      const user = (context.locals as Partial<App.Locals>).user ?? null;
      context.locals.user = user;
      userId = user?.id;
      return await next();
    }

    // The client's cookie writes wait until the answer is known. After a refresh error it does
    // not retry — a rate limit, a paused project's page — auth-js drops the session and
    // @supabase/ssr writes the cookie's deletion; on an outage that write is thrown away.
    const heldCookies: Parameters<CookieSink["set"]>[] = [];
    let cookieSink: CookieSink | null = null;
    const supabase = createClient(context.request.headers, {
      set(...write) {
        if (cookieSink) cookieSink.set(...write);
        else heldCookies.push(write);
      },
    });
    let authUnavailable = false;

    if (supabase) {
      // getUser() returns an Auth error instead of throwing it — a network failure and a 5xx too.
      const { data, error } = await supabase.auth.getUser();
      context.locals.user = error ? null : data.user;

      if (error) {
        const outcome = classifyAuthError(error);
        if (outcome !== "missing") {
          authUnavailable = outcome === "unavailable";
          logEvent(authUnavailable ? "error" : "info", {
            event: "auth_check",
            outcome,
            route,
            method,
            error_name: error.name,
            auth_status: error.status,
            auth_code: error.code,
          });
        }
      }
    } else {
      context.locals.user = null;
    }
    userId = context.locals.user?.id;

    cookieSink = authUnavailable ? { set: () => undefined } : context.cookies;
    for (const write of heldCookies) cookieSink.set(...write);

    // An outage is not a sign-out: the member gets the 503 page and keeps the cookie. next("/503")
    // rewrites without running this middleware again; neither side may read the request body.
    if (authUnavailable && !isAuthPath(context.url.pathname)) {
      return await next("/503");
    }

    if (context.url.pathname === "/" && context.locals.user) {
      return context.redirect("/dashboard");
    }

    if (PROTECTED_ROUTES.some((protectedRoute) => context.url.pathname.startsWith(protectedRoute))) {
      if (!context.locals.user) {
        return context.redirect("/auth/signin");
      }
    }

    return await next();
  } catch (error) {
    // Astro logs the stack in the same call; this entry adds what the stack does not say.
    logEvent("error", {
      event: "request",
      outcome: "unhandled",
      route,
      method,
      user_id: userId,
      error_name: error instanceof Error ? error.name : "NonError",
    });
    throw error;
  }
});
