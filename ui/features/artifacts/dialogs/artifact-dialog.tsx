import { defineDialog } from "../../../shared/dialogs/dialog-definition";
import { ArtifactPreview } from "../components/artifact-preview";

export const artifactDialog = defineDialog<"artifact">({
  title: ({ artifact }) => artifact.title,
  render: ({ artifact }) => (
    <ArtifactPreview key={artifact.id} summary={artifact} />
  ),
});
