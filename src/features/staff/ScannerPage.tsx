import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, CameraOff, CheckCircle2, CircleSlash, IdCard, ImageUp, Keyboard, ListChecks, MinusCircle, ScanLine, TriangleAlert, XCircle } from "lucide-react";
import { api, ApiError, type ScanCandidate, type ScanResult } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage, useAppConfig, useStaffOverview } from "@/lib/queries";
import { cameraBlock, cameraError, createDecoder, decodeImageFile, openCamera, type CameraError, type QrDecoder } from "@/lib/qrDecode";
import { clock, fmtRange, fmtTime } from "@/lib/time";
import { Button, IconButton } from "@/components/ui/Button";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { FacilityPicker, useStaffFacility } from "./shared";
import { t as tr } from "@/i18n";

/* ───────────── Camera ───────────── */

type CameraState = "off" | "starting" | "on" | CameraError;

/** Live camera + QR decoding. Works on iPhone (Safari and Chrome) through the JavaScript decoder. */
function useCamera(onCode: (code: string) => void, paused: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const decoder = useRef<QrDecoder | null>(null);
  const [state, setState] = useState<CameraState>("off");
  const last = useRef({ code: "", at: 0 });

  const release = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };
  const stop = useCallback(() => {
    release();
    setState("off");
  }, []);

  const start = useCallback(async () => {
    setState("starting");
    try {
      // Ask for the camera first, straight from the tap — iOS is strict about that.
      const [s, d] = await Promise.all([openCamera(), decoder.current ?? createDecoder()]);
      decoder.current = d;
      release();
      stream.current = s;
      // The camera can be taken away (a call, another app): show "Start camera" again.
      s.getVideoTracks()[0]?.addEventListener("ended", () => stop());
      const v = video.current;
      if (v) {
        v.srcObject = s;
        v.muted = true;
        v.setAttribute("playsinline", "");
        await v.play();
      }
      setState("on");
    } catch (e) {
      release();
      setState(cameraError(e));
    }
  }, [stop]);

  useEffect(() => {
    if (state !== "on" || paused) return;
    let busy = false;
    let stopped = false;
    const id = setInterval(async () => {
      const v = video.current;
      const d = decoder.current;
      if (busy || !v || !d || v.readyState < 2) return;
      busy = true;
      try {
        const code = await d.decode(v);
        // Ignore the same code held in front of the lens for a few seconds.
        if (!stopped && code && (code !== last.current.code || Date.now() - last.current.at > 4000)) {
          last.current = { code, at: Date.now() };
          onCode(code);
        }
      } catch {
        /* frame not ready */
      }
      busy = false;
    }, 250);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [state, paused, onCode]);

  // A backgrounded page loses the camera on phones anyway — let it go cleanly.
  useEffect(() => {
    const onHide = () => document.hidden && stop();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [stop]);
  useEffect(() => stop, [stop]);
  return { video, state, start, stop };
}

const CAMERA_HELP: Record<CameraError | "insecure" | "unsupported", () => string> = {
  denied: () => tr("Camera access is blocked for this site. Allow it in the browser’s site settings (on iPhone: Settings → Safari → Camera, or the “aA” menu), then try again."),
  no_camera: () => tr("No camera was found on this device."),
  busy: () => tr("Another app is using the camera. Close it and try again."),
  failed: () => tr("The camera couldn’t be started. Try again, or use one of the options below."),
  insecure: () => tr("The camera only works when the app is opened over a secure (https) address. Take a photo of the code or enter the booking reference below."),
  unsupported: () => tr("This browser can’t open the camera here. Take a photo of the code or enter the booking reference below."),
};

/* ───────────── Result ───────────── */

function ResultPanel({ r, onNext, onConfirm, confirming }: { r: ScanResult; onNext: () => void; onConfirm: () => void; confirming: boolean }) {
  const tone = r.ok ? "bg-success" : r.verify ? "bg-info" : r.alreadyCheckedIn ? "bg-warning" : "bg-danger";
  const Icon = r.ok ? CheckCircle2 : r.verify ? IdCard : r.alreadyCheckedIn ? TriangleAlert : XCircle;
  useEffect(() => {
    navigator.vibrate?.(r.ok ? 60 : r.verify ? 30 : [80, 60, 80]);
    // Enter never confirms an identity check by accident — it needs the button.
    const k = (e: KeyboardEvent) => (e.key === "Escape" || (e.key === "Enter" && !r.verify)) && onNext();
    window.addEventListener("keydown", k);
    // Successful scans clear themselves so the queue keeps moving.
    const t = r.ok ? setTimeout(onNext, 4500) : undefined;
    return () => {
      window.removeEventListener("keydown", k);
      clearTimeout(t);
    };
  }, [r, onNext]);
  return (
    <motion.div role="alertdialog" aria-modal aria-labelledby="scan-title" aria-describedby="scan-msg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn("fixed inset-0 z-[80] flex flex-col text-white", tone)}>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-[max(40px,env(safe-area-inset-top))]">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 20 }} className="mx-auto">
          <Icon className="size-24" strokeWidth={1.6} />
        </motion.div>
        <h2 id="scan-title" className="mt-4 text-center font-display text-[40px] leading-none">
          {r.title}
        </h2>
        <p id="scan-msg" className="mx-auto mt-3 max-w-sm text-center text-[15px] leading-relaxed text-white/90">
          {r.message}
        </p>
        {r.student && r.booking && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl bg-black/15 p-3.5">
            <Avatar name={r.student.name} hue={r.student.avatarHue} size={44} />
            <div className="min-w-0">
              <p className="truncate text-base font-bold">{r.student.name}</p>
              <p className="truncate text-sm text-white/80">
                {[r.student.universityId, r.booking.facility.name, r.booking.unitName, fmtRange(r.booking.start, r.booking.end)].filter(Boolean).join(" · ")}
              </p>
              {r.booking.people.length > 0 && <p className="text-sm font-semibold">{tr("Group of")}{" "}{r.booking.people.length + 1}</p>}
            </div>
          </div>
        )}
        <ul className="mt-5 space-y-1.5 text-sm">
          {r.checks.map((c) => (
            <li key={c.label} className={cn("flex items-center gap-2", c.status === "skip" && "text-white/60")}>
              {c.status === "pass" ? <CheckCircle2 className="size-4" /> : c.status === "fail" ? <CircleSlash className="size-4" /> : <MinusCircle className="size-4" />}
              {c.label}
            </li>
          ))}
        </ul>
        <div className="mt-auto space-y-2.5 pt-8">
          {r.verify && (
            <button type="button" disabled={confirming} onClick={onConfirm} className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white text-base font-bold text-ink shadow-lg active:scale-[0.98] disabled:opacity-60">
              <IdCard className="size-5" />
              {confirming ? tr("Checking in…") : tr("Student card matches — check in")}
            </button>
          )}
          <button type="button" autoFocus={!r.verify} onClick={onNext} className={cn("h-14 w-full rounded-2xl text-base font-bold active:scale-[0.98]", r.verify ? "bg-black/20 text-white" : "bg-white text-ink shadow-lg")}>
            {r.verify ? tr("Doesn’t match — cancel") : tr("Scan next")}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ───────────── Page ───────────── */

