import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { useMutation } from "@tanstack/react-query";
import { CalendarClock, Check, KeyRound, LogOut, Monitor, Moon, ShieldAlert, ShieldCheck, Smartphone, Sun, UserX, Undo2 } from "lucide-react";
import { api, type StandingInfo } from "@/api";
import type { NoShowStep, UserPreferences } from "@/domain/types";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage, useStanding, useTeammates } from "@/lib/queries";
import { fmtDayShort, format } from "@/lib/time";
import { useSession, useTheme, type ThemePref } from "@/state/session";
import { chooseLanguage, useLanguage } from "@/i18n/store";
import { useCanSignOut, useSignOut } from "@/components/shell/UserMenu";
import { ChangePasswordDialog } from "@/components/shell/ChangePasswordDialog";
import { PushCard } from "@/components/shell/PushCard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Form";
import { Avatar, Card, ErrorState, ProgressBar, Skeleton } from "@/components/ui/Primitives";
import { toast } from "@/components/ui/Toast";
import { PageHeader } from "@/layouts/StudentLayout";
import { L, N, arCount, t as tr, tStored } from "@/i18n";

const LEVEL = {
  good: { get title() {
    return tr("Good standing");
  }, get body() {
    return tr("No missed sessions on record. Keep checking in on time.");
  }, icon: ShieldCheck, tone: "bg-success-soft text-success", ring: "border-success/25" },
  warning: { get title() {
    return tr("Warning");
  }, get body() {
    return tr("You have missed sessions on record. Check in or cancel in time to avoid a pause.");
  }, icon: ShieldAlert, tone: "bg-warning-soft text-warning", ring: "border-warning/25" },
  final_warning: { get title() {
    return tr("Final warning");
  }, get body() {
    return tr("One more missed session will pause your booking access.");
  }, icon: ShieldAlert, tone: "bg-warning-soft text-warning", ring: "border-warning/40" },
  restricted: { get title() {
    return tr("Booking paused");
  }, get body() {
    return tr("You can’t make new bookings until the pause ends. Existing bookings are unaffected.");
  }, icon: ShieldAlert, tone: "bg-danger-soft text-danger", ring: "border-danger/30" },
} as const;

const stepLabel = (s: NoShowStep) => (s.action === "warning" ? tr("Warning") : s.action === "final_warning" ? tr("Final warning") : s.restrictDays ? tr("Paused {days}", { days: N.day(s.restrictDays) }) : tr("Paused"));

const REMINDERS = [
  { value: 15, get label() {
    return tr("15 minutes before");
  } },
  { value: 30, get label() {
    return tr("30 minutes before");
  } },
  { value: 60, get label() {
    return tr("1 hour before");
  } },
  { value: 120, get label() {
    return tr("2 hours before");
  } },
  { value: 1440, get label() {
    return tr("The day before");
  } },
];

const THEMES: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "light", get label() {
    return tr("Light");
  }, icon: Sun },
  { value: "dark", get label() {
    return tr("Dark");
  }, icon: Moon },
  { value: "system", get label() {
    return tr("System");
  }, icon: Monitor },
];

