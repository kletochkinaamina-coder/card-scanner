import { NextResponse } from "next/server";
import { AUTH_COOKIE, AUTH_MAX_AGE, expectedToken, tokenForPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const expected = await expectedToken();
  if (!expected) {
    return NextResponse.json({ error: "Пароль не настроен (APP_PASSWORD)" }, { status: 500 });
  }
  let password = "";
  try {
    const body = (await req.json()) as { password?: string };
    password = String(body.password ?? "");
  } catch {}

  const given = await tokenForPassword(password);
  if (given !== expected) {
    await new Promise((r) => setTimeout(r, 500)); // замедлить перебор
    return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
