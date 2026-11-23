import { Icon, type IconName } from "../../../shared/components/icons/icons";

/** Shared profile glyphs used in task rows and worker settings. */
const WORKER_PROFILE_ICONS = {
  researcher: "glasses",
  reviewer: "diff-search",
  implementer: "code",
} satisfies Record<string, IconName>;

export function workerProfileIconName(profile: string): IconName | undefined {
  return WORKER_PROFILE_ICONS[profile as keyof typeof WORKER_PROFILE_ICONS];
}

export function WorkerProfileIcon({
  profile,
  className,
}: {
  profile: string;
  className?: string;
}) {
  return (
    <Icon
      name={workerProfileIconName(profile) ?? "quiet-constellation"}
      size={10}
      className={className}
    />
  );
}
