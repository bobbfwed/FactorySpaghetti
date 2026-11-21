// Our own relay server ("TURN server"), for when two players cannot reach each other directly.
//
// Why: browsers in two houses usually find each other with the free public helper servers listed
// in peer.ts. Two players on the SAME wifi (an in-person game night), or behind strict routers,
// office or mobile networks, need a relay to pass their traffic along, and the free public
// relays are often down. A relay of our own fixes that. Leave everything below empty and online
// play works as before, with the public servers only.
//
// How to get one:
//   1. Sign up with a company that rents out TURN relays. Several have a free allowance that is
//      plenty for a few friends (for example Metered, metered.ca, under "TURN Server", or
//      ExpressTURN, expressturn.com). Any provider that gives a fixed username and password works.
//   2. In its dashboard, find the page listing "ICE servers" or "TURN credentials": addresses
//      that start with turn: or turns: (for example "turn:standard.relay.metered.ca:80" or
//      "turns:standard.relay.metered.ca:443?transport=tcp"), a username and a password (often
//      called "credential").
//   3. Paste them below. All three are needed. If any is missing or malformed, the game ignores
//      the relay altogether: a browser refuses a relay entry without a username and password,
//      and would then refuse every other helper server along with it.
//   4. Open net-check.html (on the dev server or the published site). It says whether the relay
//      is set up and whether it answered.
//
// BE AWARE: anything put in this file ships to every player's browser, so anyone who plays can
// read these details. Use the provider's own limits (a monthly cap) so nobody can run up a bill,
// and do not reuse a password used anywhere else.

export interface RelaySettings {
  urls: string[];
  username: string;
  credential: string;
}

export const RELAY: RelaySettings = {
  urls: [],
  username: '',
  credential: '',
};

/**
 * What is wrong with relay settings: null if they are complete, 'empty' if nothing is filled in,
 * otherwise a sentence for the network check page.
 */
export function relayProblem(r: Partial<RelaySettings> | null | undefined): string | null {
  const urls = relayUrls(r);
  const username = String(r?.username ?? '').trim();
  const credential = String(r?.credential ?? '').trim();
  if (urls.length === 0 && !username && !credential) return 'empty';
  if (urls.length === 0) return 'There is a user name or password but no addresses (urls).';
  const odd = urls.find(u => !/^turns?:/i.test(u));
  if (odd) return `"${odd}" is not a relay address: each one starts with turn: or turns:`;
  if (!username) return 'The user name is missing.';
  if (!credential) return 'The password (credential) is missing.';
  return null;
}

function relayUrls(r: Partial<RelaySettings> | null | undefined): string[] {
  const list: unknown[] = Array.isArray(r?.urls) ? r.urls : r?.urls ? [r.urls] : [];
  return list.map(u => String(u).trim()).filter(Boolean);
}

/** The relay as a browser ICE server entry, or null unless it is completely filled in. */
export function relayIceServer(r: Partial<RelaySettings> | null | undefined): RTCIceServer | null {
  if (relayProblem(r) !== null) return null;
  return { urls: relayUrls(r), username: String(r!.username).trim(), credential: String(r!.credential).trim() };
}

export const OWN_RELAY_PROBLEM: string | null = relayProblem(RELAY);
export const OWN_RELAY: RTCIceServer | null = relayIceServer(RELAY);
