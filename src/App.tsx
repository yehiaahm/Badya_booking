import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { createHashRouter, Navigate, RouterProvider, useLocation, useRouteError } from "react-router";
import { RefreshCw, ShieldAlert } from "lucide-react";
import { isStaleBuildError, reloadForUpdate } from "@/lib/reload";
import { api, ApiError } from "@/api";
import type { Permission } from "@/domain/types";
import { homeFor, useSession } from "@/state/session";
import { Toaster } from "@/components/ui/Toast";
import { useLiveUpdates } from "@/lib/queries";
import { adoptAccountLanguage } from "@/i18n/store";
import { EmptyState } from "@/components/ui/Primitives";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/brand/Brand";
import { StudentLayout } from "@/layouts/StudentLayout";
import { StaffLayout } from "@/layouts/StaffLayout";
import { AdminLayout } from "@/layouts/AdminLayout";
import { LoginPage } from "@/features/auth/LoginPage";
import { HomePage } from "@/features/student/HomePage";
import { ExplorePage } from "@/features/student/ExplorePage";
import { FacilityPage } from "@/features/student/FacilityPage";
import { MyBookingsPage } from "@/features/student/MyBookingsPage";
import { BookingDetailPage } from "@/features/student/BookingDetailPage";
import { ConfirmationPage } from "@/features/student/ConfirmationPage";
import { CalendarPage } from "@/features/student/CalendarPage";
import { NotificationsPage } from "@/features/student/NotificationsPage";
import { FavoritesPage } from "@/features/student/FavoritesPage";
import { ProfilePage } from "@/features/student/ProfilePage";
import { StaffTodayPage } from "@/features/staff/StaffTodayPage";
import { ScannerPage } from "@/features/staff/ScannerPage";
import { StaffFacilitiesPage } from "@/features/staff/StaffFacilitiesPage";
import { ChangePasswordDialog } from "@/components/shell/ChangePasswordDialog";
import { t } from "@/i18n";

// Admin screens are split out — students never download them.
const AdminDashboard = lazy(() => import("@/features/admin/DashboardPage"));
const AdminFacilities = lazy(() => import("@/features/admin/FacilitiesPage"));
const AdminFacilityEditor = lazy(() => import("@/features/admin/FacilityEditorPage"));
const AdminBookings = lazy(() => import("@/features/admin/BookingsPage"));
const AdminStudents = lazy(() => import("@/features/admin/StudentsPage"));
const AdminPolicies = lazy(() => import("@/features/admin/PoliciesPage"));
const AdminMaintenance = lazy(() => import("@/features/admin/MaintenancePage"));
const AdminWaitlists = lazy(() => import("@/features/admin/WaitlistsPage"));
const AdminFairness = lazy(() => import("@/features/admin/FairnessPage"));
const AdminDevices = lazy(() => import("@/features/admin/DevicesPage"));
const AdminAnalytics = lazy(() => import("@/features/admin/AnalyticsPage"));
const AdminAudit = lazy(() => import("@/features/admin/AuditPage"));
const AdminSettings = lazy(() => import("@/features/admin/SettingsPage"));

function Splash({ offline }: { offline?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg p-6 text-center">
      <BrandMark size={44} className="animate-pulse" />
      {offline && (
        <p className="max-w-xs text-sm text-muted" role="status">
          {t("Can’t reach Badya Spaces right now. Check your connection — we’ll keep trying.")}
        </p>
      )}
    </div>
  );
}

function RequireAuth({ children, permission, roles }: { children: ReactNode; permission?: Permission; roles?: string[] }) {
  const user = useSession((s) => s.user);
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if ((permission && !user.permissions.includes(permission)) || (roles && !roles.includes(user.role))) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
        <EmptyState
          icon={ShieldAlert}
          title={t("This area isn’t available to you")}
          body={t("Your account doesn’t have access to this part of Badya Spaces. If you think it should, contact the facilities office.")}
          action={
            <Button onClick={() => (window.location.hash = homeFor(user.role))} variant="secondary">
              {t("Go to my home")}
            </Button>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}

function RootRedirect() {
  const user = useSession((s) => s.user);
  return <Navigate to={user ? homeFor(user.role) : "/login"} replace />;
}

function NotFound() {
  const user = useSession((s) => s.user);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <EmptyState icon={ShieldAlert} title={t("Page not found")} body={t("The page you’re looking for doesn’t exist or has moved.")} action={<Button onClick={() => (window.location.hash = homeFor(user?.role))}>{t("Back to home")}</Button>} />
    </div>
  );
}

const lazyPage = (el: ReactNode) => <Suspense fallback={<div className="p-8" />}>{el}</Suspense>;

