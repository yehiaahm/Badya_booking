import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, UserPlus, X } from "lucide-react";
import { api, type BookingView } from "@/api";
import { useNow } from "@/lib/hooks";
import { errorMessage } from "@/lib/queries";
import { fmtRange, fmtTime, isSameDay, relDay } from "@/lib/time";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { L, t } from "@/i18n";

/** Accept or decline from your own phone. Accepting checks your own limits — the booker never sees why you can't. */
export function useRespond(bookingId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answer: "accept" | "decline") => api.bookings.respond(bookingId, answer),
    onSuccess: (b, answer) => {
      qc.invalidateQueries();
      if (answer === "decline") toast.info(t("Invitation declined"), t("{name} has been told.", { name: b.booker.name.split(" ")[0] }));
      else if (b.status === "CONFIRMED") toast.success(t("You’re in — the booking is confirmed"), t("It now counts towards your own limits."));
      else toast.success(t("You’re in"), t("The booking is confirmed once enough players accept."));
    },
    onError: (e) => toast.error(t("Couldn’t join"), errorMessage(e)),
  });
}

export function InvitationCard({ b }: { b: BookingView }) {
  const now = useNow(30000);
  const respond = useRespond(b.id);
  const deadline = b.playersDeadline ? new Date(b.playersDeadline) : null;
  return (
    <motion.article layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-[22px] border border-brand/30 bg-surface shadow-sm ring-4 ring-brand/5">
      <Link to={`/bookings/${b.id}`} className="flex gap-3.5 p-4">
        <FacilityArt motif={b.facility.media.motif} accent={b.facility.media.accent} imageUrl={b.facility.media.imageUrl} className="size-14 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand">
            <UserPlus className="size-3.5" /> {t("Invitation")}
          </p>
          <h3 className="truncate text-[15px] font-bold text-ink">{b.facility.name}</h3>
          <p className="text-[13px] font-semibold text-ink-2 tabular">
            {relDay(b.start, now)}{L(", ", "، ")}{fmtRange(b.start, b.end)}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <Avatar name={b.booker.name} hue={b.booker.avatarHue} size={18} />
            {t("{name} invited you", { name: b.booker.name })}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-2 border-t border-line bg-surface-2/50 px-4 py-2.5">
        {deadline && (
          <p className="flex flex-1 items-center gap-1.5 text-xs text-muted">
            <Clock className="size-3.5" />
            {t("Answer by {time}", { time: isSameDay(deadline, now) ? fmtTime(deadline) : `${relDay(deadline, now)} ${fmtTime(deadline)}` })}
          </p>
        )}
        <div className="ms-auto flex gap-2">
          <Button size="sm" variant="ghost" icon={<X className="size-4" />} loading={respond.isPending && respond.variables === "decline"} disabled={respond.isPending} onClick={() => respond.mutate("decline")}>
            {t("Decline")}
          </Button>
          <Button size="sm" icon={<Check className="size-4" />} loading={respond.isPending && respond.variables === "accept"} disabled={respond.isPending} onClick={() => respond.mutate("accept")}>
            {t("Accept")}
          </Button>
        </div>
      </div>
    </motion.article>
  );
}

/** Open invitations, newest session first. Renders nothing when there are none. */
export function Invitations({ bookings, className }: { bookings: BookingView[]; className?: string }) {
  if (bookings.length === 0) return null;
  return (
    <section className={className ?? "mt-4"} aria-label={t("Invitations")}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <AnimatePresence initial={false}>
          {bookings.map((b) => (
            <InvitationCard key={b.id} b={b} />
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