function StandingCard({ info }: { info: StandingInfo }) {
  const now = useNow(60000);
  const { standing } = info;
  const meta = LEVEL[standing.level];
  const count = standing.strikes.length;
  const top = standing.ladder.at(-1)?.strikes ?? 3;
  const active = info.strikesDetail.filter((s) => new Date(s.expiresAt) > now);
  const expired = info.strikesDetail.length - active.length;

  return (
    <Card id="standing" className={cn("scroll-mt-24 border p-5", meta.ring)}>
      <div className="flex items-start gap-3.5">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", meta.tone)}>
          <meta.icon className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-ink">{meta.title}</h2>
          <p className="text-sm text-muted">{meta.body}</p>
        </div>
      </div>

      {standing.restriction && (
        <div className="mt-4 rounded-2xl bg-danger-soft p-3.5 text-sm text-ink-2">
          <p>
            <span className="font-bold text-ink">{tr("You can book again on")}{" "}{format(new Date(standing.restriction.end), "EEEE d MMMM, HH:mm")}.</span> {tStored(standing.restriction.reason)}
          </p>
        </div>
      )}

      <div className="mt-5">
        <div className="flex items-center gap-1.5" role="img" aria-label={tr("{count} of {top} strikes", { count, top })}>
          {Array.from({ length: top }, (_, i) => (
            <motion.span key={i} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: i * 0.06 }} className={cn("h-2 flex-1 origin-left rounded-full", i < count ? (count >= top ? "bg-danger" : "bg-warning") : "bg-surface-3")} />
          ))}
        </div>
        <ol className="mt-2 flex justify-between gap-2 text-[11px] font-semibold text-muted">
          {standing.ladder.map((s) => (
            <li key={s.strikes} className={cn(count >= s.strikes && "text-ink")}>
              {s.strikes} · {stepLabel(s)}
            </li>
          ))}
        </ol>
      </div>

      {active.length > 0 && (
        <ul className="mt-5 divide-y divide-line rounded-2xl border border-line">
          {active.map((s) => (
            <li key={s.bookingId} className="flex items-center gap-3 p-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-danger-soft text-danger">{s.type === "no_show" ? <UserX className="size-4" /> : <Undo2 className="size-4" />}</span>
              <Link to={`/bookings/${s.bookingId}`} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-sm font-semibold text-ink">{s.facilityName}</span>
                <span className="block text-xs text-muted">
                  {s.type === "no_show" ? tr("Missed session") : tr("Late cancellation")} · {fmtDayShort(s.at)}
                </span>
              </Link>
              <span className="shrink-0 text-end text-xs text-muted">
                {tr("Expires")}
                <br />
                <span className="font-semibold text-ink-2">{fmtDayShort(s.expiresAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-relaxed text-muted">
        {expired > 0 && `${L(`${expired} older ${expired === 1 ? "strike has" : "strikes have"} expired and no longer count.`, `${arCount(expired, "مخالفة قديمة انتهت", "مخالفتان قديمتان انتهتا", "مخالفات قديمة انتهت", "مخالفة قديمة انتهت")} ولم تعد تُحتسب.`)} `}
        {tr("Missed a session for a good reason? The facilities office can waive a strike.")}
      </p>
    </Card>
  );
}

function LimitsCard({ info }: { info: StandingInfo }) {
  const tone = (v: number, max: number) => (v >= max ? "danger" : v >= max - 1 && max > 1 ? "warning" : "brand");
  return (
    <Card className="p-5">
      <h2 className="text-base font-bold text-ink">{tr("Your limits")}</h2>
      <p className="text-sm text-muted">{tr("Limits keep popular spaces fair. Participants on a booking count too.")}</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[
          { label: tr("Upcoming bookings"), v: info.campus.active, max: info.campus.maxActive },
          { label: tr("Waitlists"), v: info.campus.waitlists, max: info.campus.maxWaitlists },
        ].map((x) => (
          <div key={x.label} className="rounded-2xl bg-surface-2/70 p-3">
            <p className="text-xs font-semibold text-muted">{x.label}</p>
            <p className="mt-0.5 text-xl font-bold text-ink tabular">
              {x.v}
              <span className="text-sm font-semibold text-faint"> / {x.max}</span>
            </p>
            <ProgressBar value={x.v} max={x.max} tone={tone(x.v, x.max)} className="mt-2" label={tr("{label}: {v} of {max}", { label: x.label, v: x.v, max: x.max })} />
          </div>
        ))}
      </div>
      <ul className="mt-5 space-y-4">
        {info.usage.map((u) => (
          <li key={u.scopeId}>
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span className="size-2.5 rounded-full" style={{ background: u.color }} />
              {u.name}
            </p>
            <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-muted">
              {[
                { label: tr("Today"), v: u.today, max: u.perDay },
                { label: tr("This week"), v: u.week, max: u.perWeek },
                { label: tr("Upcoming"), v: u.active, max: u.maxActive },
              ].map((x) => (
                <div key={x.label}>
                  <p className="flex justify-between">
                    <span>{x.label}</span>
                    <span className="font-semibold text-ink-2 tabular">
                      {x.v}/{x.max}
                    </span>
                  </p>
                  <ProgressBar value={x.v} max={x.max} tone={tone(x.v, x.max)} className="mt-1" label={tr("{name}, {toLowerCase}: {v} of {max}", { name: u.name, toLowerCase: x.label.toLowerCase(), v: x.v, max: x.max })} />
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Preferences() {
  const user = useSession((s) => s.user)!;
  const theme = useTheme();
  const lang = useLanguage((s) => s.lang);
  const prefs: UserPreferences = { reminderMinutes: 60, waitlistAlerts: true, emailDigest: false, ...user.preferences };
  const save = useMutation({
    mutationFn: (p: Partial<UserPreferences>) => api.me.updatePreferences(p),
    onSuccess: (u) => {
      useSession.getState().setUser(u);
      toast.success(tr("Preferences saved"));
    },
    onError: (e) => toast.error(tr("Couldn’t save"), errorMessage(e)),
  });
  return (
    <Card id="preferences" className="scroll-mt-24 p-5">
      <h2 className="text-base font-bold text-ink">{tr("Preferences")}</h2>
      <div className="mt-4 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <CalendarClock className="size-4 text-muted" />{" "}{tr("Booking reminder")}
            </p>
            <p className="text-xs text-muted">{tr("When we nudge you before a session.")}</p>
          </div>
          <div className="w-48">
            <Select aria-label={tr("Booking reminder")} value={prefs.reminderMinutes} disabled={save.isPending} onChange={(e) => save.mutate({ reminderMinutes: Number(e.target.value) })}>
              {REMINDERS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {/* Waitlist offers are always sent (a hidden offer would just expire), and there is no email — so no switches for either. */}
        <div className="border-t border-line pt-5">
          <p className="mb-2 text-sm font-semibold text-ink">{tr("Language")}</p>
          <div className="inline-flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label={tr("Language")}>
            {(
              [
                ["ar", "العربية"],
                ["en", "English"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" role="radio" lang={value} aria-checked={lang === value} onClick={() => chooseLanguage(value, true)} className={cn("h-8 rounded-lg px-4 text-xs font-semibold transition-colors", lang === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="border-t border-line pt-5">
          <p className="mb-2 text-sm font-semibold text-ink">{tr("Appearance")}</p>
          <div className="inline-flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label={tr("Appearance")}>
            {THEMES.map((t) => (
              <button key={t.value} type="button" role="radio" aria-checked={theme.pref === t.value} onClick={() => theme.set(t.value)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors", theme.pref === t.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}>
                <t.icon className="size-3.5" /> {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function ProfilePage() {
  const user = useSession((s) => s.user)!;
  const standing = useStanding();
  const teammates = useTeammates();
  const signOut = useSignOut();
  const canSignOut = useCanSignOut();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div>
      <PageHeader title={tr("Profile")} />
      <div className="grid grid-cols-1 gap-6 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="flex items-center gap-4 p-5">
            <Avatar name={user.name} hue={user.avatarHue} size={64} ring />
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-ink">{user.name}</h2>
              <p className="truncate text-sm text-muted">{[user.universityId, tStored(user.faculty), user.year ? tr("Year {n}", { n: user.year }) : null].filter(Boolean).join(" · ")}</p>
              <p className="truncate text-sm text-muted">{user.email}</p>
            </div>
          </Card>

          {standing.isError ? <ErrorState compact error={standing.error} onRetry={() => standing.refetch()} /> : !standing.data ? <Skeleton className="h-72 rounded-[28px]" /> : <StandingCard info={standing.data} />}

          <Preferences />
        </div>

        <div className="space-y-6">
          {standing.data ? <LimitsCard info={standing.data} /> : !standing.isError && <Skeleton className="h-96 rounded-[28px]" />}

          <Card className="p-5">
            <h2 className="text-base font-bold text-ink">{tr("People you book with")}</h2>
            <p className="text-sm text-muted">{tr("From the last 60 days — add them to a booking in one tap.")}</p>
            {!teammates.data ? (
              <div className="mt-4 space-y-2">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : teammates.data.length === 0 ? (
              <p className="mt-4 rounded-2xl bg-surface-2/70 p-4 text-sm text-muted">{tr("Nobody yet. When you add people to a booking, they’ll show up here.")}</p>
            ) : (
              <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {teammates.data.map(({ user: p, shared }) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-surface-2/60 p-2.5">
                    <Avatar name={p.name} hue={p.avatarHue} size={34} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{p.name}</span>
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <Check className="size-3" /> {tr("{sessions} together", { sessions: N.session(shared) })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <PushCard />

          <Card className="p-5">
            <h2 className="text-base font-bold text-ink">{tr("Account")}</h2>
            <p className="mt-1 flex gap-2 text-sm text-muted">
              <Smartphone className="mt-0.5 size-4 shrink-0" />
              {tr("You stay signed in on this phone. To use your account on another phone, the facilities office has to approve it.")}
            </p>
            <Button variant="secondary" block className="mt-4" icon={<KeyRound className="size-4" />} onClick={() => setPwOpen(true)}>
              {tr("Change password")}
            </Button>
          </Card>
          {canSignOut && (
            <Button variant="danger-soft" block size="lg" icon={<LogOut className="size-4" />} onClick={signOut}>
              {tr("Sign out")}
            </Button>
          )}
          <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
        </div>
      </div>
    </div>
  );
}
