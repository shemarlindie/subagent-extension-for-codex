import { fileBadge, type FileFormat } from "../file-format";

type FileBadgeProps = {
  path: string;
  format: FileFormat;
};

export function FileBadge({ path, format }: FileBadgeProps) {
  return (
    <span className="file-badge" data-format={format} aria-hidden>
      {fileBadge(path)}
    </span>
  );
}
