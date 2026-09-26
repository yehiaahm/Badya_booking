import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, Building2, CalendarRange, ClipboardList, Gauge, GraduationCap, ListOrdered, Menu as MenuIcon, ScanLine, ScrollText, Settings, ShieldCheck, Scale, Smartphone, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSession } from "@/state/session";
import { useDeviceRequests, useFlags } from "@/lib/queries";
import { BrandLockup } from "@/components/brand/Brand";
import { NotificationBell } from "@/components/shell/Notifications";
import { UserMenu } from "@/components/shell/UserMenu";
import { t } from "@/i18n";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Gauge;
  end?: boolean;
  badge?: number;
}

function useNavGroups(): { title: string; items: NavItem[] }[] {
  const flags = useFlags();
  const devices = useDeviceRequests();
  const open = flags.data?.filter((f) => f.status === "open").length ?? 0;
  const pendingDevices = devices.data?.filter((r) => r.status === "pending").length ?? 0;
  return [
    {
      title: t("Overview"),
      items: [
        { to: "/admin", label: t("Dashboard"), icon: Gauge, end: true },
        { to: "/admin/analytics", label: t("Analytics"), icon: BarChart3 },
      ],
    },
    {
      title: t("Operations"),
      items: [
        { to: "/admin/bookings", label: t("Bookings"), icon: ClipboardList },
        { to: "/admin/waitlists", label: t("Waitlists"), icon: ListOrdered },
        { to: "/admin/maintenance", label: t("Maintenance"), icon: Wrench },
        { to: "/admin/fairness", label: t("Fair use"), icon: Scale, badge: open },
      ],
    },
    {
      title: t("Catalogue & people"),
      items: [
        { to: "/admin/facilities", label: t("Facilities"), icon: Building2 },
        { to: "/admin/students", label: t("Students"), icon: GraduationCap },
        { to: "/admin/devices", label: t("Devices"), icon: Smartphone, badge: pendingDevices },
      ],
    },
    {
      title: t("Governance"),
      items: [
        { to: "/admin/policies", label: t("Booking policies"), icon: ShieldCheck },
        { to: "/admin/audit", label: t("Audit log"), icon: ScrollText },
        { to: "/admin/settings", label: t("Settings"), icon: Settings },
      ],
    },
  ];
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const groups = useNavGroups();
  const user = useSession((s) => s.user)!;
  return (
    <div className="flex h-full flex-col bg-dusk text-on-dusk">
      <div className="flex h-16 items-center px-5">
        <BrandLockup compact tone="light" />
      </div>
      <div className="px-5 pb-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#d9ae8a]">
          <CalendarRange className="size-3.5" />
          {user.role === "super_admin" ? t("Super admin") : t("Administration")}
        </span>
      </div>
      <nav aria-label={t("Admin")} className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="mb-1 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/35">{g.title}</p>
            <ul className="space-y-0.5">
              {g.items.map((it) => (
                <li key={it.to}>
                  <NavLink to={it.to} end={it.end} onClick={onNavigate} className={({ isActive }) => cn("relative flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] font-semibold transition-colors", isActive ? "text-white" : "text-white/60 hover:bg-white/5 hover:text-white")}>
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="admin-nav" className="absolute inset-0 rounded-xl bg-white/10 ring-1 ring-white/10" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                        {isActive && <span className="absolute start-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-[#d9ae8a]" />}
                        <it.icon className="relative size-[18px]" />
                        <span className="relative flex-1">{it.label}</span>
                        {!!it.badge && <span className="relative rounded-full bg-[#d9ae8a] px-1.5 text-[11px] font-bold text-dusk">{it.badge}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <NavLink to="/staff" onClick={onNavigate} className="flex h-10 items-center gap-3 rounded-xl px-3 text-[13.5px] font-semibold text-white/60 hover:bg-white/5 hover:text-white">
          <ScanLine className="size-[18px]" />{" "}{t("Staff operations")}
        </NavLink>
      </div>
    </div>
  );
}

export function AdminLayout() {
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    // Back/forward and in-page links navigate too — never leave the menu covering the new page.
    setMobileOpen(false);
  }, [loc.pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [mobileOpen]);
  return (
    <div className="min-h-dvh bg-bg lg:ps-64">
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-[70] lg:hidden">
            <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)} />
            <motion.div className="absolute inset-y-0 start-0 w-72" initial={{ x: document.documentElement.dir === "rtl" ? "100%" : "-100%" }} animate={{ x: 0 }} exit={{ x: document.documentElement.dir === "rtl" ? "100%" : "-100%" }} transition={{ type: "spring", stiffness: 420, damping: 40 }}>
              <Sidebar onNavigate={() => setMobileOpen(false)} />
              <button onClick={() => setMobileOpen(false)} aria-label={t("Close menu")} className="absolute end-3 top-4 rounded-full p-2 text-white/70 hover:bg-white/10">
                <X className="size-5" />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <header className="glass sticky top-0 z-30 border-b border-line">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button onClick={() => setMobileOpen(true)} aria-label={t("Open menu")} className="rounded-xl p-2 text-ink-2 hover:bg-surface-2 lg:hidden">
            <MenuIcon className="size-5" />
          </button>
          <div className="lg:hidden">
            <BrandLockup compact product={t("Admin")} />
          </div>
          <div className="ms-auto flex items-center gap-2">
            <NotificationBell mobilePath={null} />
            <UserMenu showName />
          </div>
        </div>
      </header>
      <main id="main" className="px-4 pb-16 sm:px-6 lg:px-8">
        <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}>
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}

/** Consistent admin page header. */
export function AdminHeader({ title, description, actions, badge }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 pt-7 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 text-[26px] font-bold tracking-tight text-ink">
          {title}
          {badge}
        </h1>
        {description && <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

