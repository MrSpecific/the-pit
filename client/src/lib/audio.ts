import { useCallback, useEffect, useRef, useState } from "react";
import { config } from "../config";

// The ambient bed comes in two flavours, chosen in ../config:
//   "synth" — synthesized with the Web Audio API (no asset files): a low
//             white-noise bed plus sparse random "ticks" for a geiger-counter
//             ambience.
//   "file"  — a looped audio asset (config.backgroundAudioSrc).
// In both modes each new message lands with a short crackle blip, which is
// always synthesized via Web Audio.

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// A short band-passed noise burst — one geiger tick.
function tick(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const dur = 0.03;
  const src = ctx.createBufferSource();
  src.buffer = makeNoise(ctx, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1500;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.001); // quiet vs. the bed
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur);
}

// A brief, haunted burst of static — plays when a message lands. Filtered
// noise with a downward band sweep and a quick, slightly ragged decay; kept
// subtle so it reads as a crackle, not a beep.
function crackle(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const dur = 0.22;
  const src = ctx.createBufferSource();
  src.buffer = makeNoise(ctx, dur);
  // Thin the noise so it reads as crackle/static rather than full white noise.
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1100;
  // Sweep the band downward for an eerie "settling into the void" feel.
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(3200, t);
  bp.frequency.exponentialRampToValueAtTime(700, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.05, t + 0.06); // ragged step
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(bp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur);
}

const STORAGE_KEY = "the-pit:sound";

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false; // storage unavailable (private mode, etc.)
  }
}

export interface AudioControls {
  enabled: boolean;
  toggle: () => void;
  blip: () => void;
}

export function useAudio(): AudioControls {
  // `enabled` reflects whether sound is ACTUALLY playing — not merely the
  // stored intent. The autoplay policy keeps the AudioContext suspended until a
  // user gesture, so a persisted "on" can't resume on load; showing the toggle
  // as "playing" before then is the bug we're avoiding. We start false and let
  // the first interaction resume it (see the unlock effect below).
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const tickTimer = useRef<number | null>(null);
  const enabledRef = useRef(false);
  // File-based bed: the looping <audio> element, routed through the context so
  // it shares the master fade with the crackle blips.
  const bgElRef = useRef<HTMLAudioElement | null>(null);

  // Lazily build the graph on first enable — inside the user gesture, so the
  // browser's autoplay policy lets it run.
  const start = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();

      // iOS routes Web Audio through a session the hardware mute switch
      // silences. Opt into "playback" so ambient sound plays regardless
      // (Safari 16.4+; harmless/no-op elsewhere).
      try {
        const session = (
          navigator as unknown as { audioSession?: { type: string } }
        ).audioSession;
        if (session) session.type = "playback";
      } catch {
        /* not supported */
      }

      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);

      if (config.backgroundAudio === "synth") {
        const bed = ctx.createBufferSource();
        bed.buffer = makeNoise(ctx, 2);
        bed.loop = true;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 600;
        const bedGain = ctx.createGain();
        bedGain.gain.value = 0.05;
        bed.connect(lp).connect(bedGain).connect(master);
        bed.start();
      } else {
        // Loop the audio asset, routed through a gain into the master so it
        // fades with everything else.
        const el = new Audio(config.backgroundAudioSrc);
        el.loop = true;
        el.crossOrigin = "anonymous";
        const bedSrc = ctx.createMediaElementSource(el);
        const bedGain = ctx.createGain();
        bedGain.gain.value = config.backgroundAudioVolume;
        bedSrc.connect(bedGain).connect(master);
        bgElRef.current = el;
      }

      ctxRef.current = ctx;
      masterRef.current = master;
    }
    const ctx = ctxRef.current;
    const master = masterRef.current!;
    void ctx.resume();
    void bgElRef.current?.play();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.25); // fade in
    if (config.backgroundAudio === "synth" && tickTimer.current == null) {
      tickTimer.current = window.setInterval(() => {
        if (Math.random() < 0.2) tick(ctx, master); // ~1 tick / 4–5s, irregular
      }, 900);
    }
    // Sound is now actually running — reflect that in the toggle.
    enabledRef.current = true;
    setEnabled(true);
  }, []);

  const stop = useCallback(() => {
    if (tickTimer.current != null) {
      clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.2); // fade out
    }
    // Pause the looping asset after the fade so it doesn't keep decoding.
    const el = bgElRef.current;
    if (el) window.setTimeout(() => el.pause(), 300);
    enabledRef.current = false;
    setEnabled(false);
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable */
    }
    // Run start()/stop() synchronously in the click handler — NOT deferred.
    // iOS Safari only unlocks/resumes an AudioContext from within the
    // user-gesture call stack. start()/stop() own the `enabled` state, so it
    // only ever flips once sound is actually running (or stopped).
    if (next) start();
    else stop();
  }, [start, stop]);

  const blip = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (!enabledRef.current || !ctx || !master) return;
    crackle(ctx, master);
  }, []);

  // If sound was left on from a previous visit, the autoplay policy still
  // blocks starting it on load — so resume at the first user interaction, which
  // then flips the toggle to its playing state.
  // NOTE: iOS only unlocks audio from `touchend`/`click`, NOT pointer/touch
  // *start* — using those would create a suspended context that never plays
  // until the next gesture, which is exactly the "works only after re-toggle"
  // bug. So we listen on the events iOS actually honors.
  useEffect(() => {
    if (!readStoredPreference()) return;
    const events: (keyof WindowEventMap)[] = ["click", "touchend", "keydown"];
    const unlock = () => {
      events.forEach((e) => window.removeEventListener(e, unlock));
      // Skip if the gesture was the toggle itself turning sound off, or if it's
      // already running — start() is idempotent but this avoids a needless
      // fade re-trigger.
      if (readStoredPreference() && !enabledRef.current) start();
    };
    events.forEach((e) => window.addEventListener(e, unlock));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, [start]);

  useEffect(() => {
    return () => {
      if (tickTimer.current != null) clearInterval(tickTimer.current);
      bgElRef.current?.pause();
      void ctxRef.current?.close();
    };
  }, []);

  return { enabled, toggle, blip };
}
