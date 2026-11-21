// The start menu (mock-up 06). Built once; `update` refreshes only the parts that change, so
// the name field, the code boxes and the paste box keep their focus and text while typing.

import type { AppController } from '../app/controller';
import { savedWhen } from '../app/controller';
import { MAX_REPLAY_BYTES } from '../session/replay';
import { h } from './dom';
import { icon, mark } from './icons';

export interface View {
  el: HTMLElement;
  update(): void;
  /** Called once the element is in the page. */
  mounted?(): void;
  /** Called when the view is taken out of the page (release timers, WebGL, listeners). */
  unmounted?(): void;
}

/** How many saved (and finished) games the start menu shows before "Show all". */
const SAVES_SHOWN = 3;

export function menuView(ctrl: AppController, version: string): View {
  // ── Name ──
  const nameInput = h('input', {
    class: 'name-input', type: 'text', value: ctrl.state.name, placeholder: 'Your name',
    attrs: { maxlength: '20', autocomplete: 'nickname', 'aria-label': 'Your name', enterkeyhint: 'done', spellcheck: 'false' },
    oninput: () => { ctrl.setName(nameInput.value); },
  });
  const nameField = h('label', { class: 'field' },
    h('span', { class: 'label', text: 'Your name' }),
    h('span', { class: 'input' }, nameInput, h('span', { class: 'edit', text: 'tap to edit' })));

  // ── Host ──
  const hostBtn = h('button', { class: 'btn btn-gold big', onclick: () => { void ctrl.host(); } },
    icon('crown'), 'Host a game', h('span', { class: 'sub', text: 'get a room code' }));

  // ── Join: one real input drawn as five boxes ──
  const boxes = [0, 1, 2, 3, 4].map(() => h('span', { class: 'box' }));
  const codeInput = h('input', {
    class: 'code-input', type: 'text', value: ctrl.state.joinCode,
    attrs: {
      'aria-label': 'Room code (5 letters)', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
      inputmode: 'text', enterkeyhint: 'go',
    },
    oninput: () => { syncCode(); },
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); void ctrl.join(); } },
    onfocus: () => { codeWrap.classList.add('focused'); drawBoxes(); },
    onblur: () => { codeWrap.classList.remove('focused'); drawBoxes(); },
  });
  const codeWrap = h('label', { class: 'code' }, boxes, codeInput);
  const joinBtn = h('button', { class: 'btn btn-dark join-btn', onclick: () => { void ctrl.join(); } }, 'Join a game');
  const drawBoxes = (): void => {
    const v = codeInput.value;
    boxes.forEach((b, i) => {
      b.textContent = v[i] ?? '';
      b.classList.toggle('cur', document.activeElement === codeInput && i === Math.min(v.length, 4));
    });
  };
  const syncCode = (): void => {
    const cleaned = ctrl.setJoinCode(codeInput.value);
    if (codeInput.value !== cleaned) codeInput.value = cleaned;
    drawBoxes();
    if (cleaned.length === 5) joinBtn.focus();
  };
  drawBoxes();

  const soloBtn = h('button', { class: 'btn btn-dark big', onclick: () => { void ctrl.solo(); } },
    icon('bot'), 'Play solo vs bots', h('span', { class: 'sub', text: 'no network' }));

  // ── Saved games ──
  const savesBox = h('div', { class: 'saves' });

  // ── Load a save ──
  const pasteBox = h('textarea', {
    class: 'paste', placeholder: 'Paste a save link here',
    attrs: { rows: '3', 'aria-label': 'Save link', spellcheck: 'false', autocomplete: 'off' },
  });
  const fileInput = h('input', {
    type: 'file', class: 'file-input',
    attrs: { accept: '.fsgame,application/json,text/plain', 'aria-label': 'Save file' },
    onchange: () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      void file.text().then(text => ctrl.loadSaveText(text, 'file')).finally(() => { fileInput.value = ''; });
    },
  });
  const loadPanel = h('div', { class: 'load-panel tray', hidden: true },
    pasteBox,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-gold', onclick: () => { void ctrl.loadSaveText(pasteBox.value, 'link'); } }, 'Open link'),
      h('label', { class: 'btn btn-dark file-btn' }, icon('file'), 'Choose a save file', fileInput)));
  const loadBtn = h('button', {
    class: 'btn btn-quiet big load-btn', attrs: { 'aria-expanded': 'false' },
    onclick: () => {
      loadPanel.hidden = !loadPanel.hidden;
      loadBtn.setAttribute('aria-expanded', String(!loadPanel.hidden));
      if (!loadPanel.hidden) pasteBox.focus();
    },
  }, icon('file'), 'Load a save (link or file)');

  // ── Watch a replay (a replay, a rules-problem report, or a save file with its moves) ──
  const replayPaste = h('textarea', {
    class: 'paste', placeholder: 'Paste the text of a replay file here',
    attrs: { rows: '3', 'aria-label': 'Replay text', spellcheck: 'false', autocomplete: 'off' },
  });
  const replayFileInput = h('input', {
    type: 'file', class: 'file-input',
    attrs: { accept: '.fsreplay,.fsreport,.fsgame,application/json,text/plain', 'aria-label': 'Replay file' },
    onchange: () => {
      const file = replayFileInput.files?.[0];
      if (!file) return;
      if (file.size > MAX_REPLAY_BYTES) { ctrl.replayFileTooLarge(); replayFileInput.value = ''; return; }
      void file.text().then(text => ctrl.openReplayText(text, 'file')).finally(() => { replayFileInput.value = ''; });
    },
  });
  const replayPanel = h('div', { class: 'load-panel tray', hidden: true },
    h('p', { class: 'hint first', text: 'Open a replay (.fsreplay), a rules-problem report (.fsreport) or a save file (.fsgame) to step through the game move by move.' }),
    replayPaste,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-gold', onclick: () => { void ctrl.openReplayText(replayPaste.value, 'paste'); } }, 'Open pasted replay'),
      h('label', { class: 'btn btn-dark file-btn' }, icon('file'), 'Choose a file', replayFileInput)));
  const replayBtn = h('button', {
    class: 'btn btn-quiet big load-btn', attrs: { 'aria-expanded': 'false', 'data-replay': '1' },
    onclick: () => {
      replayPanel.hidden = !replayPanel.hidden;
      replayBtn.setAttribute('aria-expanded', String(!replayPanel.hidden));
      if (!replayPanel.hidden) replayPaste.focus();
    },
  }, icon('replay'), 'Watch a replay');

  const errorBox = h('div', { class: 'error-box', attrs: { role: 'alert' } });
  const install = h('div', { class: 'install-slot' });

  const el = h('main', { class: 'screen menu' },
    h('div', { class: 'title' },
      mark('mark'),
      h('h1', null, 'Factory', h('br'), h('span', { text: 'Spaghetti' })),
      h('p', { text: 'Build the factory. Untangle the belts. First to 4 Tesseracts.' })),
    nameField,
    errorBox,
    h('div', { class: 'stack' },
      hostBtn,
      h('div', { class: 'join' }, codeWrap, joinBtn),
      soloBtn,
      savesBox,
      loadBtn,
      loadPanel,
      replayBtn,
      replayPanel),
    h('div', { class: 'foot' },
      install,
      h('div', { class: 'ver' },
        h('span', { text: `Version ${version}` }), ' · ',
        h('a', { text: 'Network check', attrs: { href: './net-check.html' } }))));

  let lastSaves: unknown = null;
  let showAll = false;
  let lastShowAll = false;
  let lastInstall: string | null = null;

  const update = (): void => {
    const s = ctrl.state;
    const busy = s.busy !== null;
    for (const b of [hostBtn, joinBtn, soloBtn]) b.disabled = busy;
    errorBox.replaceChildren();
    if (s.busy) errorBox.append(h('div', { class: 'busy', attrs: { role: 'status' } }, h('span', { class: 'spinner' }), s.busy));
    else if (s.error) {
      errorBox.append(h('div', { class: 'error' },
        h('span', { text: s.error }),
        h('button', { class: 'x', title: 'Dismiss', attrs: { 'aria-label': 'Dismiss' }, onclick: () => ctrl.dismissError() }, icon('cross'))));
    }
    if (codeInput.value !== s.joinCode && document.activeElement !== codeInput) { codeInput.value = s.joinCode; drawBoxes(); }
    if (s.error && s.focus === 'name' && nameInput.value.trim() === '') nameInput.focus();

    if (s.saves !== lastSaves || showAll !== lastShowAll) {
      lastSaves = s.saves;
      lastShowAll = showAll;
      savesBox.replaceChildren();
      const now = Date.now();
      // Games still to play first (Resume), then finished ones (a replay, never Resume).
      const open = s.saves.filter(sv => sv.phase !== 'finished');
      const done = s.saves.filter(sv => sv.phase === 'finished');
      const limit = showAll ? Infinity : SAVES_SHOWN;
      const row = (sv: (typeof s.saves)[number]): HTMLElement => {
        const ended = sv.phase === 'finished';
        const what = ended ? 'finished game' : 'saved game';
        return h('div', { class: `save tray${ended ? ' finished' : ''}` },
          h('div', { class: 'info' },
            h('div', { class: 't' }, `Room ${sv.code} · ${ended ? 'finished' : `Round ${sv.round}`}`),
            h('div', { class: 'muted names', text: `${sv.names.filter(Boolean).join(', ')} · ${savedWhen(sv.savedAt, now)}` })),
          ended
            ? (sv.hasMoves ? h('button', { class: 'btn btn-dark', attrs: { 'data-watch': sv.code }, onclick: () => { void ctrl.watchSaved(sv.key); } }, 'Watch replay') : null)
            : h('button', { class: 'btn btn-gold', attrs: { 'data-resume': sv.code }, onclick: () => ctrl.resumeStored(sv.key) }, 'Resume'),
          h('button', {
            class: 'btn btn-quiet icon-only', title: `Delete the ${what} of room ${sv.code}`, attrs: { 'aria-label': `Delete the ${what} of room ${sv.code}` },
            onclick: () => { if (window.confirm(`Delete the ${what} of room ${sv.code}?`)) ctrl.deleteSave(sv.key); },
          }, icon('trash')));
      };
      if (open.length > 0) {
        savesBox.append(h('div', { class: 'label', text: open.length === 1 ? 'Saved game' : 'Saved games' }));
        for (const sv of open.slice(0, limit)) savesBox.append(row(sv));
      }
      if (done.length > 0) {
        savesBox.append(h('div', { class: 'label', text: done.length === 1 ? 'Finished game' : 'Finished games' }));
        for (const sv of done.slice(0, limit)) savesBox.append(row(sv));
      }
      if (open.length > SAVES_SHOWN || done.length > SAVES_SHOWN) {
        savesBox.append(h('button', {
          class: 'btn btn-quiet show-all', attrs: { 'aria-expanded': String(showAll) },
          onclick: () => { showAll = !showAll; update(); },
        }, showAll ? 'Show fewer' : `Show all (${s.saves.length})`));
      }
    }

    const installKey = `${s.installAvailable}|${s.installNote ?? ''}`;
    if (installKey !== lastInstall) {
      lastInstall = installKey;
      install.replaceChildren();
      if (!s.installAvailable && s.installNote) {
        // Browsers without an install button (Safari on iPhone, Firefox on Android): say how.
        install.append(h('div', { class: 'install note-only', attrs: { 'data-install-note': '1' } },
          icon('install'),
          h('span', { class: 'install-text' }, h('b', { text: 'Install app' }), ` · ${s.installNote}`),
          h('button', { class: 'x', title: 'Not now', attrs: { 'aria-label': 'Hide the install hint' }, onclick: () => ctrl.dismissInstall() }, icon('cross'))));
      }
      if (s.installAvailable) {
        install.append(h('div', { class: 'install' },
          h('button', { class: 'install-go', onclick: () => ctrl.install() }, icon('install'),
            h('span', null, h('b', { text: 'Install app' }), ' · add to your home screen for full screen and offline solo play')),
          h('button', { class: 'x', title: 'Not now', attrs: { 'aria-label': 'Hide the install hint' }, onclick: () => ctrl.dismissInstall() }, icon('cross'))));
      }
    }
  };

  return {
    el,
    update,
    mounted(): void {
      const f = ctrl.state.focus;
      if (f === 'name') nameInput.focus();
      else if (f === 'join') joinBtn.focus();
    },
  };
}
