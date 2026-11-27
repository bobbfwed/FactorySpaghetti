// The log says what paid for every claim and upgrade, and marks the end of each round (the
// round-end turns begin) and the start of the next. Played through the host and its clients.

import { describe, it, expect } from 'vitest';
import type { Action, ClaimBuildingAction, UpgradeBuildingAction } from '../../engine/actions';
import type { CardType } from '../../engine/config';
import type { GameState } from '../../engine/state';
import { createGame, legalActions } from '../../engine';
import { HostSession } from '../hostSession';
import { ClientSession } from '../clientSession';
import { activeSeat, appendLog, LOG_TEXT_MAX } from '../room';
import type { Room } from '../room';
import { diceRngFromSeed } from '../dice';
import { describeAction } from '../describe';
import { ManualScheduler, driveHumans, findState, join, playingRoom, settle } from './helpers';

const NO_TIMERS = { factoryOpTimeoutMs: 0, roundEndTimeoutMs: 0, awayPolicy: 'wait' as const, botDelayMs: 0 };

interface Table { host: HostSession; clients: Record<number, ClientSession> }

/** A 2-player room around `game`: "Ann" hosts seat 0, "Bea" sits in seat 1. */
async function table(game: GameState, diceSeed = 99): Promise<Table> {
  const sched = new ManualScheduler();
  const room: Room = { ...playingRoom(game, [{ kind: 'human', name: 'Ann' }, { kind: 'human', name: 'Bea' }], 0, NO_TIMERS), diceRng: diceRngFromSeed(diceSeed) };
  const host = new HostSession({ code: 'ROOMA', hostName: 'Ann', hostToken: 'tok-ann-0123456789', room, mode: 'takeover', hostSeat: 0, scheduler: sched });
  const ann = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789' });
  const bea = join(host, 'Bea', 'tok-bea-0123456789').client;
  await settle();
  return { host, clients: { 0: ann, 1: bea } };
}

const nameOf = (seat: number): string => (seat === 0 ? 'Ann' : 'Bea');

/** The active player makes `action`; returns the log lines it added. */
async function act(t: Table, action: Action): Promise<string[]> {
  const before = t.host.room.seq;
  const seat = activeSeat(t.host.room.game)!;
  const res = await t.clients[seat]!.act(action);
  if (!res.ok) throw new Error(`${res.error.code}: ${res.error.message}`);
  return t.host.room.log.filter(e => e.seq > before).map(e => e.text);
}

function legal(g: GameState): Action[] {
  return legalActions(g, activeSeat(g)!);
}

const MINE_WORD: Record<string, string> = { 'mine-1': 'the first Mine', 'mine-2': 'the second Mine', 'mine-3': 'the third Mine' };
const units = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** `g` with one `card` moved from the deck (or the discard pile, or made up) into the active player's hand. */
function withCard(g: GameState, card: CardType): GameState {
  const me = activeSeat(g)!;
  const inDeck = g.cardDeck.indexOf(card);
  const inDiscard = g.cardDiscard.indexOf(card);
  return {
    ...g,
    cardDeck: inDeck >= 0 ? g.cardDeck.filter((_, i) => i !== inDeck) : g.cardDeck,
    cardDiscard: inDeck < 0 && inDiscard >= 0 ? g.cardDiscard.filter((_, i) => i !== inDiscard) : g.cardDiscard,
    players: g.players.map(p => (p.id === me ? { ...p, hand: [...p.hand, card] } : p)),
  };
}

/** An actions step with no factory waiting and no card played yet, where a claimed building of the active player exists. */
function quietActions(extra: (s: GameState) => boolean = () => true): GameState {
  return findState(2, s => s.phase === 'actions' && s.pendingFactoryOps.length === 0 && s.cardsPlayedThisTurn === 0
    && s.board.some(p => p.claims.some(c => c.ownerId === activeSeat(s)))
    && s.board.some(p => p.claims.length === 0 && p.type !== 'mine' && p.type !== 'blank')
    && extra(s));
}

