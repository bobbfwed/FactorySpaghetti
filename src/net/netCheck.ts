// The network check page (net-check.html): asks each helper server the game uses for a way to
// reach this device, and says in plain words whether an internet game is likely to work here.
//
// Candidate types a browser can find:
//   host   an address on this device's own network (only useful to players in the same house)
//   srflx  this network's public address, found through a STUN server (works with most routers)
//   relay  an address on a TURN relay (works through almost anything, while the relay is up)

import { iceServers } from './peer';
import { OWN_RELAY, OWN_RELAY_PROBLEM } from './relay';

const GATHER_MS = 7000;

type Tone = 'ok' | 'bad' | 'warn' | 'plain';

const out = document.getElementById('out');

function say(text: string, tone: Tone = 'plain'): void {
  if (!out) return;
  const line = document.createElement('div');
  line.className = `line ${tone}`;
  line.textContent = text;
  out.appendChild(line);
}

function heading(text: string): void {
  if (!out) return;
  const h = document.createElement('h2');
  h.textContent = text;
  out.appendChild(h);
}

/** Gather ICE candidates for up to 7 seconds; returns the candidate types found. */
async function probe(servers: RTCIceServer[], relayOnly: boolean): Promise<{ found: Set<string>; error: string | null }> {
  const found = new Set<string>();
  let pc: RTCPeerConnection | null = null;
  try {
    pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: relayOnly ? 'relay' : 'all' });
    pc.createDataChannel('probe');
    const conn = pc;
    conn.onicecandidate = (e): void => {
      const c = e.candidate;
      if (!c || !c.candidate) return;
      const type = c.type ?? / typ (\w+)/.exec(c.candidate)?.[1];
      if (type) found.add(type);
    };
    await conn.setLocalDescription(await conn.createOffer());
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, GATHER_MS);
      conn.onicegatheringstatechange = (): void => {
        if (conn.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); }
      };
    });
    return { found, error: null };
  } catch (e) {
    return { found, error: e instanceof Error ? e.message : String(e) };
  } finally {
    pc?.close();
  }
}

const describeFound = (found: Set<string>): string => (found.size ? [...found].sort().join(', ') : 'nothing');
const urlsOf = (s: RTCIceServer): string[] => [s.urls].flat();
const isTurn = (s: RTCIceServer): boolean => urlsOf(s).some(u => /^turns?:/i.test(u));

async function run(): Promise<void> {
  if (!out) return;
  out.textContent = '';
  say(`Browser: ${navigator.userAgent}`);
  if (typeof RTCPeerConnection === 'undefined') {
    say('This browser cannot make direct browser-to-browser connections (WebRTC is missing or turned off). Online play will not work in it.', 'bad');
    return;
  }

  heading('Our own relay');
  if (OWN_RELAY) say(`Set up: ${urlsOf(OWN_RELAY).length} address(es), user name "${String(OWN_RELAY.username)}".`, 'ok');
  else if (OWN_RELAY_PROBLEM === 'empty') say('Not set up. Only the free public relays are tried. The instructions are at the top of src/net/relay.ts.', 'warn');
  else say(`Filled in, but NOT USED because something is wrong: ${OWN_RELAY_PROBLEM ?? ''}`, 'bad');

  heading(`Helper servers (about ${Math.round(GATHER_MS / 1000)} seconds each)`);
  const servers = iceServers();
  say('Checking everything the game uses together...');
  const all = await probe(servers, false);
  say(`Everything together: ${describeFound(all.found)}${all.error ? ` (error: ${all.error})` : ''}`,
    all.found.has('relay') || all.found.has('srflx') ? 'ok' : 'bad');

  let own: Set<string> | null = null;
  for (const s of servers) {
    const relay = isTurn(s);
    const label = s === OWN_RELAY ? 'our relay' : relay ? 'public relay' : 'address finder (STUN)';
    const r = await probe([s], relay);
    const good = relay ? r.found.has('relay') : r.found.has('srflx');
    say(`${label}  ${urlsOf(s).join(', ')}: ${describeFound(r.found)}${r.error ? ` (error: ${r.error})` : ''}`, good ? 'ok' : 'bad');
    if (s === OWN_RELAY) own = r.found;
  }

  heading('Result');
  if (OWN_RELAY && own) {
    if (own.has('relay')) say('Our relay answered. Players who cannot reach each other directly will go through it.', 'ok');
    else say('Our relay did not answer. Check its addresses, user name and password in src/net/relay.ts against the provider\'s dashboard.', 'bad');
  }
  if (all.found.has('relay')) {
    say('A relay is available. An internet game should work from this device, even on the same wifi as other players.', 'ok');
  } else if (all.found.has('srflx')) {
    say('Direct connections only: this network\'s public address was found, but no relay answered. An internet game works with most other players, but may fail between players on the same wifi or behind strict routers.', 'warn');
  } else {
    say('Local addresses only. An internet game will not work from this network: a firewall, VPN or browser setting is blocking it. Try another network, such as a phone on mobile data.', 'bad');
  }
}

const again = document.getElementById('again') as HTMLButtonElement | null;
async function runOnce(): Promise<void> {
  if (again?.disabled) return;
  if (again) again.disabled = true;
  try { await run(); } finally { if (again) again.disabled = false; }
}
again?.addEventListener('click', () => { void runOnce(); });
void runOnce();
