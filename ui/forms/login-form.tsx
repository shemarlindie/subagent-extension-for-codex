import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "../components/button";
import { useController, useSnapshot } from "../components/controller-context";
import { Field } from "./fields";

export function LoginForm() {
  const controller = useController(),
    state = useSnapshot(),
    [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm({ defaultValues: { token: "" } });

  return (
    <Dialog.Root
      open={state.loginRequired}
      disablePointerDismissal
      onOpenChange={(_open, details) => details.cancel()}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-overlay" />
        <Dialog.Popup
          className="dialog"
          id="login"
          aria-describedby="login-note"
        >
          <Dialog.Title>Connect your console</Dialog.Title>
          <Dialog.Description id="login-note">
            Enter the local console token from{" "}
            <code>.codex-subagent-extension/admin-token</code>. Your browser
            receives a short-lived session.
          </Dialog.Description>
          <form
            id="login-form"
            onSubmit={handleSubmit(async (values) => {
              try {
                setError("");
                await controller.login(values.token);
                reset();
              } catch (error) {
                setError(String(error));
              }
            })}
          >
            <Field id="token" label="Console token">
              <input
                id="token"
                type="password"
                required
                autoComplete="off"
                {...register("token", { required: true })}
              />
            </Field>
            <div id="login-error" className="error" role="alert">
              {error}
            </div>
            <footer>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                Connect
              </Button>
            </footer>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
