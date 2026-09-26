import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Camera, CameraOff, CheckCircle2, CircleSlash, Keyboard, MinusCircle, ScanLine, TriangleAlert, XCircle } from "lucide-react";
import { api, type ScanCandidate, type ScanResult } from "@/api";
import { cn } from "@/lib/cn";
import { useNow } from "@/lib/hooks";
import { errorMessage, useAppConfig, useStaffOverview } from "@/lib/queries";
import { clock, fmtRange, fmtTime } from "@/lib/time";
import { Button, IconButton } from "@/components/ui/Button";
import { Avatar, ErrorState, Skeleton } from "@/components/ui/Primitives";
import { FacilityPicker, useStaffFacility } from "./shared";
import { t as tr } from "@/i18n";

/* ───────────── Camera (where the browser can decode QR codes) ───────────── */

interface Detector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (opts: { formats: string[] }) => Detector;
const DetectorImpl = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
const cameraSupported = !!DetectorImpl && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

function useCamera(onCode: (code: string) => void, paused: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [state, setState] = useState<"off" | "starting" | "on" | "denied">("off");
  const last = useRef({ code: "", at: 0 });

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setState("off");
  }, []);

  const start = useCallback(async () => {
    setState("starting");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
      setState("on");
    } catch {
      setState("denied");
    }
  }, []);

  useEffect(() => {
    if (state !== "on" || paused || !DetectorImpl) return;
    const detector = new DetectorImpl({ formats: ["qr_code"] });
    let busy = false;
    const id = setInterval(async () => {
      if (busy || !video.current || video.current.readyState < 2) return;
      busy = true;
      try {
        const [hit] = await detector.detect(video.current);
        // Ignore the same code held in front of the lens for a few seconds.
        if (hit?.rawValue && (hit.rawValue !== last.current.code || Date.now() - last.current.at > 4000)) {
          last.current = { code: hit.rawValue, at: Date.now() };
          onCode(hit.rawValue);
        }
      } catch {
        /* frame not ready */
      }
      busy = false;
    }, 300);
    return () => clearInterval(id);
  }, [state, paused, onCode]);

  useEffect(() => stop, [stop]);
  return { video, state, start, stop };
}

/* ───────────── Result ───────────── */

function ResultPanel({ r, onNext }: { r: ScanResult; onNext: () => void }) {
  const tone = r.ok ? "bg-success" : r.alreadyCheckedIn ? "bg-warning" : "bg-danger";
  const Icon = r.ok ? CheckCircle2 : r.alreadyCheckedIn ? TriangleAlert : XCircle;
  useEffect(() => {
    navigator.vibrate?.(r.ok ? 60 : [80, 60, 80]);
    const k = (e: KeyboardEvent) => (e.key === "Enter" || e.key === "Escape") && onNext();
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
        <div className="mt-auto pt-8">
          <button type="button" autoFocus onClick={onNext} className="h-14 w-full rounded-2xl bg-white text-base font-bold text-ink shadow-lg active:scale-[0.98]">
            {tr("Scan next")}
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

  const candidates = useQuery({
    queryKey: ["staff", "scan-candidates", facilityId],
    queryFn: () => api.staff.scanCandidates(facilityId!),
    enabled: !!facilityId && demo,
    staleTime: 0,
    refetchInterval: 10_000,
  });

  const scan = useMutation({
    mutationFn: (token: string) => api.staff.scan(token.trim(), facilityId!),
    onSuccess: (r) => {
      setResult(r);
      setLog((l) => [{ at: clock.now(), ok: r.ok, title: r.title, who: r.student?.name }, ...l].slice(0, 12));
    },
    onError: (e) => setResult({ ok: false, title: tr("Couldn’t check the ticket"), message: errorMessage(e), checks: [] }),
  });

  // Keep the camera loop's callback stable — the mutation object changes every render.
  const scanRef = useRef(scan);
  scanRef.current = scan;
  const onCode = useCallback((c: string) => {
    if (!scanRef.current.isPending && facilityId) scanRef.current.mutate(c);
  }, [facilityId]);
  const cam = useCamera(onCode, !!result || scan.isPending);
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
            <p className="truncate text-sm text-white/60">{current ? `${current.facility.name} · ${fmtTime(now)}` : "Loading…"}</p>
          </div>
        </div>

        {overview.data && (
          <div className="mt-4">
            <FacilityPicker overview={overview.data} value={facilityId} onChange={select} tone="dark" />
          </div>
        )}

        <div className="relative mt-5 aspect-square overflow-hidden rounded-[28px] bg-black/40 ring-1 ring-white/10">
          <video ref={cam.video} muted playsInline className={cn("absolute inset-0 size-full object-cover", cam.state !== "on" && "hidden")} />
          <div className="pointer-events-none absolute inset-[14%]" aria-hidden>
            {["start-0 top-0 border-s-4 border-t-4 rounded-ss-2xl", "end-0 top-0 border-e-4 border-t-4 rounded-se-2xl", "bottom-0 start-0 border-b-4 border-s-4 rounded-es-2xl", "bottom-0 end-0 border-b-4 border-e-4 rounded-ee-2xl"].map((c) => (
              <span key={c} className={cn("absolute size-10 border-white/90", c)} />
            ))}
            {(cam.state === "on" || scan.isPending) && <motion.span className="absolute inset-x-2 h-0.5 rounded-full bg-brand shadow-[0_0_16px_var(--brand)]" initial={{ top: "8%" }} animate={{ top: ["8%", "92%", "8%"] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }} />}
          </div>
          {cam.state !== "on" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
              {scan.isPending ? (
                <p className="text-sm font-semibold text-white/80">{tr("Checking ticket…")}</p>
              ) : cameraSupported ? (
                <>
                  {cam.state === "denied" ? <CameraOff className="size-10 text-white/50" /> : <Camera className="size-10 text-white/50" />}
                  <p className="text-sm text-white/70">{cam.state === "denied" ? tr("Camera access was blocked. Allow it in your browser settings, or enter the ticket code below.") : tr("Point the camera at the student’s live QR code.")}</p>
                  <Button onClick={cam.start} loading={cam.state === "starting"} icon={<Camera className="size-4" />}>
                    {cam.state === "denied" ? tr("Try again") : tr("Start camera")}
                  </Button>
                </>
              ) : (
                <>
                  <ScanLine className="size-10 text-white/50" />
                  <p className="text-sm text-white/70">{tr("This browser can’t read QR codes from the camera. Use Chrome on Android, or enter the ticket code below.")}</p>
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

        <section className="mt-6">
          {manual ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) scan.mutate(code, { onSuccess: () => setCode("") });
              }}
              className="flex gap-2"
            >
              <label htmlFor="manual-code" className="sr-only">
                {tr("Ticket code")}
              </label>
              <input id="manual-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder={tr("Paste the ticket code")} className="h-11 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3.5 font-mono text-sm text-white outline-none placeholder:text-white/40 focus:border-brand" />
              <Button type="submit" disabled={!code.trim()} loading={scan.isPending}>
                {tr("Check")}
              </Button>
            </form>
          ) : (
            <button type="button" onClick={() => setManual(true)} className="flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white">
              <Keyboard className="size-4" />{" "}{tr("Enter a code instead")}
            </button>
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

      <AnimatePresence>{result && <ResultPanel r={result} onNext={next} />}</AnimatePresence>
    </div>
  );
}
