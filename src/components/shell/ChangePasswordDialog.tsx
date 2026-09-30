import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/api";
import { errorMessage, queryClient } from "@/lib/queries";
import { Dialog } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { useSession } from "@/state/session";
import { t } from "@/i18n";

const MIN_PASSWORD = 8;

/** `required`: signed in with a temporary password — no way around choosing a new one. */
export function ChangePasswordDialog({ open, onClose, required }: { open: boolean; onClose: () => void; required?: boolean }) {
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setForm({ current: "", next: "", confirm: "" });
      setError(null);
    }
  }, [open]);
  const save = useMutation({
    mutationFn: () => api.auth.changePassword(form.current, form.next),
    onSuccess: () => {
      toast.success(t("Password changed"), t("Use it the next time you sign in."));
      const user = useSession.getState().user;
      if (user?.mustChangePassword) {
        useSession.getState().setUser({ ...user, mustChangePassword: false });
        // The server held everything else back until now — load the screens behind the dialog.
        void queryClient.invalidateQueries();
      }
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const submit = () => {
    if (form.next.length < MIN_PASSWORD) return setError(t("Use a password of at least {n} characters.", { n: MIN_PASSWORD }));
    if (form.next !== form.confirm) return setError(t("The two passwords don’t match."));
    setError(null);
    save.mutate();
  };
  const field = (key: keyof typeof form, label: string, autoComplete: string) => (
    <Field label={label} htmlFor={`pw-${key}`}>
      <Input id={`pw-${key}`} type="password" dir="ltr" autoComplete={autoComplete} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </Field>
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      dismissible={!required}
      title={required ? t("Choose a new password") : t("Change password")}
      description={required ? t("You signed in with a temporary password. Choose your own before you continue.") : undefined}
      footer={
        <>
          {!required && (
            <Button variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
          )}
          <Button loading={save.isPending} disabled={!form.current || !form.next} onClick={submit}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {field("current", required ? t("Temporary password") : t("Current password"), "current-password")}
        {field("next", t("New password"), "new-password")}
        {field("confirm", t("Confirm new password"), "new-password")}
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
            {error}
          </p>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
