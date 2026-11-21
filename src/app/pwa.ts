// The install shell: service-worker registration, the "Update ready" notice, and the
// "Install app" hint (from the browser's beforeinstallprompt event).

/** Set when the player asks to reload into a new version, so the controller change reloads the page. */
let reloadRequested = false;

function showUpdateNotice(waiting: ServiceWorker): void {
  if (document.getElementById('update-notice')) return;
  const notice = document.createElement('div');
  notice.className = 'update-notice';
  notice.id = 'update-notice';
  notice.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.className = 'update-text';
  text.textContent = 'Update ready';
  const button = document.createElement('button');
  button.className = 'update-button';
  button.type = 'button';
  button.textContent = 'Reload';
  button.addEventListener('click', () => {
    reloadRequested = true;
    button.disabled = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  notice.append(text, button);
  document.body.append(notice);
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;

  sw.addEventListener('controllerchange', () => {
    if (reloadRequested) window.location.reload();
  });

  // Relative URL: the site lives under a sub-path on GitHub Pages.
  const registration = await sw.register('./sw.js');

  const watch = (worker: ServiceWorker): void => {
    worker.addEventListener('statechange', () => {
      // "installed" with an existing controller means a newer version is waiting.
      if (worker.state === 'installed' && sw.controller) showUpdateNotice(worker);
    });
  };

  if (registration.waiting && sw.controller) showUpdateNotice(registration.waiting);
  if (registration.installing) watch(registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) watch(registration.installing);
  });

  // An installed app can stay open for days; look for a new version when it comes back to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registration.update().catch(() => undefined);
  });
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
}

/**
 * Report when the browser offers to install the app. `offer` receives a function that shows
 * the browser's install dialog, or null once installing is no longer offered.
 */
export function watchInstall(offer: (install: (() => void) | null) => void): void {
  window.addEventListener('beforeinstallprompt', (ev: Event) => {
    ev.preventDefault();
    const e = ev as InstallPromptEvent;
    offer(() => { e.prompt().catch(() => undefined); });
  });
  window.addEventListener('appinstalled', () => offer(null));
}