describe('the log says what paid for a claim or an upgrade', () => {
  it('a setup claim is a free starting claim', async () => {
    const t = await table(createGame(5, 2));
    const claim = legal(t.host.room.game!).find(a => a.type === 'SETUP_CLAIM')!;
    const lines = await act(t, claim);
    expect(lines).toEqual([expect.stringMatching(/^(Ann|Bea) claimed the Plate Factory .* with Control Module 3, a free starting claim$/)]);
  });

  it('the free claim at round end names the Mine credits and the Mine the meeple stands on', async () => {
    const isFree = (a: Action): a is ClaimBuildingAction => a.type === 'CLAIM_BUILDING' && a.fromFreeClaim === true;
    const g = findState(2, s => s.phase === 'roundEnd' && (s.players[activeSeat(s)!]?.freeActionCredits ?? 0) > 0 && legal(s).some(isFree));
    const me = g.players[activeSeat(g)!]!;
    const claim = legal(g).filter(isFree).at(-1)!;
    const cost = claim.controlModule - g.mineCount + 1;
    const t = await table(g);
    const lines = await act(t, claim);
    expect(lines[0]).toMatch(new RegExp(`^${nameOf(me.id)} claimed the .* with Control Module ${claim.controlModule}, using ${units(cost, 'Mine credit', 'Mine credits')} from their meeple on ${MINE_WORD[me.meepleOnPieceId!]}$`));
    expect(t.host.room.game!.players[me.id]!.freeActionCredits).toBe(me.freeActionCredits - cost);
    // The replay viewer describes the move from the state before only: the same words.
    expect(describeAction(g, claim, nameOf(me.id))).toBe(lines[0]);
    // A move the engine refuses (here: the free claim already used) has no payment to name.
    const used: GameState = { ...g, players: g.players.map(p => (p.id === me.id ? { ...p, freeClaimUsed: true } : p)) };
    expect(describeAction(used, claim, 'Ann')).toMatch(new RegExp(`with Control Module ${claim.controlModule}$`));
  });

  it('an upgrade with Mine credits says so', async () => {
    const isMine = (a: Action): a is UpgradeBuildingAction => a.type === 'UPGRADE_BUILDING' && a.fromMineCredit === true;
    const g = findState(2, s => s.phase === 'roundEnd' && (s.players[activeSeat(s)!]?.freeActionCredits ?? 0) > 0 && legal(s).some(isMine));
    const me = g.players[activeSeat(g)!]!;
    const up = legal(g).find(isMine)!;
    const t = await table(g);
    const lines = await act(t, up);
    expect(lines[0]).toMatch(new RegExp(`^${nameOf(me.id)} upgraded the Control Module on the .* from ${up.oldModule} to ${up.newModule}, using ${units(up.newModule - up.oldModule, 'Mine credit', 'Mine credits')} from their meeple on ${MINE_WORD[me.meepleOnPieceId!]}$`));
  });

  it('an upgrade with the free end-of-round upgrades says so', async () => {
    const isFree = (a: Action): a is UpgradeBuildingAction => a.type === 'UPGRADE_BUILDING' && (a.freeCredits ?? 0) > 0;
    const g = findState(2, s => s.phase === 'roundEnd' && legal(s).some(isFree));
    const up = legal(g).filter(isFree).at(-1)!;
    const t = await table(g);
    const lines = await act(t, up);
    const n = up.newModule - up.oldModule;
    expect(lines[0]).toMatch(new RegExp(`from ${up.oldModule} to ${up.newModule}, using ${units(n, 'free end-of-round upgrade', 'free end-of-round upgrades')}$`));
  });

  it('a claim and an upgrade paid by Production Increase say so', async () => {
    const g = withCard(quietActions(), 'productionIncrease');
    const t = await table(g);
    expect(await act(t, { type: 'PLAY_CARD', cardType: 'productionIncrease' })).toEqual([expect.stringMatching(/ played Production Increase$/)]);

    // The cheapest claim, so upgrades are left for the upgrade below.
    const claim = legal(t.host.room.game!)
      .filter((a): a is ClaimBuildingAction => a.type === 'CLAIM_BUILDING' && a.fromProductionIncrease === true)
      .sort((a, b) => a.controlModule - b.controlModule)[0]!;
    expect(claim).toBeDefined();
    const cost = claim.controlModule - t.host.room.game!.mineCount + 1;
    const claimed = await act(t, claim);
    expect(claimed[0]).toMatch(new RegExp(`claimed the .* with Control Module ${claim.controlModule}, using ${units(cost, 'upgrade', 'upgrades')} from Production Increase$`));

    const up = legal(t.host.room.game!).find((a): a is UpgradeBuildingAction => a.type === 'UPGRADE_BUILDING' && a.fromProductionIncrease === true);
    expect(up).toBeDefined();
    const upgraded = await act(t, up!);
    expect(upgraded[0]).toMatch(new RegExp(`from ${up!.oldModule} to ${up!.newModule}, using ${units(up!.newModule - up!.oldModule, 'upgrade', 'upgrades')} from Production Increase$`));
  });

  it('Short Sale names the building it claims and the Control Module it puts there', async () => {
    const g = withCard(quietActions(), 'shortSale');
    const me = g.players[activeSeat(g)!]!;
    const lowest = Math.min(...me.controlModules.filter(m => m >= g.mineCount));
    const play = legal(g).find(a => a.type === 'PLAY_CARD' && a.cardType === 'shortSale')!;
    const t = await table(g);
    const lines = await act(t, play);
    expect(lines[0]).toMatch(new RegExp(`^${nameOf(me.id)} played Short Sale, claiming the .* with Control Module ${lowest}$`));
  });

  it('Changing Priorities names the Control Module it moves and where to', async () => {
    const g = withCard(quietActions(), 'changingPriorities');
    const play = legal(g).find(a => a.type === 'PLAY_CARD' && a.cardType === 'changingPriorities');
    expect(play).toBeDefined();
    const t = await table(g);
    const lines = await act(t, play!);
    expect(lines[0]).toMatch(new RegExp(` played Changing Priorities, moving Control Module ${(play as { controlModule: number }).controlModule} to the `));
  });
});

