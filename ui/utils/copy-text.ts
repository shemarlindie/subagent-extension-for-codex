/** Copies text and reports failures through the caller's error channel. */
export async function copyText(
  text: string,
  writeText: (text: string) => Promise<void>,
  report: (error: unknown) => void,
): Promise<boolean> {
  try {
    await writeText(text);

    return true;
  } catch (error) {
    report(error);

    return false;
  }
}
