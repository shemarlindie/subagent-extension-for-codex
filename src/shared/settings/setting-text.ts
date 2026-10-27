import { z } from "zod";

/** A schema's metadata, looking through the default and optional wrappers. */
export function settingMeta(schema: z.ZodType): Record<string, unknown> {
  let current = schema;

  for (;;) {
    const meta = current.meta();
    if (meta) return meta;

    if (
      current instanceof z.ZodDefault ||
      current instanceof z.ZodPrefault ||
      current instanceof z.ZodOptional
    ) {
      current = current.unwrap() as z.ZodType;
    } else {
      return {};
    }
  }
}

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
