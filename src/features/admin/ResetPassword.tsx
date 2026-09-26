import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, KeyRound } from "lucide-react";
import { api } from "@/api";
import { errorMessage } from "@/lib/queries";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Overlay";
import { toast } from "@/components/ui/Toast";
import { t } from "@/i18n";

/** Shows a temporary password once, to read out or hand over in person. */
export function TempPasswordDialog({ open, onClose, name, password }: { open: boolean; onClose: () => void; name: string; password: string | null }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title={t("New password for {name}", { name })}
      description={t("Give it to them in person. It’s shown only once — they can change it from their account menu after signing in.")}
      footer={<Button onClick={onClose}>{t("Done")}</Button>}
    >
      <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-4" dir="ltr">
        <code className="flex-1 text-center font-mono text-2xl font-bold tracking-wider text-ink select-all">{password}</code>
        <Button
          size="sm"
          variant="ghost"
          icon={<Copy className="size-4" />}
          onClick={() => {
            if (password) void navigator.clipboard?.writeText(password).then(() => toast.success(t("Copied")));
          }}
        >
          {t("Copy")}
        </Button>
      </div>
    </Dialog>
  );
}

/** "Reset password" for a student or team member: confirm, then show the new temporary password. */
export function ResetPasswordButton({ userId, name, size = "xs" }: { userId: string; name: string; size?: "xs" | "sm" }) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () => api.admin.resetPassword(userId),
    onSuccess: (r) => {
      setConfirming(false);
      setPassword(r.password);
    },
    onError: (e) => toast.error(t("Couldn’t reset the password"), errorMessage(e)),
  });
  return (
    <>
      <Button size={size} variant="ghost" icon={<KeyRound className="size-3.5" />} onClick={() => setConfirming(true)}>
        {t("Reset password")}
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title={t("Reset {name}’s password?", { name })}
        description={t("Their old password stops working. Check their student card or staff ID before you do this.")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t("Cancel")}
            </Button>
            <Button loading={reset.isPending} onClick={() => reset.mutate()}>
              {t("Reset password")}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
      <TempPasswordDialog open={!!password} onClose={() => setPassword(null)} name={name} password={password} />
    </>
  );
}
