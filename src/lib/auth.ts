export const AUTH_COOKIE = "cs_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30; // 30 дней

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Токен сессии = хэш пароля из APP_PASSWORD; null, если пароль не задан */
export async function expectedToken(): Promise<string | null> {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  return sha256("card-scanner:v1:" + pw);
}

export async function tokenForPassword(pw: string): Promise<string> {
  return sha256("card-scanner:v1:" + pw);
}