describe('the log marks the end and the start of each round', () => {
  it('says when round 1 begins, when a round ends and its round-end turns begin, and when the next round begins', async () => {
    const t = await table(createGame(11, 2), 11);
    const lastNew = (r: Room, from: number): string[] => r.log.filter(e => e.seq > from).map(e => e.text);

    // Setup claims, then round 1.
    let seq: number;
    await driveHumans(t.host, t.clients, r => r.game!.phase === 'placePiece');
    expect(t.host.room.log.at(-1)!.text).toBe('Round 1 begins.');
    expect(t.host.room.log.at(-2)!.text).toMatch(/ claimed the Power Plant .*, a free starting claim$/);

    for (let round = 1; round <= 3; round++) {
      // The last ordinary turn of the round ends: the round-end turns begin.
      await driveHumans(t.host, t.clients, r => r.game!.phase === 'roundEnd');
      seq = t.host.room.seq;
      const atEnd = t.host.room.log;
      expect(atEnd.at(-1)).toMatchObject({ seat: null, seq, text: `End of round ${round}: the round-end turns begin.` });
      expect(atEnd.at(-2)!.text).toMatch(/ ended their turn$/);
      expect(t.host.room.game!.round).toBe(round + 1); // the engine already counts the next round

      // The last round-end turn ends: the next round begins.
      await driveHumans(t.host, t.clients, r => r.game!.phase !== 'roundEnd');
      const lines = lastNew(t.host.room, seq);
      expect(lines.at(-1)).toBe(`Round ${round + 1} begins.`);
      expect(lines.at(-2)).toMatch(/ ended their round-end turn$/);
      expect(lines.filter(l => /^End of round|begins\.$/.test(l))).toEqual([`Round ${round + 1} begins.`]);
    }
  }, 60_000);

  it('never adds a line longer than a save accepts', () => {
    const long = 'x'.repeat(LOG_TEXT_MAX + 50);
    const [e] = appendLog([], [{ seq: 1, seat: null, text: long }]);
    expect(e!.text.length).toBe(LOG_TEXT_MAX);
  });
});

describe('a round-end claim in a bot game (regression: the owner could not tell how a bot claimed)', () => {
  it('comes after the end-of-round line and says it was paid with Mine credits', async () => {
    const sched = new ManualScheduler();
    const host = new HostSession({
      code: 'BOTSS', hostName: 'Ann', hostToken: 'tok-ann-0123456789', scheduler: sched, randomSeed: (): number => 777,
    });
    const me = new ClientSession(host.connectLocal(), { name: 'Ann', token: 'tok-ann-0123456789' });
    await settle();
    expect((await me.configure({ playerCount: 4, botDelayMs: 0 })).ok).toBe(true);
    for (const i of [1, 2, 3]) expect((await me.setSeat(i, 'bot', 'greedy')).ok).toBe(true);
    expect((await me.setAutopilot(0, true)).ok).toBe(true);
    expect((await me.setReady(true)).ok).toBe(true);
    expect((await me.start()).ok).toBe(true);

    const isRoundEndClaim = (text: string): boolean => / claimed the .*, using \d+ Mine credits? from their meeple on the (first|second|third) Mine$/.test(text);
    sched.runUntil(() => host.room.log.some(e => isRoundEndClaim(e.text)) || host.room.phase === 'finished');
    host.dispose();
    const log = host.room.log.map(e => e.text);
    const at = log.findIndex(isRoundEndClaim);
    expect(at).toBeGreaterThan(0);
    // Reading back from the claim: the end-of-round line comes before any ordinary turn's end or
    // any round start, and the round it closes is the one whose next round begins after the claim.
    const back = log.slice(0, at).reverse().find(l => / ended their turn$/.test(l) || /^End of round \d+|^Round \d+ begins\.$/.test(l));
    const ended = /^End of round (\d+): the round-end turns begin\.$/.exec(back ?? '');
    expect(ended, back).not.toBeNull();
    const next = log.slice(at).find(l => /^Round \d+ begins\.$/.test(l));
    if (next) expect(next).toBe(`Round ${Number(ended![1]) + 1} begins.`);
  }, 60_000);
});

