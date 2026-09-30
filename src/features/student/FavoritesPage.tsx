import { useNavigate } from "react-router";
import { AnimatePresence } from "motion/react";
import { Compass, Heart } from "lucide-react";
import { useFacilities, useFavorites } from "@/lib/queries";
import { FacilityCard, FacilityCardSkeleton } from "@/components/facility/FacilityCard";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/Primitives";
import { PageHeader } from "@/layouts/StudentLayout";
import { N, t } from "@/i18n";

export function FavoritesPage() {
  const nav = useNavigate();
  const q = useFavorites();
  // The heart toggles the facilities cache optimistically; read it so an
  // un-favorited card leaves this page straight away, not after the refetch.
  const facilities = useFacilities();
  const unfavorited = new Set((facilities.data ?? []).filter((s) => !s.isFavorite).map((s) => s.facility.id));
  const list = (q.data ?? []).filter((s) => !unfavorited.has(s.facility.id));

  return (
    <div>
      <PageHeader title={t("Favorites")} subtitle={q.data ? (list.length ? t("{facilities} saved", { facilities: N.facility(list.length) }) : undefined) : undefined} />
      <div className="px-4 pt-2 sm:px-6">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <FacilityCardSkeleton key={i} />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            icon={Heart}
            title={t("No favorites yet")}
            body={t("Tap the heart on any facility to keep it here — handy for the pitch you book every week.")}
            action={
              <Button icon={<Compass className="size-4" />} onClick={() => nav("/explore")}>
                {t("Explore facilities")}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {list.map((s) => (
                <FacilityCard key={s.facility.id} s={{ ...s, isFavorite: true }} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
