import { z } from "zod";

/** A schema without its default, prefault and optional wrappers. */
export function unwrapped(schema: z.ZodType): z.ZodType {
  let current = schema;

  while (
    current instanceof z.ZodDefault ||
    current instanceof z.ZodPrefault ||
    current instanceof z.ZodOptional
  ) {
    current = current.unwrap() as z.ZodType;
  }

  return current;
}

/**
 * A setting's metadata. Each setting declares `.meta()` before its default,
 * so the metadata sits on the unwrapped schema.
 */
export const settingMeta = (schema: z.ZodType): Record<string, unknown> =>
  unwrapped(schema).meta() ?? {};

/**
 * A setting's label and help, read from its schema's `title` and
 * `description`, so section rows and the schema agents read never drift.
 */
export function settingText(schema: z.ZodType) {
  const { title, description } = settingMeta(schema);

  return {
    label: typeof title === "string" ? title : "",
    ...(typeof description === "string" ? { help: [description] } : {}),
  };
}
