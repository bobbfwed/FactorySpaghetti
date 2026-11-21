// What the start menu offers about installing the app: Chrome's own install button when the
// browser offers it (beforeinstallprompt), a short "how to install" note for browsers that never
// offer it (Safari on iPhone and iPad, Firefox on Android), and nothing when the app already
// runs installed. Pure, so it is tested in Vitest; main.ts reads the browser and the events.

export interface InstallEnv {
  /** Running as the installed app: `display-mode: standalone` (or iOS `navigator.standalone`). */
  standalone: boolean;
  /** The browser has offered to install (a captured beforeinstallprompt event). */
  promptAvailable: boolean;
  /** The app was installed during this visit (appinstalled). */
  installed: boolean;
  userAgent: string;
  /** navigator.maxTouchPoints (an iPad reports itself as a Mac). */
  maxTouchPoints: number;
}

export type InstallAdvice =
  | { kind: 'button' }
  | { kind: 'note'; text: string }
  | null;

export function isIos(ua: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}

export function installAdvice(env: InstallEnv): InstallAdvice {
  if (env.standalone || env.installed) return null;
  if (env.promptAvailable) return { kind: 'button' };
  const ua = env.userAgent;
  if (isIos(ua, env.maxTouchPoints)) {
    // Every browser on iOS uses Safari's engine; only Safari (and recent others) can add to the Home Screen.
    return { kind: 'note', text: 'To install: tap Share, then “Add to Home Screen”.' };
  }
  if (/Android/.test(ua) && /Firefox\//.test(ua)) {
    return { kind: 'note', text: 'To install: open the ⋮ menu and choose “Install”.' };
  }
  if (/Android/.test(ua) && /SamsungBrowser\//.test(ua)) {
    return { kind: 'note', text: 'To install: open the ☰ menu and choose “Add page to” → “Home screen”.' };
  }
  // Chrome and Edge show the button once they offer installing; other desktop browsers cannot install.
  return null;
}
