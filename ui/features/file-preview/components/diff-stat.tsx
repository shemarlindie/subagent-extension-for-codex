type DiffStatProps = {
  additions: number;
  deletions: number;
};

export function DiffStat({ additions, deletions }: DiffStatProps) {
  return (
    <span className="diff-stat">
      <span className="add">+{additions}</span>{" "}
      <span className="remove">−{deletions}</span>
    </span>
  );
}
