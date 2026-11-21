export async function withCleanup<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<unknown>,
): Promise<T> {
  let result: T;

  try {
    result = await run();
  } catch (error) {
    try {
      await cleanup();
    } catch {
      // A closed page can also reject cleanup. Keep the first failure.
    }

    throw error;
  }

  await cleanup();

  return result;
}
