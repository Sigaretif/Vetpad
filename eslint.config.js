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
// The ignored files predate the token contract; remove each one when it is migrated, never add one.
const COLOUR_LITERAL =
  "/\\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|decoration|divide|placeholder|caret|accent)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\\b|-\\[#|\\bbg-cosmic\\b|\\bbackdrop-blur/";
const COLOUR_MESSAGE =
  "Colour literal in a class string. Use a role token from src/styles/global.css (bg-card, text-muted-foreground, text-link, …) — CLAUDE.md, ### UI.";
const tokensOnlyConfig = defineConfig({
  files: ["src/**/*.{astro,ts,tsx}"],
  ignores: [
    // Views not yet migrated to tokens.
    "src/pages/auth/signin.astro",
    "src/pages/dashboard.astro",
    "src/components/Welcome.astro",
    "src/components/auth/FormField.tsx",
    "src/components/auth/PasswordToggle.tsx",
    "src/components/auth/ServerError.tsx",
    "src/components/auth/SubmitButton.tsx",
    // shadcn's upstream destructive variant sets text-white on bg-destructive.
    "src/components/ui/button.tsx",
    "src/components/ui/badge.tsx",
  ],
  rules: {
    "no-restricted-syntax": [
      "error",
      { selector: `Literal[value=${COLOUR_LITERAL}]`, message: COLOUR_MESSAGE },
      { selector: `TemplateElement[value.raw=${COLOUR_LITERAL}]`, message: COLOUR_MESSAGE },
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
