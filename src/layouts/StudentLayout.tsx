import { useEffect } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { motion } from "motion/react";
import { CalendarDays, Compass, Heart, Home, Ticket, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { BrandLockup } from "@/components/brand/Brand";
import { NotificationBell } from "@/components/shell/Notifications";
import { UserMenu } from "@/components/shell/UserMenu";
import { t as tr } from "@/i18n";

const DESKTOP_NAV = [
  { to: "/home", get label() {
    return tr("Home");
  } },
  { to: "/explore", get label() {
    return tr("Explore");
  } },
  { to: "/bookings", get label() {
    return tr("My bookings");
  } },
  { to: "/calendar", get label() {
    return tr("Calendar");
  } },
  { to: "/favorites", get label() {
    return tr("Favorites");
  }, icon: Heart },
];

const TABS = [
  { to: "/home", get label() {
    return tr("Home");
  }, icon: Home },
  { to: "/explore", get label() {
    return tr("Explore");
  }, icon: Compass },
  { to: "/bookings", get label() {
    return tr("Bookings");
  }, icon: Ticket },
  { to: "/calendar", get label() {
    return tr("Calendar");
  }, icon: CalendarDays },
  { to: "/profile", get label() {
    return tr("Profile");
  }, icon: UserRound },
];

const TOP_LEVEL = ["/home", "/explore", "/bookings", "/calendar", "/profile", "/favorites", "/notifications"];

export function StudentLayout() {
  const loc = useLocation();
  const showTabs = TOP_LEVEL.includes(loc.pathname);
  useEffect(() => {
    if (!loc.hash) return void window.scrollTo({ top: 0 });
    // Anchored sections usually render after their data loads — wait for them.
    const id = decodeURIComponent(loc.hash.slice(1));
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(id);
      if (el || ++tries > 40) {
        clearInterval(timer);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [loc.pathname, loc.hash]);

  return (
    <div className="app-backdrop min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100] focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2 focus:shadow-lg">
        {tr("Skip to content")}
      </a>
      <header className="glass sticky top-0 z-40 hidden border-b border-line/70 lg:block">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-8 px-6">
          <NavLink to="/home" aria-label={tr("Badya Spaces home")}>
            <BrandLockup compact />
          </NavLink>
          <nav aria-label={tr("Main")} className="flex items-center gap-1">
            {DESKTOP_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={({ isActive }) => cn("relative rounded-full px-3.5 py-2 text-sm font-semibold transition-colors", isActive ? "text-ink" : "text-muted hover:text-ink")}>
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="student-nav" className="absolute inset-0 rounded-full bg-surface shadow-sm ring-1 ring-line" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
                    <span className="relative">{n.label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <NotificationBell />
            <UserMenu showName profilePath="/profile" />
          </div>
        </div>
      </header>

      <main id="main" className={cn("mx-auto w-full max-w-6xl", showTabs ? "pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-16" : "pb-16")}>
        <motion.div key={loc.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}>
          <Outlet />
        </motion.div>
      </main>

      {showTabs && (
        <nav aria-label={tr("Main")} className="glass fixed inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))] z-40 rounded-[26px] border border-line/80 shadow-lg lg:hidden">
          <ul className="grid grid-cols-5">
            {TABS.map((t) => (
              <li key={t.to}>
                <NavLink to={t.to} className={({ isActive }) => cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors", isActive ? "text-brand" : "text-muted")}>
                  {({ isActive }) => (
                    <>
                      {isActive && <motion.span layoutId="student-tab" className="absolute inset-x-2 inset-y-1.5 rounded-[20px] bg-brand-soft" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                      <t.icon className="relative size-[22px]" strokeWidth={isActive ? 2.3 : 1.9} />
                      <span className="relative">{t.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}

/** Mobile page header — large title with the bell. Desktop uses the top bar. */
export function PageHeader({ title, subtitle, actions, className }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-end justify-between gap-4 px-4 pt-[max(20px,env(safe-area-inset-top))] pb-4 sm:px-6 lg:pt-10", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-[34px] leading-none text-ink sm:text-[40px]">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {actions}
        <div className="lg:hidden">
          <NotificationBell />
        </div>
      </div>
    </div>
  );
}
