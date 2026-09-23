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
// border(?:-[trblxy])? also catches side borders such as border-t-white.
const COLOUR_LITERAL =
  "/\\b(?:bg|text|border(?:-[trblxy])?|ring|outline|fill|stroke|from|via|to|shadow|decoration|divide|placeholder|caret|accent)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\\b|-\\[#|\\bbg-cosmic\\b|\\bbackdrop-blur/";
const COLOUR_MESSAGE =
  "Colour literal in a class string. Use a role token from src/styles/global.css (bg-card, text-muted-foreground, text-link, …) — CLAUDE.md, ### UI.";
// Narrowed to the style attribute: a bare hex/rgba() regex over any string would also catch
// anchors like href="#add".
const STYLE_COLOUR = "/rgba?\\(|#[0-9a-fA-F]{3,8}\\b/";
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
  baseConfig,
  reactConfig,
  eslintPluginAstro.configs["flat/recommended"],
  eslintPluginAstro.configs["flat/jsx-a11y-recommended"],
  astroConfig,
  tokensOnlyConfig,
  scriptsConfig,
  eslintPluginPrettier,
);
