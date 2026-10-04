"use client";

// Small two-tone chime for newly verified (paid) orders in the POS workspace.
// Implemented with WebAudio so no asset files are needed.

let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  context ??= new Constructor();
  return context;
}

/** Warm up the audio context from a user gesture so later beeps are audible. */
export function unlockOrderSound() {
  try {
    const audio = getContext();
    if (audio?.state === "suspended") void audio.resume();
  } catch {
    /* Audio is unavailable — orders still work silently. */
  }
}

export function playNewOrderSound() {
  try {
    const audio = getContext();
    if (!audio) return;
    if (audio.state === "suspended") void audio.resume();
    const start = audio.currentTime;
    const notes: Array<{ frequency: number; at: number }> = [
      { frequency: 880, at: 0 },
      { frequency: 1174.66, at: 0.14 },
    ];
    for (const note of notes) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = note.frequency;
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(0.25, start + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + 0.4);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start + note.at);
      oscillator.stop(start + note.at + 0.45);
    }
  } catch {
    /* Audio is unavailable — orders still work silently. */
  }
}
