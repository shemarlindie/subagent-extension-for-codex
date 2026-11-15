import type { ProviderOptions, Task } from "../tasks/model.js";

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

/**
 * A task's options with one value its session reported, such as what it runs
 * with, beside what it requested.
 */
export function withSessionOption(
  {
    provider,
    provider_options: options,
  }: Pick<Task, "provider" | "provider_options">,
  key: "effective" | "prompt_cache",
  value: Record<string, unknown>,
): ProviderOptions {
  return withProviderOptions(options, provider, {
    ...optionsForProvider(options, provider),
    [key]: value,
  });
}

export function assertSelectedProviderOptions(
  provider: string,
  options: ProviderOptions | undefined,
) {
  if (Object.keys(options ?? {}).some((id) => id !== provider)) {
    throw new Error("Options must be namespaced under the selected provider");
  }
}
