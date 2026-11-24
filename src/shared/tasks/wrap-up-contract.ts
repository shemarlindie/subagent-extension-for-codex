/** A panel action a wrap-up button runs. */
export type WrapUpPanelAction = "archive" | "ask_codex";

/**
 * A wrap-up button: a reply that sends its label as a message, or a panel
 * action.
 */
export type WrapUpAction = { label: string } | { action: WrapUpPanelAction };

/** How the worker summed up its turn, shown under the turn's reply. */
export interface WrapUp {
  /** What is now true, then what isn't done or verified. */
  recap: string;
  /** One decision for the user. */
  ask?: string;
  /** Answers to `ask`, the worker's pick first. */
  actions?: WrapUpAction[];
  /** The worker can't go on until the user answers. */
  blocked?: true;
}
