import { z } from "zod";

export const handoffSchema = z
  .object({
    goal: z.string().min(1),
    concept: z.string().min(1),
    userJourney: z.array(z.string().min(1)).min(1),
    constraints: z.array(z.string().min(1)),
    implementationSteps: z
      .array(
        z
          .object({
            title: z.string().min(1),
            description: z.string().min(1),
            acceptanceCriteria: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .min(1),
    risks: z.array(z.string().min(1)),
    openQuestions: z.array(z.string().min(1)),
  })
  .strict();

export function validateHandoff(text: string) {
  const source = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(source);
  } catch {
    return { valid: false as const, fields: ["json"], artifact: null };
  }
  const result = handoffSchema.safeParse(json);
  return result.success
    ? { valid: true as const, fields: [], artifact: result.data }
    : {
        valid: false as const,
        fields: result.error.issues.map((i) => i.path.join(".")),
        artifact: null,
      };
}
