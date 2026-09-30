import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { BellOff, BellRing, Share, SquarePlus, X } from "lucide-react";
import { api } from "@/api";
import { cn } from "@/lib/cn";
import { errorMessage, useAppConfig } from "@/lib/queries";
import { usePush } from "@/lib/push";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { t } from "@/i18n";

const DISMISS_KEY = "bs-push-prompt";

/** How to add the app to the Home Screen on an iPhone — the only way iOS allows notifications from a web app. */
function IosSteps() {
  return (
    <ol className="mt-3 space-y-2 rounded-2xl bg-surface-2/70 p-3.5 text-[13px] text-ink-2">
      <li className="flex items-center gap-2">
        <Share className="size-4 shrink-0 text-info" /> {t("Tap the Share button in Safari")}
      </li>
      <li className="flex items-center gap-2">
        <SquarePlus className="size-4 shrink-0 text-info" /> {t("Choose “Add to Home Screen”")}
      </li>
      <li className="flex items-center gap-2">
        <BellRing className="size-4 shrink-0 text-info" /> {t("Open Badya Spaces from your Home Screen and turn notifications on there")}
      </li>
    </ol>
  );
}

/** Profile: turn notifications on this phone on or off, and send a test. */
export function PushCard({ className }: { className?: string }) {
  const config = useAppConfig();
  const push = usePush(config.data?.pushPublicKey);
  const [busy, setBusy] = useState(false);
  const test = useMutation({
    mutationFn: () => api.me.testPush(),
    onSuccess: () => toast.success(t("Test sent"), t("It should appear on this phone in a few seconds.")),
    onError: (e) => toast.error(t("Couldn’t send a test"), errorMessage(e)),
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error(t("Couldn’t turn on notifications"), errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const s = push.state;
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-start gap-3">
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-2xl", s === "on" ? "bg-success-soft text-success" : "bg-brand-soft text-brand")}>
          {s === "blocked" || s === "unsupported" ? <BellOff className="size-5" /> : <BellRing className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-ink">{t("Notifications on this phone")}</h2>
          <p className="text-sm text-muted">
            {s === "on"
              ? t("On — reminders, invitations and waitlist offers arrive like messages from any other app.")
              : s === "blocked"
                ? t("Blocked in your browser. Allow notifications for this site in the browser’s settings, then come back.")
                : s === "unsupported"
                  ? t("This browser can’t show notifications. Open Badya Spaces in Chrome, Safari, Firefox or Edge.")
                  : s === "needs-install"
                    ? t("On iPhone, notifications work once Badya Spaces is on your Home Screen.")
                    : t("Get reminders before your sessions, invitations from teammates and waitlist offers — even when the app is closed.")}
          </p>
        </div>
      </div>
      {s === "needs-install" && <IosSteps />}
      <div className="mt-4 flex flex-wrap gap-2">
        {s === "off" && (
          <Button icon={<BellRing className="size-4" />} loading={busy} onClick={() => run(push.enable)}>
            {t("Turn on notifications")}
          </Button>
        )}
        {s === "on" && (
          <>
            <Button variant="secondary" loading={test.isPending} onClick={() => test.mutate()}>
              {t("Send a test")}
            </Button>
            <Button variant="ghost" loading={busy} onClick={() => run(push.disable)}>
              {t("Turn off")}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/** Home: a one-time nudge to turn notifications on, until they're on or the student says not now. */
export function PushPrompt() {
  const config = useAppConfig();
  const push = usePush(config.data?.pushPublicKey);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  if (hidden || (push.state !== "off" && push.state !== "needs-install")) return null;
  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode */
    }
  };
  return (
    <div className="mt-4 rounded-[22px] border border-brand/25 bg-brand-softer p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-brand text-on-brand">
          <BellRing className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-ink">{t("Don’t miss your sessions")}</p>
          <p className="text-[13px] text-ink-2">{push.state === "needs-install" ? t("On iPhone, add Badya Spaces to your Home Screen to get reminders and invitations as notifications.") : t("Turn on notifications to get reminders, invitations and waitlist offers on this phone.")}</p>
        </div>
        <button type="button" onClick={dismiss} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={t("Not now")}>
          <X className="size-4" />
        </button>
      </div>
      {push.state === "needs-install" ? (
        <IosSteps />
      ) : (
        <Button
          className="mt-3"
          size="sm"
          loading={busy}
          icon={<BellRing className="size-4" />}
          onClick={async () => {
            setBusy(true);
            try {
              await push.enable();
            } catch (e) {
              toast.error(t("Couldn’t turn on notifications"), errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Turn on notifications")}
        </Button>
      )}
    </div>
  );
}
