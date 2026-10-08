/** Web Audio stubs — pitidos simples opcionales */
let ctx = null;
let enabled = true;

export function setSoundEnabled(v) { enabled = !!v; }

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function beep(freq, dur, type = 'sine', gain = 0.08) {
  if (!enabled) return;
  const a = ac();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination);
  o.start();
  o.stop(a.currentTime + dur);
}

export const sfx = {
  grab: () => beep(220, 0.08, 'triangle', 0.05),
  throw: () => beep(140, 0.12, 'sawtooth', 0.06),
  smash: () => { beep(80, 0.18, 'square', 0.07); beep(60, 0.25, 'sawtooth', 0.04); },
  shatter: () => beep(900, 0.06, 'square', 0.04),
  shock: () => beep(180, 0.2, 'sawtooth', 0.07),
  crush: () => beep(55, 0.3, 'sine', 0.09),
  slam: () => beep(45, 0.35, 'square', 0.08),
  shield: () => beep(440, 0.15, 'sine', 0.05),
  hydrant: () => beep(600, 0.4, 'sine', 0.03),
  flee: () => beep(320, 0.05, 'triangle', 0.03),
  hit: () => beep(100, 0.1, 'square', 0.05),
  ui: () => beep(500, 0.05, 'sine', 0.04),
  explode: () => { beep(50, 0.5, 'sawtooth', 0.09); beep(90, 0.3, 'square', 0.06); },
  freeze: () => beep(1200, 0.08, 'sine', 0.03),
  charge: () => beep(660, 0.04, 'triangle', 0.025),
};
