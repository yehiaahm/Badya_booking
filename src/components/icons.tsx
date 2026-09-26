import {
  Accessibility,
  AirVent,
  Bath,
  CalendarDays,
  Car,
  Coffee,
  Droplets,
  Dumbbell,
  Gamepad2,
  Gauge,
  GraduationCap,
  Hash,
  HeartPulse,
  Lamp,
  Link2,
  ListOrdered,
  Lock,
  Monitor,
  Music2,
  PenLine,
  Plug,
  QrCode,
  Repeat,
  Scale,
  Shield,
  Shirt,
  Sofa,
  Speaker,
  Timer,
  Trophy,
  Undo2,
  UserCheck,
  UserX,
  Users,
  Waves,
  Wifi,
  Wrench,
  CalendarRange,
  CircleDot,
  Disc3,
  Volleyball,
  type LucideIcon,
} from "lucide-react";
import type { AmenityKey, CategoryKind, Motif } from "@/domain/types";
import { t } from "@/i18n";

export const AMENITIES: Record<AmenityKey, { label: string; icon: LucideIcon }> = {
  floodlights: { get label() {
    return t("Floodlights");
  }, icon: Lamp },
  changing_rooms: { get label() {
    return t("Changing rooms");
  }, icon: Shirt },
  showers: { get label() {
    return t("Showers");
  }, icon: Bath },
  lockers: { get label() {
    return t("Lockers");
  }, icon: Lock },
  equipment: { get label() {
    return t("Equipment provided");
  }, icon: Wrench },
  water: { get label() {
    return t("Water station");
  }, icon: Droplets },
  ac: { get label() {
    return t("Air-conditioned");
  }, icon: AirVent },
  wifi: { get label() {
    return t("Wi-Fi");
  }, icon: Wifi },
  screen: { get label() {
    return t("Display screen");
  }, icon: Monitor },
  whiteboard: { get label() {
    return t("Whiteboard");
  }, icon: PenLine },
  power: { get label() {
    return t("Power outlets");
  }, icon: Plug },
  accessible: { get label() {
    return t("Step-free access");
  }, icon: Accessibility },
  parking: { get label() {
    return t("Parking nearby");
  }, icon: Car },
  seating: { get label() {
    return t("Seating");
  }, icon: Sofa },
  sound: { get label() {
    return t("Sound system");
  }, icon: Speaker },
  first_aid: { get label() {
    return t("First aid");
  }, icon: HeartPulse },
  coach: { get label() {
    return t("Trainer on site");
  }, icon: UserCheck },
  towels: { get label() {
    return t("Towels");
  }, icon: Waves },
};

export const POLICY_ICONS: Record<string, LucideIcon> = {
  calendar: CalendarDays,
  hash: Hash,
  repeat: Repeat,
  coffee: Coffee,
  users: Users,
  link: Link2,
  undo: Undo2,
  qr: QrCode,
  shield: Shield,
  scale: Scale,
  gauge: Gauge,
  "calendar-range": CalendarRange,
  timer: Timer,
  "list-ordered": ListOrdered,
  "user-x": UserX,
};

export const MOTIF_ICONS: Record<Motif, LucideIcon> = {
  football: Trophy,
  basketball: Trophy,
  tennis: Trophy,
  padel: Trophy,
  tabletennis: Trophy,
  volleyball: Volleyball,
  billiards: CircleDot,
  airhockey: Disc3,
  pool: Waves,
  gym: Dumbbell,
  study: GraduationCap,
  pods: Lamp,
  meeting: Users,
  studio: Speaker,
  lab: Wrench,
  computer: Monitor,
  gaming: Gamepad2,
  music: Music2,
  generic: CalendarDays,
};

export const KIND_LABEL: Record<CategoryKind, string> = {
  get sports() {
    return t("Sports");
  },
  get wellness() {
    return t("Wellness");
  },
  get academic() {
    return t("Academic");
  },
  get recreation() {
    return t("Recreation");
  },
  get other() {
    return t("Other");
  },
};