/**
 * A screen failed to load or crashed. After an update, a tab still running the
 * previous version can't load the new screens' files: reload once to get the
 * new version. Anything else gets a plain message instead of a stack trace.
 */
function RouteError() {
  const error = useRouteError();
  const stale = isStaleBuildError(error);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!stale) console.error(error);
    else if (!reloadForUpdate()) setGaveUp(true);
  }, [error, stale]);
  if (stale && !gaveUp) return <Splash />;
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
      <EmptyState
        icon={stale ? RefreshCw : ShieldAlert}
        title={stale ? t("A new version is available") : t("Something went wrong")}
        body={stale ? t("Badya Spaces was updated. Reload to continue.") : t("This page ran into a problem. Reload to try again — if it keeps happening, contact the facilities office.")}
        action={<Button onClick={() => window.location.reload()}>{t("Reload")}</Button>}
      />
    </div>
  );
}

const router = createHashRouter([
  {
    errorElement: <RouteError />,
    children: [
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <RootRedirect /> },
  {
    element: (
      <RequireAuth roles={["student"]}>
        <StudentLayout />
      </RequireAuth>
    ),
    children: [
      { path: "/home", element: <HomePage /> },
      { path: "/explore", element: <ExplorePage /> },
      { path: "/facility/:id", element: <FacilityPage /> },
      { path: "/bookings", element: <MyBookingsPage /> },
      { path: "/bookings/:id", element: <BookingDetailPage /> },
      { path: "/bookings/:id/confirmed", element: <ConfirmationPage /> },
      { path: "/calendar", element: <CalendarPage /> },
      { path: "/notifications", element: <NotificationsPage /> },
      { path: "/favorites", element: <FavoritesPage /> },
      { path: "/profile", element: <ProfilePage /> },
    ],
  },
  {
    element: (
      <RequireAuth permission="schedule.view">
        <StaffLayout />
      </RequireAuth>
    ),
    children: [
      { path: "/staff", element: <StaffTodayPage /> },
      { path: "/staff/scan", element: <ScannerPage /> },
      { path: "/staff/facilities", element: <StaffFacilitiesPage /> },
    ],
  },
  {
    element: (
      <RequireAuth permission="analytics.view">
        <AdminLayout />
      </RequireAuth>
    ),
    children: [
      { path: "/admin", element: lazyPage(<AdminDashboard />) },
      { path: "/admin/facilities", element: lazyPage(<AdminFacilities />) },
      { path: "/admin/facilities/new", element: lazyPage(<AdminFacilityEditor />) },
      { path: "/admin/facilities/:id", element: lazyPage(<AdminFacilityEditor />) },
      { path: "/admin/bookings", element: lazyPage(<AdminBookings />) },
      { path: "/admin/students", element: lazyPage(<AdminStudents />) },
      { path: "/admin/policies", element: lazyPage(<AdminPolicies />) },
      { path: "/admin/maintenance", element: lazyPage(<AdminMaintenance />) },
      { path: "/admin/waitlists", element: lazyPage(<AdminWaitlists />) },
      { path: "/admin/fairness", element: lazyPage(<AdminFairness />) },
      { path: "/admin/devices", element: lazyPage(<AdminDevices />) },
      { path: "/admin/analytics", element: lazyPage(<AdminAnalytics />) },
      { path: "/admin/audit", element: lazyPage(<AdminAudit />) },
      { path: "/admin/settings", element: lazyPage(<AdminSettings />) },
    ],
  },
  { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  const ready = useSession((s) => s.ready);
  const signedIn = useSession((s) => !!s.user);
  useLiveUpdates(signedIn);
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const { setUser, setReady, expire } = useSession.getState();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      api.auth
        .me()
        .then((u) => {
          adoptAccountLanguage(u?.preferences?.language);
          setUser(u);
          setReady();
        })
        .catch((e) => {
          // A network hiccup or server restart isn't a sign-out — keep trying.
          if (e instanceof ApiError && e.code === "NETWORK") {
            setOffline(true);
            retry = setTimeout(load, 3000);
            return;
          }
          expire(e.message);
          setReady();
        });
    load();
    return () => clearTimeout(retry);
  }, []);
  if (!ready) return <Splash offline={offline} />;
  return (
    <>
      <RouterProvider router={router} />
      <MustChangePassword />
      <Toaster />
    </>
  );
}

/** Someone signed in with a temporary password (set by an administrator): they choose their own first. */
function MustChangePassword() {
  const must = useSession((s) => !!s.user?.mustChangePassword);
  return <ChangePasswordDialog open={must} onClose={() => undefined} required />;
}
