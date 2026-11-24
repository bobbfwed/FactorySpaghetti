// A yes-or-no question in the page, in place of the browser's own confirm box (which a browser
// may block or switch off). One dialog at a time, in its own layer above every screen, the 3D
// table and the other dialogs. It lives outside the views, so their redraws never touch it;
// `refreshConfirm` (called on every redraw) closes it when the thing it asks about is gone.
//
// Escape and a press on the dark backdrop cancel. Focus moves into the dialog, stays there
// (Tab cycles between its buttons), and goes back to where it was when the dialog closes.

import { h } from './dom';

export interface ConfirmRequest {
  /** The question, e.g. "Delete the saved game of room KQMTV?" */
  question: string;
  /** The confirm button's words: "Delete", "Leave", "Remove". */
  confirmLabel: string;
  /** A destructive action (red confirm button, Cancel focused first). Default true. */
  danger?: boolean;
  /** Checked on every redraw; once false the dialog closes as cancelled. */
  stillValid?: () => boolean;
  onConfirm: () => unknown;
}

interface Open {
  req: ConfirmRequest;
  veil: HTMLElement;
  returnTo: HTMLElement | null;
}

let open: Open | null = null;
let layer: HTMLElement | null = null;

/** The dialog's own layer: the last child of <body>, above everything else. */
function host(): HTMLElement {
  if (!layer || !layer.isConnected) {
    layer = h('div', { class: 'confirm-host' });
    document.body.appendChild(layer);
  }
  return layer;
}

/** Ask a question in the page; `onConfirm` runs only if the player confirms. */
export function askConfirm(req: ConfirmRequest): void {
  // A second question replaces the first (it cannot normally happen: the backdrop covers the page).
  const returnTo = open ? open.returnTo : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  close(false);
  const danger = req.danger ?? true;

  const cancelBtn = h('button', { class: 'btn btn-quiet btn-lg', attrs: { 'data-confirm-cancel': '1' }, onclick: () => close(true) }, 'Cancel');
  const okBtn = h('button', {
    class: `btn btn-lg ${danger ? 'btn-danger' : 'btn-gold'}`, attrs: { 'data-confirm-ok': '1' },
    onclick: () => {
      if (open?.req !== req) return;
      close(true);
      req.onConfirm();
    },
  }, req.confirmLabel);
  const text = h('p', { class: 'confirm-text', id: 'confirm-question', text: req.question });
  const panel = h('div', {
    class: 'confirm-box tray',
    attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-question' },
  }, text, h('div', { class: 'confirm-btns' }, cancelBtn, okBtn));

  // Only a press that starts and ends on the backdrop cancels (not a drag out of the panel).
  let downOnVeil = false;
  const veil = h('div', {
    class: 'veil confirm-veil',
    onclick: (e) => { if (e.target === veil && downOnVeil) close(true); downOnVeil = false; },
    onkeydown: (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(true); } else if (e.key === 'Tab') {
        // Keep focus inside the dialog.
        const order = [cancelBtn, okBtn];
        const at = order.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        const next = at < 0 ? 0 : (at + (e.shiftKey ? order.length - 1 : 1)) % order.length;
        order[next]!.focus();
      }
      // Keys pressed in the dialog are not shortcuts for the screen behind it.
      e.stopPropagation();
    },
  }, panel);
  veil.addEventListener('pointerdown', (e) => { downOnVeil = e.target === veil; });

  open = { req, veil, returnTo };
  host().replaceChildren(veil);
  document.addEventListener('keydown', onDocKey, true);
  (danger ? cancelBtn : okBtn).focus({ preventScroll: true });
}

/** Escape anywhere (focus may have left the dialog, e.g. after a tap on the backdrop) cancels. */
function onDocKey(e: KeyboardEvent): void {
  if (!open) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
  if (!open.veil.contains(document.activeElement)) {
    // Bring focus back into the dialog before the key does anything behind it.
    e.stopPropagation();
    if (e.key === 'Tab') { e.preventDefault(); open.veil.querySelector<HTMLButtonElement>('[data-confirm-cancel]')?.focus(); }
  }
}

function close(restoreFocus: boolean): void {
  const was = open;
  if (!was) return;
  open = null;
  document.removeEventListener('keydown', onDocKey, true);
  was.veil.remove();
  if (restoreFocus && was.returnTo?.isConnected) was.returnTo.focus({ preventScroll: true });
}

/** Close the dialog without confirming (for example when the screen changes). */
export function closeConfirm(): void {
  close(true);
}

/** Called on every redraw: closes the dialog once what it asks about is gone. */
export function refreshConfirm(): void {
  if (!open) return;
  let ok = true;
  try { ok = open.req.stillValid ? open.req.stillValid() : true; } catch { ok = false; }
  if (!ok) close(true);
}
