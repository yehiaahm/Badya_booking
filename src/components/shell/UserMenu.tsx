import { useState } from "react";
import { useNavigate } from "react-router";
import { KeyRound, Languages, LogOut, Monitor, Moon, Sun, User as UserIcon } from "lucide-react";
import { api } from "@/api";
import { queryClient, useAppConfig } from "@/lib/queries";
import { useSession, useTheme } from "@/state/session";
import { Avatar, Menu } from "@/components/ui/Primitives";
import { cn } from "@/lib/cn";
import { t, tStored } from "@/i18n";
import { chooseLanguage, useLanguage } from "@/i18n/store";
import { ChangePasswordDialog } from "./ChangePasswordDialog";

export function useSignOut() {
  const nav = useNavigate();
  return async () => {
    await api.auth.logout();
    queryClient.clear();
    useSession.getState().setUser(null);
    nav("/login");
  };
}

/**
 * Students stay signed in on their own phone — no sign-out, so nobody else can
 * sign in to a different account there. (Demo data lets a presenter switch.)
 */
export function useCanSignOut() {
  const role = useSession((s) => s.user?.role);
  const demo = useAppConfig().data?.demo;
  return role !== "student" || !!demo;
}

export function UserMenu({ tone = "default", showName, profilePath }: { tone?: "default" | "light"; showName?: boolean; profilePath?: string }) {
  const user = useSession((s) => s.user)!;
  const theme = useTheme();
  const nav = useNavigate();
  const signOut = useSignOut();
  const nextTheme = theme.pref === "light" ? "dark" : theme.pref === "dark" ? "system" : "light";
  const ThemeIcon = theme.pref === "light" ? Sun : theme.pref === "dark" ? Moon : Monitor;
  const lang = useLanguage((s) => s.lang);
  const canSignOut = useCanSignOut();
  const [pwOpen, setPwOpen] = useState(false);
  return (
    <>
    <Menu
      label={t("Account")}
      trigger={(p) => (
        <button {...p} className={cn("flex items-center gap-2.5 rounded-full p-0.5 pe-0.5 transition-colors", showName && "pe-3", tone === "light" ? "hover:bg-white/10" : "hover:bg-surface-2")} aria-label={t("Account menu")}>
          <Avatar name={user.name} hue={user.avatarHue} size={34} />
          {showName && (
            <span className="hidden text-start leading-tight xl:block">
              <span className={cn("block text-[13px] font-semibold", tone === "light" ? "text-white" : "text-ink")}>{user.name}</span>
              <span className={cn("block text-[11px]", tone === "light" ? "text-white/60" : "text-muted")}>{user.title ?? tStored(user.faculty)}</span>
            </span>
          )}
        </button>
      )}
      items={[
        ...(profilePath ? [{ label: t("Profile & standing"), icon: <UserIcon />, onSelect: () => nav(profilePath) }] : []),
        { label: lang === "ar" ? "English" : "العربية", icon: <Languages />, onSelect: () => chooseLanguage(lang === "ar" ? "en" : "ar", true) },
        { label: t("Theme: {name}", { name: theme.pref === "system" ? t("System") : theme.pref === "dark" ? t("Dusk (dark)") : t("Ivory (light)") }), icon: <ThemeIcon />, onSelect: () => theme.set(nextTheme) },
        { label: t("Change password"), icon: <KeyRound />, onSelect: () => setPwOpen(true) },
        ...(canSignOut ? [{ label: t("Sign out"), icon: <LogOut />, onSelect: signOut, danger: true }] : []),
      ]}
    />
    <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}
