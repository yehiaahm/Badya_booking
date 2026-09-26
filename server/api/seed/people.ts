import type { Audience, User } from "@/domain/types";
import { FACULTIES, PROGRAMS } from "./catalog";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
export const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

const FIRST_M = ["Omar", "Youssef", "Seif", "Ziad", "Adham", "Marwan", "Hussein", "Karim", "Ahmed", "Mohamed", "Ali", "Hamza", "Amr", "Belal", "Eyad", "Moaz", "Mostafa", "Khaled", "Tarek", "Mahmoud", "Hazem", "Abdelrahman", "Sherif", "Hassan", "Yassin", "Malek", "Fares", "Adam", "Mazen", "Ismail", "Taha", "Anas", "Hesham", "Kareem", "Ibrahim", "Salah", "Omar", "Nour", "Selim", "Ramy"];
const FIRST_F = ["Mariam", "Salma", "Nadine", "Hana", "Laila", "Farida", "Malak", "Rana", "Jana", "Habiba", "Yasmin", "Aya", "Dina", "Sara", "Menna", "Rawan", "Judy", "Lina", "Hagar", "Nada", "Reem", "Shahd", "Alia", "Nourhan", "Maya", "Yara", "Rahma", "Heba", "Nesma", "Tasneem", "Zeina", "Logy", "Fatma", "Mayar", "Amina", "Jomana", "Retaj", "Sandy", "Rodina", "Lara"];
const LAST = ["Hassan", "Tarek", "Khaled", "Ibrahim", "Wael", "Hamdy", "Sayed", "Emad", "Magdy", "Farouk", "Mahmoud", "Sherif", "Nabil", "Ashraf", "Essam", "Gamal", "Tamer", "Walid", "Samir", "Reda", "Fawzy", "Mohsen", "Hany", "Lotfy", "Galal", "Adel", "Mostafa", "Youssef", "Fathy", "Zaki", "Soliman", "El-Sharkawy", "Abdallah", "Ragab", "Mansour", "Kamel", "Helmy", "Shawky", "El-Masry", "Naguib", "Rizk", "Badawy", "Abdelaziz", "El-Sayed", "Farag", "Hegazy", "Osman", "Saad", "Salem", "Nassar"];

const CREATED = "2025-09-14T08:00:00.000Z";

const slugEmail = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z\s-]/g, "")
    .replace(/-/g, "")
    .trim()
    .replace(/\s+/g, ".");

interface SpecialStudent {
  id: string;
  name: string;
  faculty: string;
  year: number;
  program?: string;
  email?: string;
  nameAr?: string;
}

export const SPECIAL_STUDENTS: SpecialStudent[] = [
  { id: "u_yehia", name: "Yehia Ahmed", nameAr: "يحيى أحمد", faculty: "Computer Science", program: "Artificial Intelligence", year: 3, email: "student@badya.edu.eg" },
  { id: "u_omar", name: "Omar Khaled", faculty: "Engineering", program: "Mechatronics", year: 3 },
  { id: "u_youssef", name: "Youssef Ibrahim", faculty: "Computer Science", program: "Software Engineering", year: 3 },
  { id: "u_seif", name: "Seif Wael", faculty: "Business Administration", program: "Finance", year: 2 },
  { id: "u_ziad", name: "Ziad Hamdy", faculty: "Engineering", program: "Electrical Engineering", year: 4 },
  { id: "u_adham", name: "Adham Sayed", faculty: "Physical Therapy", year: 3 },
  { id: "u_marwan", name: "Marwan Emad", faculty: "Computer Science", program: "Data Science", year: 2 },
  { id: "u_hussein", name: "Hussein Magdy", faculty: "Pharmacy", program: "Clinical Pharmacy", year: 3 },
  { id: "u_karim_adel", name: "Karim Adel", faculty: "Architecture & Design", program: "Architecture", year: 3 },
  { id: "u_ahmed", name: "Ahmed Hassan", faculty: "Engineering", program: "Civil Engineering", year: 2 },
  { id: "u_mohamed", name: "Mohamed Tarek", faculty: "Business Administration", program: "Marketing", year: 2 },
  { id: "u_ali", name: "Ali Mostafa", faculty: "Engineering", program: "Mechatronics", year: 2 },
  { id: "u_hamza", name: "Hamza Reda", faculty: "Computer Science", program: "Cybersecurity", year: 1 },
  { id: "u_amr", name: "Amr Fawzy", faculty: "Medicine", year: 2 },
  { id: "u_belal", name: "Belal Samir", faculty: "Dentistry", year: 3 },
  { id: "u_eyad", name: "Eyad Lotfy", faculty: "Engineering", program: "Biomedical Engineering", year: 2 },
  { id: "u_moaz", name: "Moaz Galal", faculty: "Business Administration", program: "Business Analytics", year: 1 },
  { id: "u_salma", name: "Salma Youssef", faculty: "Medicine", year: 3 },
  { id: "u_mariam", name: "Mariam Hesham", faculty: "Architecture & Design", program: "Interior Design", year: 3 },
  { id: "u_rana", name: "Rana Essam", faculty: "Pharmacy", program: "Pharmaceutical Sciences", year: 2 },
  { id: "u_nadine", name: "Nadine Farouk", faculty: "Mass Communication", program: "Digital Media", year: 4 },
  { id: "u_laila", name: "Laila Sherif", faculty: "Mass Communication", program: "Journalism", year: 3 },
  { id: "u_jana", name: "Jana Tamer", faculty: "Mass Communication", program: "Public Relations", year: 4 },
  { id: "u_hana", name: "Hana Mahmoud", faculty: "Dentistry", year: 2 },
  { id: "u_farida", name: "Farida Nabil", faculty: "Physical Therapy", year: 1 },
];

