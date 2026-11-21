// Public surface of the network layer. PeerJS itself is loaded only when the internet
// transport is first used.

export type { Conn, HostHandle, JoinErrorKind, Transport } from './conn';
export { JoinError } from './conn';
export { chunked, utf8Length, PART } from './chunk';
export type { HeartbeatOptions } from './heartbeat';
export { BEAT, heartbeat } from './heartbeat';
export type { Delivery, HubLink, MemoryHub, MemoryHubOptions, MemoryTransport } from './memory';
export { createMemoryHub } from './memory';
export type { LocalTransportOptions } from './local';
export { localTransport } from './local';
export type { PeerTransportOptions } from './peer';
export { JOIN_ERROR_TEXT, PUBLIC_ICE_SERVERS, iceServers, peerTransport } from './peer';
export type { RelaySettings } from './relay';
export { OWN_RELAY, OWN_RELAY_PROBLEM, RELAY, relayProblem } from './relay';
export { CODE_LETTERS, codeFromLocation, inviteLink, isRoomCode, makeRoomCode, normalizeCode } from './roomCode';
