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
 * What a session reports beside what its task requested: what it runs with,
 * and its latest prompt cache and context usage records.
 */
export type SessionOptionKey = "effective" | "prompt_cache" | "context_usage";

/** A task's options with one value its session reported. */
export function withSessionOption(
  {
    provider,
    provider_options: options,
  }: Pick<Task, "provider" | "provider_options">,
  key: SessionOptionKey,
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
