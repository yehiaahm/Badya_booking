import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Eye, EyeOff, GraduationCap, Hourglass, IdCard, Info, Languages, LayoutDashboard, Lock, Mail, MessageSquareText, ScanLine, Send, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { api, ApiError, type SessionUser } from "@/api";
import { cn } from "@/lib/cn";
import { queryClient, useAppConfig } from "@/lib/queries";
import { homeFor, useSession } from "@/state/session";
import { adoptAccountLanguage, chooseLanguage, useLanguage } from "@/i18n/store";
import { BRAND_ASSETS, BrandLockup } from "@/components/brand/Brand";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { t as tr, tStored } from "@/i18n";

const ROLE_ICON = { student: GraduationCap, staff: ScanLine, admin: LayoutDashboard, super_admin: ShieldCheck };
const PENDING_KEY = "bs-device-request";
const MIN_PASSWORD = 8;

type SignInResult = Awaited<ReturnType<typeof api.auth.signIn>>;
type Reason = "new_device" | "device_in_use";
type Step = { kind: "signin" } | { kind: "register" } | { kind: "locked"; ticket: string; reason: Reason } | { kind: "waiting"; requestId: string; reason: Reason };

function readPending(): Step | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? { kind: "waiting", ...(JSON.parse(raw) as { requestId: string; reason: Reason }) } : null;
  } catch {
    return null;
  }
}
function savePending(v: { requestId: string; reason: string } | null) {
  try {
    if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    /* private mode */
  }
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : tr("We couldn’t sign you in. Please try again."));

