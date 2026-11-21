// Public surface of the session layer.

export type {
  ActivationOutcome, LogEntry, Room, RoomSettings, Seat, SeatColor, TableEvent,
} from './room';
export {
  NAME_MAX, RECENT_PER_SEAT, SEAT_COLORS, STAND_IN_BOT, activeSeat, defaultSettings, isBotControlled, isHumanControlled,
} from './room';
export type { ClientMsg, ClosedWhy, HostMsg, SessionErrorCode, WireError } from './protocol';
export { CLOSED_WHY, PROTOCOL } from './protocol';
export { chooseSuccessor } from './seating';
export type { HostOptions } from './hostSession';
export { HostSession, SessionError } from './hostSession';
export type { ActResult, ClientOptions, PendingMove } from './clientSession';
export { ClientSession, promoteToHost } from './clientSession';
export type { Scheduler } from './scheduler';
export { realScheduler, randomId } from './scheduler';
export { MemoryConn, memoryPair } from './memoryConn';
export { describeAction, BUILDING_NAME, CARD_NAME, MATERIAL_NAME } from './describe';
export { diceRngFromSeed, rollDice } from './dice';
export type { SaveEnvelope, SaveErrorKind } from './save';
export {
  MAX_LINK_CHARS, MAX_SAVE_BYTES, SaveError, packLink, parseSaveFile, rulesFingerprint, sameRules, saveFromHash, saveSummary,
  serializeSaveFile, toSave, unpackLink, validateSave,
} from './save';
export type { SaveListing, SaveStore } from './store';
export { listSaves, localStorageStore, memoryStore, saveKey, writeSave } from './store';
