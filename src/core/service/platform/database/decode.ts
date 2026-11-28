import { z } from "zod";

/**
 * Checks a stored value against `schema`. A malformed record fails with an
 * error naming it, rather than being dropped or filled with defaults.
 */
export function checkStored<T extends z.ZodType>(
  schema: T,
  value: unknown,
  record: string,
): z.infer<T> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error(
      `Stored ${record} is malformed: ${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
}

/** Parses a stored JSON column and checks it like `checkStored`. */
export function decodeStored<T extends z.ZodType>(
  schema: T,
  json: string,
  record: string,
): z.infer<T> {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error) {
    throw new Error(`Stored ${record} is not valid JSON`, { cause: error });
  }

  return checkStored(schema, value, record);
}
