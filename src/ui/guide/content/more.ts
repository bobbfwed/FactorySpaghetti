// Mines, bonus Tesseracts, winning, and playing online.

import {
  BONUS_THRESHOLDS, FACTORY_OP_TIMEOUT_MS, MATERIAL_VALUES, MINE_COSTS, ROUND_END_TIMEOUT_MS, TESSERACTS_TO_WIN,
  bonusesEnabled,
} from '../../../engine/config';
import { defaultSettings } from '../../../session/room';
import { BOT_TYPES } from '../../../bots/registry';
import type { Topic } from '../types';
import { minePointRows } from './turn';
import { MATERIALS, MATERIAL_NAME, ORDINAL, cardPriceWords, listWords, mineCredits, minePriceWords, perMineWords } from './facts';

const secs = (ms: number): string => `${Math.round(ms / 1000)} seconds`;

export const mines: Topic = {
  id: 'mines',
  title: 'Mines',
  summary: 'Ore, dice, buying a Mine, and Mines that drop by themselves.',
  blocks: [
    { k: 'p', t: 'Mines give out Ore without end. The number of Mines on the board also sets:' },
    {
      k: 'list', items: [
        'how many dice are rolled: one per Mine;',
        `the price of a Leverage card: Mines + 1 (${cardPriceWords()});`,
        'the lowest Control Module you may place on a building (the claim floor);',
        'how many free upgrades everyone gets at the end of each round;',
        `what a Mine's upgrade point gives: Mines + 1 (${perMineWords(mineCredits)});`,
        'how many Plates Mine Inspection gives.',
      ],
    },
    { k: 'h', t: 'Bringing the next Mine into play', id: 'next' },
    {
      k: 'list', items: [
        `**Buy it** in your actions step: ${minePriceWords()}. You place it at once, next to the board.`,
        '**It drops** when a stack runs out: the next Mine comes into play by itself, and the next player places it instead of drawing a piece.',
      ],
    },
    { k: 'p', t: 'Either way the stack under that Mine opens, and from then on everyone rolls one more die.' },
    { k: 'h', t: 'Meeple points', id: 'points' },
    { k: 'p', t: 'Each Mine has a resource point and an upgrade point, each with room for one meeple. They pay out at the end of the round:' },
    { k: 'table', head: ['Point', 'Gives'], rows: minePointRows() },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'A Mine covers two spaces side by side: its larger half, with ore exits all round, and its smaller half. The **larger half must touch the board**; the smaller half may point any way that is free. Only the spaces where that works glow. Choose its direction with the turn button before you confirm.' },
        { k: 'p', t: 'Where Ore comes out: see [[belts#points|Which holes take a belt]].' },
        { k: 'p', t: 'You cannot buy a Mine while a dropped Mine is still waiting to be placed.' },
        { k: 'p', t: 'Mines can never be removed.' },
        { k: 'p', t: `Buying the ${ORDINAL[1]} Mine for ${MINE_COSTS[0]} is often cheaper than waiting for stack 1 to run out — but it also opens a new stack for everyone, and changes which totals come up. See [[step-roll#odds|Which totals come up]].` },
      ],
    },
  ],
  see: ['step-roll', 'step-meeple', 'claiming'],
};

export const bonuses: Topic = {
  id: 'bonuses',
  title: 'Bonus Tesseracts',
  summary: 'Three bonus cards, each worth one Tesseract toward winning.',
  blocks: [
    ...(bonusesEnabled ? [] : [{ k: 'note' as const, tone: 'warn' as const, t: 'Bonus Tesseracts are switched off in this version of the game.' }]),
    { k: 'p', t: 'Three bonus cards each count as one Tesseract toward winning, for as long as you hold them. They are not materials: you cannot spend or exchange them, and they are worth nothing in the material-value count at the end.' },
    {
      k: 'table', head: ['Bonus', 'Who holds it'], rows: [
        ['The Investor', `The player with the highest Control Module on any building, if it is at least ${BONUS_THRESHOLDS.investor}.`],
        ['Belt Weaver', `The player with the longest continuous chain of their own belts linking two buildings, or a Mine and a building — at least ${BONUS_THRESHOLDS.beltWeaver} belts.`],
        ['Factory Empire', `The player with the most buildings claimed (several modules on one building count once) — at least ${BONUS_THRESHOLDS.factoryEmpire}.`],
      ],
    },
    { k: 'p', t: 'The game checks after every move and hands a card over the moment someone beats its holder — even in the middle of another player\'s turn. The **Bonuses** tab shows who holds each one.' },
    {
      k: 'details', blocks: [
        { k: 'p', t: 'Ties: the holder keeps the card. If nobody held it yet and several players qualify at once, the player in the earliest seat (the order of the seats in the lobby) gets it.' },
        { k: 'p', t: 'Belt Weaver counts your belts along one path that never doubles back. The path may pass through a factory you own, from the belt at its input to the belt at its output; the factory itself does not count. Its two ends must reach two different buildings, or a Mine and a building.' },
        { k: 'note', tone: 'example', t: 'Eight of your belts run from a Mine into your Plate Factory, and one more from its output into a Tesseract Factory: a chain of 9 belts.' },
        { k: 'p', t: 'The Investor counts any Control Module on a building, even one whose number cannot be rolled yet.' },
        { k: 'p', t: 'A bonus counts only while you hold it. Losing the lead loses the card at once.' },
      ],
    },
  ],
  see: ['winning', 'belts', 'claiming'],
};

