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

/** Допустимые длины IDN */
export const IDN_LENGTHS = [9, 11];

/** IDN: ровно 9 или 11 цифр */
export function isValidIdn(v: string): boolean {
  return /^\d+$/.test(v) && IDN_LENGTHS.includes(v.length);
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
  const notCard = (c: string) => !exclude || !exclude.includes(c);
  const candidates: string[] = [];
  // 1. Отдельное число из 11 или 9 цифр (без пробелов)
  for (const m of text.match(/(?<!\d)\d{11}(?!\d)/g) ?? []) candidates.push(m);
  for (const m of text.match(/(?<!\d)\d{9}(?!\d)/g) ?? []) candidates.push(m);
  // 2. Строка, в которой суммарно 11 или 9 цифр (OCR мог вставить пробелы)
  for (const line of text.split(/\r?\n/)) {
    const d = line.replace(/\D/g, "");
    if (IDN_LENGTHS.includes(d.length)) candidates.push(d);
  }
  // 3. Число с пробелами внутри строки, например "123 456 789 01"
  for (const m of text.match(/(?<!\d)\d[\d ]{8,14}\d(?!\d)/g) ?? []) {
    const d = m.replace(/\D/g, "");
    if (IDN_LENGTHS.includes(d.length)) candidates.push(d);
  }
  return candidates.find(notCard) ?? "";
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
