export interface CardData {
  number: string; // только цифры
  iin: string; // ИИН 12 цифр или IDN 9 цифр
  expiry: string; // MM/YY
}

export interface ScanRow extends CardData {
  id: string;
  scannedAt: string; // ISO
}

/** Допустимые годы срока действия (две последние цифры) */
export const EXPIRY_MIN_YY = 25;
export const EXPIRY_MAX_YY = 35;

/** Проверка номера карты алгоритмом Луна */
export function luhn(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** Контрольная сумма ИИН/БИН Казахстана (12 цифр) */
export function iinChecksum(iin: string): boolean {
  if (!/^\d{12}$/.test(iin)) return false;
  const d = iin.split("").map(Number);
  const w1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const w2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];
  let s = d.slice(0, 11).reduce((acc, x, i) => acc + x * w1[i], 0) % 11;
  if (s === 10) {
    s = d.slice(0, 11).reduce((acc, x, i) => acc + x * w2[i], 0) % 11;
    if (s === 10) return false;
  }
  return s === d[11];
}

/** Правдоподобная дата рождения в первых 6 цифрах ИИН */
export function iinPlausible(iin: string): boolean {
  if (!/^\d{12}$/.test(iin)) return false;
  const mm = Number(iin.slice(2, 4));
  const dd = Number(iin.slice(4, 6));
  const c = Number(iin[6]);
  return mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31 && c >= 1 && c <= 6;
}

/** ИИН 12 цифр с верной контрольной суммой или IDN 9 цифр */
export function isValidIdn(v: string): boolean {
  if (/^\d{9}$/.test(v)) return true;
  return iinChecksum(v);
}

/** Срок ММ/ГГ, год в допустимом диапазоне */
export function isValidExpiry(exp: string): boolean {
  const m = exp.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
  if (!m) return false;
  const yy = Number(m[2]);
  return yy >= EXPIRY_MIN_YY && yy <= EXPIRY_MAX_YY;
}

export function formatCardNumber(digits: string): string {
  return digits.replace(/\D/g, "").replace(/(.{4})/g, "$1 ").trim();
}

/** Год срока действия: "12/27" -> "2027" */
export function expiryYear(exp: string): string {
  const m = exp.match(/\/(\d{2})$/);
  return m ? `20${m[1]}` : "Без срока";
}

function findCardNumber(text: string): string {
  const lines = text.split(/\r?\n/);
  // 1. Строка целиком — номер карты с верной контрольной суммой
  for (const line of lines) {
    const d = line.replace(/\D/g, "");
    if (d.length >= 16 && d.length <= 19 && luhn(d)) return d;
  }
  // 2. Группы по 4 цифры (16–19 цифр) внутри текста
  const re = /(?<!\d)\d{4}[ \-]?\d{4}[ \-]?\d{4}[ \-]?\d{4}(?:[ \-]?\d{3})?(?!\d)/g;
  const groups = (text.match(re) ?? []).map((g) => g.replace(/\D/g, ""));
  const ok = groups.find((g) => luhn(g));
  if (ok) return ok;
  // 3. Без контрольной суммы (возможна ошибка OCR в одной цифре) — пользователь проверит
  const weak = lines.map((l) => l.replace(/\D/g, "")).find((d) => d.length === 16);
  return weak ?? groups[0] ?? "";
}

function findIin(text: string, exclude: string): string {
  const lines = text.split(/\r?\n/);
  const c12: string[] = [];
  const c9: string[] = [];
  for (const m of text.match(/(?<!\d)\d{12}(?!\d)/g) ?? []) c12.push(m);
  for (const m of text.match(/(?<!\d)\d{9}(?!\d)/g) ?? []) c9.push(m);
  for (const line of lines) {
    const d = line.replace(/\D/g, "");
    if (d.length === 12) c12.push(d);
    if (d.length === 9) c9.push(d);
  }
  const notCard = (c: string) => !exclude || !exclude.includes(c);
  const strong = c12.find((c) => notCard(c) && iinChecksum(c) && iinPlausible(c));
  if (strong) return strong;
  const idn9 = c9.find(notCard);
  if (idn9) return idn9;
  const plausible = c12.find((c) => notCard(c) && iinPlausible(c));
  if (plausible) return plausible;
  return c12.find(notCard) ?? "";
}

function findExpiry(text: string): string {
  const re = /(0[1-9]|1[0-2])\s*[/\-.]\s*(\d{2})(?!\d)/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) found.push(`${m[1]}/${m[2]}`);
  if (!found.length) return "";
  // только существующие сроки (25–35 год); если таких нет — последний найденный
  const valid = found.filter(isValidExpiry);
  const pool = valid.length ? valid : found;
  return pool[pool.length - 1];
}

/** Разбор текста OCR в данные карты */
export function parseOcrText(text: string): CardData {
  const number = findCardNumber(text);
  const expiry = findExpiry(text);
  const iin = findIin(text, number);
  return { number, iin, expiry };
}
