import { useEffect } from "react";
import { MutationCache, QueryCache, QueryClient, useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { api, ApiError, subscribeToChanges, type BookingQuery, type AuditQuery } from "@/api";
import { useSession } from "@/state/session";
import { t } from "@/i18n";

/**
 * Data access for the UI. Every screen reads through these hooks, so moving
 * from the mock backend to a real API means changing `src/api` only.
 */

function onError(e: unknown) {
  if (e instanceof ApiError && e.code === "UNAUTHENTICATED" && useSession.getState().user) {
    useSession.getState().expire(e.message);
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (count, e) => !(e instanceof ApiError && ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "RULE_VIOLATION"].includes(e.code)) && count < 1,
      refetchOnWindowFocus: false,
    },
  },
});

/**
 * Live updates while signed in: any change on the server — another student's
 * booking, a check-in, the scheduler — refreshes what's on screen.
 */
export function useLiveUpdates(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = subscribeToChanges(() => {
      clearTimeout(timer);
      timer = setTimeout(() => queryClient.invalidateQueries(), 150);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [enabled]);
}

/** Public app settings (product name, email domains, faculties, demo mode). */
export const useAppConfig = () => useQuery({ queryKey: ["app-config"], queryFn: () => api.auth.config(), staleTime: 5 * 60_000 });

export const keys = {
  facilities: ["facilities"] as const,
  categories: ["categories"] as const,
  facility: (id: string) => ["facility", id] as const,
  availability: (id: string, day: string) => ["availability", id, day] as const,
  myBookings: ["bookings", "mine"] as const,
  booking: (id: string) => ["booking", id] as const,
  myWaitlist: ["waitlist", "mine"] as const,
  notifications: ["notifications"] as const,
  favorites: ["favorites"] as const,
  standing: ["standing"] as const,
  teammates: ["teammates"] as const,
};

/* ───────────── Student ───────────── */

export const useFacilities = () => useQuery({ queryKey: keys.facilities, queryFn: () => api.facilities.list() });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: () => api.facilities.categories(), staleTime: 60_000 });
export const useFacility = (id: string) => useQuery({ queryKey: keys.facility(id), queryFn: () => api.facilities.get(id) });
export const useAvailability = (id: string, day: string) => useQuery({ queryKey: keys.availability(id, day), queryFn: () => api.facilities.availability(id, day), placeholderData: keepPreviousData });
export const useMyBookings = () => useQuery({ queryKey: keys.myBookings, queryFn: () => api.bookings.mine() });
export const useBooking = (id: string) => useQuery({ queryKey: keys.booking(id), queryFn: () => api.bookings.get(id) });
export const useMyWaitlist = () => useQuery({ queryKey: keys.myWaitlist, queryFn: () => api.waitlist.mine() });
export const useNotifications = () => useQuery({ queryKey: keys.notifications, queryFn: () => api.me.notifications(), refetchInterval: 30_000 });
export const useFavorites = () => useQuery({ queryKey: keys.favorites, queryFn: () => api.me.favorites() });
export const useStanding = () => useQuery({ queryKey: keys.standing, queryFn: () => api.me.standing() });
export const useTeammates = () => useQuery({ queryKey: keys.teammates, queryFn: () => api.me.teammates(), staleTime: 60_000 });

export function useQrToken(bookingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["qr", bookingId],
    queryFn: () => api.bookings.qr(bookingId),
    enabled,
    staleTime: 0,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d ? Math.max(1000, new Date(d.expiresAt).getTime() - Date.now() + 250) : 5000;
    },
    retry: false,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (facilityId: string) => api.me.toggleFavorite(facilityId),
    onMutate: async (facilityId: string) => {
      // Optimistic: flip the heart immediately.
      await qc.cancelQueries({ queryKey: keys.facilities });
      const prev = qc.getQueryData<Awaited<ReturnType<typeof api.facilities.list>>>(keys.facilities);
      if (prev) qc.setQueryData(keys.facilities, prev.map((f) => (f.facility.id === facilityId ? { ...f, isFavorite: !f.isFavorite } : f)));
      const detail = qc.getQueryData<Awaited<ReturnType<typeof api.facilities.get>>>(keys.facility(facilityId));
      if (detail) qc.setQueryData(keys.facility(facilityId), { ...detail, isFavorite: !detail.isFavorite });
      return { prev, detail };
    },
    onError: (_e, id, ctx) => {
      if (ctx?.prev) qc.setQueryData(keys.facilities, ctx.prev);
      if (ctx?.detail) qc.setQueryData(keys.facility(id), ctx.detail);
    },
  });
}

/* ───────────── Staff ───────────── */

export const useStaffOverview = () => useQuery({ queryKey: ["staff", "overview"], queryFn: () => api.staff.overview(), refetchInterval: 30_000 });

/* ───────────── Admin ───────────── */

export const useAdminDashboard = () => useQuery({ queryKey: ["admin", "dashboard"], queryFn: () => api.admin.dashboard() });
export const useAdminFacilities = () => useQuery({ queryKey: ["admin", "facilities"], queryFn: () => api.admin.facilities() });
export const useAdminBookings = (q: BookingQuery) => useQuery({ queryKey: ["admin", "bookings", q], queryFn: () => api.admin.bookings(q), placeholderData: keepPreviousData });
export const useAdminStudents = (q: { q?: string; level?: string; faculty?: string; page?: number }) => useQuery({ queryKey: ["admin", "students", q], queryFn: () => api.admin.students(q), placeholderData: keepPreviousData });
export const useAdminStudent = (id: string | null) => useQuery({ queryKey: ["admin", "student", id], queryFn: () => api.admin.student(id!), enabled: !!id });
export const usePolicies = () => useQuery({ queryKey: ["admin", "policies"], queryFn: () => api.admin.policies() });
export const useMaintenance = () => useQuery({ queryKey: ["admin", "maintenance"], queryFn: () => api.admin.maintenance() });
export const useAdminWaitlists = () => useQuery({ queryKey: ["admin", "waitlists"], queryFn: () => api.admin.waitlists() });
export const useDeviceRequests = () => useQuery({ queryKey: ["admin", "device-requests"], queryFn: () => api.admin.deviceRequests() });
export const useFlags = () => useQuery({ queryKey: ["admin", "flags"], queryFn: () => api.admin.flags() });
export const useAnalytics = (days: number) => useQuery({ queryKey: ["admin", "analytics", days], queryFn: () => api.admin.analytics(days), placeholderData: keepPreviousData });
export const useAudit = (q: AuditQuery) => useQuery({ queryKey: ["admin", "audit", q], queryFn: () => api.admin.audit(q), placeholderData: keepPreviousData });
export const useSettings = () => useQuery({ queryKey: ["admin", "settings"], queryFn: () => api.admin.settings() });
export const useTeam = () => useQuery({ queryKey: ["admin", "team"], queryFn: () => api.admin.team() });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  return t("Something went wrong. Please try again.");
}
