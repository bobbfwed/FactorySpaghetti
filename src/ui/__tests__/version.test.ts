import { describe, it, expect } from 'vitest';
import { versionDisplay } from '../version';

describe('versionDisplay', () => {
  it('splits a version into a large major.minor and a small two-digit patch', () => {
    expect(versionDisplay('0.1.1')).toEqual({ big: '0.1', small: '.01', text: '0.1.01' });
    expect(versionDisplay('0.1.12')).toEqual({ big: '0.1', small: '.12', text: '0.1.12' });
    expect(versionDisplay('0.1.0')).toEqual({ big: '0.1', small: '.00', text: '0.1.00' });
    expect(versionDisplay('2.10.123')).toEqual({ big: '2.10', small: '.123', text: '2.10.123' });
  });

  it('leaves out the build (commit hash) after the plus sign', () => {
    expect(versionDisplay('0.1.1+abc1234')).toEqual({ big: '0.1', small: '.01', text: '0.1.01' });
    expect(versionDisplay('0.1.12+0f3e9d2')).toEqual({ big: '0.1', small: '.12', text: '0.1.12' });
  });

  it('keeps a pre-release label with the small part', () => {
    expect(versionDisplay('0.2.0-beta.1+abc1234')).toEqual({ big: '0.2', small: '.00-beta.1', text: '0.2.00-beta.1' });
  });

  it('shows a dev build, or anything that is not a version number, whole and large', () => {
    expect(versionDisplay('dev')).toEqual({ big: 'dev', small: '', text: 'dev' });
    expect(versionDisplay('')).toEqual({ big: 'dev', small: '', text: 'dev' });
    expect(versionDisplay('nightly+abc')).toEqual({ big: 'nightly', small: '', text: 'nightly' });
  });
});
