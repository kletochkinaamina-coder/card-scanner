import { createWorker, PSM, Worker } from "tesseract.js";
import { CardData, parseOcrText } from "./parse";

let workerPromise: Promise<Worker> | null = null;
let progressCb: ((p: number) => void) | undefined;

export function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && progressCb) progressCb(m.progress);
      },
    }).then(async (w) => {
      await w.setParameters({
        tessedit_char_whitelist: "0123456789/ ",
        preserve_interword_spaces: "1",
      });
      return w;
    });
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

/** Ч/б + растяжение контраста */
export function preprocess(src: HTMLCanvasElement, targetWidth = 1600): HTMLCanvasElement {
  const scale = Math.max(1, targetWidth / src.width);
  const out = document.createElement("canvas");
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);

  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const gray = new Uint8ClampedArray(d.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    gray[j] = g;
    hist[g | 0]++;
  }
  const total = gray.length;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > total * 0.02) {
      lo = i;
      break;
    }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc > total * 0.02) {
      hi = i;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((gray[j] - lo) * 255) / range));
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export interface OcrResult extends CardData {
  rawText: string;
}

/** Распознаёт карту: сначала блочный режим, при нехватке полей — разреженный текст */
export async function recognizeCard(
  canvas: HTMLCanvasElement,
  onProgress?: (p: number) => void,
): Promise<OcrResult> {
  progressCb = onProgress;
  const worker = await getWorker();
  const img = preprocess(canvas);

  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  const r1 = await worker.recognize(img);
  let data = parseOcrText(r1.data.text);
  let raw = r1.data.text;

  if (!data.number || !data.iin || !data.expiry) {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const r2 = await worker.recognize(img);
    const d2 = parseOcrText(r2.data.text);
    raw += "\n---\n" + r2.data.text;
    data = {
      number: data.number || d2.number,
      iin: data.iin || d2.iin,
      expiry: data.expiry || d2.expiry,
    };
  }
  return { ...data, rawText: raw };
}
