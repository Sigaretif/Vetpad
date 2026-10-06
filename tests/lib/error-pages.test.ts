import { describe, expect, it } from "vitest";
import { retryHref } from "@/lib/error-pages";

// Expected values are written by hand from the contract in the auth-outage-not-signed-out plan
// (Phase 2, „Cel linku »Spróbuj ponownie«”) — never copied from what the function returns. Every
// refused path stands beside one the same condition lets through: alone, it would pass on a
// function that always answers "/".

const OFFER = "/offers/8360a2e2-264f-48ab-aaaf-894984275c42";

describe("retryHref: the 503 page links back to where the member was going", () => {
  it.each(["/dashboard", OFFER, "/criteria"])("returns the path %j of a GET request", (pathname) => {
    expect(retryHref("GET", pathname)).toBe(pathname);
  });

  it("returns the home page for a GET of the home page", () => {
    expect(retryHref("GET", "/")).toBe("/");
  });
});

describe("retryHref: only a GET can be repeated by following a link", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])("sends a %s to the home page", (method) => {
    expect(retryHref(method, "/dashboard")).toBe("/");
    expect(retryHref(method, OFFER)).toBe("/");
    expect(retryHref("GET", "/dashboard")).toBe("/dashboard");
    expect(retryHref("GET", OFFER)).toBe(OFFER);
  });
});

describe("retryHref: never the 503 page itself, never an API route", () => {
  it("sends the 503 page's own address to the home page", () => {
    expect(retryHref("GET", "/503")).toBe("/");
    expect(retryHref("GET", "/dashboard")).toBe("/dashboard");
  });

  // Astro hands `Astro.originPathname` over with a trailing slash under this app's config
  // (`trailingSlash: "ignore"`, directory build format): a visit to /503 arrives as "/503/".
  it("sends the 503 page's own address with a trailing slash to the home page", () => {
    expect(retryHref("GET", "/503/")).toBe("/");
    expect(retryHref("GET", "/dashboard/")).toBe("/dashboard/");
  });

  it("keeps a path that only begins like /503", () => {
    expect(retryHref("GET", "/5030")).toBe("/5030");
    expect(retryHref("GET", "/503/x")).toBe("/503/x");
  });

  it.each(["/api/offers", "/api/auth/signout", "/api/"])("sends the API path %j to the home page", (pathname) => {
    expect(retryHref("GET", pathname)).toBe("/");
    expect(retryHref("GET", OFFER)).toBe(OFFER);
  });

  it("keeps a path that only begins like /api/", () => {
    expect(retryHref("GET", "/apiary")).toBe("/apiary");
  });
});

describe("retryHref: never a target outside the app", () => {
  // `//host` and `/\host` are protocol-relative in a browser.
  it.each(["//evil.example", "//evil.example/dashboard", "//"])(
    "sends %j, which begins with two slashes, to the home page",
    (pathname) => {
      expect(retryHref("GET", pathname)).toBe("/");
      expect(retryHref("GET", "/dashboard")).toBe("/dashboard");
    },
  );

  it.each(["/\\evil.example", "\\\\evil.example", "/offers\\x", "/dashboard\\"])(
    "sends %j, which holds a backslash, to the home page",
    (pathname) => {
      expect(retryHref("GET", pathname)).toBe("/");
      expect(retryHref("GET", OFFER)).toBe(OFFER);
    },
  );
});
