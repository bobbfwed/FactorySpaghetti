// App entry point: builds the real dependencies (transports, storage, clipboard, sharing,
// downloads, the page address), creates the controller, mounts the views, and sets up the
// install shell (service worker, "Update ready" notice, install hint).

import './style.css';
import '../ui/app.css';
import type { Transport } from '../net/conn';
import { createMemoryHub } from '../net/memory';
import { localTransport } from '../net/local';
import { peerTransport } from '../net/peer';
import { saveFromHash } from '../session/save';
import type { SaveStore } from '../session/store';
import { localStorageStore, memoryStore } from '../session/store';
import type { AppDeps, ShareData, TransportKind } from './controller';
import { AppController, TOKEN_KEY } from './controller';
import { registerServiceWorker, watchInstall } from './pwa';
import { installAdvice } from './install';
import type { WakeSentinel } from './wakeLock';
import { ScreenKeeper } from './wakeLock';
import { mountApp } from '../ui/mount';

const params = new URLSearchParams(window.location.search);
const sameBrowser = params.get('t') === 'local';

function transport(kind: TransportKind): Transport {
  if (kind === 'solo') return createMemoryHub().transport();
  if (kind === 'local') return localTransport();
  return peerTransport();
}

/**
 * Name and device token. With the same-browser transport (`?t=local`, for testing) every tab
 * is a different player, so the token is kept per tab.
 */
function identityStore(): SaveStore {
  const shared = localStorageStore();
  if (!sameBrowser) return shared;
  const fallback = memoryStore();
  const tab = (): Storage | null => { try { return window.sessionStorage; } catch { return null; } };
  return {
    get: (k): string | null => (k === TOKEN_KEY ? (tab()?.getItem(k) ?? fallback.get(k)) : shared.get(k)),
    set: (k, v): void => {
      if (k !== TOKEN_KEY) { shared.set(k, v); return; }
      try { tab()?.setItem(k, v); } catch { fallback.set(k, v); }
      fallback.set(k, v);
    },
    remove: (k): void => { shared.remove(k); },
    keys: (): string[] => shared.keys(),
  };
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function share(data: ShareData): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: object) => boolean };
  if (data.file && typeof File === 'function') {
    const file = new File([data.file.text], data.file.name, { type: 'application/octet-stream' });
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ title: data.title, text: data.text, files: [file] });
      return;
    }
  }
  await nav.share({ title: data.title, text: data.text, ...(data.url ? { url: data.url } : {}) });
}

const deps: AppDeps = {
  transport,
  saves: localStorageStore(),
  identity: identityStore(),
  appVersion: __APP_VERSION__,
  location: {
    search: window.location.search,
    hash: window.location.hash,
    base: window.location.origin + window.location.pathname,
    clearHash: (): void => { history.replaceState(null, '', window.location.pathname + window.location.search); },
  },
  download,
  isOffline: (): boolean => navigator.onLine === false,
  ...(navigator.clipboard ? { clipboard: (text: string): Promise<void> => navigator.clipboard.writeText(text) } : {}),
  ...(typeof navigator.share === 'function' ? { share } : {}),
};

const ctrl = new AppController(deps);
// For scripted browser checks (and curious developers): the live controller.
if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { __app: AppController }).__app = ctrl;

const root = document.getElementById('app');
if (root) mountApp(root, ctrl, __APP_VERSION__);

// A save link pasted into the address bar of an open page only changes the fragment.
window.addEventListener('hashchange', () => {
  const text = saveFromHash(window.location.hash);
  if (text === null) return;
  deps.location.clearHash();
  if (ctrl.screen === 'menu') void ctrl.loadSaveText(text, 'link');
});

// The move journal is written to storage at most every 2 seconds; write it now when the page
// may be closed or frozen (a phone switching apps).
window.addEventListener('pagehide', () => ctrl.flushJournal());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ctrl.flushJournal(); });

// ── Installing: Chrome's install button, or a "how to install" note, or nothing when installed ──
const standalone = (): boolean => window.matchMedia?.('(display-mode: standalone)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const install = { prompt: null as (() => void) | null, installed: false };
const showInstall = (): void => {
  const advice = installAdvice({
    standalone: standalone(), promptAvailable: install.prompt !== null, installed: install.installed,
    userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
  ctrl.setInstaller(advice?.kind === 'button' ? install.prompt : null);
  ctrl.setInstallNote(advice?.kind === 'note' ? advice.text : null);
};
watchInstall((fn) => {
  install.prompt = fn;
  if (fn === null) install.installed = true; // appinstalled
  showInstall();
});
showInstall();

// ── Keep the screen on while a game is shown ──
const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeSentinel> } }).wakeLock;
const keeper = new ScreenKeeper({
  ...(wakeLock ? { request: (): Promise<WakeSentinel> => wakeLock.request('screen') } : {}),
  visible: (): boolean => document.visibilityState === 'visible',
});
ctrl.subscribe(() => keeper.setWanted(ctrl.wantsScreenOn));
document.addEventListener('visibilitychange', () => keeper.onVisibility());
(window as unknown as { __wake: ScreenKeeper }).__wake = keeper;

if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    registerServiceWorker().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('Service worker registration failed', err);
    });
  });
}
