import { Dialog } from "@base-ui/react/dialog";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useController, useSnapshot } from "../../app/state/controller-context";
import { Button } from "../../shared/components/button/button";
import { Field } from "../../shared/forms/fields";

type LoginValues = { token: string };

export function LoginForm() {
  const controller = useController();
  const loginRequired = useSnapshot((state) => state.loginRequired);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    reset,
    formState: { isSubmitting },
  } = useForm<LoginValues>({ defaultValues: { token: "" } });

  const login = async (values: LoginValues) => {
    try {
      setError("");
      await controller.login(values.token);
      reset();
    } catch (error) {
      setError(String(error));
    }
  };

  return (
    <Dialog.Root
      open={loginRequired}
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
            <code>.subagent-extension-for-codex/admin-token</code>. Your browser
            receives a short-lived session.
          </Dialog.Description>
          <form
            id="login-form"
            onSubmit={controller.handle(handleSubmit(login))}
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
