"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Ошибка входа");
    } catch {
      setError("Нет связи с сервером");
    }
    setBusy(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-xl bg-white p-6 shadow-sm">
        <h1 className="text-xl font-bold">Сканер карт</h1>
        <label className="text-sm">
          Пароль
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
