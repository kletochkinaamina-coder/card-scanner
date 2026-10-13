"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { recognizeCard } from "@/lib/ocr";
import {
  CardData,
  ScanRow,
  formatCardNumber,
  iinChecksum,
  isValidExpiry,
  luhn,
} from "@/lib/parse";
import { downloadCsv, downloadXlsx, groupByYear } from "@/lib/export";

const STORAGE_KEY = "card-scanner-rows-v1";
const EMPTY: CardData = { number: "", iin: "", expiry: "" };

type Status = "idle" | "camera" | "scanning" | "result";

export default function Scanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [form, setForm] = useState<CardData>(EMPTY);
  const [preview, setPreview] = useState("");
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  // localStorage
  useEffect(() => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (s) setRows(JSON.parse(s));
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {}
  }, [rows, loaded]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  async function startCamera() {
    setError("");
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
      setStatus("camera");
      // дождаться рендера <video>
      requestAnimationFrame(async () => {
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        try {
          await v.play();
        } catch {}
      });
    } catch (e) {
      setError(
        "Нет доступа к камере. Разрешите доступ в настройках браузера или загрузите фото. " +
          (e instanceof Error ? e.message : ""),
      );
    }
  }

  /** Кадр из видео, обрезанный по рамке */
  function captureFrame(): HTMLCanvasElement | null {
    const v = videoRef.current;
    const frame = frameRef.current;
    const guide = guideRef.current;
    if (!v || !frame || !guide || !v.videoWidth) return null;

    const fr = frame.getBoundingClientRect();
    const gr = guide.getBoundingClientRect();
    // object-fit: cover
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
  }

  async function runOcr(canvas: HTMLCanvasElement) {
    setStatus("scanning");
    setProgress(0);
    setError("");
    setPreview(canvas.toDataURL("image/jpeg", 0.8));
    try {
      const res = await recognizeCard(canvas, setProgress);
      setForm({ number: res.number, iin: res.iin, expiry: res.expiry });
      setRawText(res.rawText);
      if (!res.number && !res.iin && !res.expiry) {
        setError("Ничего не распознано. Поднесите карту ближе, уберите блики и попробуйте снова.");
      }
    } catch (e) {
      setError("Ошибка распознавания: " + (e instanceof Error ? e.message : String(e)));
      setForm(EMPTY);
    }
    setStatus("result");
  }

  async function scan() {
    const c = captureFrame();
    if (!c) {
      setError("Камера ещё не готова");
      return;
    }
    stopCamera();
    await runOcr(c);
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
      runOcr(c);
    };
    img.onerror = () => setError("Не удалось открыть файл");
    img.src = url;
  }

  function addRow() {
    const number = form.number.replace(/\D/g, "");
    const iin = form.iin.replace(/\D/g, "");
    const expiry = form.expiry.trim();
    if (!number && !iin && !expiry) return;
    setRows((r) => [
      ...r,
      { id: crypto.randomUUID(), number, iin, expiry, scannedAt: new Date().toISOString() },
    ]);
    setForm(EMPTY);
    setPreview("");
    setRawText("");
    setStatus("idle");
  }

  function removeRow(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
  }

  function clearAll() {
    if (confirm("Удалить все отсканированные записи?")) setRows([]);
  }

  const numberOk = luhn(form.number.replace(/\D/g, ""));
  const iinOk = iinChecksum(form.iin.replace(/\D/g, ""));
  const expiryOk = isValidExpiry(form.expiry);
  const groups = groupByYear(rows);

  const inputCls = (ok: boolean, val: string) =>
    "w-full rounded-lg border px-3 py-2 text-lg font-mono outline-none focus:ring-2 focus:ring-blue-500 " +
    (val ? (ok ? "border-green-500 bg-green-50" : "border-amber-500 bg-amber-50") : "border-gray-300");

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">Сканер карт</h1>

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
              Поместите карту в рамку
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
              ИИН (IDN)
              <input
                className={inputCls(iinOk, form.iin)}
                inputMode="numeric"
                value={form.iin}
                onChange={(e) => setForm({ ...form, iin: e.target.value.replace(/\D/g, "").slice(0, 12) })}
                placeholder="12 цифр"
              />
            </label>
            <label className="text-sm">
              Срок действия
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
                Ещё раз
              </button>
            </div>
            {rawText && (
              <details open={showRaw} onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}>
                <summary className="cursor-pointer text-xs text-gray-500">Текст OCR</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-gray-100 p-2 text-xs">{rawText}</pre>
              </details>
            )}
          </div>
        )}

        {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}

        <div className="mt-3 flex flex-col gap-2">
          {status === "camera" ? (
            <button onClick={scan} className="rounded-lg bg-blue-600 px-4 py-3 text-lg font-semibold text-white active:bg-blue-700">
              Сканировать
            </button>
          ) : status !== "scanning" && status !== "result" ? (
            <button onClick={startCamera} className="rounded-lg bg-blue-600 px-4 py-3 text-lg font-semibold text-white active:bg-blue-700">
              Включить камеру
            </button>
          ) : null}
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
                    <th className="px-2 py-1">ИИН</th>
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
          <p className="text-sm text-gray-500">Таблицы появятся после первого сканирования. Каждый год срока действия — отдельная таблица.</p>
        )}
      </section>
    </div>
  );
}
