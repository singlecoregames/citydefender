/*
 * ZzFX - Zuper Zmall Zound Zynth v1.3.2 by Frank Force — MIT License
 * https://github.com/KilledByAPixel/ZzFX
 *
 * Vendored and typed for City Defender: procedural SFX keeps the repo's
 * zero-external-assets rule (see docs/GAME_DESIGN.md §7). Adapted parts:
 *  - lazy AudioContext (created on the first user gesture, autoplay-safe)
 *  - a master GainNode so mute/volume apply instantly to live sounds
 * `buildSamples` is a faithful port of the original — do not "clean it up".
 */

/** The 20 zzfx parameters, all optional (see buildSamples for defaults). */
export type ZzfxSound = (number | undefined)[];

const SAMPLE_RATE = 44100;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let masterVolume = 1;

/** Create (or resume) the audio context. Call from a user-gesture handler —
 *  browsers keep the context suspended until one arrives. Safe to call often. */
export function zzfxUnlock(): void {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = masterVolume;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

/** Master volume (0..1). 0 silences live and future sounds immediately. */
export function zzfxSetVolume(v: number): void {
  masterVolume = v;
  if (master) master.gain.value = v;
}

/** Build and play a sound. No-ops until zzfxUnlock has run (and skips the
 *  sample build entirely while fully muted — it's the expensive part). */
export function zzfx(params: ZzfxSound, volumeScale = 1): void {
  if (!ctx || !master || ctx.state !== 'running' || masterVolume <= 0) return;
  const samples = buildSamples(...params);
  const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
  buffer.getChannelData(0).set(samples);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = volumeScale;
  source.connect(gain).connect(master);
  source.start();
}

// ---------------------------------------------------------------------------
// Faithful port of ZZFX.buildSamples (v1.3.2). Exported (pure, DOM-free) so
// the sound table can be sanity-tested headlessly.
// ---------------------------------------------------------------------------
export function buildSamples(
  volume = 1,
  randomness = 0.05,
  frequency = 220,
  attack = 0,
  sustain = 0,
  release = 0.1,
  shape = 0,
  shapeCurve = 1,
  slide = 0,
  deltaSlide = 0,
  pitchJump = 0,
  pitchJumpTime = 0,
  repeatTime = 0,
  noise = 0,
  modulation = 0,
  bitCrush = 0,
  delay = 0,
  sustainVolume = 1,
  decay = 0,
  tremolo = 0,
  filter = 0,
): number[] {
  // init parameters
  const sampleRate = SAMPLE_RATE,
    PI2 = Math.PI * 2,
    abs = Math.abs,
    sign = (v: number): number => (v < 0 ? -1 : 1);
  let startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate),
    startFrequency = (frequency *= ((1 + randomness * 2 * Math.random() - randomness) * PI2) / sampleRate),
    modOffset = 0, // modulation offset
    repeat = 0, // repeat offset
    crush = 0, // bit crush offset
    jump = 1, // pitch jump timer
    length, // sample length
    t = 0, // sample time
    i = 0, // sample index
    s = 0, // sample value
    f; // wave frequency
  const b: number[] = []; // sample buffer

  // biquad LP/HP filter
  const quality = 2,
    w = (PI2 * abs(filter) * 2) / sampleRate,
    cos = Math.cos(w),
    alpha = Math.sin(w) / 2 / quality,
    a0 = 1 + alpha,
    a1 = (-2 * cos) / a0,
    a2 = (1 - alpha) / a0,
    b0 = (1 + sign(filter) * cos) / 2 / a0,
    b1 = -(sign(filter) + cos) / a0,
    b2 = b0;
  let x2 = 0,
    x1 = 0,
    y2 = 0,
    y1 = 0;

  // scale by sample rate
  const minAttack = 9; // prevent pop if attack is 0
  attack = attack * sampleRate || minAttack;
  decay *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;
  delay *= sampleRate;
  deltaSlide *= (500 * PI2) / sampleRate ** 3;
  modulation *= PI2 / sampleRate;
  pitchJump *= PI2 / sampleRate;
  pitchJumpTime *= sampleRate;
  repeatTime = (repeatTime * sampleRate) | 0;

  // generate waveform
  for (length = (attack + decay + sustain + release + delay) | 0; i < length; b[i++] = s * volume) {
    if (!(++crush % ((bitCrush * 100) | 0))) {
      // bit crush
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? shape > 4
                ? ((t / PI2) % 1 < shapeCurve / 2 ? 1 : 0) * 2 - 1 // 5 square duty
                : Math.sin(t ** 3) // 4 noise
              : Math.max(Math.min(Math.tan(t), 1), -1) // 3 tan
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2) // 2 saw
          : 1 - 4 * abs(Math.round(t / PI2) - t / PI2) // 1 triangle
        : Math.sin(t); // 0 sin

      s =
        (repeatTime
          ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) // tremolo
          : 1) *
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) * // shape curve
        (i < attack
          ? i / attack // attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume) // decay falloff
            : i < attack + decay + sustain
              ? sustainVolume // sustain volume
              : i < length - delay
                ? ((length - i - delay) / release) * // release falloff
                  sustainVolume // release volume
                : 0); // post release

      s = delay
        ? s / 2 +
          (delay > i
            ? 0 // delay
            : ((i < length - delay ? 1 : (length - i) / delay) * // release delay
                b[(i - delay) | 0]!) /
              2 /
              volume) // sample delay
        : s;

      if (filter)
        // apply filter
        s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
    }

    f =
      (frequency += slide += deltaSlide) * // frequency
      Math.cos(modulation * modOffset++); // modulation
    t += f + f * noise * Math.sin(i ** 5); // noise

    if (jump && ++jump > pitchJumpTime) {
      // pitch jump
      frequency += pitchJump; // apply pitch jump
      startFrequency += pitchJump; // also apply to start
      jump = 0; // stop pitch jump time
    }

    if (repeatTime && !(++repeat % repeatTime)) {
      // repeat
      frequency = startFrequency; // reset frequency
      slide = startSlide; // reset slide
      jump ||= 1; // reset pitch jump time
    }
  }
  return b;
}
