import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Clock, Info, ListOrdered, MapPin, Minus, Plus, Search, ShieldCheck, Sparkles, UserPlus, X } from "lucide-react";
import { api, ApiError, type FacilityDetail, type PublicUser } from "@/api";
import type { RuleCheck } from "@/domain/engine/rules";
import { cn, uid } from "@/lib/cn";
import { useDebounced, useNow } from "@/lib/hooks";
import { keys, useTeammates } from "@/lib/queries";
import { countdown, fmtDayLong, fmtRange, fmtTime, format } from "@/lib/time";
import { useSession } from "@/state/session";
import { Sheet } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Avatar, Skeleton } from "@/components/ui/Primitives";
import { Textarea } from "@/components/ui/Form";
import { toast } from "@/components/ui/Toast";
import { FacilityArt } from "@/components/facility/FacilityArt";
import { locationLabel } from "@/components/facility/FacilityCard";
import { t as tr, tStored } from "@/i18n";

/** The server looks people up by a full university ID or at least three letters of a name. */
const searchable = (q: string) => (/^\d+$/.test(q.trim()) ? q.trim().length >= 5 : q.trim().length >= 3);

export type BookingMode = { kind: "book" } | { kind: "claim"; entryId: string; expiresAt: string };

function CheckRow({ c, i }: { c: RuleCheck; i: number }) {
  return (
    <motion.li initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i, duration: 0.2 }} className="flex items-center gap-2.5 py-1 text-[13px]">
      <motion.span
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 0.08 * i + 0.1, type: "spring", stiffness: 500, damping: 22 }}
        className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", c.status === "pass" && "bg-success-soft text-success", c.status === "fail" && "bg-danger-soft text-danger", c.status === "warn" && "bg-warning-soft text-warning", c.status === "skip" && "bg-surface-3 text-faint")}
      >
        {c.status === "pass" ? <Check className="size-3" strokeWidth={3} /> : c.status === "fail" ? <X className="size-3" strokeWidth={3} /> : c.status === "warn" ? <span className="text-[11px] font-black">!</span> : <Minus className="size-3" />}
      </motion.span>
      <span className={cn(c.status === "skip" ? "text-faint" : "text-ink-2")}>{c.label}</span>
      {c.status === "skip" && <span className="ms-auto text-[11px] text-faint">{tr("Not needed")}</span>}
    </motion.li>
  );
}

