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
  g.gain.exponentialRampToValueAtTime(0.5, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + dur);
}

// A short rising square blip — plays when a message lands.
function blipSound(ctx: AudioContext, dest: AudioNode) {
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(660, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.05);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + 0.13);
}

export interface AudioControls {
  enabled: boolean;
  toggle: () => void;
  blip: () => void;
}

export function useAudio(): AudioControls {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const tickTimer = useRef<number | null>(null);
  const enabledRef = useRef(false);

  // Lazily build the graph on first enable — inside the user gesture, so the
  // browser's autoplay policy lets it run.
  const start = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctor();
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
        if (Math.random() < 0.4) tick(ctx, master); // ~3 ticks/sec, irregular
      }, 130);
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
    setEnabled((on) => {
      const next = !on;
      enabledRef.current = next;
      if (next) start();
      else stop();
      return next;
    });
  }, [start, stop]);

  const blip = useCallback(() => {
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (!enabledRef.current || !ctx || !master) return;
    blipSound(ctx, master);
  }, []);

  useEffect(() => {
    return () => {
      if (tickTimer.current != null) clearInterval(tickTimer.current);
      void ctxRef.current?.close();
    };
  }, []);

  return { enabled, toggle, blip };
}
