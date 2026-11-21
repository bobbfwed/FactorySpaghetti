// Network test bench (development only; served by `npx vite` at /dev/net.html).
// Plain controls for hosting, joining and playing a whole game over either transport.
// URL parameters for scripted runs:
//   ?t=local|peer&name=Ann&players=2&auto=host|join&join=CODE&autoplay=1&delay=150&debug=1
// The live OnlineRoom is exposed as window.__net.room for scripts.

import type { Transport } from '../src/net/conn';
import { localTransport } from '../src/net/local';
import { peerTransport } from '../src/net/peer';
import { codeFromLocation, inviteLink, normalizeCode } from '../src/net/roomCode';
import { OnlineRoom } from '../src/online/onlineRoom';
import { autoplay } from '../src/online/autoplay';
import { activeSeat } from '../src/session/room';
import { packLink, toSave } from '../src/session/save';
import { localStorageStore } from '../src/session/store';
import { randomId } from '../src/session/scheduler';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

const transportSel = $<HTMLSelectElement>('transport');
const nameIn = $<HTMLInputElement>('name');
const codeIn = $<HTMLInputElement>('code');
const playersSel = $<HTMLSelectElement>('players');
const stateOut = $<HTMLPreElement>('state');
const logOut = $<HTMLPreElement>('log');
const linkOut = $<HTMLTextAreaElement>('link');

// One device token per tab, so several tabs of one browser are different players.
function tabToken(): string {
  try {
    const saved = sessionStorage.getItem('fs.dev.token');
    if (saved) return saved;
    const t = `dev-${randomId()}${randomId()}`; // 36 characters
    sessionStorage.setItem('fs.dev.token', t);
    return t;
  } catch {
    return `dev-${randomId()}${randomId()}`;
  }
}

transportSel.value = params.get('t') === 'peer' ? 'peer' : 'local';
nameIn.value = (params.get('name') ?? `P-${randomId().slice(0, 4)}`).slice(0, 20);
codeIn.value = codeFromLocation(location.search) ?? '';
if (params.get('players')) playersSel.value = params.get('players')!;

let room: OnlineRoom | null = null;
let stopAuto: (() => void) | null = null;
let message = '';

function transport(): Transport {
  return transportSel.value === 'peer' ? peerTransport({ debug: params.get('debug') === '1' }) : localTransport();
}

function options(): { transport: Transport; name: string; token: string; store: ReturnType<typeof localStorageStore>; appVersion: string } {
  return { transport: transport(), name: nameIn.value.trim() || 'Player', token: tabToken(), store: localStorageStore(), appVersion: 'dev-bench' };
}

function render(): void {
  const lines: string[] = [];
  if (message) lines.push(message, '');
  if (!room) { stateOut.textContent = lines.concat('Not connected.').join('\n'); return; }
  const c = room.client;
  const r = c.room;
  lines.push(`code ${room.code}   role ${room.role}   status ${room.status}${room.closedWhy ? ` (${room.closedWhy})` : ''}`
    + `${room.lastError ? `   last error ${room.lastError}` : ''}`);
  lines.push(`session ${c.status}   my seat ${c.seat ?? '-'}   autoplay ${stopAuto ? 'on' : 'off'}   pending move ${c.pending ? 'yes' : 'no'}`);
  if (r) {
    const g = r.game;
    const turn = activeSeat(g);
    lines.push(`phase ${r.phase}${r.hold ? ' (on hold)' : ''}   seq ${r.seq}   round ${g?.round ?? '-'}   game phase ${g?.phase ?? '-'}`
      + `   turn ${turn === null ? '-' : `${turn} ${r.seats[turn]?.name ?? ''}`}`
      + `${g?.pendingFactoryOps.length ? `   waiting on factory choices of ${g.pendingFactoryOps.map(e => e.ownerId).join(',')}` : ''}`);
    if (g?.gameOver) lines.push(`GAME OVER: winner ${g.winner ?? '-'} ${g.tiedWinners.length ? `tied ${g.tiedWinners.join(',')}` : ''}`);
    lines.push('seats:');
    for (const s of r.seats) {
      lines.push(`  ${s.index} ${s.color.padEnd(6)} ${s.kind.padEnd(5)} ${(s.name || '(open)').padEnd(20)}`
        + `${s.kind === 'human' ? (s.connected ? ' connected' : ' away') : ''}${s.ready ? ' ready' : ''}${s.autopilot ? ' autopilot' : ''}`
        + `${s.index === r.hostSeat ? ' HOST' : ''}`);
    }
    if (r.waiting.length) lines.push(`waiting: ${r.waiting.map(w => w.name).join(', ')}`);
    logOut.textContent = r.log.slice(-12).map(e => `${e.seq}: ${e.text}`).join('\n');
  }
  stateOut.textContent = lines.join('\n');
}

