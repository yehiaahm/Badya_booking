import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { motion } from "motion/react";
import { Building2, CalendarClock, LayoutDashboard, ScanLine } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSession } from "@/state/session";
import { BrandLockup } from "@/components/brand/Brand";
import { NotificationBell } from "@/components/shell/Notifications";
import { UserMenu } from "@/components/shell/UserMenu";
import { t } from "@/i18n";

const NAV = [
  { to: "/staff", get label() {
    return t("Today");
  }, icon: CalendarClock, end: true },
  { to: "/staff/scan", get label() {
    return t("Scan");
  }, icon: ScanLine },
  { to: "/staff/facilities", get label() {
    return t("Facilities");
  }, icon: Building2 },
];

export function StaffLayout() {
  const loc = useLocation();
  const user = useSession((s) => s.user)!;
  const isAdmin = user.role === "admin" || user.role === "super_admin";
  const scanner = loc.pathname === "/staff/scan";
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);
  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 bg-dusk text-on-dusk">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <NavLink to="/staff" aria-label={t("Operations home")} className="flex items-center gap-3">
            <BrandLockup compact tone="light" />
            <span className="hidden rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white/80 sm:inline">{t("Operations")}</span>
          </NavLink>
          <nav aria-label={t("Operations")} className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("relative flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors", isActive ? "text-white" : "text-white/60 hover:text-white")}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="staff-nav" className="absolute inset-0 rounded-full bg-white/12" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                    <n.icon className="relative size-4" />
                    <span className="relative">{n.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-1.5">
            {isAdmin && (
              <NavLink to="/admin" className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10 hover:text-white sm:flex">
                <LayoutDashboard className="size-4" />{" "}{t("Admin console")}
              </NavLink>
            )}
            <NotificationBell tone="light" mobilePath={null} />
            <UserMenu tone="light" showName />
          </div>
        </div>
      </header>
      <main id="main" className={cn("mx-auto w-full max-w-7xl", !scanner && "px-4 pb-28 sm:px-6 md:pb-12")}>
        <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
          <Outlet />
        </motion.div>
      </main>
      {!scanner && (
        <nav aria-label={t("Operations")} className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line pb-safe md:hidden">
          <ul className="grid grid-cols-3">
            {NAV.map((n) => (
              <li key={n.to} className="flex justify-center">
                <NavLink to={n.to} end={n.end} className={({ isActive }) => cn("flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold", isActive ? "text-brand" : "text-muted")}>
                  {n.to === "/staff/scan" ? (
                    <span className="-mt-7 flex size-14 items-center justify-center rounded-full bg-brand text-on-brand shadow-lg ring-4 ring-bg">
                      <ScanLine className="size-6" />
                    </span>
                  ) : (
                    <n.icon className="size-[22px]" />
                  )}
                  {n.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
