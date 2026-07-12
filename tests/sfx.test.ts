import { describe, expect, it } from 'vitest';
import { SOUNDS } from '../src/audio/sfx';
import { buildSamples } from '../src/audio/zzfx';

/** Every entry in the sound table must synthesise something audible and sane
 *  — a typo'd parameter array tends to fail as silence, NaN or a blown-out
 *  buffer, none of which are catchable by ear in a review. */
describe('sfx sound table', () => {
  for (const [name, params] of Object.entries(SOUNDS)) {
    it(`'${name}' builds finite, audible, bounded samples`, () => {
      const samples = buildSamples(...(params as (number | undefined)[]));
      expect(samples.length).toBeGreaterThan(200); // at least a few ms long
      let peak = 0;
      for (const s of samples) {
        expect(Number.isFinite(s)).toBe(true);
        peak = Math.max(peak, Math.abs(s));
      }
      expect(peak).toBeGreaterThan(0.01); // not silence
      expect(peak).toBeLessThanOrEqual(1.5); // not blown out
    });
  }

  it('the kill thock stays percussive under the full combo pitch ladder', () => {
    // Max ladder = one octave up; the sound must still build cleanly there.
    const params = (SOUNDS.kill as (number | undefined)[]).slice();
    params[2] = (params[2] ?? 220) * 2;
    const samples = buildSamples(...params);
    const peak = samples.reduce((a, s) => Math.max(a, Math.abs(s)), 0);
    expect(Number.isFinite(peak)).toBe(true);
    expect(peak).toBeGreaterThan(0.01);
  });
});
