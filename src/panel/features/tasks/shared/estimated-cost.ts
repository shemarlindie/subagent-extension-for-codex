/** Explains a cost figure, naming whether it covers one turn or the whole task. */
export const estimatedCostNote = (scope: "turn" | "task") =>
  `Estimated cost of this ${scope} at API list prices. Billing depends on your Claude Code sign-in.`;
