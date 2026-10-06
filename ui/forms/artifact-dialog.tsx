import { ArtifactPreview } from "../components/artifact/artifact-preview";
import { defineDialog } from "./dialog-definition";

export const artifactDialog = defineDialog<"artifact">({
  title: ({ artifact }) => artifact.title,
  render: ({ artifact }) => (
    <ArtifactPreview key={artifact.id} summary={artifact} />
  ),
});
