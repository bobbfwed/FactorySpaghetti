// A very small stand-in for the browser's document, enough for the guide's example stage
// (playMount.ts DomStage) to build its side panel and its flying tokens in Vitest, which runs
// without a DOM. Selectors: tag, .class and [attr="value"] / [attr], combined (no spaces or commas).

class FakeText {
  parentNode: FakeEl | null = null;
  constructor(public data: string) {}
  get textContent(): string { return this.data; }
  remove(): void { this.parentNode?.drop(this); }
}

const camel = (k: string): string => k.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

export class FakeEl {
  parentNode: FakeEl | null = null;
  childNodes: (FakeEl | FakeText)[] = [];
  className = '';
  hidden = false;
  id = '';
  title = '';
  innerHTML = '';
  clientWidth = 340;
  dataset: Record<string, string> = {};
  style: Record<string, string> = { cssText: '' };
  private attrs = new Map<string, string>();
  constructor(readonly tagName: string) {}

  get parentElement(): FakeEl | null { return this.parentNode; }
  get children(): FakeEl[] { return this.childNodes.filter((c): c is FakeEl => c instanceof FakeEl); }
  get classList(): { add(c: string): void; remove(c: string): void; toggle(c: string, on?: boolean): void; contains(c: string): boolean } {
    const list = (): string[] => this.className.split(/\s+/).filter(Boolean);
    const set = (xs: string[]): void => { this.className = xs.join(' '); };
    return {
      add: (c: string): void => { if (!list().includes(c)) set([...list(), c]); },
      remove: (c: string): void => set(list().filter(x => x !== c)),
      toggle: (c: string, on?: boolean): void => { const has = list().includes(c); if (on ?? !has) { if (!has) set([...list(), c]); } else set(list().filter(x => x !== c)); },
      contains: (c: string): boolean => list().includes(c),
    };
  }
  setAttribute(k: string, v: string): void {
    if (k === 'class') this.className = v;
    else if (k.startsWith('data-')) this.dataset[camel(k)] = v;
    else this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    if (k === 'class') return this.className;
    if (k.startsWith('data-')) return this.dataset[camel(k)] ?? null;
    return this.attrs.get(k) ?? null;
  }
  hasAttribute(k: string): boolean { return this.getAttribute(k) !== null; }
  removeAttribute(k: string): void { if (k.startsWith('data-')) delete this.dataset[camel(k)]; else this.attrs.delete(k); }
  addEventListener(): void { /* no events in these tests */ }
  removeEventListener(): void { /* no events in these tests */ }
  appendChild<T extends FakeEl | FakeText>(c: T): T {
    c.remove();
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }
  append(...cs: (FakeEl | FakeText | string)[]): void {
    for (const c of cs) this.appendChild(typeof c === 'string' ? new FakeText(c) : c);
  }
  replaceChildren(...cs: (FakeEl | FakeText | string)[]): void {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this.append(...cs);
  }
  drop(c: FakeEl | FakeText): void {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
  }
  remove(): void { this.parentNode?.drop(this); }
  get textContent(): string { return this.childNodes.map(c => c.textContent).join(''); }
  set textContent(v: string) { this.replaceChildren(v); }
  querySelector(sel: string): FakeEl | null { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (e: FakeEl): void => { for (const c of e.children) { if (matches(c, sel)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number; right: number; bottom: number; x: number; y: number } {
    return { left: 0, top: 0, width: 340, height: 190, right: 340, bottom: 190, x: 0, y: 0 };
  }
  animate(): { pause(): void; cancel(): void; currentTime: number } { return { pause: () => undefined, cancel: () => undefined, currentTime: 0 }; }
  getContext(): object { return {}; }
}

function matches(e: FakeEl, sel: string): boolean {
  const m = /^([a-z0-9-]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i.exec(sel);
  if (!m) return false;
  if (m[1] && e.tagName.toLowerCase() !== m[1].toLowerCase()) return false;
  for (const c of (m[2] ?? '').split('.').filter(Boolean)) if (!e.classList.contains(c)) return false;
  for (const a of (m[3] ?? '').match(/\[[^\]]+\]/g) ?? []) {
    const [, k, v] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(a) ?? [];
    if (!k) return false;
    const have = e.getAttribute(k);
    if (have === null || (v !== undefined && have !== v)) return false;
  }
  return true;
}

/** Put the fake document in place (returns a function that takes it away again). */
export function installFakeDom(): () => void {
  const g = globalThis as unknown as { document?: unknown };
  const before = g.document;
  g.document = {
    createElement: (t: string): FakeEl => new FakeEl(t),
    createElementNS: (_ns: string, t: string): FakeEl => new FakeEl(t),
    createTextNode: (s: string): FakeText => new FakeText(s),
  };
  return () => { g.document = before; };
}
