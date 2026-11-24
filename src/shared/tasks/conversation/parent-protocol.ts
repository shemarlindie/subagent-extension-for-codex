/** How to supervise a running task, given with the polling tool. */
export const PARENT_SUPERVISION_PROTOCOL =
  "While delegated work runs, continue your own work and keep polling. A timeout or empty result does not mean the task finished. Handle pending_input, failures and interruptions explicitly. Report success only after reading the final reply. A reply's wrap_up ask is the worker's question for the user: relay it, or answer it with send_message when the decision is yours. A queued follow-up is still pending work. If you lose the cursor, read again from after: 0.";
