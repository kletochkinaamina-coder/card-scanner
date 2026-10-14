"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recognizeCard, recognizeFrame } from "@/lib/ocr";
import {
  CardData,
  EXPIRY_MAX_YY,
  EXPIRY_MIN_YY,
  ScanRow,
  formatCardNumber,
  isValidExpiry,
  isValidIdn,
  luhn,
} from "@/lib/parse";
import { downloadCsv, downloadXlsx, groupByYear } from "@/lib/export";
import { audioReady, beepOk, beepWarn, unlockAudio } from "@/lib/beep";

const STORAGE_KEY = "card-scanner-rows-v1";
const SOUND_KEY = "card-scanner-sound";
const EMPTY: CardData = { number: "", iin: "", expiry: "" };

type Status = "idle" | "camera" | "scanning" | "result";

interface Acc extends CardData {
  misses: number; // кадров подряд без IDN при найденных номере и сроке
}

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const timerRef = useRef(0);
  const loopRef = useRef<() => Promise<void>>(async () => {});
  const accRef = useRef<Acc>({ ...EMPTY, misses: 0 });
  const rowsRef = useRef<ScanRow[]>([]);
  const soundRef = useRef(true);

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<CardData>(EMPTY);
  const [preview, setPreview] = useState("");
  const [rawText, setRawText] = useState("");
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sound, setSound] = useState(true);
  const [audioOn, setAudioOn] = useState(false);

  // Сохранённые записи и настройка звука
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (s) setRows(JSON.parse(s));
      const snd = localStorage.getItem(SOUND_KEY);
      if (snd === "0") setSound(false);
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    rowsRef.current = rows;
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {}
  }, [rows, loaded]);
  useEffect(() => {
    soundRef.current = sound;
    try {
      localStorage.setItem(SOUND_KEY, sound ? "1" : "0");
    } catch {}
  }, [sound]);

  // Разблокировать звук любым касанием (браузер не даёт играть звук без жеста)
  useEffect(() => {
    const h = () => {
      unlockAudio();
      window.setTimeout(() => setAudioOn(audioReady()), 50);
    };
    const evs = ["pointerdown", "touchend", "click", "keydown"] as const;
    evs.forEach((e) => window.addEventListener(e, h, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, h));
  }, []);

  const stopCamera = useCallback(() => {
    activeRef.current = false;
    window.clearTimeout(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  /** Кадр из видео, обрезанный по рамке */
  const captureFrame = useCallback((): HTMLCanvasElement | null => {
    const v = videoRef.current;
    const frame = frameRef.current;
    const guide = guideRef.current;
    if (!v || !frame || !guide || !v.videoWidth || v.readyState < 2) return null;

    const fr = frame.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    const scale = Math.max(fr.width / v.videoWidth, fr.height / v.videoHeight);
    const offX = (fr.width - v.videoWidth * scale) / 2;
    const offY = (fr.height - v.videoHeight * scale) / 2;
    const sx = (gr.left - fr.left - offX) / scale;
    const sy = (gr.top - fr.top - offY) / scale;
    const sw = gr.width / scale;
    const sh = gr.height / scale;

    const c = document.createElement("canvas");
    c.width = Math.round(sw);
    c.height = Math.round(sh);
    c.getContext("2d")!.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }, []);

  /** Есть ли в кадре что-то кроме ровного фона */
  function hasContent(c: HTMLCanvasElement): boolean {
    const s = document.createElement("canvas");
    s.width = 64;
    s.height = 40;
    const ctx = s.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(c, 0, 0, 64, 40);
    const d = ctx.getImageData(0, 0, 64, 40).data;
    let sum = 0;
    let sq = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
      sum += g;
      sq += g * g;
    }
    const mean = sum / n;
    const std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    return std > 14;
  }

  const finish = useCallback(
    (data: CardData, canvas: HTMLCanvasElement, raw: string) => {
      stopCamera();
      setPreview(canvas.toDataURL("image/jpeg", 0.8));
      setForm(data);
      setRawText(raw);
      setHint("");
      const dup = data.number && rowsRef.current.some((r) => r.number === data.number);
      if (dup) {
        setError("Эта карта уже есть в таблице");
        if (soundRef.current) beepWarn();
      } else {
        setError("");
        if (soundRef.current) beepOk();
      }
      setStatus("result");
    },
    [stopCamera],
  );

  /** Цикл автосканирования */
  const loop = useCallback(async () => {
    if (!activeRef.current) return;
    try {
      const c = busyRef.current ? null : captureFrame();
      if (c) {
        if (!hasContent(c)) {
          setHint("Поднесите карту к рамке");
        } else {
          busyRef.current = true;
          try {
            const r = await recognizeFrame(c);
            if (activeRef.current) {
              const acc = accRef.current;
              if (luhn(r.number)) acc.number = r.number;
              if (isValidExpiry(r.expiry)) acc.expiry = r.expiry;
              if (isValidIdn(r.iin)) acc.iin = r.iin;

              if (acc.number && acc.expiry && (acc.iin || acc.misses >= 3)) {
                const data = { number: acc.number, iin: acc.iin, expiry: acc.expiry };
                accRef.current = { ...EMPTY, misses: 0 };
                finish(data, c, r.rawText);
              } else if (acc.number && acc.expiry) {
                acc.misses++;
                setHint("Номер и срок найдены, ищу IDN…");
              } else if (acc.number) {
                setHint("Номер найден, ищу срок действия…");
              } else if (acc.expiry || acc.iin) {
                setHint("Ищу номер карты…");
              } else {
                setHint("Ищу карту… держите ровно, без бликов");
              }
            }
          } finally {
            busyRef.current = false;
          }
        }
      }
    } catch {
      // кадр пропущен (ошибка захвата или распознавания) — продолжаем
    }
    if (activeRef.current) timerRef.current = window.setTimeout(() => loopRef.current(), 250);
  }, [captureFrame, finish]);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);

  const startCamera = useCallback(async () => {
    setError("");
    setHint("Запуск камеры…");
    accRef.current = { ...EMPTY, misses: 0 };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setHint("Ищу карту…");
      setStatus("camera"); // поток подключится к <video> в эффекте ниже
    } catch (e) {
      setStatus("idle");
      setHint("");
      setError(
        "Нет доступа к камере. Разрешите доступ в настройках браузера или загрузите фото. " +
          (e instanceof Error ? e.message : ""),
      );
    }
  }, []);

  // Подключить поток к <video>, когда он отрендерен, и запустить цикл
  useEffect(() => {
    if (status !== "camera") return;
    const v = videoRef.current;
    const s = streamRef.current;
    if (!v || !s) return;
    v.srcObject = s;
    v.play().catch(() => {});
    activeRef.current = true;
    loopRef.current();
    return () => {
      window.clearTimeout(timerRef.current);
    };
  }, [status]);

  // Автозапуск камеры при открытии
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => startCamera(), 0);
    return () => window.clearTimeout(t);
  }, [loaded, startCamera]);

  async function runFullOcr(canvas: HTMLCanvasElement) {
    stopCamera();
    setStatus("scanning");
    setProgress(0);
    setError("");
    setPreview(canvas.toDataURL("image/jpeg", 0.8));
    try {
      const res = await recognizeCard(canvas, setProgress);
      if (!res.number && !res.iin && !res.expiry) {
        setForm(EMPTY);
        setRawText(res.rawText);
        setError("Ничего не распознано. Поднесите карту ближе, уберите блики и попробуйте снова.");
        setStatus("result");
        return;
      }
      finish({ number: res.number, iin: res.iin, expiry: res.expiry }, canvas, res.rawText);
    } catch (e) {
      setError("Ошибка распознавания: " + (e instanceof Error ? e.message : String(e)));
      setForm(EMPTY);
      setStatus("result");
    }
  }

  async function scanNow() {
    const c = captureFrame();
    if (!c) {
      setError("Камера ещё не готова");
      return;
    }
    await runFullOcr(c);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    stopCamera();
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      const maxW = 2000;
      const s = Math.min(1, maxW / img.width);
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      runFullOcr(c);
    };
    img.onerror = () => setError("Не удалось открыть файл");
    img.src = url;
  }

  function addRow() {
    const number = form.number.replace(/\D/g, "");
    const iin = form.iin.replace(/\D/g, "");
    const expiry = form.expiry.trim();
    if (!number && !iin && !expiry) return;
    if (expiry && !isValidExpiry(expiry)) {
      setError(`Срок должен быть ММ/ГГ, год от ${EXPIRY_MIN_YY} до ${EXPIRY_MAX_YY}`);
      return;
    }
    setRows((r) => [
      ...r,
      { id: crypto.randomUUID(), number, iin, expiry, scannedAt: new Date().toISOString() },
    ]);
    setForm(EMPTY);
    setPreview("");
    setRawText("");
    setError("");
    startCamera();
  }

  function removeRow(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
  }

  function clearAll() {
    if (confirm("Удалить все отсканированные записи?")) setRows([]);
  }

  async function logout() {
    stopCamera();
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  const numberOk = luhn(form.number.replace(/\D/g, ""));
  const iinOk = isValidIdn(form.iin.replace(/\D/g, ""));
  const expiryOk = isValidExpiry(form.expiry);
  const groups = groupByYear(rows);

  const inputCls = (ok: boolean, val: string) =>
    "w-full rounded-lg border px-3 py-2 text-lg font-mono outline-none focus:ring-2 focus:ring-blue-500 " +
    (val ? (ok ? "border-green-500 bg-green-50" : "border-amber-500 bg-amber-50") : "border-gray-300");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Сканер карт</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              unlockAudio();
              if (!sound) beepOk(); // при включении — пробный «бип»
              setSound((s) => !s);
            }}
            className="rounded-lg border border-gray-300 px-3 py-1 text-sm"
            title="Звук при сканировании"
          >
            {sound ? "Звук: вкл" : "Звук: выкл"}
          </button>
          <button onClick={logout} className="text-sm text-gray-500">
            Выйти
          </button>
        </div>
      </div>

      {sound && !audioOn && (
        <button
          onClick={() => {
            unlockAudio();
            beepOk();
            window.setTimeout(() => setAudioOn(audioReady()), 100);
          }}
          className="rounded-lg bg-amber-100 px-4 py-3 text-sm font-semibold text-amber-900 active:bg-amber-200"
        >
          Нажмите, чтобы включить звук сканера
        </button>
      )}

      {/* Камера / результат */}
      <section className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
        {status === "camera" && (
          <div ref={frameRef} className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-black sm:aspect-[4/3]">
            <video ref={videoRef} className="h-full w-full object-cover" playsInline muted autoPlay />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                ref={guideRef}
                className="aspect-[1.586] w-[92%] rounded-xl border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
              />
            </div>
            <p className="absolute bottom-2 left-0 right-0 text-center text-sm text-white drop-shadow">
              {hint || "Поместите карту в рамку"}
            </p>
          </div>
        )}

        {status === "scanning" && (
          <div className="flex flex-col items-center gap-3 py-6">
            {preview && <img src={preview} alt="" className="max-h-48 rounded-lg" />}
            <div className="h-2 w-full overflow-hidden rounded bg-gray-200">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-sm text-gray-600">Распознавание… {Math.round(progress * 100)}%</p>
          </div>
        )}

        {status === "result" && (
          <div className="flex flex-col gap-3">
            {preview && <img src={preview} alt="" className="max-h-40 self-center rounded-lg" />}
            <label className="text-sm">
              Номер карты
              <input
                className={inputCls(numberOk, form.number)}
                inputMode="numeric"
                value={formatCardNumber(form.number)}
                onChange={(e) => setForm({ ...form, number: e.target.value.replace(/\D/g, "").slice(0, 19) })}
                placeholder="0000 0000 0000 0000"
              />
            </label>
            <label className="text-sm">
              IDN (9 или 12 цифр)
              <input
                className={inputCls(iinOk, form.iin)}
                inputMode="numeric"
                value={form.iin}
                onChange={(e) => setForm({ ...form, iin: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                placeholder="9 или 12 цифр"
              />
            </label>
            <label className="text-sm">
              Срок действия (ММ/ГГ, год {EXPIRY_MIN_YY}–{EXPIRY_MAX_YY})
              <input
                className={inputCls(expiryOk, form.expiry)}
                inputMode="numeric"
                value={form.expiry}
                onChange={(e) => {
                  let v = e.target.value.replace(/[^\d/]/g, "").slice(0, 5);
                  if (/^\d{3,}$/.test(v)) v = v.slice(0, 2) + "/" + v.slice(2);
                  setForm({ ...form, expiry: v });
                }}
                placeholder="ММ/ГГ"
              />
            </label>
            <p className="text-xs text-gray-500">
              Зелёное — проверка пройдена, жёлтое — проверьте вручную. Поля можно редактировать.
            </p>
            <div className="flex gap-2">
              <button onClick={addRow} className="flex-1 rounded-lg bg-green-600 px-4 py-3 font-semibold text-white active:bg-green-700">
                Добавить в таблицу
              </button>
              <button onClick={startCamera} className="rounded-lg border border-gray-300 px-4 py-3 active:bg-gray-100">
                Пропустить
              </button>
            </div>
            {rawText && (
              <details>
                <summary className="cursor-pointer text-xs text-gray-500">Текст OCR</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-100 p-2 text-xs">{rawText}</pre>
              </details>
            )}
          </div>
        )}

        {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="mt-3 flex flex-col gap-2">
          {status === "camera" && (
            <button onClick={scanNow} className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-semibold text-blue-700 active:bg-blue-50">
              Снять вручную
            </button>
          )}
          {status === "idle" && (
            <button onClick={startCamera} className="rounded-lg bg-blue-600 px-4 py-3 text-lg font-semibold text-white active:bg-blue-700">
              Включить камеру
            </button>
          )}
          {status !== "scanning" && (
            <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-gray-300 px-4 py-2 text-sm active:bg-gray-100">
              Загрузить фото карты
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
        </div>
      </section>

      {/* Таблицы по годам */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Отсканировано: {rows.length}</h2>
          {rows.length > 0 && (
            <button onClick={clearAll} className="text-sm text-red-600">
              Очистить всё
            </button>
          )}
        </div>

        {rows.length > 0 && (
          <button onClick={() => downloadXlsx(rows)} className="rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white active:bg-emerald-800">
            Скачать Excel (лист на каждый год)
          </button>
        )}

        {groups.map(([year, list]) => (
          <div key={year} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
              <h3 className="font-semibold">
                Срок действия: {year} <span className="font-normal text-gray-500">({list.length})</span>
              </h3>
              <button onClick={() => downloadCsv(list, year)} className="text-sm text-blue-700">
                CSV
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="px-2 py-1">№</th>
                    <th className="px-2 py-1">Номер карты</th>
                    <th className="px-2 py-1">IDN</th>
                    <th className="px-2 py-1">Срок</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{formatCardNumber(r.number) || "—"}</td>
                      <td className="px-2 py-1 font-mono">{r.iin || "—"}</td>
                      <td className="px-2 py-1 font-mono">{r.expiry || "—"}</td>
                      <td className="px-2 py-1 text-right">
                        <button onClick={() => removeRow(r.id)} className="text-red-500" aria-label="Удалить">
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        {loaded && rows.length === 0 && (
          <p className="text-sm text-gray-500">
            Таблицы появятся после первого сканирования. Каждый год срока действия — отдельная таблица. Записи сохраняются на этом телефоне.
          </p>
        )}
      </section>
    </div>
  );
}
