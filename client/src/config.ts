// Project-wide toggles. Flip a value here and rebuild — no other edits needed.

export const config = {
  // Which ambient background sound plays when the visitor enables sound.
  //   "synth" — the original Web Audio ambience: a low white-noise bed with
  //             sparse geiger-style ticks (no asset files).
  //   "file"  — loop the audio asset at `backgroundAudioSrc` instead.
  // Either way, a short crackle still plays as each new message lands.
  backgroundAudio: "file" as "synth" | "file",

  // Asset used when `backgroundAudio` is "file". Served from client/public.
  backgroundAudioSrc: "/background.mp3",

  // Looping volume of the file-based background bed (0–1).
  backgroundAudioVolume: 0.5,
};