export const YEHIA_SQUAD = ["u_omar", "u_youssef", "u_seif", "u_ziad", "u_adham", "u_marwan", "u_hussein", "u_karim_adel"];
export const AHMED_SQUAD = ["u_ahmed", "u_mohamed", "u_ali", "u_hamza", "u_amr", "u_belal", "u_eyad", "u_moaz"];

const universityId = (year: number, n: number) => `${2026 - year + 1}${String(n).padStart(4, "0")}`;

export function buildUsers(rng: Rng, generatedCount: number): User[] {
  const users: User[] = [];
  const emails = new Set<string>();
  const names = new Set<string>();
  let serial = 1000;

  const addStudent = (id: string, name: string, faculty: string, year: number, program?: string, email?: string, nameAr?: string) => {
    let em = email ?? `${slugEmail(name)}@badya.edu.eg`;
    let k = 2;
    while (emails.has(em)) em = `${slugEmail(name)}${k++}@badya.edu.eg`;
    emails.add(em);
    names.add(name);
    serial += randInt(rng, 3, 29);
    const audience: Audience = year >= 5 && faculty !== "Medicine" && faculty !== "Dentistry" ? "postgraduate" : "undergraduate";
    users.push({
      id,
      role: "student",
      name,
      nameAr,
      email: em,
      avatarHue: Math.floor(rng() * 360),
      status: "active",
      createdAt: CREATED,
      universityId: universityId(year, serial),
      faculty,
      program: program ?? pick(rng, PROGRAMS[faculty]),
      year,
      audience,
      preferences: { reminderMinutes: 60, waitlistAlerts: true, emailDigest: false },
    });
  };

  for (const s of SPECIAL_STUDENTS) addStudent(s.id, s.name, s.faculty, s.year, s.program, s.email, s.nameAr);
  const yehia = users.find((u) => u.id === "u_yehia")!;
  yehia.universityId = "20241047";
  yehia.avatarHue = 28;
  yehia.preferences = { reminderMinutes: 30, waitlistAlerts: true, emailDigest: true };

  let n = 0;
  let guard = 0;
  while (n < generatedCount && guard++ < generatedCount * 20) {
    const female = rng() < 0.46;
    const name = `${pick(rng, female ? FIRST_F : FIRST_M)} ${pick(rng, LAST)}`;
    if (names.has(name)) continue;
    const faculty = pick(rng, FACULTIES);
    const year = faculty === "Medicine" || faculty === "Dentistry" ? randInt(rng, 1, 6) : randInt(rng, 1, 4) + (rng() < 0.06 ? 1 : 0);
    addStudent(`u_s${String(++n).padStart(3, "0")}`, name, faculty, year);
  }

  const staff = (id: string, name: string, title: string, email: string, role: User["role"], assigned: string[] = [], hue = 210) =>
    users.push({ id, role, name, email, title, avatarHue: hue, status: "active", createdAt: CREATED, assignedFacilityIds: assigned, audience: "staff", preferences: { reminderMinutes: 60, waitlistAlerts: false, emailDigest: true } });

  staff("u_staff_karim", "Karim Mostafa", "Sports Courts Supervisor", "staff@badya.edu.eg", "staff", ["f_tennis", "f_padel", "f_football", "f_volleyball"], 152);
  staff("u_staff_mona", "Mona Saleh", "Activity Center Coordinator", "mona.saleh@badya.edu.eg", "staff", ["f_pingpong", "f_billiards", "f_airhockey"], 320);
  staff("u_admin_nour", "Nour El-Din Samir", "Facilities Administration Manager", "admin@badya.edu.eg", "admin", [], 20);
  staff("u_admin_dina", "Dina Rizk", "Student Activities Officer", "dina.rizk@badya.edu.eg", "admin", [], 340);
  staff("u_super_tamer", "Tamer Helmy", "Director of Digital Services", "superadmin@badya.edu.eg", "super_admin", [], 230);
  return users;
}
