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

/**
 * Тон как у пьезо-пищалки сканера штрихкодов: ровная громкость,
 * мгновенное начало и конец (без затухания), лёгкая «пищащая» окраска.
 */
function tone(freq: number, start: number, dur: number, vol = 0.3) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  // срезаем верхние гармоники квадрата — звук как у пьезо, а не «8-бит»
  filter.type = "lowpass";
  filter.frequency.value = freq * 2.2;
  filter.Q.value = 0.7;
  const a = 0.003; // атака 3 мс
  const r = 0.006; // спад 6 мс
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(vol, start + a);
  gain.gain.setValueAtTime(vol, start + dur - r);
  gain.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.01);
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

/** Один короткий высокий «бип», как сканер на кассе супермаркета */
export function beepOk() {
  play((t) => tone(2730, t, 0.13));
  try {
    navigator.vibrate?.(80);
  } catch {}
}

/** Ошибка / дубликат: двойной низкий сигнал, как отказ на кассе */
export function beepWarn() {
  play((t) => {
    tone(620, t, 0.16, 0.35);
    tone(620, t + 0.22, 0.16, 0.35);
  });
  try {
    navigator.vibrate?.([150, 80, 150]);
  } catch {}
}
