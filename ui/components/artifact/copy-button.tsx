import { useState } from "react";

import { copyText } from "../../utils/copy-text";
import { Button } from "../button";
import { useController } from "../controller-context";
import { Icon } from "../icons";

type CopyButtonProps = {
  text: string;
};

export function CopyButton({ text }: CopyButtonProps) {
  const controller = useController();
  const [copied, setCopied] = useState(false);

  async function copy() {
    const copied = await copyText(
      text,
      (value) => navigator.clipboard.writeText(value),
      controller.report,
    );

    if (!copied) return;

    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Button className="file-action" onClick={() => void copy()}>
      <Icon name={copied ? "check" : "copy"} size={14} />
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
