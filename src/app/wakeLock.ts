// Keeps the screen on while a game is shown (Screen Wake Lock API). The browser drops the lock
// whenever the page is hidden, so it is taken again when the page comes back. Absent API or a
// refusal (battery saver) is fine: the game just behaves like any page.
//
// Pure state machine over injected parts, tested with a fake in Vitest; main.ts wires it to
// `navigator.wakeLock` and the document's visibility.

export interface WakeSentinel {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

export interface WakeLockParts {
  /** navigator.wakeLock.request('screen'); undefined when the browser has no wake lock. */
  request?: () => Promise<WakeSentinel>;
  visible: () => boolean;
}

export class ScreenKeeper {
  private wanted = false;
  private sentinel: WakeSentinel | null = null;
  private asking = false;
  private readonly parts: WakeLockParts;

  constructor(parts: WakeLockParts) {
    this.parts = parts;
  }

  /** True while the screen is held on. */
  get held(): boolean {
    return !!this.sentinel && !this.sentinel.released;
  }

  /** Whether a game is on screen (call on every change; repeated calls are cheap). */
  setWanted(on: boolean): void {
    if (on === this.wanted) return;
    this.wanted = on;
    if (on) void this.acquire();
    else this.release();
  }

  /** Call on `visibilitychange`: the lock was dropped while hidden, so take it again. */
  onVisibility(): void {
    if (this.wanted && this.parts.visible() && !this.held) void this.acquire();
  }

  private async acquire(): Promise<void> {
    const request = this.parts.request;
    if (!request || this.asking || this.held || !this.parts.visible()) return;
    this.asking = true;
    try {
      const s = await request();
      if (!this.wanted) { void s.release().catch(() => undefined); return; }
      this.sentinel = s;
      s.addEventListener('release', () => { if (this.sentinel === s) this.sentinel = null; });
    } catch {
      // Refused (battery saver, not visible, no permission): try again on the next visibility change.
    } finally {
      this.asking = false;
    }
  }

  private release(): void {
    const s = this.sentinel;
    this.sentinel = null;
    if (s && !s.released) void s.release().catch(() => undefined);
  }
}
