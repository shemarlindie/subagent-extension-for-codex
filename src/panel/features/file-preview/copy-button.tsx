import { useEffect, useRef, useState } from "react";

import { useController } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Icon } from "../../shared/components/icons/icons";
import { TooltipWrapper } from "../../shared/components/tooltip";
import { copyText } from "../../shared/utils/copy-text";
import { writeClipboardText } from "../../shared/utils/write-clipboard";

type CopyButtonProps = {
  text: string;
  label?: string;
  iconOnly?: boolean;
  iconSize?: number;
};

export function CopyButton({
  text,
  label = "Copy",
  iconOnly = false,
  iconSize,
}: CopyButtonProps) {
  const controller = useController();

  // A changed value must not inherit the previous value's checkmark.
  const [copiedText, setCopiedText] = useState<string>(),
    copied = copiedText === text,
    feedbackLabel = copied
      ? iconOnly
        ? `${label} — copied`
        : "Copied"
      : label,
    resetTimer = useRef<ReturnType<typeof setTimeout>>(undefined),
    currentWrite = useRef(0);

  // A clipboard write can finish after the user leaves this view.
  useEffect(
    () => () => {
      currentWrite.current++;
      clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    const write = ++currentWrite.current;

    const copied = await copyText(text, writeClipboardText, (error) => {
      if (write === currentWrite.current) controller.report(error);
    });

    if (!copied || write !== currentWrite.current) return;

    setCopiedText(text);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopiedText(undefined), 1500);
  }

  const button = (
    <Button
      variant={iconOnly ? "ghost" : "default"}
      className={iconOnly ? "file-action file-copy-inline" : "file-action"}
      aria-label={feedbackLabel}
      onClick={() => void copy()}
    >
      <Icon
        name={copied ? "check" : "copy"}
        size={iconSize ?? (iconOnly ? 8 : 14)}
      />
      {!iconOnly && (copied ? "Copied" : "Copy")}
    </Button>
  );

  return iconOnly ? (
    <TooltipWrapper label={feedbackLabel}>{button}</TooltipWrapper>
  ) : (
    button
  );
}
