import { Link } from "react-router";
import { Settings2 } from "lucide-react";
import { NotificationList } from "@/components/shell/Notifications";
import { PageHeader } from "@/layouts/StudentLayout";
import { t } from "@/i18n";

export function NotificationsPage() {
  return (
    <div>
      <PageHeader
        title={t("Notifications")}
        subtitle={t("Confirmations, reminders and waitlist offers.")}
        actions={
          <Link to="/profile#preferences" className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink">
            <Settings2 className="size-4" /> <span className="hidden sm:inline">{t("Preferences")}</span>
          </Link>
        }
      />
      <div className="mx-auto max-w-2xl px-3 pt-2 sm:px-6">
        <NotificationList />
      </div>
    </div>
  );
}
