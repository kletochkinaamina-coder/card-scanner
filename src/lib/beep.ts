let ctx: AudioContext | null = null;

/** Создать AudioContext после жеста пользователя (иначе браузер блокирует звук) */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

function tone(freq: number, start: number, dur: number, vol = 0.25) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, start);
  gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur);
}

/** «Пип-пип» как на кассе */
export function beepOk() {
  unlockAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(1400, t, 0.09);
  tone(1400, t + 0.13, 0.09);
}

/** Низкий сигнал ошибки / дубликата */
export function beepWarn() {
  unlockAudio();
  if (!ctx) return;
  tone(400, ctx.currentTime, 0.3, 0.2);
}
