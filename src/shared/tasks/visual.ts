/**
 * The most characters a visual's code may have. Rendering handles far more,
 * but the code stays in the task's history and the worker's context.
 */
export const MAX_VISUAL_CODE = 200_000;

/** The id of a visual's Chat item and conversation message. */
export const visualId = (visual: number) => `visual_${visual}`;

/** What the conversation shows the parent in place of a visual's code. */
export const visualPlaceholder = (visual: number, title: string) =>
  `[Visual ${visual} shown in the panel: ${title}]`;
