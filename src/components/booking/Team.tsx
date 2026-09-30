import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, LogOut, Search, UserPlus, Users, X } from "lucide-react";
import { api, type BookingView, type PublicUser } from "@/api";
import type { ParticipantStatus } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useDebounced } from "@/lib/hooks";
import { errorMessage } from "@/lib/queries";
import { Sheet } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Avatar, Card } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { t, tStored } from "@/i18n";

/** The server looks people up by a full university ID or at least three letters of a name. */
const searchable = (q: string) => (/^\d+$/.test(q.trim()) ? q.trim().length >= 5 : q.trim().length >= 3);

const STATUS: Record<ParticipantStatus, { label: () => string; icon: typeof Check; tone: string }> = {
  accepted: { label: () => t("Accepted"), icon: Check, tone: "bg-success-soft text-success" },
  invited: { label: () => t("Invited"), icon: Clock, tone: "bg-warning-soft text-warning" },
  declined: { label: () => t("Can’t make it"), icon: X, tone: "bg-surface-2 text-muted" },
  left: { label: () => t("Dropped out"), icon: LogOut, tone: "bg-surface-2 text-muted" },
};

/** Everyone on the booking and where their invitation stands. The booker can withdraw open invitations and invite more. */
export function TeamCard({ b }: { b: BookingView }) {
  const qc = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const upcoming = (b.status === "AWAITING_PLAYERS" || b.status === "CONFIRMED" || b.status === "PENDING") && new Date(b.start) > new Date();
  const listed = b.team.filter((p) => p.status === "accepted" || p.status === "invited").length;
  const room = b.peopleLimits.max - 1 - listed;
  const withdraw = useMutation({
    mutationFn: (userId: string) => api.bookings.uninvite(b.id, userId),
    onSuccess: () => qc.invalidateQueries(),
    onError: (e) => toast.error(t("Couldn’t withdraw the invitation"), errorMessage(e)),
  });
  if (b.team.length === 0 && !(b.relation === "booker" && upcoming && room > 0 && b.peopleLimits.max > 1)) return null;
  const accepted = b.team.filter((p) => p.status === "accepted").length + 1;
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-ink">
          <Users className="size-4 text-muted" /> {t("Players")}
        </h2>
        <span className="text-xs font-semibold text-muted tabular">{t("{n} of {min}–{max} in", { n: accepted, min: b.peopleLimits.min, max: b.peopleLimits.max })}</span>
      </div>
      <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <li className="flex items-center gap-3 rounded-2xl bg-surface-2/60 p-2.5">
          <Avatar name={b.booker.name} hue={b.booker.avatarHue} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink">{b.booker.name}</span>
            <span className="block text-xs text-muted">{t("Booked by")}</span>
          </span>
        </li>
        {b.team.map(({ user, status }) => {
          const s = STATUS[status];
          return (
            <li key={user.id} className={cn("flex items-center gap-3 rounded-2xl bg-surface-2/60 p-2.5", (status === "declined" || status === "left") && "opacity-60")}>
              <Avatar name={user.name} hue={user.avatarHue} size={34} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
                <span className="block truncate text-xs text-muted">{tStored(user.faculty)}</span>
              </span>
              <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-bold", s.tone)}>
                <s.icon className="size-3" /> {s.label()}
              </span>
              {b.relation === "booker" && status === "invited" && upcoming && (
                <button type="button" onClick={() => withdraw.mutate(user.id)} disabled={withdraw.isPending} className="rounded-lg p-1 text-muted hover:bg-surface-3 hover:text-ink" aria-label={t("Withdraw the invitation to {name}", { name: user.name })}>
                  <X className="size-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {b.relation === "booker" && upcoming && room > 0 && (
        <Button variant="secondary" block className="mt-3" icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
          {t("Invite players")}
        </Button>
      )}
      <InviteSheet b={b} open={inviting} onClose={() => setInviting(false)} room={room} />
    </Card>
  );
}

function InviteSheet({ b, open, onClose, room }: { b: BookingView; open: boolean; onClose: () => void; room: number }) {
  const qc = useQueryClient();
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<PublicUser[]>([]);
  const dTerm = useDebounced(term, 250);
  const onBooking = new Set([b.userId, ...b.team.filter((p) => p.status === "accepted" || p.status === "invited").map((p) => p.user.id)]);
  const search = useQuery({ queryKey: ["search-students", dTerm], queryFn: () => api.me.searchStudents(dTerm), enabled: open && searchable(dTerm) });
  const send = useMutation({
    mutationFn: () => api.bookings.invite(b.id, picked.map((p) => p.id)),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success(t("Invitations sent"), t("They’ll get a notification and can accept from their phone."));
      setPicked([]);
      setTerm("");
      onClose();
    },
    onError: (e) => toast.error(t("Couldn’t send the invitations"), errorMessage(e)),
  });
  const add = (u: PublicUser) => {
    if (onBooking.has(u.id) || picked.some((p) => p.id === u.id) || picked.length >= room) return;
    setPicked((x) => [...x, u]);
    setTerm("");
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("Invite players")}
      description={t("Each player accepts from their own phone. Room for {n} more.", { n: room })}
      size="md"
      footer={
        <Button size="lg" block disabled={picked.length === 0} loading={send.isPending} onClick={() => send.mutate()}>
          {picked.length ? t("Send invitations ({n})", { n: picked.length }) : t("Pick someone to invite")}
        </Button>
      }
    >
      <div className="space-y-3">
        {picked.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {picked.map((p) => (
              <span key={p.id} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface ps-1 pe-1 text-xs font-semibold text-ink">
                <Avatar name={p.name} hue={p.avatarHue} size={24} />
                {p.name.split(" ")[0]}
                <button onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))} aria-label={t("Remove {name}", { name: p.name })} className="rounded-full p-1 text-muted hover:bg-surface-2 hover:text-ink">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("Name, or their full university ID")} aria-label={t("Search students to add")} className="h-11 w-full rounded-xl border border-line bg-surface ps-9 pe-3 text-sm outline-none focus:border-brand focus:ring-4 focus:ring-[var(--ring)]" />
        </div>
        {searchable(dTerm) && term && (
          <ul className="max-h-64 overflow-y-auto rounded-2xl border border-line bg-surface p-1">
            {search.isFetching && !search.data && <li className="px-3 py-2 text-xs text-muted">{t("Searching…")}</li>}
            {search.data?.length === 0 && <li className="px-3 py-2.5 text-xs text-muted">{t("No students match “")}{dTerm}{t("”. Check the ID on their student card.")}</li>}
            {search.data?.map((u) => (
              <li key={u.id}>
                <button onClick={() => add(u)} disabled={onBooking.has(u.id) || picked.some((p) => p.id === u.id)} className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-start hover:bg-surface-2 disabled:opacity-40">
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
          </ul>
        )}
      </div>
    </Sheet>
  );
}
