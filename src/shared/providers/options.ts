import type { ProviderOptions } from "../tasks/model.js";

export function optionsForProvider<T extends Record<string, unknown>>(
  options: ProviderOptions | undefined,
  provider: string,
): T {
  return (options?.[provider] ?? {}) as T;
}

export function withProviderOptions(
  options: ProviderOptions | undefined,
  provider: string,
  value: Record<string, unknown>,
): ProviderOptions {
  return { ...options, [provider]: value };
}

export function assertSelectedProviderOptions(
  provider: string,
  options: ProviderOptions | undefined,
) {
  if (Object.keys(options ?? {}).some((id) => id !== provider)) {
    throw new Error("Options must be namespaced under the selected provider");
  }
}
