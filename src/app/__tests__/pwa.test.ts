// The install shell's pure parts: the offline file list, what the menu offers about installing,
// and keeping the screen on during a game.

import { describe, expect, it } from 'vitest';
import { fileRev, isPrecached, precacheEntries, totalBytes } from '../precache';
import { installAdvice, isIos } from '../install';
import type { WakeSentinel } from '../wakeLock';
import { ScreenKeeper } from '../wakeLock';

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('the offline file list', () => {
  it('lists every built file except the worker, source maps and hidden files', () => {
    const entries = precacheEntries([
      { path: 'index.html', bytes: bytes('<html>') },
      { path: 'sw.js', bytes: bytes('worker') },
      { path: 'assets\\main-abc.js', bytes: bytes('main') },
      { path: 'assets/index-def.js', bytes: bytes('three') },
      { path: 'assets/main-abc.js.map', bytes: bytes('map') },
      { path: 'models/belt.glb', bytes: bytes('glb') },
      { path: 'models/manifest.json', bytes: bytes('{}') },
      { path: 'icons/icon-192.png', bytes: bytes('png') },
      { path: 'manifest.webmanifest', bytes: bytes('{}') },
      { path: '.well-known/x', bytes: bytes('x') },
    ]);
    expect(entries.map(e => e.url)).toEqual([
      './', 'assets/index-def.js', 'assets/main-abc.js', 'icons/icon-192.png', 'manifest.webmanifest', 'models/belt.glb', 'models/manifest.json',
    ]);
    expect(totalBytes(entries)).toBe(6 + 5 + 4 + 3 + 2 + 3 + 2);
    expect(isPrecached('sw.js')).toBe(false);
    expect(isPrecached('./models/mine-1.glb')).toBe(true);
  });

  it('gives a file the same revision while it is unchanged, and another when it changes', () => {
    expect(fileRev(bytes('model A'))).toBe(fileRev(bytes('model A')));
    expect(fileRev(bytes('model A'))).not.toBe(fileRev(bytes('model B')));
    expect(fileRev(bytes('ab'))).not.toBe(fileRev(bytes('abc')));
  });
});

const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:129.0) Gecko/129.0 Firefox/129.0';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0';

describe('installing', () => {
  const env = (o: Partial<Parameters<typeof installAdvice>[0]>): Parameters<typeof installAdvice>[0] => ({
    standalone: false, promptAvailable: false, installed: false, userAgent: ANDROID_CHROME, maxTouchPoints: 5, ...o,
  });

  it('offers the browser\'s install button when Chrome offers it', () => {
    expect(installAdvice(env({ promptAvailable: true }))).toEqual({ kind: 'button' });
  });

  it('offers nothing when already installed, or once installed in this visit', () => {
    expect(installAdvice(env({ standalone: true, promptAvailable: true }))).toBeNull();
    expect(installAdvice(env({ installed: true }))).toBeNull();
    expect(installAdvice(env({ standalone: true, userAgent: IPHONE }))).toBeNull();
  });

  it('explains how to install where no button exists, and stays quiet elsewhere', () => {
    expect(installAdvice(env({ userAgent: IPHONE }))).toMatchObject({ kind: 'note', text: expect.stringMatching(/Share.*Add to Home Screen/) });
    expect(isIos(IPAD_AS_MAC, 5)).toBe(true);
    expect(isIos(IPAD_AS_MAC, 0)).toBe(false); // a real Mac
    expect(installAdvice(env({ userAgent: ANDROID_FIREFOX }))).toMatchObject({ kind: 'note', text: expect.stringMatching(/Install/) });
    expect(installAdvice(env({}))).toBeNull();                       // Chrome before it offers
    expect(installAdvice(env({ userAgent: DESKTOP_FIREFOX, maxTouchPoints: 0 }))).toBeNull();
  });
});

class FakeSentinel implements WakeSentinel {
  released = false;
  private fns: (() => void)[] = [];
  release(): Promise<void> { if (!this.released) { this.released = true; this.fns.forEach(f => f()); } return Promise.resolve(); }
  addEventListener(_t: 'release', fn: () => void): void { this.fns.push(fn); }
}

describe('keeping the screen on', () => {
  function rig(opts: { refuse?: boolean } = {}): { keeper: ScreenKeeper; locks: FakeSentinel[]; page: { visible: boolean } } {
    const locks: FakeSentinel[] = [];
    const page = { visible: true };
    const keeper = new ScreenKeeper({
      request: (): Promise<FakeSentinel> => {
        if (opts.refuse) return Promise.reject(new Error('NotAllowedError'));
        const s = new FakeSentinel();
        locks.push(s);
        return Promise.resolve(s);
      },
      visible: (): boolean => page.visible,
    });
    return { keeper, locks, page };
  }
  const tick = (): Promise<void> => new Promise(r => setTimeout(r, 0));

  it('holds the screen during a game, takes it again after the page was hidden, and lets go after', async () => {
    const { keeper, locks, page } = rig();
    keeper.setWanted(true);
    await tick();
    expect(keeper.held).toBe(true);
    keeper.setWanted(true); // repeated: no second request
    await tick();
    expect(locks).toHaveLength(1);
    // The browser drops the lock while the page is hidden.
    page.visible = false;
    void locks[0]!.release();
    keeper.onVisibility();
    await tick();
    expect(keeper.held).toBe(false);
    expect(locks).toHaveLength(1);
    page.visible = true;
    keeper.onVisibility();
    await tick();
    expect(keeper.held).toBe(true);
    expect(locks).toHaveLength(2);
    keeper.setWanted(false);
    expect(keeper.held).toBe(false);
    expect(locks[1]!.released).toBe(true);
  });

  it('does nothing without the API or when refused, and never holds the screen after the game', async () => {
    const none = new ScreenKeeper({ visible: (): boolean => true });
    none.setWanted(true);
    none.onVisibility();
    await tick();
    expect(none.held).toBe(false);

    const refused = rig({ refuse: true });
    refused.keeper.setWanted(true);
    await tick();
    expect(refused.keeper.held).toBe(false);

    // Leaving the game while the request is still on its way: the lock is let go at once.
    const { keeper, locks } = rig();
    keeper.setWanted(true);
    keeper.setWanted(false);
    await tick();
    expect(keeper.held).toBe(false);
    expect(locks[0]!.released).toBe(true);
  });
});