function attach(next: OnlineRoom): void {
  room = next;
  message = '';
  linkOut.value = inviteLink(location.href, next.code) + (transportSel.value === 'peer' ? '' : '&t=local');
  next.subscribe(render);
  (window as unknown as { __net: unknown }).__net = { room: next };
  message = '';
  if (params.get('autoplay') === '1') toggleAutoplay();
  render();
}

async function guard(what: string, fn: () => Promise<unknown>): Promise<void> {
  message = '';
  try {
    const r = await fn();
    const res = r as { ok?: boolean; error?: { message: string } } | undefined;
    if (res && res.ok === false) message = `${what}: ${res.error?.message ?? 'refused'}`;
  } catch (e) {
    message = `${what} failed: ${e instanceof Error ? `${e.name} ${(e as { kind?: string }).kind ?? ''} ${e.message}` : String(e)}`;
  }
  render();
}

function toggleAutoplay(): void {
  if (!room) return;
  const delayMs = Number(params.get('delay') ?? 150);
  if (stopAuto) { stopAuto(); stopAuto = null; } else stopAuto = autoplay(room.client, { delayMs: Number.isFinite(delayMs) ? delayMs : 150 });
  render();
}

$('host').onclick = (): void => {
  if (room) return;
  void guard('Host', async () => {
    message = 'Opening a room...';
    render();
    const r = await OnlineRoom.host(options());
    await r.client.configure({ playerCount: Number(playersSel.value) as 2 | 3 | 4 });
    attach(r);
  });
};

$('join').onclick = (): void => {
  if (room) return;
  const code = normalizeCode(codeIn.value);
  if (!code) { message = 'A room code is five letters.'; render(); return; }
  void guard('Join', async () => {
    message = `Joining ${code}...`;
    render();
    attach(await OnlineRoom.join({ ...options(), code }));
  });
};

$('ready').onclick = (): void => { if (room) void guard('Ready', () => room!.client.setReady(true)); };
$('start').onclick = (): void => { if (room) void guard('Start', () => room!.client.start()); };
$('resume').onclick = (): void => { if (room) void guard('Continue', () => room!.client.resumeGame()); };
$('autoplay').onclick = toggleAutoplay;
$('bots').onclick = (): void => {
  const r = room?.client.room;
  if (!room || !r) return;
  void guard('Add bots', async () => {
    for (const s of r.seats) {
      if (s.kind !== 'open') continue;
      const res = await room!.client.setSeat(s.index, 'bot', 'greedy');
      if (!res.ok) return res;
    }
    return { ok: true };
  });
};
$('leave').onclick = (): void => {
  stopAuto?.();
  stopAuto = null;
  room?.leave();
  render();
  room = null;
};
$('savelink').onclick = (): void => {
  const r = room?.client.room;
  if (!r || !r.game) { message = 'There is no game to save yet.'; render(); return; }
  void guard('Save link', async () => {
    const text = await packLink(toSave(r, { savedAt: Date.now(), app: 'dev-bench' }, { forLink: true }));
    const url = new URL(location.href);
    url.search = '';
    url.hash = `save=${text}`;
    linkOut.value = url.toString();
    try { await navigator.clipboard.writeText(linkOut.value); message = `Save link copied (${linkOut.value.length} characters).`; } catch { message = 'Save link below (copy it by hand).'; }
  });
};

setInterval(render, 1000);
render();
if (params.get('auto') === 'host') $('host').click();
else if (params.get('auto') === 'join' && codeIn.value) $('join').click();
