let ctx: AudioContext | null = null;

type AudioSessionNav = Navigator & { audioSession?: { type: string } };

/**
 * Включить звук. Браузеры (особенно iPhone) разрешают звук только
 * после касания экрана, поэтому вызывается из обработчика нажатия.
 */
export function unlockAudio() {
  if (typeof window === "undefined") return;
  try {
    // iOS 17+: играть звук даже при беззвучном режиме (как медиа)
    const nav = navigator as AudioSessionNav;
    if (nav.audioSession) nav.audioSession.type = "playback";
  } catch {}
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
  }
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  // Тихий короткий буфер — «прогревает» звук на iOS
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch {}
}

/** Разрешён ли звук браузером сейчас */
export function audioReady(): boolean {
  return !!ctx && ctx.state === "running";
}

function tone(freq: number, start: number, dur: number, vol = 0.35) {
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

function play(fn: (t: number) => void) {
  if (!ctx) return;
  const c = ctx;
  if (c.state !== "running") {
    c.resume()
      .then(() => fn(c.currentTime))
      .catch(() => {});
    return;
  }
  fn(c.currentTime);
}

/** «Пип-пип» как на кассе */
export function beepOk() {
  play((t) => {
    tone(1400, t, 0.09);
    tone(1400, t + 0.13, 0.09);
  });
  try {
    navigator.vibrate?.([60, 60, 60]);
  } catch {}
}

/** Низкий сигнал ошибки / дубликата */
export function beepWarn() {
  play((t) => tone(400, t, 0.3, 0.3));
  try {
    navigator.vibrate?.(300);
  } catch {}
}
