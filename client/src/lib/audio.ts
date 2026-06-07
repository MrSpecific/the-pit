import { useCallback, useEffect, useRef, useState } from "react";

// All sound is synthesized with the Web Audio API — no asset files. A low
// white-noise bed plus sparse random "ticks" gives a geiger-counter ambience,
// and each new message lands with a short rising blip.

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
  const [enabled, setEnabled] = useState(readStoredPreference);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const tickTimer = useRef<number | null>(null);
  const enabledRef = useRef(enabled);

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

      ctxRef.current = ctx;
      masterRef.current = master;
    }
    const ctx = ctxRef.current;
    const master = masterRef.current!;
    void ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.5, ctx.currentTime, 0.25); // fade in
    if (tickTimer.current == null) {
      tickTimer.current = window.setInterval(() => {
        if (Math.random() < 0.2) tick(ctx, master); // ~1 tick / 4–5s, irregular
      }, 900);
    }
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
  }, []);

  const toggle = useCallback(() => {
    const next = !enabledRef.current;
    enabledRef.current = next;
    try {
      localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      /* storage unavailable */
    }
    // Run start()/stop() synchronously in the click handler — NOT inside the
    // setEnabled updater. iOS Safari only unlocks/resumes an AudioContext from
    // within the user-gesture call stack, and React may defer the updater.
    if (next) start();
    else stop();
    setEnabled(next);
  }, [start, stop]);

  const blip = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (!enabledRef.current || !ctx || !master) return;
    crackle(ctx, master);
  }, []);

  // If sound was left on from a previous visit, the autoplay policy still
  // blocks starting it on load — so begin at the first user interaction.
  // NOTE: iOS only unlocks audio from `touchend`/`click`, NOT pointer/touch
  // *start* — using those would create a suspended context that never plays
  // until the next gesture, which is exactly the "works only after re-toggle"
  // bug. So we listen on the events iOS actually honors.
  useEffect(() => {
    if (!enabledRef.current) return;
    const events: (keyof WindowEventMap)[] = ["click", "touchend", "keydown"];
    const unlock = () => {
      events.forEach((e) => window.removeEventListener(e, unlock));
      if (enabledRef.current) start();
    };
    events.forEach((e) => window.addEventListener(e, unlock));
    return () => events.forEach((e) => window.removeEventListener(e, unlock));
  }, [start]);

  useEffect(() => {
    return () => {
      if (tickTimer.current != null) clearInterval(tickTimer.current);
      void ctxRef.current?.close();
    };
  }, []);

  return { enabled, toggle, blip };
}
