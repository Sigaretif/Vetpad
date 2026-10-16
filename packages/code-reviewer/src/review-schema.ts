// m5l2-review-schema.ts — shared contract for the code-review agent (M5L2, M5L3).
// Copied from .claude/config-templates/m5l2-review-schema.ts.template. Both SDK variants (Claude Agent SDK and
// AI SDK ToolLoopAgent), the CI gate and the promptfoo evals read this one definition.
// Criteria follow m5l3-requirements: six scores on a 1-10 scale, a binding verdict, a summary.
// This file is the contract only: change criteria, verdict values or field names here first,
// then in the prompts (src/prompts/), the CI gate and the evals.
import { z } from "zod";

// Scores are plain z.number(): Anthropic structured output rejects minimum/maximum on
// integer types, so the 1-10 range is carried by the field description and the prompt.
export const REVIEW_SCHEMA = z.object({
  implementationCorrectness: z
    .number()
    .describe(
      "Poprawność implementacji (skala 1-10). " +
        "1: logika jest błędna, pomija oczywiste przypadki brzegowe lub po cichu psuje istniejące zachowania. " +
        "10: poprawny na ścieżce głównej, w przypadkach brzegowych i w obsłudze błędów, bez regresji.",
    ),
  idiomaticity: z
    .number()
    .describe(
      "Idiomatyczność (skala 1-10). " +
        "1: walczy z idiomami stacku i wzorcami repozytorium. " +
        "10: nie do odróżnienia od dobrze napisanego kodu wokół.",
    ),
  complexity: z
    .number()
    .describe(
      "Złożoność (skala 1-10). " +
        "1: przekombinowane lub splątane, przypadkowa złożoność zasłania intencję. " +
        "10: najprostszy projekt, który w pełni rozwiązuje problem.",
    ),
  testRiskCoverage: z
    .number()
    .describe(
      "Pokrycie testami proporcjonalne do ryzyka (skala 1-10). " +
        "1: ryzykowna logika bez testów albo testy, które nic nie sprawdzają. " +
        "10: najbardziej ryzykowne ścieżki są przetestowane celowo i dobrze.",
    ),
  documentation: z
    .number()
    .describe(
      "Dokumentacja (skala 1-10). " +
        "1: brak komentarzy i dokumentacji tam, gdzie są potrzebne; intencję trzeba odtwarzać. " +
        "10: tyle dokumentacji, ile trzeba, by wyjaśnić „dlaczego”, bez powtarzania oczywistości.",
    ),
  securitySafety: z
    .number()
    .describe(
      "Bezpieczeństwo (skala 1-10). " +
        "1: podatność, wyciek sekretów lub niebezpieczne zaufanie do danych z zewnątrz. " +
        "10: wejście walidowane, sekrety obsłużone poprawnie, brak nowej powierzchni ataku.",
    ),
  verdict: z.enum(["pass", "fail"]).describe("Wiążący werdykt dla całej zmiany; czyta go bramka w CI"),
  summary: z.string().describe("Podsumowanie w Markdown, gotowe jako komentarz do PR-a"),
});

// draft-07 keeps zod output compatible with the Claude Agent SDK outputFormat.
export const REVIEW_JSON_SCHEMA = z.toJSONSchema(REVIEW_SCHEMA, { target: "draft-07" });

export type Review = z.infer<typeof REVIEW_SCHEMA>;
