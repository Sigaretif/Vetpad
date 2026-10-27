import { fixupPluginRules } from "@eslint/compat";
import eslint from "@eslint/js";
import { defineConfig, globalIgnores, includeIgnoreFile } from "eslint/config";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import eslintPluginAstro from "eslint-plugin-astro";
import pluginReact from "eslint-plugin-react";
import eslintPluginReactHooks from "eslint-plugin-react-hooks";
import path from "node:path";
import tseslint from "typescript-eslint";

// eslint-plugin-react still uses context APIs removed in ESLint 10; wrap it until it ships native support.
const reactPlugin = fixupPluginRules(pluginReact);

const gitignorePath = path.resolve(import.meta.dirname, ".gitignore");

const baseConfig = defineConfig({
  extends: [eslint.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    "no-console": "warn",
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],
    "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
  },
});

const reactConfig = defineConfig({
  files: ["**/*.{js,jsx,ts,tsx}"],
  extends: [eslintPluginReactHooks.configs.flat["recommended-latest"]],
  plugins: { react: reactPlugin },
  languageOptions: {
    ...pluginReact.configs.flat.recommended.languageOptions,
    globals: {
      window: true,
      document: true,
    },
  },
  settings: { react: { version: "detect" } },
  rules: {
    ...pluginReact.configs.flat.recommended.rules,
    "react/react-in-jsx-scope": "off",
  },
});

const astroConfig = defineConfig({
  files: ["**/*.astro"],
  languageOptions: {
    // astro-eslint-parser does not support projectService yet and warns on every file; hand it a project path instead.
    parserOptions: { projectService: false, project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
  },
  rules: {
    "astro/no-set-html-directive": "error",
    "astro/no-unused-css-selector": "warn",
    "astro/prefer-class-list-directive": "warn",
  },
});

// Views take colours from the tokens in src/styles/global.css (CLAUDE.md, "### UI"): a Tailwind
// palette utility, an arbitrary hex colour, bg-cosmic or backdrop-blur in a class string is a bug.
// border(?:-(?:[trblxyse]|b[se]))? also catches physical and logical side borders (border-t-white,
// border-s-white, border-bs-white). The palette list is Tailwind 4.3's, mauve/olive/mist/taupe
// included. The arbitrary group catches hex, colour functions and white/black inside [...],
// with or without a color: hint. A role token named after a palette word (bg-red-flag) is
// rejected too — name new tokens by role, not by hue.
const COLOUR_LITERAL =
  "/\\b(?:bg|text|border(?:-(?:[trblxyse]|b[se]))?|ring(?:-offset)?|outline|fill|stroke|from|via|to|shadow|decoration|divide|placeholder|caret|accent)-(?:white|black|slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\\b|-\\[(?:color:)?(?:#|rgba?\\(|hsla?\\(|okl(?:ch|ab)\\(|l(?:ab|ch)\\(|hwb\\(|color-mix\\(|white\\]|black\\])|\\bbg-cosmic\\b|\\bbackdrop-blur/";
const COLOUR_MESSAGE =
  "Colour literal in a class string. Use a role token from src/styles/global.css (bg-card, text-muted-foreground, text-link, …) — CLAUDE.md, ### UI.";
// Narrowed to the style attribute: a bare hex/rgba() regex over any string would also catch
// anchors like href="#add".
const STYLE_COLOUR = "/rgba?\\(|hsla?\\(|okl(?:ch|ab)\\(|l(?:ab|ch)\\(|hwb\\(|color-mix\\(|#[0-9a-fA-F]{3,8}\\b/";
const tokensOnlyConfig = defineConfig({
  files: ["src/**/*.{astro,ts,tsx}"],
  // Every view is on tokens. Nothing is ever added here again — a lint error is fixed with a token.
  ignores: [],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: `Literal[value=${COLOUR_LITERAL}]`, message: COLOUR_MESSAGE },
      { selector: `TemplateElement[value.raw=${COLOUR_LITERAL}]`, message: COLOUR_MESSAGE },
      { selector: `JSXAttribute[name.name="style"] Literal[value=${STYLE_COLOUR}]`, message: COLOUR_MESSAGE },
      {
        selector: `JSXAttribute[name.name="style"] TemplateElement[value.raw=${STYLE_COLOUR}]`,
        message: COLOUR_MESSAGE,
      },
    ],
  },
});

// src/lib/log.ts is the one way out to the console under src/: its whitelist decides what a log
// entry can hold, so a console call anywhere else is a way around it.
const consoleConfig = defineConfig(
  { files: ["src/**/*.{astro,ts,tsx}"], rules: { "no-console": "error" } },
  { files: ["src/lib/log.ts"], rules: { "no-console": "off" } },
);

// Members' notes never leave the system (prd.md, Non-Functional Requirements), and row-level
// security cannot hold that line: every signed-in member may read every note. So the structure of
// the code holds it — the audit, the only code that talks to the model provider, cannot import the
// notes module. The regex takes the module by any path: the alias (@/lib/notes), a relative one
// (../notes, ../../lib/notes) and either with a file extension. src/pages/api/audits.ts is named
// before it exists, so the rule binds the moment the file is created.
// The same block keeps the team's commute points away from the model provider (prd.md, FR-016): a
// point's address goes only to Google Routes, and the audit reads its criteria through
// `loadAuditCriteria` alone. Its second pattern rejects every module under src/lib/commute/ — the
// points module, `@/lib/commute/points`, first among them — by the alias or a relative path. Both
// patterns live in this one block: a second block over the same files would replace this one's
// options rather than add to them. refetchNoNotesConfig,
// archiveNoNotesConfig, deleteNoNotesConfig, paidServiceServerOnlyConfig and commuteNoNotesConfig
// below are the only other blocks that set no-restricted-imports, for files this one does not cover; a block whose files overlap any of them must merge the patterns, since flat config replaces a rule's
// options rather than adding to them.
const auditNoNotesConfig = defineConfig({
  files: ["src/lib/audit/**", "src/pages/api/audits.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "(?:^|/)notes(?:\\.[cm]?[jt]sx?)?$",
            message:
              "The audit must not import the notes module: members' notes never reach the model provider (CLAUDE.md, Secrets and data access).",
          },
          {
            regex: "(?:^|/)commute/",
            message:
              "The audit must not import the commute modules: a commute point's address never reaches the model provider (prd.md, FR-016).",
          },
        ],
      },
    ],
  },
});

