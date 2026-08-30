"use client";
/**
 * MOVA notification sounds — Web Audio oscillators, no asset files.
 *
 * - Created lazily on the first user gesture (browser autoplay policies).
 * - `setSoundMuted` is read synchronously by `playUiSound`, so the app store
 *   can gate sounds without prop-drilling state into every call site.
 * - Sounds are decorative only: a visual toast always accompanies them, so
 *   muting never loses information.
 */
let ctx: AudioContext | null = null;
let muted = false;

export function setSoundMuted(value: boolean): void {
  muted = value;
}

export function isSoundMuted(): boolean {
  return muted;
}

/** Lazily create the shared AudioContext. Returns null if unavailable. */
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const AC: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    // A stale "suspended" context is resumed on the next user gesture.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Play one short envelope (osc -> gain -> destination). */
function blip(
  freqA: number,
  freqB: number,
  type: OscillatorType,
  duration: number,
  volume: number,
): void {
  const ac = audio();
  if (!ac) return;
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    const t = ac.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqB, 1), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  } catch {
    /* never throw from audio — it's decorative */
  }
}

/** Map an AppNotification kind (or a specific event title) to a sound. */
export function playUiSound(kind: "info" | "success" | "warning" | "error" | string): void {
  if (muted) return;
  switch (kind) {
    case "success":
      // Short rising "ding" — settlement confirmed.
      blip(880, 1320, "sine", 0.18, 0.12);
      break;
    case "error":
      // Low double "thud" — something failed.
      blip(220, 110, "triangle", 0.16, 0.14);
      window.setTimeout(() => blip(180, 90, "triangle", 0.2, 0.12), 140);
      break;
    case "warning":
      // Soft two-note chime — attention needed.
      blip(660, 660, "sine", 0.12, 0.08);
      window.setTimeout(() => blip(660, 660, "sine", 0.12, 0.08), 140);
      break;
    default:
      // info / approval-required — gentle single tick.
      blip(660, 660, "sine", 0.1, 0.06);
  }
}
