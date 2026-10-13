import type { SelectOption } from "./select-field";

export function matchesLookupOption(option: SelectOption, query: string) {
  const text = query.trim().toLowerCase();

  return [option.value, option.label, option.description].some((part) =>
    part?.toLowerCase().includes(text),
  );
}