export function LoginPage() {
  const user = useSession((s) => s.user);
  const notice = useSession((s) => s.notice);
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from;
  const config = useAppConfig();
  const lang = useLanguage((s) => s.lang);
  const [step, setStep] = useState<Step>(() => readPending() ?? { kind: "signin" });
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [profile, setProfile] = useState({ name: "", nameAr: "", email: "", universityId: "", faculty: "", year: 1, level: "undergraduate" as "undergraduate" | "postgraduate", password: "", confirm: "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const finish = (u: SessionUser) => {
    savePending(null);
    adoptAccountLanguage(u.preferences?.language);
    queryClient.clear();
    useSession.getState().setUser(u);
    const dest = from && ((u.role === "student" && !from.startsWith("/admin") && !from.startsWith("/staff")) || (u.role !== "student" && (from.startsWith("/admin") || from.startsWith("/staff")))) ? from : homeFor(u.role);
    nav(dest, { replace: true });
  };

  const handle = (r: SignInResult) => {
    setError(null);
    setPassword("");
    if (r.status === "signed_in") finish(r.user);
    else if (r.status === "device_locked") {
      setNote("");
      setStep({ kind: "locked", ticket: r.ticket, reason: r.kind });
    } else {
      savePending({ requestId: r.requestId, reason: r.kind });
      setStep({ kind: "waiting", requestId: r.requestId, reason: r.kind });
    }
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setError(null);
    setLoading(key);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(null);
    }
  };

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) return setError(tr("Enter your university ID or email and your password."));
    run("signin", async () => handle(await api.auth.signIn(identifier.trim(), password)));
  };

  const register = (e: FormEvent) => {
    e.preventDefault();
    if (!profile.faculty) return setError(tr("Choose your faculty."));
    if (profile.password.length < MIN_PASSWORD) return setError(tr("Use a password of at least {n} characters.", { n: MIN_PASSWORD }));
    if (profile.password !== profile.confirm) return setError(tr("The two passwords don’t match."));
    const { confirm: _confirm, ...p } = profile;
    run("register", async () => handle(await api.auth.register({ ...p, nameAr: p.nameAr || undefined })));
  };

  const contact = (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== "locked") return;
    run("contact", async () => handle(await api.auth.contactAdmin(step.ticket, note.trim() || undefined)));
  };

  const demoAccounts = config.data?.demo ? config.data.demoAccounts : [];
  const domains = config.data?.allowedEmailDomains ?? ["badya.edu.eg"];
  const supportEmail = config.data?.supportEmail;

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Visual side */}
      <div className="relative h-[34vh] min-h-64 overflow-hidden bg-dusk lg:sticky lg:top-0 lg:h-dvh">
        <motion.img src={BRAND_ASSETS.campus} alt={tr("Aerial view of the Badya University campus at dusk")} className="absolute inset-0 size-full object-cover" initial={{ scale: 1.08 }} animate={{ scale: 1 }} transition={{ duration: 2.4, ease: [0.22, 1, 0.36, 1] }} />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(10_17_27/0.55)_0%,rgb(10_17_27/0.15)_40%,rgb(10_17_27/0.85)_100%)]" />
        <div className="absolute inset-0 hidden bg-[radial-gradient(900px_500px_at_20%_110%,rgb(136_91_58/0.45),transparent_70%)] lg:block" />
        <div className="relative flex h-full flex-col justify-between p-6 sm:p-8 lg:p-12">
          <BrandLockup tone="light" />
          <div className="hidden max-w-lg lg:block">
            <motion.h1 className="font-display text-6xl leading-[0.95] text-white" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.7 }}>
              {tr("Your campus,")}
              <br />
              <span className="italic text-[#e3bb98]">{tr("booked fairly.")}</span>
            </motion.h1>
            <motion.p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/75" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45, duration: 0.6 }}>
              {tr("Tennis, padel, football, volleyball and the Activity Center — see what’s free, book in seconds and check in with your phone.")}
            </motion.p>
            <div className="mt-8 flex gap-8 text-white/80">
              {[
                ["9", tr("courts & tables")],
                ["2", tr("venues")],
                [tr("1 tap"), tr("QR check-in")],
              ].map(([v, l]) => (
                <div key={l}>
                  <p className="font-display text-3xl text-white">{v}</p>
                  <p className="text-xs uppercase tracking-wider text-white/55">{l}</p>
                </div>
              ))}
            </div>
          </div>
          <p className="hidden text-xs text-white/45 lg:block">
            © {new Date().getFullYear()} {tr(config.data?.universityName ?? "Badya University")}
          </p>
        </div>
      </div>

      {/* Form side */}
      <div className="relative -mt-8 rounded-t-[32px] bg-bg px-5 pt-8 pb-12 sm:px-10 lg:mt-0 lg:flex lg:items-center lg:rounded-none lg:px-16">
        <button type="button" onClick={() => chooseLanguage(lang === "ar" ? "en" : "ar", false)} className="absolute end-5 top-5 inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm font-semibold text-ink-2 hover:border-line-strong sm:end-10 lg:top-8" lang={lang === "ar" ? "en" : "ar"}>
          <Languages className="size-4" /> {lang === "ar" ? "English" : "العربية"}
        </button>
        <div className="mx-auto w-full max-w-md">
          <AnimatePresence>
            {notice && step.kind === "signin" && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-5 flex gap-2.5 rounded-2xl bg-info-soft p-3.5 text-sm text-info" role="status">
                <Info className="mt-0.5 size-4 shrink-0" />
                {notice}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step.kind} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.2 }}>
              {step.kind === "signin" && (
                <form onSubmit={signIn} noValidate>
                  <h2 className="font-display text-4xl text-ink">{tr("Welcome")}</h2>
                  <p className="mt-2 text-sm text-muted">{tr("Sign in with your account. You only do this once — after that the app opens straight away on this phone.")}</p>
                  <div className="mt-6 space-y-4">
                    <Field label={tr("University ID or email")} htmlFor="identifier">
                      <Input id="identifier" autoComplete="username" autoCapitalize="none" autoFocus value={identifier} onChange={(e) => setIdentifier(e.target.value)} invalid={!!error} leading={<IdCard className="size-4" />} />
                    </Field>
                    <Field label={tr("Password")} htmlFor="password">
                      <PasswordInput id="password" autoComplete="current-password" value={password} onChange={setPassword} invalid={!!error} />
                    </Field>
                  </div>
                  <ErrorLine error={error} />
                  <Button type="submit" size="lg" block className="mt-5" loading={loading === "signin"} iconRight={<ArrowRight className="size-4" />}>
                    {tr("Sign in")}
                  </Button>
                  <div className="mt-6 rounded-2xl border border-line bg-surface p-4 text-center">
                    <p className="text-sm text-muted">{tr("New to Badya Spaces?")}</p>
                    <Button type="button" variant="secondary" block className="mt-2.5" onClick={() => go({ kind: "register" })}>
                      {tr("Create an account")}
                    </Button>
                  </div>
                  <p className="mt-4 text-center text-xs text-muted">{tr("Forgot your password? The facilities office can give you a new one.")}</p>
                </form>
              )}

              {step.kind === "register" && (
                <form onSubmit={register} noValidate>
                  <h2 className="font-display text-4xl text-ink">{tr("Create your account")}</h2>
                  <p className="mt-2 text-sm text-muted">{tr("Students of the university only. Use your real details — the facilities office checks them against your student card.")}</p>
                  <div className="mt-6 space-y-4">
                    <Field label={tr("Full name (English)")} htmlFor="name" hint={tr("As it appears on your student ID.")}>
                      <Input id="name" autoComplete="name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
                    </Field>
                    <Field label={tr("Full name (Arabic)")} htmlFor="nameAr" optional>
                      <Input id="nameAr" dir="rtl" value={profile.nameAr} onChange={(e) => setProfile({ ...profile, nameAr: e.target.value })} />
                    </Field>
                    <Field label={tr("University email")} htmlFor="email" hint={tr("Use your {join} address.", { join: domains.map((d) => "@" + d).join(tr(" or ")) })}>
                      <Input id="email" type="email" inputMode="email" autoComplete="email" dir="ltr" placeholder={tr("name@{v}", { v: domains[0] })} value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} leading={<Mail className="size-4" />} />
                    </Field>
                    <Field label={tr("University ID")} htmlFor="uid">
                      <Input id="uid" inputMode="numeric" dir="ltr" value={profile.universityId} onChange={(e) => setProfile({ ...profile, universityId: e.target.value.replace(/\D/g, "") })} />
                    </Field>
                    <Field label={tr("Faculty")} htmlFor="faculty">
                      <Select id="faculty" value={profile.faculty} onChange={(e) => setProfile({ ...profile, faculty: e.target.value })}>
                        <option value="">{tr("Choose your faculty")}</option>
                        {(config.data?.faculties ?? []).map((f) => (
                          <option key={f} value={f}>
                            {tStored(f)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label={tr("Year")} htmlFor="year">
                        <Select id="year" value={profile.year} onChange={(e) => setProfile({ ...profile, year: Number(e.target.value) })}>
                          {[1, 2, 3, 4, 5, 6, 7].map((y) => (
                            <option key={y} value={y}>
                              {tr("Year {n}", { n: y })}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={tr("Level")} htmlFor="level">
                        <Select id="level" value={profile.level} onChange={(e) => setProfile({ ...profile, level: e.target.value as "undergraduate" | "postgraduate" })}>
                          <option value="undergraduate">{tr("Undergraduate")}</option>
                          <option value="postgraduate">{tr("Postgraduate")}</option>
                        </Select>
                      </Field>
                    </div>
                    <Field label={tr("Password")} htmlFor="new-password" hint={tr("At least {n} characters.", { n: MIN_PASSWORD })}>
                      <PasswordInput id="new-password" autoComplete="new-password" value={profile.password} onChange={(v) => setProfile({ ...profile, password: v })} />
                    </Field>
                    <Field label={tr("Confirm password")} htmlFor="confirm-password">
                      <PasswordInput id="confirm-password" autoComplete="new-password" value={profile.confirm} onChange={(v) => setProfile({ ...profile, confirm: v })} />
                    </Field>
                  </div>
                  <ErrorLine error={error} />
                  <p className="mt-4 flex gap-2 rounded-2xl bg-surface-2 p-3.5 text-xs leading-relaxed text-ink-2">
                    <Smartphone className="mt-0.5 size-4 shrink-0 text-brand" />
                    {tr("Your account will be linked to this phone and stay signed in. Moving it to another phone later needs approval from the facilities office.")}
                  </p>
                  <Button type="submit" size="lg" block className="mt-4" loading={loading === "register"} iconRight={<ArrowRight className="size-4" />}>
                    {tr("Create my account")}
                  </Button>
                  <p className="mt-4 text-center text-sm text-muted">
                    {tr("Already have an account?")}{" "}
                    <button type="button" onClick={() => go({ kind: "signin" })} className="font-semibold text-brand hover:underline">
                      {tr("Sign in")}
                    </button>
                  </p>
                </form>
              )}

              {step.kind === "locked" && (
                <form onSubmit={contact} noValidate>
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
                    <Lock className="size-6" />
                  </span>
                  <h2 className="mt-5 font-display text-4xl text-ink">{step.reason === "device_in_use" ? tr("This phone belongs to another student") : tr("Your account is on another phone")}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    {step.reason === "device_in_use"
                      ? tr("Each phone can hold one student account. To use your account on this phone, contact the facilities office.")
                      : tr("Your account can only be used on one phone. To move it to this phone, contact the facilities office — your old phone will be signed out.")}
                  </p>
                  <Field label={tr("Message to the facilities office")} htmlFor="note" className="mt-6" optional hint={tr("Tell them why — for example, you got a new phone.")}>
                    <Textarea id="note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("e.g. My old phone broke and this is my new one.")} className="min-h-24" />
                  </Field>
                  <ErrorLine error={error} />
                  <Button type="submit" size="lg" block className="mt-4" loading={loading === "contact"} icon={<Send className="size-4" />}>
                    {tr("Contact the facilities office")}
                  </Button>
                  <p className="mt-3 flex gap-2 text-xs leading-relaxed text-muted">
                    <MessageSquareText className="mt-0.5 size-3.5 shrink-0" />
                    {tr("They’ll approve or decline your request. Once approved, your account opens on this phone right away.")}
                  </p>
                  {supportEmail && (
                    <p className="mt-2 text-xs text-muted">
                      {tr("You can also email")}{" "}
                      <a href={`mailto:${supportEmail}`} className="font-semibold text-brand hover:underline" dir="ltr">
                        {supportEmail}
                      </a>
                    </p>
                  )}
                  <Button type="button" variant="ghost" block className="mt-4" onClick={() => go({ kind: "signin" })}>
                    {tr("Back to sign-in")}
                  </Button>
                </form>
              )}

              {step.kind === "waiting" && (
                <WaitingForApproval
                  requestId={step.requestId}
                  reason={step.reason}
                  onSignedIn={finish}
                  onDone={() => {
                    savePending(null);
                    go({ kind: "signin" });
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>

          {demoAccounts.length > 0 && step.kind === "signin" && (
            <div className="mt-10">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-faint">{tr("Demo accounts — one tap")}</p>
              <div className="grid grid-cols-2 gap-2">
                {demoAccounts.map((a) => {
                  const Icon = ROLE_ICON[a.role];
                  return (
                    <button
                      key={a.email}
                      disabled={loading !== null}
                      onClick={() => run(a.email, async () => handle(await api.auth.demoSignIn(a.email)))}
                      className={cn("group flex flex-col items-start gap-2 rounded-2xl border border-line bg-surface p-3.5 text-start shadow-sm transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md disabled:opacity-60")}
                    >
                      <span className="flex w-full items-center justify-between">
                        <span className="flex size-8 items-center justify-center rounded-xl bg-brand-soft text-brand">
                          <Icon className="size-4" />
                        </span>
                        {loading === a.email ? <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" /> : <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />}
                      </span>
                      <span>
                        <span className="block text-[13px] font-bold capitalize text-ink">{a.role.replace("_", " ")}</span>
                        <span className="block truncate text-xs text-muted">{a.name}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="mt-4 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}

/** A password field with a show/hide toggle. */
function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <Input
      id={id}
      type={show ? "text" : "password"}
      dir="ltr"
      autoComplete={autoComplete}
      value={value}
      invalid={invalid}
      onChange={(e) => onChange(e.target.value)}
      leading={<Lock className="size-4" />}
      trailing={
        <button type="button" onClick={() => setShow((s) => !s)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label={show ? tr("Hide password") : tr("Show password")} aria-pressed={show}>
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      }
    />
  );
}

/** Shown while an administrator reviews a new or shared device. Checks back every few seconds. */
function WaitingForApproval({ requestId, reason, onSignedIn, onDone }: { requestId: string; reason: "new_device" | "device_in_use"; onSignedIn: (u: SessionUser) => void; onDone: () => void }) {
  const [state, setState] = useState<{ status: "pending" | "rejected" | "cancelled"; note?: string }>({ status: "pending" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (state.status !== "pending") return;
    let stop = false;
    const check = async () => {
      try {
        const r = await api.auth.deviceRequestStatus(requestId);
        if (stop) return;
        if (r.status === "signed_in") onSignedIn(r.user);
        else if (r.status === "rejected" || r.status === "cancelled") setState({ status: r.status, note: "note" in r ? r.note : undefined });
      } catch (e) {
        if (!stop && e instanceof ApiError && e.code === "NOT_FOUND") setState({ status: "cancelled" });
      }
    };
    void check();
    const t = setInterval(check, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [requestId, state.status, onSignedIn]);

  if (state.status !== "pending") {
    return (
      <div>
        <span className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
          <XCircle className="size-6" />
        </span>
        <h2 className="mt-5 font-display text-4xl text-ink">{state.status === "rejected" ? tr("Request declined") : tr("Request closed")}</h2>
        <p className="mt-2 text-sm text-muted">{state.status === "rejected" ? `${state.note ? tr("The facilities office didn’t approve this device: {note}", { note: state.note }) : tr("The facilities office didn’t approve this device.")} ${tr("Sign in on your own device, or visit the office.")}` : tr("This request is no longer active. You can start again.")}</p>
        <Button size="lg" block className="mt-6" onClick={onDone}>
          {tr("Back to sign-in")}
        </Button>
      </div>
    );
  }
  return (
    <div>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-warning-soft text-warning">
        <Hourglass className="size-6" />
      </span>
      <h2 className="mt-5 font-display text-4xl text-ink">{tr("Request sent")}</h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {reason === "device_in_use"
          ? tr("The facilities office has your message. Each phone can hold one student account, so they need to approve using yours on this phone.")
          : tr("The facilities office has your message. Once they approve, your account moves to this phone and your old phone is signed out.")}
      </p>
      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
        <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-warning border-t-transparent" />
        {tr("Waiting for approval — you’ll be signed in automatically as soon as it’s approved. You can keep this page open or come back later.")}
      </div>
      <Button
        variant="ghost"
        block
        className="mt-4"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.auth.cancelDeviceRequest(requestId);
          } catch {
            /* already gone */
          }
          onDone();
        }}
      >
        {tr("Cancel request")}
      </Button>
    </div>
  );
}