export function BookingSheet({ open, onClose, facility, start, end, mode }: { open: boolean; onClose: () => void; facility: FacilityDetail; start: string; end: string; mode: BookingMode }) {
  const f = facility.facility;
  const policy = facility.policy;
  const me = useSession((s) => s.user)!;
  const nav = useNavigate();
  const qc = useQueryClient();
  const now = useNow(1000);
  const needsPeople = policy.participants.required && f.mode === "exclusive";
  const maxPeople = Math.min(policy.participants.max, f.capacity);
  const [people, setPeople] = useState<PublicUser[]>([]);
  const [term, setTerm] = useState("");
  const [purpose, setPurpose] = useState("");
  const [showChecks, setShowChecks] = useState(false);
  const [serverError, setServerError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);
  const idem = useMemo(() => uid(), [open, start]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    setPeople([]);
    setTerm("");
    setPurpose("");
    setServerError(null);
    setDone(false);
    setShowChecks(false);
  }, [open, start]);

  const ids = useDebounced(
    people.map((p) => p.id),
    200,
  );
  const evaluation = useQuery({
    queryKey: ["evaluate", f.id, start, ids],
    queryFn: () => api.facilities.evaluate({ facilityId: f.id, start, participantIds: ids }),
    enabled: open,
    placeholderData: (prev) => prev,
  });
  const teammates = useTeammates();
  const dTerm = useDebounced(term, 250);
  const search = useQuery({ queryKey: ["search-students", dTerm], queryFn: () => api.me.searchStudents(dTerm), enabled: open && needsPeople && searchable(dTerm) });

  const ev = evaluation.data;
  const personIssues = (ev?.blocking ?? []).filter((b) => b.personId);
  const countIssue = (ev?.blocking ?? []).find((b) => b.code === "participants_count");
  const otherBlocking = (ev?.blocking ?? []).filter((b) => !b.personId && b.code !== "participants_count");
  const canConfirm = !!ev && ev.ok && !evaluation.isFetching && ids.length === people.length;
  const passed = ev?.checks.filter((c) => c.status === "pass").length ?? 0;
  const relevant = ev?.checks.filter((c) => c.status !== "skip").length ?? 0;

  const add = (u: PublicUser) => {
    if (people.some((p) => p.id === u.id) || u.id === me.id) return;
    if (1 + people.length >= maxPeople) {
      toast.info(tr("That’s a full team"), tr("{name} allows up to {maxPeople} people.", { name: f.name, maxPeople }));
      return;
    }
    setPeople((p) => [...p, u]);
    setTerm("");
  };

  const submit = useMutation({
    mutationFn: async () => {
      const participantIds = people.map((p) => p.id);
      if (mode.kind === "claim") return api.waitlist.claim(mode.entryId, participantIds);
      return api.bookings.create({ facilityId: f.id, start, participantIds, purpose, idempotencyKey: idem });
    },
    onSuccess: (res) => {
      setDone(true);
      qc.invalidateQueries();
      setTimeout(() => {
        onClose();
        nav(`/bookings/${res.booking.id}/confirmed`, { state: { flagged: res.flagged } });
      }, 650);
    },
    onError: (e) => {
      setServerError(e instanceof ApiError ? e : new ApiError("NETWORK", tr("We couldn’t reach the server. Please try again.")));
      qc.invalidateQueries({ queryKey: keys.availability(f.id, format(new Date(start), "yyyy-MM-dd")) });
    },
  });

  const joinWaitlist = useMutation({
    mutationFn: () => api.waitlist.join(f.id, start),
    onSuccess: (w) => {
      toast.success(tr("You’re #{position} on the waitlist", { position: w.position }), tr("We’ll notify you the moment a spot opens."));
      qc.invalidateQueries();
      onClose();
    },
    onError: (e) => toast.error(tr("Couldn’t join the waitlist"), e instanceof ApiError ? e.message : undefined),
  });

  const claimLeft = mode.kind === "claim" ? new Date(mode.expiresAt).getTime() - now.getTime() : 0;
  const approval = policy.approval.required;
  const freeUntil = new Date(new Date(start).getTime() - policy.cancellation.freeUntilMinutes * 60000);
  const suggestions = (teammates.data ?? []).filter((t) => !people.some((p) => p.id === t.user.id));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode.kind === "claim" ? tr("Claim your spot") : approval ? tr("Request this session") : tr("Review your booking")}
      description={mode.kind === "claim" ? tr("This spot is being held just for you.") : undefined}
      size="md"
      footer={
        <>
          {serverError?.code === "CONFLICT" && (serverError.data as { canWaitlist?: boolean } | undefined)?.canWaitlist ? (
            <Button size="lg" block variant="soft" icon={<ListOrdered className="size-4" />} loading={joinWaitlist.isPending} onClick={() => joinWaitlist.mutate()}>
              {tr("Join the waitlist instead")}
            </Button>
          ) : (
            <Button size="lg" block disabled={!canConfirm || serverError !== null} loading={submit.isPending} success={done} onClick={() => submit.mutate()}>
              {mode.kind === "claim" ? tr("Claim spot") : approval ? tr("Send request") : tr("Confirm booking")}
            </Button>
          )}
          {serverError && (
            <Button size="md" block variant="ghost" onClick={onClose}>
              {tr("Choose another session")}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {mode.kind === "claim" && (
          <div className={cn("flex items-center gap-3 rounded-2xl p-3.5", claimLeft > 0 ? "bg-brand-soft text-brand-strong" : "bg-danger-soft text-danger")}>
            <Clock className="size-5 shrink-0" />
            <p className="text-sm font-semibold">{claimLeft > 0 ? <>{tr("Held for you for")}{" "}<span className="tabular">{countdown(claimLeft)}</span></> : tr("This offer has expired.")}</p>
          </div>
        )}

        {/* Summary */}
        <div className="flex gap-3.5 rounded-2xl border border-line bg-bg-elevated p-3">
          <FacilityArt motif={f.media.motif} accent={f.media.accent} imageUrl={f.media.imageUrl} className="size-[72px] shrink-0 rounded-xl" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold text-ink">{f.name}</p>
            <p className="text-sm font-semibold text-ink-2 tabular">{fmtDayLong(start)}</p>
            <p className="text-sm text-ink-2 tabular">
              {fmtRange(start, end)} · {f.sessionMinutes}{" "}{tr("min")}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
              <MapPin className="size-3" /> {locationLabel(f)}
              {f.mode === "exclusive" && f.units > 1 && ` · ${tr("{unit} assigned on confirm", { unit: f.unitLabel })}`}
            </p>
          </div>
        </div>

        {/* Participants */}
        {needsPeople && (
          <section aria-labelledby="who-heading">
            <div className="mb-2 flex items-baseline justify-between">
              <h3 id="who-heading" className="text-sm font-bold text-ink">
                {tr("Who’s playing?")}
              </h3>
              <span className={cn("text-xs font-semibold tabular", countIssue ? "text-warning" : "text-success")}>
                {1 + people.length}{" "}{tr("of")}{" "}{policy.participants.min}–{maxPeople}
              </span>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-muted">{tr("List everyone by name or university ID. Everyone listed follows the same fair-use limits and gets a notification.")}</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-soft ps-1 pe-3 text-xs font-semibold text-brand-strong">
                <Avatar name={me.name} hue={me.avatarHue} size={24} />{" "}{tr("You")}
              </span>
              <AnimatePresence initial={false}>
                {people.map((p) => {
                  const issue = personIssues.find((x) => x.personId === p.id);
                  return (
                    <motion.span key={p.id} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border ps-1 pe-1 text-xs font-semibold", issue ? "border-danger/40 bg-danger-soft text-danger" : "border-line bg-surface text-ink")}>
                      <Avatar name={p.name} hue={p.avatarHue} size={24} />
                      {p.name.split(" ")[0]}
                      <button onClick={() => setPeople((x) => x.filter((y) => y.id !== p.id))} aria-label={tr("Remove {name}", { name: p.name })} className="rounded-full p-1 text-muted hover:bg-surface-2 hover:text-ink">
                        <X className="size-3" />
                      </button>
                    </motion.span>
                  );
                })}
              </AnimatePresence>
            </div>
            <AnimatePresence>
              {personIssues.map((iss) => {
                const p = people.find((x) => x.id === iss.personId);
                return (
                  <motion.div key={iss.personId! + iss.code} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-2 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span className="flex-1">{iss.message}</span>
                    {p && (
                      <button className="font-bold underline" onClick={() => setPeople((x) => x.filter((y) => y.id !== p.id))}>
                        {tr("Remove")}
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {suggestions.length > 0 && 1 + people.length < maxPeople && (
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-muted">
                    <Sparkles className="size-3.5 text-brand" />{" "}{tr("People you often play with")}
                  </p>
                  <button
                    className="text-xs font-bold text-brand hover:underline"
                    onClick={() =>
                      setPeople((cur) => {
                        const room = maxPeople - 1 - cur.length;
                        const needed = Math.max(0, policy.participants.min - 1 - cur.length);
                        const take = Math.min(room, Math.max(needed, 0) || room);
                        return [...cur, ...suggestions.slice(0, take).map((s) => s.user)];
                      })
                    }
                  >
                    {tr("Add squad")}
                  </button>
                </div>
                <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                  {suggestions.map((s) => (
                    <button key={s.user.id} onClick={() => add(s.user)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-line-strong bg-surface ps-1 pe-2.5 text-xs font-semibold text-ink-2 hover:border-brand hover:text-brand">
                      <Avatar name={s.user.name} hue={s.user.avatarHue} size={22} />
                      {s.user.name.split(" ")[0]}
                      <Plus className="size-3" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="relative mt-3">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
              <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={tr("Name, or their full university ID")} aria-label={tr("Search students to add")} className="h-11 w-full rounded-xl border border-line bg-surface ps-9 pe-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-[var(--ring)]" />
              <AnimatePresence>
                {searchable(dTerm) && term && (
                  <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-2xl border border-line bg-surface p-1 shadow-lg">
                    {search.isFetching && !search.data && <li className="px-3 py-2 text-xs text-muted">{tr("Searching…")}</li>}
                    {search.data?.length === 0 && <li className="px-3 py-2.5 text-xs text-muted">{tr("No students match “")}{dTerm}{tr("”. Check the ID on their student card.")}</li>}
                    {search.data?.map((u) => (
                      <li key={u.id}>
                        <button onClick={() => add(u)} disabled={people.some((p) => p.id === u.id)} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start hover:bg-surface-2 disabled:opacity-40">
                          <Avatar name={u.name} hue={u.avatarHue} size={28} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-ink">{u.name}</span>
                            <span className="block text-xs text-muted">
                              {u.universityId} · {tStored(u.faculty)}
                            </span>
                          </span>
                          <UserPlus className="size-4 text-brand" />
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
            {countIssue && <p className="mt-2 text-xs font-medium text-warning">{countIssue.message}</p>}
          </section>
        )}

        {approval && (
          <section>
            <label htmlFor="purpose" className="mb-1.5 block text-sm font-bold text-ink">
              {tr("What’s it for?")}{" "}<span className="font-normal text-faint">{tr("(helps staff approve faster)")}</span>
            </label>
            <Textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={tr("e.g. Team training before the university tournament")} className="min-h-20" />
          </section>
        )}

        {/* Server-side rejection */}
        <AnimatePresence>
          {serverError && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="rounded-2xl border border-danger/25 bg-danger-soft p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-danger">
                <AlertTriangle className="size-4" />
                {serverError.code === "CONFLICT" ? tr("Someone just took the last spot") : serverError.code === "NETWORK" ? tr("Connection problem") : tr("This booking can’t go ahead")}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{serverError.code === "CONFLICT" ? tr("Another student confirmed this session a moment before you. Nothing was charged to your limits.") : serverError.message}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {!serverError && otherBlocking.length > 0 && (
          <div role="alert" className="rounded-2xl border border-danger/25 bg-danger-soft p-4">
            <p className="text-sm font-bold text-danger">{otherBlocking[0].title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">{otherBlocking[0].message}</p>
          </div>
        )}

        {/* Rules check */}
        <section className="rounded-2xl border border-line">
          <button onClick={() => setShowChecks((s) => !s)} className="flex w-full items-center gap-3 p-3.5 text-start" aria-expanded={showChecks}>
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", ev?.ok ? "bg-success-soft text-success" : "bg-surface-2 text-muted")}>
              <ShieldCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink">{!ev ? tr("Checking booking rules…") : ev.ok ? tr("All {n} booking rules passed", { n: relevant }) : tr("{passed} of {n} rules passed", { passed, n: relevant })}</span>
              <span className="block text-xs text-muted">{tr("Fair-use, limits and capacity — checked again when you confirm.")}</span>
            </span>
            <ChevronDown className={cn("size-4 text-muted transition-transform", showChecks && "rotate-180")} />
          </button>
          <AnimatePresence initial={false}>
            {showChecks && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <ul className="border-t border-line px-4 py-2.5">{ev ? ev.checks.map((c, i) => <CheckRow key={c.id} c={c} i={i} />) : <Skeleton className="h-24" />}</ul>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Warnings & notes */}
        {ev && ev.warnings.length > 0 && (
          <ul className="space-y-2">
            {ev.warnings.map((w) => (
              <li key={w.code} className={cn("flex gap-2.5 rounded-2xl p-3.5 text-[13px] leading-relaxed", w.severity === "warn" ? "bg-warning-soft text-ink-2" : "bg-info-soft text-ink-2")}>
                <Info className={cn("mt-0.5 size-4 shrink-0", w.severity === "warn" ? "text-warning" : "text-info")} />
                <span>
                  <span className="font-bold text-ink">{w.title}. </span>
                  {w.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        {policy.cancellation.freeUntilMinutes > 0 && freeUntil > now && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Check className="size-3.5 text-success" />{" "}{tr("Free cancellation until {date} at {time}", { date: format(freeUntil, "EEE d MMM"), time: fmtTime(freeUntil) })}
          </p>
        )}
      </div>
    </Sheet>
  );
}
