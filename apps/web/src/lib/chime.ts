const NOTES_HZ = [880, 1320];
const NOTE_S = 0.16;
const VOLUME = 0.12;

let context: AudioContext | null = null;

/**
 * A short two-note chime made in the browser, so there is no sound file. Browsers only allow sound after the
 * person has clicked in the tab once; before that it stays silent.
 */
export const playChime = (): void => {
  try {
    context ??= new AudioContext();
    void context.resume();
    const start = context.currentTime;
    NOTES_HZ.forEach((frequency, index) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const at = start + index * NOTE_S;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(VOLUME, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_S * 2);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(at);
      oscillator.stop(at + NOTE_S * 2);
    });
  } catch {
    // No audio in this browser: the toast and notification still show.
  }
};
