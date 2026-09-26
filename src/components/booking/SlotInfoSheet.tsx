import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Info, ListOrdered, Lock, ShieldAlert, Wrench } from "lucide-react";
import { api, ApiError, type SlotView } from "@/api";
import { fmtDayLong, fmtRange, format } from "@/lib/time";
import { Sheet } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { L, arCount, currentLanguage, t } from "@/i18n";

/**
 * "Why can't I book this?" — every unavailable slot explains itself in plain
 * language and offers the next best action.
 */
export function SlotInfoSheet({ slot, facilityId, facilityName, claimMinutes, suggestion, onClose, onPickSuggestion }: { slot: SlotView | null; facilityId: string; facilityName: string; claimMinutes: number; suggestion?: SlotView; onClose: () => void; onPickSuggestion: (s: SlotView) => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const join = useMutation({
    mutationFn: () => api.waitlist.join(facilityId, slot!.session.start),
    onSuccess: (w) => {
      qc.invalidateQueries();
      toast.success(t("You’re #{position} on the waitlist", { position: w.position }), t("We’ll hold a spot for you for {claimMinutes} minutes when one opens.", { claimMinutes: w.claimMinutes }));
      onClose();
    },
    onError: (e) => toast.error(t("Couldn’t join the waitlist"), e instanceof ApiError ? e.message : undefined),
  });
  const leave = useMutation({
    mutationFn: () => api.waitlist.leave(slot!.waitlistEntryId!),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.info(t("You left the waitlist"));
      onClose();
    },
  });
  if (!slot) return <Sheet open={false} onClose={onClose}>{null}</Sheet>;

  const s = slot.session;
  const when = `${fmtDayLong(s.start)} · ${fmtRange(s.start, s.end)}`;
  let icon = <Info className="size-6" />;
  let tone = "bg-surface-2 text-muted";
  let title = t("Not available");
  let body: React.ReactNode = slot.reasons[0]?.message;
  let actions: React.ReactNode = null;

  switch (slot.status) {
    case "waitlist":
      icon = <ListOrdered className="size-6" />;
      tone = "bg-violet-soft text-violet";
      title = t("Fully booked");
      body = (
        <>
          {s.capacity > 1 ? t("Every spot is taken.") : t("This session is taken.")}{" "}
          {s.waitlistCount > 0
            ? L(`${s.waitlistCount} ${s.waitlistCount === 1 ? "student is" : "students are"} waiting — you’d be #${s.waitlistCount + 1}.`, `${arCount(s.waitlistCount, "طالب واحد ينتظر", "طالبان ينتظران", "طلاب ينتظرون", "طالبًا ينتظرون")} — سيكون ترتيبك #${s.waitlistCount + 1}.`)
            : t("You’d be first in line.")}{" "}
          {t("When a spot opens we hold it for you for {n} minutes and send a notification.", { n: claimMinutes })}
        </>
      );
      actions = (
        <Button size="lg" block variant="primary" loading={join.isPending} icon={<ListOrdered className="size-4" />} onClick={() => join.mutate()}>
          {s.waitlistCount ? t("Join waitlist as #{n}", { n: s.waitlistCount + 1 }) : t("Join waitlist")}
        </Button>
      );
      break;
    case "waitlisted":
      icon = <ListOrdered className="size-6" />;
      tone = "bg-violet-soft text-violet";
      title = t("You’re #{position} on the waitlist", { position: slot.waitlistPosition });
      body = t("We’ll notify you as soon as a spot opens and hold it for {n} minutes.", { n: claimMinutes });
      actions = (
        <Button size="lg" block variant="secondary" loading={leave.isPending} onClick={() => leave.mutate()}>
          {t("Leave waitlist")}
        </Button>
      );
      break;
    case "full":
      title = t("Fully booked");
      body = slot.reasons.find((r) => r.code !== "full")?.message ?? t("This session is full and its waitlist isn’t accepting more students.");
      break;
    case "maintenance":
      icon = <Wrench className="size-6" />;
      tone = "bg-warning-soft text-warning";
      title = t("Closed for maintenance");
      body = s.maintenance ? t("{name} is closed {range} for {reason}. Sessions around it are unaffected.", { name: facilityName, range: fmtRange(s.maintenance.start, s.maintenance.end), reason: currentLanguage() === "ar" ? s.maintenance.reason : s.maintenance.reason.toLowerCase() }) : slot.reasons[0]?.message;
      break;
    case "not_open":
      icon = <CalendarClock className="size-6" />;
      tone = "bg-info-soft text-info";
      title = t("Not open for booking yet");
      body = slot.reasons[0]?.message ?? (s.opensAt ? t("Bookings for this day open on {date}.", { date: format(new Date(s.opensAt), "EEEE d MMMM") }) : undefined);
      break;
    case "blocked":
      icon = slot.reasons[0]?.code === "restricted" ? <ShieldAlert className="size-6" /> : <Lock className="size-6" />;
      tone = "bg-brand-soft text-brand-strong";
      title = slot.reasons[0]?.title ?? t("Not available to you");
      break;
    case "past":
      title = t("This session has started");
      body = t("Sessions can’t be booked once they’ve begun. Pick a later time.");
      break;
    case "closed":
      title = t("Booking has closed");
      body = slot.reasons[0]?.message ?? t("Booking for this session has closed.");
      break;
  }

  return (
    <Sheet
      open={!!slot}
      onClose={onClose}
      size="sm"
      bare
      footer={
        actions || suggestion ? (
          <>
            {actions}
            {suggestion && (
              <Button size={actions ? "md" : "lg"} block variant={actions ? "ghost" : "primary"} onClick={() => onPickSuggestion(suggestion)}>
                {t("Book {range} instead", { range: fmtRange(suggestion.session.start, suggestion.session.end) })}
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <div className="px-6 pt-6 pb-5">
        <div className={`mb-4 flex size-12 items-center justify-center rounded-2xl ${tone}`}>{icon}</div>
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        <p className="mt-0.5 text-sm font-medium text-muted tabular">{when}</p>
        {body && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{body}</p>}
        {slot.reasons.length > 1 && slot.status === "blocked" && (
          <details className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-ink-2">{L(`${slot.reasons.length - 1} more ${slot.reasons.length === 2 ? "reason" : "reasons"}`, arCount(slot.reasons.length - 1, "سبب آخر", "سببان آخران", "أسباب أخرى", "سببًا آخر"))}</summary>
            <ul className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">
              {slot.reasons.slice(1).map((r) => (
                <li key={r.code}>
                  <span className="font-semibold text-ink-2">{r.title}. </span>
                  {r.message}
                </li>
              ))}
            </ul>
          </details>
        )}
        {slot.status === "blocked" && slot.reasons[0]?.code === "restricted" && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => nav("/profile")}>
            {t("See my standing")}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
