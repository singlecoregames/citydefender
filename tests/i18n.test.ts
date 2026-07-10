import { afterEach, describe, expect, it } from 'vitest';
import { nodeDescription, nodeName, setLang, t } from '../src/ui/i18n';
import { TREE } from '../src/core/tree';

afterEach(() => setLang('en'));

describe('i18n', () => {
  it('falls back to the English node text in English', () => {
    setLang('en');
    for (const node of TREE) {
      expect(nodeName(node)).toBe(node.name);
      expect(nodeDescription(node)).toBe(node.description);
    }
  });

  it('every tree node has a Korean description (add one when adding nodes)', () => {
    setLang('ko');
    for (const node of TREE) {
      // A KO description must exist and differ from the English source —
      // identical text means the entry is missing and fell back.
      expect(nodeDescription(node), node.id).not.toBe(node.description);
    }
  });

  it('string tables swap with the language', () => {
    setLang('en');
    const en = t().nextNight;
    setLang('ko');
    expect(t().nextNight).not.toBe(en);
    expect(t().nightWave(1, 3, 1, 4)).toContain('3');
  });
});
