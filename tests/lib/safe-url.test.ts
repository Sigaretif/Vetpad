import { describe, expect, it } from "vitest";
import { safeHttpsUrl } from "@/lib/safe-url";

describe("safeHttpsUrl", () => {
  it.each(["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:alert(1)"])(
    "refuses the script URL %j",
    (url) => {
      expect(safeHttpsUrl(url)).toBeNull();
    },
  );

  it.each(["data:text/html,x", "http://x.pl", "//x.pl"])("refuses the non-https URL %j", (url) => {
    expect(safeHttpsUrl(url)).toBeNull();
  });

  it.each(["", null, 42, {}, "https//x"])("refuses %j, which is not an absolute URL", (url) => {
    expect(safeHttpsUrl(url)).toBeNull();
  });

  it("returns an https URL normalised by the parser", () => {
    expect(safeHttpsUrl("HTTPS://x.pl/a")).toBe("https://x.pl/a");
    expect(safeHttpsUrl(" https://x.pl")).toBe("https://x.pl/");
  });

  it("keeps an https URL whose path needs encoding", () => {
    expect(safeHttpsUrl("https://x.pl/a b")).toMatch(/^https:\/\//);
  });
});
