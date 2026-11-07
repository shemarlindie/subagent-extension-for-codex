import { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";

import { providerMetadata } from "../../../../shared/providers/metadata";
import {
  allowedPermissionMode,
  withBlockedOptions,
} from "../../../../shared/providers/policy";
import type { Worker } from "../../../app/state/types";
import { Presence } from "../../../shared/components/motion/presence";
import { Field } from "../../../shared/forms/fields";
import { FormSelect } from "../../../shared/forms/form-select";
import type { DelegateValues } from "../delegate-values";
import { workerChoice } from "../delegation";
import { SandboxField } from "./sandbox-field";

interface ApprovalFieldProps {
  workers: Worker[];
  disabled?: boolean;
  loading?: boolean;
}

/** The worker's modes, or a stand-in once it's known to have none. */
const fallbackPermissions = (
  options: { value: string; label: string }[] | undefined,
  unresolved: boolean,
) => options ?? (unresolved ? [] : [{ value: "inherit", label: "Inherit" }]);

export function ApprovalField({
  workers,
  disabled = false,
  loading = false,
}: ApprovalFieldProps) {
  const { control, setValue } = useFormContext<DelegateValues>();
  const worker = useWatch({ control, name: "worker" });
  const mode = useWatch({ control, name: "permission_mode" });
  const { provider } = workerChoice(worker);
  const info = workers.find((item) => item.provider === provider);

  const permissions = providerMetadata(
    provider,
    info?.metadata,
  )?.nativePermissions;

  const unresolved = loading && !info;
  const allowedMode = allowedPermissionMode(info?.policy, mode);

  // A restored draft or late policy can leave a blocked mode, which won't run.
  useEffect(() => {
    if (allowedMode !== mode) setValue("permission_mode", allowedMode);
  }, [allowedMode, mode, setValue]);

  return (
    <>
      <div className="permission-row">
        <Field id="permission-mode" label="Permission mode">
          <FormSelect
            control={control}
            name="permission_mode"
            id="permission-mode"
            label="Permission mode"
            disabled={disabled || !permissions}
            loading={loading}
            loadingLabel="Loading permission options"
            placeholder={unresolved ? "Loading…" : undefined}
            options={withBlockedOptions(
              fallbackPermissions(permissions?.options, unresolved),
              info?.policy,
            )}
          />
          <p className="help">
            {unresolved
              ? "Loading permission options."
              : (permissions?.help ?? "This worker has no permission modes.")}
          </p>
        </Field>
        <SandboxField
          permissions={permissions}
          unresolved={unresolved}
          disabled={disabled}
          loading={loading}
        />
      </div>
      <Presence show={Boolean(permissions?.approvalDecider) || unresolved}>
        <Field id="approval-decider" label="Approval decision maker">
          <FormSelect
            control={control}
            name="approval_decider"
            id="approval-decider"
            label="Approval decision maker"
            disabled={disabled}
            loading={loading}
            loadingLabel="Loading approval options"
            placeholder={unresolved ? "Loading…" : undefined}
            options={
              unresolved
                ? []
                : [
                    { value: "user", label: "User" },
                    { value: "parent_agent", label: "Parent agent" },
                  ]
            }
          />
          <p className="help">
            {unresolved
              ? "Loading approval options."
              : permissions?.approvalDeciderHelp}
          </p>
        </Field>
      </Presence>
    </>
  );
}
