import type { Snapshot } from "../../app/state/types.js";

export function projectChoices(state: Snapshot) {
  const choices = state.projects.filter(
    (project) => project.kind === "repository",
  );

  return state.repository &&
    !choices.some((project) => project.repository === state.repository)
    ? [{ repository: state.repository, kind: "repository" }, ...choices]
    : choices;
}
