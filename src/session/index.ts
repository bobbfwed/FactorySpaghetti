// Public surface of the session layer.

export type {
  ActivationOutcome, LogEntry, Room, RoomSettings, Seat, SeatColor, TableEvent,
} from './room';
export {
  SEAT_COLORS, STAND_IN_BOT, activeSeat, defaultSettings, isBotControlled, isHumanControlled,
} from './room';
export type { ClientMsg, ClosedWhy, HostMsg, SessionErrorCode, WireError } from './protocol';
export { PROTOCOL } from './protocol';
export { chooseSuccessor } from './seating';
export type { HostOptions } from './hostSession';
export { HostSession } from './hostSession';
export type { ActResult, ClientOptions } from './clientSession';
export { ClientSession, promoteToHost } from './clientSession';
export type { Scheduler } from './scheduler';
export { realScheduler, randomId } from './scheduler';
export { MemoryConn, memoryPair } from './memoryConn';
export { describeAction, BUILDING_NAME, CARD_NAME, MATERIAL_NAME } from './describe';
export { diceRngFromSeed, rollDice } from './dice';
export type { SaveEnvelope, SaveErrorKind } from './save';
export {
  SaveError, packLink, parseSaveFile, rulesFingerprint, sameRules, saveFromHash, saveSummary,
  serializeSaveFile, toSave, unpackLink, validateSave,
} from './save';
export type { SaveListing, SaveStore } from './store';
export { listSaves, localStorageStore, memoryStore, saveKey, writeSave } from './store';