interface LogEntry {
  at: Date;
  ok: boolean;
  title: string;
  who?: string;
}

const KIND_TONE: Record<ScanCandidate["kind"], string> = {
  valid: "bg-success/20 text-success-soft",
  used: "bg-warning/20 text-warning-soft",
  wrong_facility: "bg-danger/20 text-danger-soft",
  cancelled: "bg-danger/20 text-danger-soft",
  wrong_day: "bg-danger/20 text-danger-soft",
  expired: "bg-danger/20 text-danger-soft",
  tampered: "bg-danger/20 text-danger-soft",
};

export function ScannerPage() {
  const nav = useNavigate();
  const now = useNow(1000);
  const overview = useStaffOverview();
  const demo = !!useAppConfig().data?.demo;
  const { current, select } = useStaffFacility(overview.data);
  const facilityId = current?.facility.id;
  const [result, setResult] = useState<ScanResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState("");
  const photo = useRef<HTMLInputElement>(null);
  const block = cameraBlock();

  const candidates = useQuery({
    queryKey: ["staff", "scan-candidates", facilityId],
    queryFn: () => api.staff.scanCandidates(facilityId!),
    enabled: !!facilityId && demo,
    staleTime: 0,
    refetchInterval: 10_000,
  });

  const record = (r: ScanResult) => {
    setResult(r);
    if (!r.verify) setLog((l) => [{ at: clock.now(), ok: r.ok, title: r.title, who: r.student?.name }, ...l].slice(0, 12));
  };
  const scan = useMutation({
    mutationFn: (token: string) => api.staff.scan(token.trim(), facilityId!),
    onSuccess: record,
    onError: (e) => setResult({ ok: false, title: tr("Couldn’t check the ticket"), message: errorMessage(e), checks: [] }),
  });
  // Typed in: a booking reference (the student card is then checked by eye) — or a pasted code.
  const lookup = useMutation({
    mutationFn: (text: string) => (text.trim().length > 40 ? api.staff.scan(text.trim(), facilityId!) : api.staff.lookup(text.trim(), facilityId!)),
    onSuccess: (r) => {
      record(r);
      setCode("");
    },
    onError: (e) => setResult({ ok: false, title: tr("Couldn’t check the ticket"), message: errorMessage(e), checks: [] }),
  });
  const confirm = useMutation({
    mutationFn: (r: ScanResult) => api.staff.checkIn(r.booking!.id, r.booking!.people.length > 0 ? r.booking!.people.length + 1 : undefined),
    onSuccess: (booking, r) => record({ ok: true, title: tr("Check-in successful"), message: tr("{name} is checked in until {time}.", { name: r.student?.name ?? "", time: fmtTime(booking.end) }), checks: [], booking, student: r.student }),
    onError: (e) => setResult({ ok: false, title: tr("Couldn’t check in"), message: errorMessage(e), checks: [] }),
  });
  const readPhoto = useMutation({
    mutationFn: async (f: File) => {
      const text = await decodeImageFile(f).catch(() => null);
      if (!text) throw new ApiError("VALIDATION", tr("No QR code found in that photo. Hold the phone steady, fill the frame with the code and try again — or enter the booking reference."));
      return text;
    },
    onSuccess: (text) => facilityId && scan.mutate(text),
    onError: (e) => setResult({ ok: false, title: tr("Couldn’t read the photo"), message: errorMessage(e), checks: [] }),
  });
  const busy = scan.isPending || lookup.isPending || readPhoto.isPending;

  // Keep the camera loop's callback stable — the mutation object changes every render.
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const onCode = useCallback((c: string) => {
    if (!scanRef.current.isPending && facilityId) scanRef.current.mutate(c);
  }, [facilityId]);
  const cam = useCamera(onCode, !!result || busy);
  const next = useCallback(() => setResult(null), []);

  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} className="mt-10" />;

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-dusk text-on-dusk">
      <div className="mx-auto max-w-lg px-4 pb-12 pt-4">
        <div className="flex items-center gap-3">
          <IconButton label={tr("Back to today")} variant="ghost" className="text-white hover:bg-white/10" onClick={() => nav(facilityId ? `/staff?f=${facilityId}` : "/staff")}>
            <ArrowLeft className="size-5" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold text-white">{tr("Scan tickets")}</h1>
            <p className="truncate text-sm text-white/60">{current ? `${current.facility.name} · ${fmtTime(now)}` : tr("Loading…")}</p>
          </div>
        </div>

        {overview.data && (
          <div className="mt-4">
            <FacilityPicker overview={overview.data} value={facilityId} onChange={select} tone="dark" />
          </div>
        )}

        <div className="relative mt-5 aspect-square overflow-hidden rounded-[28px] bg-black/40 ring-1 ring-white/10">
          {/* Kept rendered (just invisible) while starting: iOS won't play into a hidden video. */}
          <video ref={cam.video} muted playsInline autoPlay aria-hidden className={cn("absolute inset-0 size-full object-cover", cam.state !== "on" && "opacity-0")} />
          <div className="pointer-events-none absolute inset-[14%]" aria-hidden>
            {["start-0 top-0 border-s-4 border-t-4 rounded-ss-2xl", "end-0 top-0 border-e-4 border-t-4 rounded-se-2xl", "bottom-0 start-0 border-b-4 border-s-4 rounded-es-2xl", "bottom-0 end-0 border-b-4 border-e-4 rounded-ee-2xl"].map((c) => (
              <span key={c} className={cn("absolute size-10 border-white/90", c)} />
            ))}
            {(cam.state === "on" || scan.isPending) && <motion.span className="absolute inset-x-2 h-0.5 rounded-full bg-brand shadow-[0_0_16px_var(--brand)]" initial={{ top: "8%" }} animate={{ top: ["8%", "92%", "8%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />}
          </div>
          {cam.state !== "on" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center" role="status">
              {busy ? (
                <p className="text-sm font-semibold text-white/80">{tr("Checking ticket…")}</p>
              ) : block ? (
                <>
                  <ScanLine className="size-10 text-white/50" />
                  <p className="text-sm text-white/70">{CAMERA_HELP[block]()}</p>
                </>
              ) : (
                <>
                  {cam.state === "off" || cam.state === "starting" ? <Camera className="size-10 text-white/50" /> : <CameraOff className="size-10 text-white/50" />}
                  <p className="text-sm text-white/70">{cam.state === "off" || cam.state === "starting" ? tr("Point the camera at the student’s live QR code.") : CAMERA_HELP[cam.state]()}</p>
                  {cam.state !== "no_camera" && (
                    <Button onClick={cam.start} loading={cam.state === "starting"} icon={<Camera className="size-4" />}>
                      {cam.state === "off" || cam.state === "starting" ? tr("Start camera") : tr("Try again")}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
          {cam.state === "on" && (
            <button type="button" onClick={cam.stop} className="absolute bottom-3 end-3 flex h-9 items-center gap-1.5 rounded-full bg-black/50 px-3 text-xs font-semibold text-white backdrop-blur">
              <CameraOff className="size-3.5" />{" "}{tr("Stop")}
            </button>
          )}
        </div>

        {demo && (
        <section className="mt-6" aria-labelledby="demo-tickets">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="demo-tickets" className="text-sm font-bold uppercase tracking-wider text-white/50">
              {tr("Demo tickets")}
            </h2>
            <span className="text-xs text-white/40">{tr("Real signed codes — tap to scan")}</span>
          </div>
          {!candidates.data ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-14 bg-white/10" />
              ))}
            </div>
          ) : candidates.data.length === 0 ? (
            <p className="rounded-2xl bg-white/5 p-4 text-sm text-white/60">{tr("No tickets to try at this facility right now. Move the demo clock to a session time.")}</p>
          ) : (
            <ul className="space-y-2">
              {candidates.data.map((c) => (
                <li key={`${c.kind}-${c.label}`}>
                  <button type="button" disabled={scan.isPending} onClick={() => scan.mutate(c.token)} className="flex w-full items-center gap-3 rounded-2xl bg-white/5 p-3 text-start transition-colors hover:bg-white/10 disabled:opacity-50">
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", KIND_TONE[c.kind])}>{c.kind === "valid" ? <CheckCircle2 className="size-[18px]" /> : c.kind === "used" ? <TriangleAlert className="size-[18px]" /> : <XCircle className="size-[18px]" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{c.label}</span>
                      <span className="block truncate text-xs text-white/55">{c.hint}</span>
                    </span>
                    <ScanLine className="size-4 text-white/40" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        )}

        <section className="mt-6 space-y-4">
          <input
            ref={photo}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && facilityId) readPhoto.mutate(f);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <button type="button" disabled={!facilityId || busy} onClick={() => photo.current?.click()} className="flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white disabled:opacity-50">
              <ImageUp className="size-4" />
              {tr("Take a photo of the code")}
            </button>
            {!manual && (
              <button type="button" onClick={() => setManual(true)} className="flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white">
                <Keyboard className="size-4" />
                {tr("Enter the booking reference")}
              </button>
            )}
            <Link to={facilityId ? `/staff?f=${facilityId}` : "/staff"} className="flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white">
              <ListChecks className="size-4" />
              {tr("Find them in today’s list")}
            </Link>
          </div>
          {manual && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim() && facilityId) lookup.mutate(code);
              }}
              className="space-y-1.5"
            >
              <label htmlFor="manual-code" className="block text-xs font-semibold text-white/60">
                {tr("Booking reference — on the student’s ticket, under the code")}
              </label>
              <div className="flex gap-2">
                <input id="manual-code" autoFocus dir="ltr" autoCapitalize="characters" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="BK-2026-000123" className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3.5 font-mono text-sm text-white outline-none placeholder:text-white/40 focus:border-brand" />
                <Button type="submit" disabled={!code.trim() || !facilityId} loading={lookup.isPending}>
                  {tr("Find")}
                </Button>
              </div>
              <p className="text-xs text-white/50">{tr("You’ll be asked to check the student card before they’re checked in.")}</p>
            </form>
          )}
        </section>

        {log.length > 0 && (
          <section className="mt-8" aria-labelledby="scan-log">
            <h2 id="scan-log" className="mb-2 text-sm font-bold uppercase tracking-wider text-white/50">
              {tr("This shift")}
            </h2>
            <ul className="divide-y divide-white/10 rounded-2xl bg-white/5">
              {log.map((l, i) => (
                <li key={i} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
                  {l.ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <XCircle className="size-4 shrink-0 text-danger" />}
                  <span className="min-w-0 flex-1 truncate text-white/90">
                    {l.who ?? tr("Unknown ticket")} <span className="text-white/50">· {l.title}</span>
                  </span>
                  <span className="shrink-0 text-xs text-white/40 tabular">{fmtTime(l.at)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <AnimatePresence>{result && <ResultPanel r={result} onNext={next} onConfirm={() => confirm.mutate(result)} confirming={confirm.isPending} />}</AnimatePresence>
    </div>
  );
}