// Human-authored notes are never overwritten by machine action (CLAUDE.md, Product invariants): a
// re-fetch replaces scraped listing data only. The re-fetch route and its rules get the same
// structural guard as the audit — they cannot import the notes module, by any path.
const refetchNoNotesConfig = defineConfig({
  files: ["src/pages/api/offer-refetch.ts", "src/lib/offer-refetch.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "(?:^|/)notes(?:\\.[cm]?[jt]sx?)?$",
            message:
              "A re-fetch must not import the notes module: human-authored notes are never overwritten by machine action (CLAUDE.md, Product invariants).",
          },
        ],
      },
    ],
  },
});

// Archiving and restoring an offer touch neither its notes nor its audit (prd.md, FR-014): the
// route and the archive's read get the same structural guard — they cannot import the notes
// module, by any path.
const archiveNoNotesConfig = defineConfig({
  files: ["src/pages/api/offer-archive.ts", "src/lib/offer-archive.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "(?:^|/)notes(?:\\.[cm]?[jt]sx?)?$",
            message:
              "The archive must not import the notes module: archiving and restoring an offer never touch a member's note (prd.md, FR-014).",
          },
        ],
      },
    ],
  },
});

// Deleting an offer takes every member's notes on it — through `on delete cascade` in the database
// and through nothing else (prd.md, FR-015). The route gets the same structural guard: it cannot
// import the notes module, by any path, so it never reads or deletes a note by itself.
const deleteNoNotesConfig = defineConfig({
  files: ["src/pages/api/offer-delete.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "(?:^|/)notes(?:\\.[cm]?[jt]sx?)?$",
            message:
              "The offer deletion must not import the notes module: notes go with their offer only through the cascade in the database (prd.md, FR-015).",
          },
        ],
      },
    ],
  },
});

// The keys of the paid services stay on the server (CLAUDE.md, Secrets and data access). Two
// modules hold one each: `@/lib/otodom/apify` the Apify token, `@/lib/commute/google` the Google
// Maps server key for the Routes API (FR-016). A page render, a layout or an island must never load
// either — an island ships to the browser. A view asks `isApifyAvailable()` or `isCommuteAvailable()`
// in `@/lib/config-status` instead. Each regex takes its module by any path, the alias or a relative
// one, with or without a file extension, and leaves its neighbours alone: `apify-request` holds no
// token, and the other commute modules hold no key. API routes under src/pages/api/ are `.ts` files
// and are not covered — they are where the clients are built. Both patterns live in this one block:
// a second block over the same files would replace this one's options rather than add to them.
const paidServiceServerOnlyConfig = defineConfig({
  files: ["src/components/**", "src/layouts/**", "src/pages/**/*.astro"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "(?:^|/)otodom/apify(?:\\.[cm]?[jt]sx?)?$",
            message:
              "A view must not import the Apify module: it holds the token, which never leaves the server. Ask isApifyAvailable() in @/lib/config-status (CLAUDE.md, Secrets and data access).",
          },
          {
            regex: "(?:^|/)commute/google(?:\\.[cm]?[jt]sx?)?$",
            message:
              "A view must not import the Google Routes module: it holds the server key, which never leaves the server. Ask isCommuteAvailable() in @/lib/config-status (CLAUDE.md, Secrets and data access).",
          },
        ],
      },
    ],
  },
});

// Members' notes never leave the system (prd.md, Non-Functional Requirements): the commute modules
// and the calculation route are the code that talks to Google, so they cannot import the notes
// module, by any path — on the pattern of auditNoNotesConfig. src/pages/api/commute.ts is named
// before it exists, so the rule binds the moment the file is created. No other block that sets
// no-restricted-imports covers these files.
const commuteNoNotesConfig = defineConfig({
  files: ["src/lib/commute/**", "src/pages/api/commute.ts"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            regex: "(?:^|/)notes(?:\\.[cm]?[jt]sx?)?$",
            message:
              "The commute code must not import the notes module: members' notes never reach Google (CLAUDE.md, Secrets and data access).",
          },
        ],
      },
    ],
  },
});

const scriptsConfig = defineConfig({
  files: ["scripts/**/*.mjs"],
  extends: [tseslint.configs.disableTypeChecked],
  languageOptions: { globals: { console: true, process: true, fetch: true, URLSearchParams: true } },
  rules: { "no-console": "off" },
});

export default defineConfig(
  includeIgnoreFile(gitignorePath),
  // Agent skill tooling lives outside the app's tsconfig and is not app code.
  globalIgnores([".claude/**"]),
  // Standalone packages carry their own package.json, node_modules and typecheck; the root CI never installs them.
  globalIgnores(["packages/**"]),
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  tokensOnlyConfig,
  consoleConfig,
  auditNoNotesConfig,
  refetchNoNotesConfig,
  archiveNoNotesConfig,
  deleteNoNotesConfig,
  paidServiceServerOnlyConfig,
  commuteNoNotesConfig,
  scriptsConfig,
  eslintPluginPrettier,
);
