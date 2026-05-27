import { z } from "zod";

export function parseToolInput<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  input: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(input ?? {});

  if (result.success) {
    return result.data;
  }

  const details = result.error.issues
    .map(issue => {
      const path = issue.path.length ? issue.path.join(".") : "input";
      return `${path}: ${issue.message}`;
    })
    .join("; ");

  throw new Error(`Invalid tool input: ${details}`);
}
