import { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY } from "astro:env/server";

export interface ConfigStatus {
  name: string;
  configured: boolean;
  message: string;
  docsUrl?: string;
  docsLabel?: string;
}

export const configStatuses: ConfigStatus[] = [
  {
    name: "Supabase",
    configured: Boolean(SUPABASE_URL && SUPABASE_KEY),
    message: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    docsUrl: "https://github.com/Sigaretif/Vetpad#supabase-configuration",
    docsLabel: "Zobacz instrukcję konfiguracji",
  },
  {
    // The model provider of the AI audit (FR-010). No link: the entry names the variable to set.
    name: "Anthropic",
    configured: Boolean(ANTHROPIC_API_KEY),
    message: "Brak klucza dostawcy modelu (ANTHROPIC_API_KEY) — audyt AI jest wyłączony.",
  },
];

export const missingConfigs = configStatuses.filter((s) => !s.configured);
