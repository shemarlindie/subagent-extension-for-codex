import { useSnapshot } from "../controller-context";
import { ArtifactCard } from "./artifact-card";

export function ArtifactList() {
  const { artifacts } = useSnapshot();

  return (
    <>
      <p className="help">Inspect reports and patches here.</p>
      {artifacts.map((summary) => (
        <ArtifactCard key={summary.id} summary={summary} />
      ))}
    </>
  );
}
