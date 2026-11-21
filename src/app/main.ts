// App entry point. For now it shows a placeholder page and sets up the install shell
// (service worker + "Update ready" notice). Later milestones wire the menu, lobby and table here.

import './style.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPlaceholder(root: HTMLElement): void {
  const page = el('main', 'placeholder');
  page.append(
    el('h1', 'placeholder-title', 'Factory Spaghetti'),
    el('p', 'placeholder-status', 'Online version under construction'),
    el('p', 'version-label', __APP_VERSION__),
  );
  root.replaceChildren(page);
}

// ---- Service worker and update notice ----

/** Set when the player asks to reload into a new version, so the controller change reloads the page. */
let reloadRequested = false;

function showUpdateNotice(waiting: ServiceWorker): void {
  if (document.getElementById('update-notice')) return;
  const notice = el('div', 'update-notice');
  notice.id = 'update-notice';
  notice.setAttribute('role', 'status');
  const button = el('button', 'update-button', 'Reload');
  button.type = 'button';
  button.addEventListener('click', () => {
    reloadRequested = true;
    button.disabled = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  });
  notice.append(el('span', 'update-text', 'Update ready'), button);
  document.body.append(notice);
}

async function registerServiceWorker(): Promise<void> {
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

const root = document.getElementById('app');
if (root) renderPlaceholder(root);

if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    registerServiceWorker().catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.warn('Service worker registration failed', err);
    });
  });
}
