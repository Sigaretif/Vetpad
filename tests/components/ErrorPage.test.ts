import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { loadRenderers } from "astro:container";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeAll, describe, expect, it } from "vitest";
import ErrorPage from "@/components/ErrorPage.astro";

// The contract `scripts/smoke.mjs` and the middleware rely on: the `data-error-page` marker, the
// heading and where each link goes. Expected values are written by hand from the
// auth-outage-not-signed-out plan (Phase 2, „Komponent widoku”), never copied from the output.

const OFFER = "/offers/8360a2e2-264f-48ab-aaaf-894984275c42";

let container: AstroContainer;

beforeAll(async () => {
  // The view renders the React `Card` server-side, so the container needs the React renderer.
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

// A tag up to its closing `>`, stepping over quoted attribute values: `buttonVariants` puts a
// literal `>` inside the class attribute (`has-[>svg]:px-3`).
const TAG = /<(?:[^>"]|"[^"]*")*>/g;

/** Tags stripped and every run of whitespace collapsed into one space. */
function textOf(html: string): string {
  return html.replace(TAG, " ").replace(/\s+/g, " ").trim();
}

function headingsIn(html: string): string[] {
  return Array.from(html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi), (match) => textOf(match[1]));
}

/** Every link as `[visible text, href]`, in document order. */
function linksIn(html: string): [string, string][] {
  const links = Array.from(
    html.matchAll(/<a\b(?:[^>"]|"[^"]*")*?\shref="([^"]*)"(?:[^>"]|"[^"]*")*>([\s\S]*?)<\/a>/gi),
    (match): [string, string] => [textOf(match[2]), match[1]],
  );
  // Guards the extraction: a link the pattern cannot read fails the test instead of going missing.
  expect(links).toHaveLength(html.match(/<a\b/gi)?.length ?? 0);
  return links;
}

function markersIn(html: string): string[] {
  return Array.from(html.matchAll(/\sdata-error-page="([^"]*)"/gi), (match) => match[1]);
}

describe("ErrorPage: the 503 view of an Auth outage", () => {
  it("carries its marker, its heading and both links, the first one to the given retry target", async () => {
    const html = await container.renderToString(ErrorPage, { props: { variant: "503", retryHref: OFFER } });

    expect(markersIn(html)).toEqual(["503"]);
    expect(headingsIn(html)).toEqual(["Nie możemy teraz potwierdzić Twojej sesji"]);
    expect(textOf(html)).toContain(
      "Usługa logowania chwilowo nie odpowiada. To nie jest wylogowanie — spróbuj ponownie za chwilę.",
    );
    expect(linksIn(html)).toEqual([
      ["Spróbuj ponownie", OFFER],
      ["Przejdź do logowania", "/auth/signin"],
    ]);
  });

  it("follows the retry target it is given", async () => {
    const html = await container.renderToString(ErrorPage, { props: { variant: "503", retryHref: "/criteria" } });

    expect(linksIn(html)).toEqual([
      ["Spróbuj ponownie", "/criteria"],
      ["Przejdź do logowania", "/auth/signin"],
    ]);
  });
});

describe("ErrorPage: the 500 view of an unexpected error", () => {
  it("carries its marker, its heading and the one link back to the board", async () => {
    const html = await container.renderToString(ErrorPage, { props: { variant: "500" } });

    expect(markersIn(html)).toEqual(["500"]);
    expect(headingsIn(html)).toEqual(["Coś poszło nie tak"]);
    expect(textOf(html)).toContain(
      "Vetpad napotkał nieoczekiwany błąd. Spróbuj ponownie za chwilę. Jeśli to było zapisywanie, sprawdź najpierw, czy zmiana już jest na miejscu.",
    );
    expect(linksIn(html)).toEqual([["Wróć do listy ofert", "/dashboard"]]);
  });

  it("has no retry link, whatever retry target it is given", async () => {
    const html = await container.renderToString(ErrorPage, { props: { variant: "500", retryHref: OFFER } });

    expect(linksIn(html)).toEqual([["Wróć do listy ofert", "/dashboard"]]);
  });
});
