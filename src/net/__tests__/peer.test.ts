// The PeerJS transport's configuration and error mapping. (The transport itself needs a browser
// and the public broker; it is exercised by the real-network smoke test, not here.)
import { describe, it, expect } from 'vitest';
import {
  PEER_CHUNK_BYTES, PUBLIC_ICE_SERVERS, hostErrorKind, hostPeerId, iceServers, joinErrorKind,
  joinTimeoutKind, joinerPeerId,
} from '../peer';
import { RELAY, relayIceServer, relayProblem } from '../relay';

describe('PeerJS transport settings', () => {
  it('names the host after the code and gives joiners random ids', () => {
    expect(hostPeerId('kqmtv')).toBe('factory-spaghetti-v1-KQMTV');
    const a = joinerPeerId();
    expect(a).toMatch(/^factory-spaghetti-v1-j-[0-9a-f]{16}$/);
    expect(joinerPeerId()).not.toBe(a);
  });

  it('splits below the PeerJS limit of 16,300 bytes', () => {
    expect(PEER_CHUNK_BYTES).toBe(15 * 1024);
    expect(PEER_CHUNK_BYTES).toBeLessThan(16_300);
  });

  it('uses Google and Cloudflare STUN and the public PeerJS TURN, every TURN entry with credentials', () => {
    const urls = PUBLIC_ICE_SERVERS.flatMap(s => [s.urls].flat());
    expect(urls).toEqual(expect.arrayContaining([
      'stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478', 'turn:eu-0.turn.peerjs.com:3478',
    ]));
    for (const s of PUBLIC_ICE_SERVERS) {
      if ([s.urls].flat().some(u => u.startsWith('turn'))) expect(s.username && s.credential).toBeTruthy();
    }
  });

  it('puts our own relay first only when it is completely filled in', () => {
    expect(RELAY).toEqual({ urls: [], username: '', credential: '' }); // the shipped slot is empty
    expect(iceServers(null)).toEqual([...PUBLIC_ICE_SERVERS]);
    const own = relayIceServer({ urls: ['turn:relay.example.com:80'], username: 'u', credential: 'p' });
    expect(own).toEqual({ urls: ['turn:relay.example.com:80'], username: 'u', credential: 'p' });
    expect(iceServers(own)[0]).toBe(own);
    expect(relayIceServer({ urls: ['turn:relay.example.com:80'], username: 'u', credential: '' })).toBeNull();
  });

  it('explains what is wrong with relay settings', () => {
    expect(relayProblem({ urls: [], username: '', credential: '' })).toBe('empty');
    expect(relayProblem({ urls: [], username: 'u', credential: 'p' })).toMatch(/no addresses/);
    expect(relayProblem({ urls: ['stun:x.org'], username: 'u', credential: 'p' })).toMatch(/not a relay address/);
    expect(relayProblem({ urls: ['turn:x.org'], username: ' ', credential: 'p' })).toMatch(/user name/);
    expect(relayProblem({ urls: ['turns:x.org:443'], username: 'u', credential: '' })).toMatch(/password/);
    expect(relayProblem({ urls: [' turn:x.org '], username: 'u', credential: 'p' })).toBeNull();
  });

  it('maps PeerJS failures to the kinds the interface explains', () => {
    expect(hostErrorKind('unavailable-id')).toBe('code-taken');
    expect(hostErrorKind('network')).toBe('broker-unreachable');
    expect(hostErrorKind('server-error')).toBe('broker-unreachable');
    expect(hostErrorKind('browser-incompatible')).toBe('other');
    expect(joinErrorKind('peer-unavailable')).toBe('no-room');
    expect(joinErrorKind('socket-closed')).toBe('broker-unreachable');
    expect(joinErrorKind('webrtc')).toBe('no-route');
    expect(joinErrorKind('negotiation-failed')).toBe('no-route');
    expect(joinTimeoutKind(false)).toBe('broker-unreachable');
    expect(joinTimeoutKind(true)).toBe('no-route');
  });
});