export const winning: Topic = {
  id: 'winning',
  title: 'Winning and the end of the game',
  summary: `${TESSERACTS_TO_WIN} Tesseracts on your own turn — or the most valuable materials when the pieces run out.`,
  blocks: [
    { k: 'p', t: `You win the moment you hold **${TESSERACTS_TO_WIN} Tesseracts** — in your materials plus your bonus cards — during your own turn, your round-end turn included. The game checks after every move; there is nothing to announce.` },
    { k: 'p', t: 'Tesseracts that reach you on someone else\'s turn, for example through an output teleporter, count as soon as your next turn (or round-end turn) begins and you make a move.' },
    { k: 'h', t: 'When the pieces run out', id: 'exhausted' },
    { k: 'p', t: `When all three stacks are empty, the game ends at the end of the turn in which the last piece was placed. The player whose materials are worth the most wins: ${listWords(MATERIALS.map(m => `${MATERIAL_NAME[m]} ${MATERIAL_VALUES[m]}`))}. Bonus cards add nothing to this total.` },
    {
      k: 'details', title: 'Tie-breaks', blocks: [
        { k: 'p', t: 'If players are level, the game compares, in this order, until one is ahead:' },
        {
          k: 'steps', items: [
            'The most material value.',
            'The most Tesseracts, bonus cards included.',
            'The most Spheres.',
            'The most Plates.',
            'The most Ore.',
            'Who comes earliest in the turn order of that round.',
          ],
        },
        { k: 'p', t: 'Only if they are still level do they share the win — which the last step makes impossible in practice.' },
        { k: 'p', t: 'If the last piece is placed in the last turn of a round, the Mine resource points still pay out, but there are no round-end turns.' },
      ],
    },
  ],
  see: ['bonuses', 'goal'],
};

const st = defaultSettings();

export const online: Topic = {
  id: 'online',
  title: 'Playing online, saving and resuming',
  summary: 'Room codes, saves, away players, the host, timers and bots.',
  blocks: [
    { k: 'h', t: 'Room codes and invite links', id: 'codes' },
    { k: 'p', t: 'The host\'s browser runs the game. The others connect to it directly over the internet, using the 5-letter room code to find it. **Copy invite link** in the lobby gives a link that opens the game with the code already filled in.' },
    { k: 'p', t: 'The host\'s device rolls every die and checks every move, so all devices see the same game and nobody can make a move the rules do not allow.' },
    { k: 'h', t: 'Saving and resuming', id: 'saving' },
    { k: 'p', t: 'The game saves itself on your device after every move. The start menu lists your saved games: press **Resume**.' },
    { k: 'p', t: 'To carry a game to another device, or to a friend, use the game menu: **Copy save link**, **Download save file** or **Share save…**. On the other device, open the link, or choose **Load a save (link or file)** on the start menu.' },
    { k: 'p', t: 'A resumed online game opens in the lobby. Players get their seat back by joining with the same name as before; the host can also hand an empty seat to someone waiting, or to a bot. The host presses **Continue game** when ready.' },
    { k: 'h', t: 'If someone drops out', id: 'away' },
    { k: 'p', t: `If a player loses their connection, their seat keeps everything. The host chooses what happens: a bot plays the seat until the player comes back (by default after ${secs(st.awayGraceMs)}), or the game waits for them.` },
    { k: 'p', t: 'If the host leaves, another player takes over as host by themselves, under the same room code, and the game carries on. If nobody hosting can be reached, your device still holds the game, and you can host it from your copy.' },
    { k: 'h', t: 'Autoplay' },
    { k: 'p', t: '**Autoplay my seat** in the game menu lets a bot on your device play for you. **Take my seat back** to play again.' },
    { k: 'h', t: 'Timers', id: 'timers' },
    {
      k: 'table', head: ['Timer', 'Normally', 'What it does'], rows: [
        ['Operate timer', secs(FACTORY_OP_TIMEOUT_MS), 'Time to answer **Run it** or **Skip** for a factory activated on someone else\'s turn. When it runs out, the game runs the factory if you can pay, and skips it otherwise.'],
        ['Round-end timer', secs(ROUND_END_TIMEOUT_MS), 'A round-end turn with no move for this long ends by itself. Every move starts the countdown again.'],
        ['If a player drops', `A bot takes over after ${secs(st.awayGraceMs)}`, 'Or the game waits for the player to come back.'],
      ],
    },
    { k: 'p', t: 'The host sets these in the lobby, and can switch the first two off. Steps 1 to 4 of your own turn have no timer.' },
    { k: 'note', tone: 'warn', t: 'Timers keep counting while this guide is open, and the game carries on underneath it. If the game is waiting for you, close the guide to answer.' },
    { k: 'h', t: 'Bots', id: 'bots' },
    { k: 'p', t: 'Bots follow the same rules and choose from the same legal moves as you. In the lobby (and on the solo **Game set-up** screen) the host chooses which kind of bot plays each bot seat, from the drop-down on the seat:' },
    { k: 'list', items: BOT_TYPES.map(b => `**${b.label}**`) },
    { k: 'p', t: 'A bot seat is named after its kind, numbered when there are several of a kind. **Bot speed** (Instant, Fast or Normal) sets how quickly bots move; on Normal you see each of their moves on the table.' },
    { k: 'h', t: 'Replays and rules problems', id: 'replays' },
    { k: 'p', t: 'The game menu can **Save replay** and **Watch this game again**; **Watch a replay** on the start menu opens a saved replay. If you think the game applied a rule wrongly, **Report a rules problem** writes a file with the game and your note. It sends nothing anywhere; pass the file to the game\'s designer.' },
    { k: 'h', t: 'Installing', id: 'install' },
    { k: 'p', t: '**Install app** on the start menu adds the game to your home screen. After one visit, a solo game works without a connection.' },
  ],
  see: ['starting', 'screen'],
};
