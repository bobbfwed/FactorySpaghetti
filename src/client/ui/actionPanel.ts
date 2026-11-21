// Right-side panel: player info, phase actions, card hand, log.

import type { GameState, PlayerId, HexCoord } from '../../engine/state';
import { MINE_COSTS, BELT_COST, cardCost, CONTROL_MODULE_MAX, FACTORY_POWER_COST, type PieceType, type Material } from '../../engine/config';
import type { Action } from '../../engine/actions';
import { legalActions } from '../../engine/reducer';
import { factoryCanOperate, factoryOperatePowerCost, factoryExpectedProduct, canLoadMaterial, findInputCompletion } from '../../engine/rules/production';
import { playerStats } from '../../engine/rules/stats';
import { PLAYER_COLORS, PLAYER_NAMES } from '../render/colors';
import { CARD_INFO } from './cardDescriptions';

export type ActionCallback = (action: Action) => void;

export interface PanelState {
  selectedCoord: HexCoord | null;
  pendingActionType: string | null;
  ghostPieceType: PieceType | null;
  ghostRotation: number;
  beltPieceId: string | null;    // belt: piece where first point was clicked (legacy)
  beltFromPoint: number | null;  // belt: position index of the first click (legacy)
  // Belt-route placement (findRoute-driven): chosen source point, and a pending buy prompt
  // when the hovered/clicked route needs more belts than the player holds.
  beltRouteSource: { pieceId: string; position: number } | null;
  beltRoutePrompt: {
    belts: ReadonlyArray<{ pieceId: string; fromPoint: number; toPoint: number }>;
    cost: number; have: number; need: number; affordable: boolean;
  } | null;
  claimFromFreeClaim: boolean;   // claim: true when the action is a free mine-slot-1 claim
  tpPieceId: string | null;      // teleporter: piece selected, waiting for input/output choice
  // Card piece-selection mode
  pendingCardType: string | null;    // card being played (shortSale, sinkHole, etc.)
  pendingCardTarget: string | null;  // first piece ID selected
  pendingCardTarget2: string | null; // second piece ID or 'input'/'output' for rdTaxWriteOff
  // Card draw feedback (set after BUY_CARD, cleared on next action)
  drawnCardNotice: { cardType: string; playedOnDraw: boolean } | null;
}

// Cards that require selecting a piece on the board before dispatching.
export const BOARD_PIECE_CARDS: ReadonlySet<string> = new Set([
  'shortSale', 'sinkHole', 'changingPriorities', 'rdTaxWriteOff',
]);

export class ActionPanel {
  private readonly infoEl: HTMLElement;
  private readonly btnsEl: HTMLElement;
  private readonly cardEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly allPlayersEl: HTMLElement;

  constructor(
    private readonly onAction: ActionCallback,
    private readonly onCancel: () => void,
    private readonly onGhostUpdate: (pieceType: PieceType | null, rotation: number) => void,
    private readonly requestRender?: () => void,
    // Belt-route buy prompt: confirm=true → buy the shortfall and place the route.
    private readonly onRouteCommit: (confirm: boolean) => void = () => {},
  ) {
    this.infoEl = document.getElementById('player-info')!;
    this.btnsEl = document.getElementById('action-buttons')!;
    this.cardEl = document.getElementById('card-hand-entries')!;
    this.logEl  = document.getElementById('log-entries')!;
    this.timerEl = document.getElementById('turn-timer')!;
    this.allPlayersEl = document.getElementById('all-players-rows')!;
  }

  // Epoch ms when the current timed auto-action fires (null = none). Set each render so the
  // pending-op and round-end prompts can show a live countdown.
  private actionDeadline: number | null = null;

  render(
    state: GameState,
    humanId: PlayerId,
    ps: PanelState,
    log: readonly string[],
    opts: { controllable: boolean; seatLabel?: string; actionDeadline?: number | null } = { controllable: true },
  ): void {
    this.actionDeadline = opts.actionDeadline ?? null;
    this.renderPlayerInfo(state, humanId, opts.seatLabel);
    this.renderAllPlayers(state);
    this.renderActions(state, humanId, ps, opts.controllable);
    this.renderCardHand(state, humanId, ps);
    this.renderLog(log);
    this.updateTurnTimer(this.actionDeadline);
  }

  // Compact readout of EVERY player's Tesseracts (real + bonus) and resources, so you can
  // track opponents at a glance. Uses each player's colour + name; the active player is lit.
  private renderAllPlayers(state: GameState): void {
    const activeId = state.turnOrder[state.activePlayerIndex];
    const rows = playerStats(state).map(r => {
      const color = PLAYER_COLORS[r.playerId] ?? '#fff';
      const name = escapeHtml(PLAYER_NAMES[r.playerId] ?? `Player ${r.playerId + 1}`);
      const bonus = r.bonusTesseracts > 0 ? `<span class="pl-bonus">+${r.bonusTesseracts}★</span>` : '';
      const activeCls = r.playerId === activeId ? ' active' : '';
      return `<div class="pl-row${activeCls}">` +
        `<div class="pl-dot" style="background:${color}"></div>` +
        `<span class="pl-name">${name}</span>` +
        `<span class="pl-tess">◆${r.tesseracts}</span>${bonus}` +
        `<span class="pl-res">${r.ore}/${r.plate}/${r.sphere}</span>` +
        `</div>`;
    });
    this.allPlayersEl.innerHTML = rows.join('');
  }

  // Update ONLY the countdown banner, in place — never rebuilds the action buttons. The
  // 500ms ticker calls this (not full render()), so a button can't be destroyed between a
  // player's mousedown and click (which was eating clicks at round end — the two-click bug).
  updateTurnTimer(deadline: number | null): void {
    this.actionDeadline = deadline;
    if (deadline === null) { this.timerEl.classList.add('hidden'); this.timerEl.textContent = ''; return; }
    const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    this.timerEl.textContent = `⏳ auto in ${secs}s`;
    this.timerEl.classList.toggle('urgent', secs <= 5);
    this.timerEl.classList.remove('hidden');
  }

  // ── Player info ─────────────────────────────────────────────────────────────

  private renderPlayerInfo(state: GameState, humanId: PlayerId, seatLabel?: string): void {
    const player = state.players[humanId];
    if (!player) { this.infoEl.innerHTML = ''; return; }

    const activeId = state.turnOrder[state.activePlayerIndex];
    const isActive = activeId === humanId;
    const color = PLAYER_COLORS[humanId] ?? '#fff';
    const nameSuffix = seatLabel ? ` <span style="color:#889;font-size:0.8em">(${seatLabel})</span>` : '';

    const inv = player.inventory;
    const invStr = (Object.keys(inv) as Array<keyof typeof inv>)
      .map(m => `${m[0]!.toUpperCase()}${m.slice(1)}: ${inv[m]}`)
      .join(' · ');

    const bonuses = [
      player.bonusTesseracts.investor      ? '★Investor'   : null,
      player.bonusTesseracts.beltWeaver    ? '★BeltWeaver' : null,
      player.bonusTesseracts.factoryEmpire ? '★FctEmpire'  : null,
    ].filter(Boolean).join(' ');

    const nextMineCost = state.unplacedMines.length > 0
      ? (MINE_COSTS[2 - state.unplacedMines.length] ?? '?')
      : null;
    const minePrice = nextMineCost !== null ? `${nextMineCost} ore` : 'none left';

    this.infoEl.innerHTML = `
      <h2 style="color:${color}">${PLAYER_NAMES[humanId] ?? `P${humanId}`}${nameSuffix}${isActive ? ' ▶' : ''}</h2>
      <div class="stat-row"><span>Round / Phase</span><span>${state.round} / ${state.phase}</span></div>
      <div class="stat-row"><span>Power tokens</span><span>${player.powerTokens}</span></div>
      <div class="stat-row"><span>Inventory</span><span>${invStr}</span></div>
      <div class="stat-row" style="display:block"><span>Control Modules</span>${controlModuleGrid(player.controlModules)}</div>
      <div class="stat-row"><span>Belt supply</span><span>${player.beltsRemaining}</span></div>
      <div class="stat-row"><span>Teleporters on board</span><span>${state.globalTeleporterCount}</span></div>
      <div class="stat-row"><span>TP slots remaining</span><span>${player.teleportersRemaining}</span></div>
      ${bonuses ? `<div class="stat-row"><span>Bonus Tesseracts</span><span style="color:#ffee58">${bonuses}</span></div>` : ''}
      ${player.freeUpgradesRemaining > 0 ? `<div class="stat-row"><span>Free upgrades</span><span>${player.freeUpgradesRemaining}</span></div>` : ''}
      ${player.freeActionCredits > 0 ? `<div class="stat-row"><span>Mine credits</span><span>${player.freeActionCredits}</span></div>` : ''}
      <div class="stat-section-label" style="margin-top:6px;font-size:0.75em;opacity:0.7;text-transform:uppercase;letter-spacing:0.05em">Current prices</div>
      <div class="stat-row"><span>Buy belt</span><span>1 ore</span></div>
      <div class="stat-row"><span>Next mine</span><span>${minePrice}</span></div>
      <div class="stat-row"><span>Buy card</span><span>${cardCost(state.mineCount)} ore</span></div>
      <div class="stat-row"><span>Next teleporter</span><span>${state.globalTeleporterCount + 1} ore</span></div>
    `;
  }

  // ── Phase actions ────────────────────────────────────────────────────────────

  private renderActions(state: GameState, humanId: PlayerId, ps: PanelState, controllable: boolean): void {
    this.btnsEl.innerHTML = '';

    if (state.gameOver) { this.addHint('Game over!'); return; }
    const activeId = state.turnOrder[state.activePlayerIndex];

    // Factory activations belong to their OWNER and must be decided even when it is NOT
    // your turn (a roll on anyone's turn activates your factories). Surface them first,
    // before the "someone else is playing" gate, so you always get the operate/skip choice.
    const myPending = state.pendingFactoryOps.filter(e => e.ownerId === humanId);
    if (myPending.length > 0) {
      this.renderPendingFactoryOps(state, humanId, myPending);
      return;
    }

    if (!controllable) {
      const activeName = PLAYER_NAMES[activeId ?? 0] ?? `Player ${(activeId ?? 0) + 1}`;
      this.addHint(`🤖 ${activeName} is playing…`);
      return;
    }

    switch (state.phase) {
      case 'setupClaimPF': this.addHint('Click a highlighted Plate Factory to claim it'); break;
      case 'setupClaimPP': this.addHint('Click a highlighted Power Plant to claim it'); break;
      case 'placePiece':  this.renderPlacePiece(state, ps); break;
      case 'roll':        this.renderRoll(state); break;
      case 'actions':     this.renderActionsPhase(state, humanId, ps); break;
      case 'placeMeeple': this.renderPlaceMeeple(state, humanId); break;
      case 'roundEnd':    this.renderRoundEnd(state, humanId, ps); break;
    }
  }

  // ── placePiece ───────────────────────────────────────────────────────────────

  private renderPlacePiece(state: GameState, ps: PanelState): void {
    const isPendingMine = state.pendingMineIds.length > 0;

    if (!ps.selectedCoord) {
      this.addHint(isPendingMine
        ? '⚠ Auto-dropped mine — click a highlighted hex to place it'
        : 'Click a highlighted hex to begin placing a piece');
      return;
    }

    const coord = ps.selectedCoord;
    this.addHint(`Hex (${coord.q}, ${coord.r}) selected`);

    if (isPendingMine) {
      this.addSectionLabel('Choose rotation for the pending mine:');
      this.addRotationGrid(null, (r) => this.onAction({ type: 'PLACE_MINE', coord, rotation: r }), 'mine', ps);
    } else {
      for (let si = 0; si <= 2; si++) {
        const stack = state.stacks[si as 0 | 1 | 2];
        if (!stack.available || stack.pieces.length === 0) continue;
        const top = stack.pieces[0]!;
        this.addSectionLabel(`Stack ${si + 1} — ${PIECE_DISPLAY[top.type] ?? top.type} (${stack.pieces.length} left)`);
        if (top.type === 'blank') {
          // Blanks are rotationally symmetric — no rotation choice needed.
          this.addBtn('Place Blank', () => this.onAction({ type: 'PLACE_PIECE', stackIndex: si as 0 | 1 | 2, coord, rotation: 0 }));
        } else {
          this.addRotationGrid(si as 0 | 1 | 2,
            (r) => this.onAction({ type: 'PLACE_PIECE', stackIndex: si as 0 | 1 | 2, coord, rotation: r }),
            top.type, ps);
        }
      }
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn';
    cancelBtn.style.marginTop = '4px';
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.addEventListener('click', () => this.onCancel());
    this.btnsEl.appendChild(cancelBtn);
  }

  private addSectionLabel(text: string): void {
    const el = document.createElement('div');
    el.className = 'section-label';
    el.textContent = text;
    this.btnsEl.appendChild(el);
  }

  private addRotationGrid(
    _stackIndex: 0 | 1 | 2 | null,
    onPick: (rotation: number) => void,
    pieceType: PieceType,
    ps: PanelState,
  ): void {
    const grid = document.createElement('div');
    grid.className = 'rotation-grid';
    const ROTATION_LABELS = ['0°', '60°', '120°', '180°', '240°', '300°'];
    for (let r = 0; r < 6; r++) {
      const btn = document.createElement('button');
      btn.className = 'rot-btn';
      btn.textContent = ROTATION_LABELS[r] ?? `${r}`;
      btn.title = `Place at rotation ${r} (${r * 60}°)`;
      btn.addEventListener('mouseenter', () => {
        ps.ghostRotation = r;
        ps.ghostPieceType = pieceType;
        this.onGhostUpdate(pieceType, r);
      });
      btn.addEventListener('mouseleave', () => {
        this.onGhostUpdate(pieceType, ps.ghostRotation);
      });
      btn.addEventListener('click', () => onPick(r));
      grid.appendChild(btn);
    }
    this.btnsEl.appendChild(grid);
  }

  // ── roll ─────────────────────────────────────────────────────────────────────

  private renderRoll(state: GameState): void {
    const n = state.mineCount;
    const btn = this.addBtn(
      `🎲 Roll ${n} ${n === 1 ? 'die' : 'dice'}`,
      () => {
        const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * 6) + 1);
        this.onAction({ type: 'ROLL_DICE', rolls });
      },
      false, true,
    );
    if (state.lastRoll) {
      btn.title = `Last roll: [${state.lastRoll.join(', ')}]`;
    }
  }

  // ── pending factory activations (operate/skip, any turn) ──────────────────────

  private renderPendingFactoryOps(
    state: GameState,
    humanId: PlayerId,
    myPending: ReadonlyArray<{ pieceId: string; ownerId: PlayerId }>,
  ): void {
    const entry = myPending[0]!;
    const piece = state.board.find(p => p.id === entry.pieceId);
    const player = state.players[humanId];
    const lbl = piece ? (PIECE_DISPLAY[piece.type] ?? piece.type) : entry.pieceId;
    const rollSum = state.lastRoll ? state.lastRoll.reduce((a, b) => a + b, 0) : '?';
    const module = piece?.claims.find(c => c.ownerId === humanId)?.controlModule ?? '?';
    const activeId = state.turnOrder[state.activePlayerIndex];
    const whose = activeId === humanId
      ? 'You'
      : (PLAYER_NAMES[activeId ?? 0] ?? `Player ${(activeId ?? 0) + 1}`);

    this.addSectionLabel('── Your Factory Activated ──');
    this.addHint(`${whose} rolled ${rollSum} — your ${lbl} (#${module}) can operate.`);
    // The live countdown is shown by the #turn-timer banner (updated in place, so it never
    // rebuilds these buttons mid-click).

    const cost = piece && player ? operateConsumption(piece, player) : null;
    if (cost) {
      const matStr = cost.consumed.length ? cost.consumed.join(' + ') : 'no materials';
      this.addHint(
        `Operating takes ${cost.power} 🔋 and ${matStr} → produces 1 ${cost.product} (to the output buffer).`,
      );
      this.addBtn(
        `✓ Operate  (−${cost.power} 🔋, −${matStr})`,
        () => this.onAction({ type: 'OPERATE_BUILDING', pieceId: entry.pieceId, ownerId: humanId }),
        false, true,
      );
    } else {
      this.addBtn(
        '✓ Operate',
        () => this.onAction({ type: 'OPERATE_BUILDING', pieceId: entry.pieceId, ownerId: humanId }),
        false, true,
      );
    }
    this.addBtn(
      '✗ Skip  (keep your power & materials)',
      () => this.onAction({ type: 'SKIP_FACTORY_ROLL', pieceId: entry.pieceId, ownerId: humanId }),
    );
    if (myPending.length > 1) {
      this.addHint(`(${myPending.length - 1} more activation${myPending.length > 2 ? 's' : ''} to decide)`);
    }
    if (this.actionDeadline !== null) this.addHint('Auto-operates if you don’t choose in time.');
  }

  // ── actions phase ────────────────────────────────────────────────────────────

  private renderActionsPhase(state: GameState, humanId: PlayerId, ps: PanelState): void {
    const player = state.players[humanId];
    if (!player) return;

    // Change 2: drawn-card notice — show before anything else
    if (ps.drawnCardNotice) {
      const { cardType, playedOnDraw } = ps.drawnCardNotice;
      const info = CARD_INFO[cardType as keyof typeof CARD_INFO];
      const cardTitle = info?.title ?? cardType;
      if (playedOnDraw) {
        // Blocking overlay: must acknowledge before continuing
        this.addSectionLabel('── Card Drawn (Play-on-Draw) ──');
        this.addHint(`${cardTitle}`);
        const desc = CARD_DESCRIPTIONS[cardType] ?? info?.description ?? '';
        if (desc) this.addHint(desc);
        this.addBtn('OK — Continue', () => {
          ps.drawnCardNotice = null;
          this.requestRender?.();
        }, false, true);
        return; // block rest of panel until acknowledged
      } else {
        // Non-blocking banner
        this.addHint(`Drew: ${cardTitle} (added to hand)`);
      }
    }

    const legal = legalActions(state, humanId);
    const types = new Set(legal.map(a => a.type));

    // Overstock pending — only show overstock UI until resolved
    if (state.overstockPieces.length > 0) {
      this.addHint(`Place ${state.overstockPieces.length} overstock piece(s) — click a highlighted hex`);
      if (ps.selectedCoord) {
        this.addBtn(`Place overstock at (${ps.selectedCoord.q}, ${ps.selectedCoord.r})`,
          () => this.onAction({ type: 'PLACE_OVERSTOCK_PIECE', coord: ps.selectedCoord!, rotation: 0 }),
        );
      }
      return;
    }


    // ── Pending card-play mode ────────────────────────────────────────────────

    if (ps.pendingCardType && BOARD_PIECE_CARDS.has(ps.pendingCardType)) {
      const cardInfo = CARD_INFO[ps.pendingCardType as keyof typeof CARD_INFO];
      const cardTitle = cardInfo?.title ?? ps.pendingCardType;
      this.addSectionLabel(`── Playing: ${cardTitle} ──`);

      if (ps.pendingCardType === 'changingPriorities') {
        if (!ps.pendingCardTarget) {
          this.addHint('Click the building to move a module FROM');
        } else if (!ps.pendingCardTarget2) {
          const fromPiece = state.board.find(p => p.id === ps.pendingCardTarget);
          this.addHint(`From: ${fromPiece ? (PIECE_DISPLAY[fromPiece.type] ?? fromPiece.id) : ps.pendingCardTarget} — click the building to move TO`);
        } else {
          const cpPlays = (legal.filter(a =>
            a.type === 'PLAY_CARD' &&
            (a as Action & { type: 'PLAY_CARD' }).cardType === 'changingPriorities' &&
            (a as Action & { type: 'PLAY_CARD' }).pieceId === ps.pendingCardTarget &&
            (a as Action & { type: 'PLAY_CARD' }).toPieceId === ps.pendingCardTarget2,
          ) as Array<Action & { type: 'PLAY_CARD' }>);
          if (cpPlays.length === 1) {
            this.addBtn('✓ Complete', () => this.onAction(cpPlays[0]!), false, true);
          } else if (cpPlays.length > 1) {
            this.addHint('Choose which module to move:');
            for (const ca of cpPlays) {
              this.addBtn(`Module ${ca.controlModule}`, () => this.onAction(ca), false, true);
            }
          } else {
            this.addHint('No valid move for that combination — pick different buildings');
          }
        }
      } else if (ps.pendingCardType === 'rdTaxWriteOff' && ps.pendingCardTarget) {
        const tpPlays = (legal.filter(a =>
          a.type === 'PLAY_CARD' &&
          (a as Action & { type: 'PLAY_CARD' }).cardType === 'rdTaxWriteOff' &&
          (a as Action & { type: 'PLAY_CARD' }).pieceId === ps.pendingCardTarget,
        ) as Array<Action & { type: 'PLAY_CARD' }>);
        const inputPlay = tpPlays.find(a => a.bufferType === 'input');
        const outputPlay = tpPlays.find(a => a.bufferType === 'output');
        const rPiece = state.board.find(p => p.id === ps.pendingCardTarget);
        this.addHint(`Teleporter on ${rPiece ? (PIECE_DISPLAY[rPiece.type] ?? rPiece.id) : ps.pendingCardTarget}:`);
        if (inputPlay) this.addBtn('Place on Input buffer', () => this.onAction(inputPlay), false, true);
        if (outputPlay) this.addBtn('Place on Output buffer', () => this.onAction(outputPlay), false, true);
      } else if (ps.pendingCardTarget && ps.pendingCardType !== 'rdTaxWriteOff') {
        const matchingPlay = legal.find(a =>
          a.type === 'PLAY_CARD' &&
          (a as Action & { type: 'PLAY_CARD' }).cardType === ps.pendingCardType &&
          (a as Action & { type: 'PLAY_CARD' }).pieceId === ps.pendingCardTarget,
        ) as (Action & { type: 'PLAY_CARD' }) | undefined;
        if (matchingPlay) {
          const selPiece = state.board.find(p => p.id === ps.pendingCardTarget);
          this.addHint(`Selected: ${selPiece ? (PIECE_DISPLAY[selPiece.type] ?? selPiece.id) : ps.pendingCardTarget}`);
          this.addBtn('✓ Complete', () => this.onAction(matchingPlay), false, true);
        } else {
          this.addHint('That piece is not a valid target — click another');
        }
      } else {
        this.addHint('Click a highlighted building on the board');
      }

      this.addBtn('✕ Cancel card', () => {
        ps.pendingCardType = null;
        ps.pendingCardTarget = null;
        ps.pendingCardTarget2 = null;
        this.onCancel();
      });
      this.addSectionLabel('──────────────────');
    }

    // ── Scouting Drone multi-step flow ────────────────────────────────────────
    if (ps.pendingCardType === 'scoutingDrone') {
      this.addSectionLabel('── Playing: Scouting Drone ──');

      const cancelDrone = () => {
        ps.pendingCardType = null;
        ps.pendingCardTarget = null;
        ps.pendingCardTarget2 = null;
        ps.selectedCoord = null;
        this.onCancel();
      };

      if (ps.pendingCardTarget === null) {
        // Step 1: choose a stack to scout
        this.addHint('Step 1: select a stack to scout');
        for (let si = 0; si < 3; si++) {
          const stack = state.stacks[si as 0 | 1 | 2];
          const disabled = !stack.available || stack.pieces.length === 0;
          this.addBtn(
            `Scout Stack ${si + 1}${disabled ? ' (unavailable)' : ` (${Math.min(stack.pieces.length, 5)} pieces)`}`,
            () => { ps.pendingCardTarget = String(si); this.requestRender?.(); },
            false, false, disabled,
          );
        }
      } else if (ps.pendingCardTarget2 === null) {
        // Step 2: choose a piece from the top 5 of the selected stack
        const si = parseInt(ps.pendingCardTarget) as 0 | 1 | 2;
        const stack = state.stacks[si];
        this.addHint(`Step 2: choose a piece from Stack ${si + 1}`);
        const PIECE_NAMES: Record<string, string> = {
          plateFact: 'Plate Factory', sphereFact: 'Sphere Factory',
          tesseractFact: 'Tesseract Factory', powerPlant: 'Power Plant', blank: 'Blank',
        };
        const top5 = stack.pieces.slice(0, 5);
        top5.forEach((piece, idx) => {
          this.addBtn(
            `${idx + 1}. ${PIECE_NAMES[piece.type] ?? piece.type}`,
            () => { ps.pendingCardTarget2 = String(idx); this.requestRender?.(); },
          );
        });
      } else if (ps.selectedCoord === null) {
        // Step 3: choose placement hex
        const si = parseInt(ps.pendingCardTarget) as 0 | 1 | 2;
        const pi = parseInt(ps.pendingCardTarget2);
        const piece = state.stacks[si].pieces[pi];
        const PIECE_NAMES: Record<string, string> = {
          plateFact: 'Plate Factory', sphereFact: 'Sphere Factory',
          tesseractFact: 'Tesseract Factory', powerPlant: 'Power Plant', blank: 'Blank',
        };
        this.addHint(`Step 3: click a highlighted hex to place ${PIECE_NAMES[piece?.type ?? ''] ?? 'piece'}`);
        if (piece?.type !== 'blank') {
          this.addHint(`Rotation: ${ps.ghostRotation} — use rotation buttons in stack area`);
        }
      } else {
        // Step 4: confirm placement
        const si = parseInt(ps.pendingCardTarget) as 0 | 1 | 2;
        const pi = parseInt(ps.pendingCardTarget2);
        const matchingPlay = legal.find(a =>
          a.type === 'PLAY_CARD' &&
          (a as Action & { type: 'PLAY_CARD' }).cardType === 'scoutingDrone' &&
          (a as Action & { type: 'PLAY_CARD' }).stackIndex === si &&
          (a as Action & { type: 'PLAY_CARD' }).pieceIndex === pi,
        ) as (Action & { type: 'PLAY_CARD' }) | undefined;

        if (matchingPlay) {
          const finalAction = { ...matchingPlay, coord: ps.selectedCoord!, rotation: ps.ghostRotation };
          this.addHint(`Place at (${ps.selectedCoord!.q}, ${ps.selectedCoord!.r}) rotation ${ps.ghostRotation}`);
          this.addBtn('✓ Place piece', () => this.onAction(finalAction), false, true);
        } else {
          this.addHint('That hex is not a valid placement — click another');
        }
      }

      this.addBtn('✕ Cancel drone', cancelDrone);
      this.addSectionLabel('──────────────────');
    }

    // ── Actions section ───────────────────────────────────────────────────────

    this.addSectionLabel('── Actions ──');

    if (types.has('END_ACTIONS')) {
      this.addBtn('✓ End Actions', () => this.onAction({ type: 'END_ACTIONS' }), false, true);
    }

    // Place Belt — route picker (findRoute): pick a source, then a destination input.
    if (ps.pendingActionType !== 'PLACE_BELT') {
      this.addBtn(
        `Place Belt route (${player.beltsRemaining} in supply)`,
        () => {
          ps.pendingActionType = 'PLACE_BELT'; ps.beltRouteSource = null; ps.beltRoutePrompt = null; ps.selectedCoord = null;
          this.requestRender?.(); // draw the candidate belt points immediately
        },
      );
    } else if (ps.beltRoutePrompt) {
      const pr = ps.beltRoutePrompt;
      this.addHint(`This route needs ${pr.cost} belt${pr.cost !== 1 ? 's' : ''}; you have ${pr.have}.`);
      if (pr.affordable) {
        this.addBtn(
          `Buy ${pr.need} belt${pr.need !== 1 ? 's' : ''} (${pr.need} ore) & place route`,
          () => this.onRouteCommit(true), false, true,
        );
      } else {
        this.addHint(`Not enough materials to buy ${pr.need} more belt${pr.need !== 1 ? 's' : ''}.`);
      }
      this.addBtn('✕ Cancel route', () => this.onRouteCommit(false));
    } else if (!ps.beltRouteSource) {
      this.addHint('Belt route — click a belt point (blue) next to a source or an input to start.');
      this.addBtn('✕ Cancel', () => this.onCancel());
    } else {
      this.addHint('Now click another belt point to route to it (hover to preview). Solid = belts you have, dashed = need to buy.');
      this.addBtn('✕ Cancel', () => this.onCancel());
    }

    // Remove Belt
    const removeBelts = legal.filter(a => a.type === 'REMOVE_BELT') as Array<Action & { type: 'REMOVE_BELT' }>;
    if (removeBelts.length > 0) {
      if (ps.pendingActionType !== 'REMOVE_BELT') {
        this.addBtn('Remove Belt — click a belt', () => { ps.pendingActionType = 'REMOVE_BELT'; this.requestRender?.(); });
      } else {
        this.addHint('Click a belt on the board to remove it');
        this.addBtn('✕ Cancel', () => this.onCancel());
      }
    }

    // Undo all belts placed this turn
    if (legal.some(a => a.type === 'UNDO_BELTS')) {
      const n = state.beltsPlacedThisTurn.length;
      const undoBtn = this.addBtn(
        `↩ Undo All Belt Placements (${n})`,
        () => this.onAction({ type: 'UNDO_BELTS' }),
      );
      undoBtn.style.background = '#c62828';
      undoBtn.style.color = '#fff';
    }

    // Production Increase upgrade budget (claims/upgrades only — never paid with materials)
    if (state.productionIncreaseBudget > 0) {
      this.addHint(`Production Increase: ${state.productionIncreaseBudget} upgrade(s) remaining`);
      const piClaims = (legal.filter(a => a.type === 'CLAIM_BUILDING' &&
        (a as Action & { type: 'CLAIM_BUILDING' }).fromProductionIncrease) as Array<Action & { type: 'CLAIM_BUILDING' }>);
      if (piClaims.length > 0) {
        if (ps.pendingActionType !== 'CLAIM_BUILDING') {
          this.addBtn('[PI] Claim Building — click a building', () => {
            ps.pendingActionType = 'CLAIM_BUILDING'; ps.claimFromFreeClaim = false;
            this.requestRender?.();
          });
        }
      }
      const piUpgrades = (legal.filter(a => a.type === 'UPGRADE_BUILDING' &&
        (a as Action & { type: 'UPGRADE_BUILDING' }).fromProductionIncrease) as Array<Action & { type: 'UPGRADE_BUILDING' }>);
      if (piUpgrades.length > 0) {
        this.addSectionLabel('[PI] Upgrade Building:');
        for (const u of piUpgrades) {
          const piece = state.board.find(p => p.id === u.pieceId);
          const lbl = piece ? (PIECE_DISPLAY[piece.type] ?? piece.type) : u.pieceId;
          this.addBtn(`  ${lbl}  ${u.oldModule} → ${u.newModule} [PI]`, () => this.onAction(u));
        }
      }
    }

    // Show claim-mode hint/cancel if active (could be triggered from Purchases section)
    if (ps.pendingActionType === 'CLAIM_BUILDING') {
      this.addHint('Click a building on the board to claim it');
      this.addBtn('✕ Cancel', () => this.onCancel());
    }

    // ── Exchange Materials ────────────────────────────────────────────────────

    const exchangeMats: Array<{ give: 'plate' | 'sphere' | 'tesseract'; label: string }> = [
      { give: 'tesseract', label: 'Break 1 Tesseract → 3 Spheres + 2 Ore' },
      { give: 'sphere',    label: 'Break 1 Sphere → 2 Plates + 1 Ore' },
      { give: 'plate',     label: 'Break 1 Plate → 3 Ore' },
    ];
    const exchangeAvail = exchangeMats.filter(e => player.inventory[e.give] > 0);
    if (exchangeAvail.length > 0) {
      this.addSectionLabel('── Exchange Materials ──');
      for (const { give, label } of exchangeAvail) {
        this.addBtn(label, () => this.onAction({ type: 'EXCHANGE_MATERIALS', give }));
      }
    }

    // ── Purchases section ─────────────────────────────────────────────────────

    this.addSectionLabel('── Purchases ──');

    // Buy Belt from bank (1 ore)
    const canBuyBelt = types.has('BUY_BELT');
    this.addBtn(
      `Buy Belt (${BELT_COST} ore → +1 supply)`,
      canBuyBelt ? () => this.onAction({ type: 'BUY_BELT' }) : () => {},
      false, false, !canBuyBelt,
    );

    // Buy Card
    if (state.cardDeck.length > 0) {
      const cardCostN = cardCost(state.mineCount);
      const canBuyCard = types.has('BUY_CARD');
      this.addBtn(
        `Buy Card (${cardCostN} ore · ${state.cardDeck.length} left)`,
        canBuyCard ? () => this.onAction({ type: 'BUY_CARD' }) : () => {},
        false, false, !canBuyCard,
      );
    }

    // Buy Mine
    if (state.unplacedMines.length > 0) {
      const mineCostIdx = 2 - state.unplacedMines.length;
      const mineCost = MINE_COSTS[mineCostIdx as 0 | 1] ?? '?';
      const canBuyMine = types.has('BUY_MINE');
      if (ps.pendingActionType === 'BUY_MINE') {
        if (ps.selectedCoord) {
          this.addSectionLabel(`Place mine at (${ps.selectedCoord.q}, ${ps.selectedCoord.r}):`);
          this.addRotationGrid(null,
            (r) => this.onAction({ type: 'BUY_MINE', coord: ps.selectedCoord!, rotation: r }),
            'mine', ps);
          this.addBtn('✕ Cancel', () => this.onCancel());
        } else {
          this.addHint('Click a highlighted hex to place the mine');
          this.addBtn('✕ Cancel', () => this.onCancel());
        }
      } else {
        this.addBtn(
          `Buy Mine (${mineCost} ore) — click to place`,
          canBuyMine ? () => { ps.pendingActionType = 'BUY_MINE'; this.requestRender?.(); } : () => {},
          false, false, !canBuyMine,
        );
      }
    }

    // Buy Teleporter
    if (player.teleportersRemaining > 0) {
      const tpCost = state.globalTeleporterCount + 1;
      const tps = legal.filter(a => a.type === 'PLACE_TELEPORTER') as Array<Action & { type: 'PLACE_TELEPORTER'; pieceId: string; bufferType: 'input' | 'output' }>;
      const canBuyTp = tps.length > 0;
      if (ps.pendingActionType === 'PLACE_TELEPORTER') {
        if (ps.tpPieceId === null) {
          this.addHint('Click a claimed building to place the teleporter');
          this.addBtn('✕ Cancel', () => this.onCancel());
        } else {
          const inputTp = tps.find(a => a.pieceId === ps.tpPieceId && a.bufferType === 'input');
          const outputTp = tps.find(a => a.pieceId === ps.tpPieceId && a.bufferType === 'output');
          const piece = state.board.find(p => p.id === ps.tpPieceId);
          const lbl = piece ? (PIECE_DISPLAY[piece.type] ?? piece.type) : ps.tpPieceId;
          this.addHint(`Teleporter on ${lbl}:`);
          if (inputTp) this.addBtn('Place on Input buffer', () => this.onAction(inputTp));
          if (outputTp) this.addBtn('Place on Output buffer', () => this.onAction(outputTp));
          this.addBtn('✕ Cancel', () => this.onCancel());
        }
      } else {
        this.addBtn(
          `Buy Teleporter (${tpCost} ore) — click a building`,
          canBuyTp ? () => { ps.pendingActionType = 'PLACE_TELEPORTER'; ps.tpPieceId = null; this.requestRender?.(); } : () => {},
          false, false, !canBuyTp,
        );
      }
    }

  }

  // ── placeMeeple ──────────────────────────────────────────────────────────────

  private renderPlaceMeeple(state: GameState, humanId: PlayerId): void {
    const player = state.players[humanId];
    if (player) {
      if (player.meepleOnPieceId === null) {
        this.addHint('Click an owned building or mine to place your meeple');
      } else {
        const piece = state.board.find(p => p.id === player.meepleOnPieceId);
        const pieceName = piece ? (PIECE_DISPLAY[piece.type] ?? piece.type) : '?';
        this.addHint(`Meeple on ${pieceName} — click elsewhere to move it`);
        this.addBtn('✓ End Turn', () => this.onAction({ type: 'END_TURN' }), false, true);
      }
    }
  }

  // ── roundEnd ─────────────────────────────────────────────────────────────────

  private renderRoundEnd(state: GameState, humanId: PlayerId, ps: PanelState): void {
    const player = state.players[humanId];
    if (!player) return;

    // Round-end turn is time-limited (multiplayer courtesy); it resets on each action, so
    // you're only auto-advanced if you go idle. Live countdown is in the #turn-timer banner.
    if (this.actionDeadline !== null) this.addHint('Your round-end turn auto-ends if you go idle.');

    const legal = legalActions(state, humanId);
    type UpgradeAction = Action & { type: 'UPGRADE_BUILDING'; fromMineCredit?: boolean };
    const upgrades = legal.filter(a => a.type === 'UPGRADE_BUILDING') as UpgradeAction[];
    const mineUpgrades = upgrades.filter(u => u.fromMineCredit);
    const regularUpgrades = upgrades.filter(u => !u.fromMineCredit);

    if (player.freeActionCredits > 0) {
      this.addSectionLabel(`Mine credits: ${player.freeActionCredits}`);
      if (!player.freeClaimUsed) {
        if (ps.pendingActionType !== 'CLAIM_BUILDING') {
          this.addBtn('Free Claim Building — click a building', () => {
            ps.pendingActionType = 'CLAIM_BUILDING';
            ps.claimFromFreeClaim = true;
            this.requestRender?.();
          });
        } else {
          this.addHint('Click a building on the board to claim it for free');
          this.addBtn('✕ Cancel', () => this.onCancel());
        }
      }
      if (mineUpgrades.length > 0) {
        this.addSectionLabel('Upgrade with mine credits:');
        for (const u of mineUpgrades) {
          const piece = state.board.find(p => p.id === u.pieceId);
          const lbl = piece ? (PIECE_DISPLAY[piece.type] ?? piece.type) : u.pieceId;
          const cost = u.newModule - u.oldModule;
          this.addBtn(`  ${lbl}  ${u.oldModule} → ${u.newModule} (${cost} credit${cost !== 1 ? 's' : ''})`, () => this.onAction(u));
        }
      }
    }

    if (player.freeUpgradesRemaining > 0) {
      this.addHint(`Free upgrade${player.freeUpgradesRemaining > 1 ? 's' : ''}: ${player.freeUpgradesRemaining} (must go to same building)`);
      if (regularUpgrades.length > 0) {
        this.addSectionLabel('Apply free upgrade:');
        for (const u of regularUpgrades) {
          const piece = state.board.find(p => p.id === u.pieceId);
          const lbl = piece ? (PIECE_DISPLAY[piece.type] ?? piece.type) : u.pieceId;
          this.addBtn(`  ${lbl}  ${u.oldModule} → ${u.newModule} (free)`, () => this.onAction(u));
        }
      } else {
        this.addHint('No eligible buildings to upgrade');
      }
    } else {
      this.addHint('No free upgrades this round');
    }

    // Building meeple: load input + operate
    if (player.meepleOnPieceId !== null && player.meepleSlotIndex === null) {
      const piece = state.board.find(p => p.id === player.meepleOnPieceId);
      if (piece && piece.type !== 'mine' && piece.type !== 'blank') {
        const pieceLbl = PIECE_DISPLAY[piece.type] ?? piece.type;
        this.addSectionLabel(`── ${pieceLbl} (meeple) ──`);

        const SLOT_LABELS: Record<string, string> = { ore: 'Ore', plate: 'Plate', sphere: 'Sphere', tesseract: 'Tesseract' };

        // Show current input buffer status
        if (piece.input) {
          const slots = piece.input.slots
            .map((m, i) => m ? `Slot ${i + 1}: ${SLOT_LABELS[m] ?? m}` : `Slot ${i + 1}: empty`)
            .join(' | ');
          this.addHint(`Input buffer: ${slots}`);
        }

        // Show current output buffer status + collect button (output stays in the
        // building until you collect it here, or it flows to a connected input).
        if (piece.output) {
          const outSlots = piece.output.slots
            .map((m, i) => m ? `Slot ${i + 1}: ${SLOT_LABELS[m] ?? m}` : `Slot ${i + 1}: empty`)
            .join(' | ');
          this.addHint(`Output buffer: ${outSlots}`);

          const collectable = piece.output.slots.some(
            s => s !== null && (player.inventory[s] ?? 0) < 6,
          );
          const hasAny = piece.output.slots.some(s => s !== null);
          if (hasAny) {
            const btn = this.addBtn(
              collectable ? '⬇ Collect output → inventory' : '⬇ Collect output (inventory full)',
              () => this.onAction({ type: 'COLLECT_OUTPUT', pieceId: piece.id }),
              false, collectable, !collectable,
            );
            if (!collectable) btn.title = 'Your inventory is full for that material';
          }
        }

        // Load actions — offer only materials that keep a valid recipe reachable
        // (canLoadMaterial, the shared recipe table), disabled if the player lacks them.
        if (piece.input && piece.input.slots.some(s => s === null)) {
          const MATS = ['ore', 'plate', 'sphere', 'tesseract'] as const;
          for (const mat of MATS) {
            if (!canLoadMaterial(piece.type, piece.input.slots, mat)) continue;
            const hasIt = player.inventory[mat] > 0;
            const btn = this.addBtn(
              `  Load ${mat}${hasIt ? '' : ' (need more in inventory)'}`,
              () => this.onAction({ type: 'LOAD_BUILDING_INPUT', pieceId: piece.id, material: mat }),
              false, false, !hasIt,
            );
            if (!hasIt) btn.title = `You have no ${mat} in inventory`;
          }
        }

        // A building may be operated at most ONCE per round end. After that, only
        // loading inputs (to leave it primed for next round) remains available.
        if (player.meepleOperatedThisRound) {
          this.addHint('✓ Operated this round — you may still load inputs for next round.');
        } else if (piece.type !== 'powerPlant') {
          // Operate button — always show with cost; disabled with reason if blocked
          const powerCost = factoryOperatePowerCost(piece);
          const canOp = factoryCanOperate(piece, player);
          const expectedProduct = factoryExpectedProduct(piece);
          const allInputsReady = piece.input ? piece.input.slots.every(s => s !== null) : false;

          let opLabel: string;
          let opDisabled = false;
          let opReason = '';

          if (!allInputsReady) {
            opLabel = `⚙ Operate ${pieceLbl} — load inputs first`;
            opDisabled = true;
            opReason = 'All input slots must be filled before operating';
          } else if (!expectedProduct) {
            opLabel = `⚙ Operate ${pieceLbl} — invalid recipe`;
            opDisabled = true;
            opReason = 'Current inputs do not form a valid recipe for this factory';
          } else if (!canOp) {
            opLabel = `⚙ Operate ${pieceLbl} — need ${powerCost} 🔋 (have ${player.powerTokens})`;
            opDisabled = true;
            opReason = `Need ${powerCost} power tokens; you only have ${player.powerTokens}`;
          } else {
            opLabel = `⚙ Operate ${pieceLbl} — pay ${powerCost} 🔋 → ${expectedProduct} to output buffer`;
          }

          const opBtn = this.addBtn(
            opLabel,
            () => this.onAction({ type: 'OPERATE_BUILDING', pieceId: piece.id }),
            false, !opDisabled, opDisabled,
          );
          if (opReason) opBtn.title = opReason;
        } else {
          // Power plant
          const canOp = factoryCanOperate(piece, player);
          const opBtn = this.addBtn(
            `⚙ Operate ${pieceLbl}`,
            () => this.onAction({ type: 'OPERATE_BUILDING', pieceId: piece.id }),
            false, canOp, !canOp,
          );
          if (!canOp) opBtn.title = 'Power token cap reached';
        }
      }
    }

    // Exchange materials
    const roundEndExchangeMats: Array<{ give: 'plate' | 'sphere' | 'tesseract'; label: string }> = [
      { give: 'tesseract', label: 'Break 1 Tesseract → 3 Spheres + 2 Ore' },
      { give: 'sphere',    label: 'Break 1 Sphere → 2 Plates + 1 Ore' },
      { give: 'plate',     label: 'Break 1 Plate → 3 Ore' },
    ];
    const reAvail = roundEndExchangeMats.filter(e => player.inventory[e.give] > 0);
    if (reAvail.length > 0) {
      this.addSectionLabel('── Exchange Materials ──');
      for (const { give, label } of reAvail) {
        this.addBtn(label, () => this.onAction({ type: 'EXCHANGE_MATERIALS', give }));
      }
    }

    this.addBtn('✓ Done', () => this.onAction({ type: 'END_ACTIONS' }), false, true);
  }

  // ── Card hand section ─────────────────────────────────────────────────────────

  private renderCardHand(state: GameState, humanId: PlayerId, ps: PanelState): void {
    this.cardEl.innerHTML = '';
    const player = state.players[humanId];
    if (!player || player.hand.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'card-empty';
      empty.textContent = 'No cards in hand';
      this.cardEl.appendChild(empty);
      return;
    }

    const isActionPhase = state.turnOrder[state.activePlayerIndex] === humanId
      && state.phase === 'actions'
      && state.cardsPlayedThisTurn < 2;

    const legal = isActionPhase ? legalActions(state, humanId) : [];
    const cardPlays = legal.filter(a => a.type === 'PLAY_CARD') as Array<Action & { type: 'PLAY_CARD' }>;

    // Show each unique card (group duplicates)
    const seen = new Map<string, number>();
    for (const c of player.hand) seen.set(c, (seen.get(c) ?? 0) + 1);

    for (const [cardType, count] of seen) {
      const info = CARD_INFO[cardType as keyof typeof CARD_INFO];
      const entry = document.createElement('div');
      entry.className = 'card-entry';

      const header = document.createElement('div');
      header.className = 'card-header';
      const title = document.createElement('span');
      title.className = 'card-title';
      title.textContent = (info?.title ?? cardType) + (count > 1 ? ` ×${count}` : '');
      header.appendChild(title);
      if (info?.playOnDraw) {
        const badge = document.createElement('span');
        badge.className = 'pod-badge';
        badge.textContent = 'PLAY ON DRAW';
        header.appendChild(badge);
      }
      entry.appendChild(header);

      const desc = document.createElement('div');
      desc.className = 'card-desc';
      desc.textContent = info?.description ?? '(no description)';
      entry.appendChild(desc);

      // Play buttons (if legal)
      const playsForCard = cardPlays.filter(a => a.cardType === cardType);
      if (playsForCard.length > 0) {
        const actArea = document.createElement('div');
        actArea.className = 'card-play-area';

        if (BOARD_PIECE_CARDS.has(cardType)) {
          // Board-piece selection flow: one "Play" button → click piece on board
          const btn = document.createElement('button');
          btn.className = 'action-btn primary';
          if (ps.pendingCardType === cardType) {
            btn.textContent = 'Playing… (cancel in Actions panel)';
            btn.disabled = true;
            btn.style.opacity = '0.7';
          } else {
            btn.textContent = 'Play';
            btn.addEventListener('click', () => {
              ps.pendingCardType = cardType;
              ps.pendingCardTarget = null;
              ps.pendingCardTarget2 = null;
              this.requestRender?.();
            });
          }
          actArea.appendChild(btn);
        } else if (cardType === 'scoutingDrone') {
          // Multi-step drone flow: initiate via panel, show "Playing…" here
          const btn = document.createElement('button');
          btn.className = 'action-btn primary';
          if (ps.pendingCardType === 'scoutingDrone') {
            btn.textContent = 'Playing… (see Actions panel)';
            btn.disabled = true;
            btn.style.opacity = '0.7';
          } else {
            btn.textContent = 'Play';
            btn.addEventListener('click', () => {
              ps.pendingCardType = 'scoutingDrone';
              ps.pendingCardTarget = null;
              ps.pendingCardTarget2 = null;
              ps.selectedCoord = null;
              this.requestRender?.();
            });
          }
          actArea.appendChild(btn);
        } else if (playsForCard.length === 1 && !playsForCard[0]!.pieceId && !playsForCard[0]!.stackIndex) {
          const btn = document.createElement('button');
          btn.className = 'action-btn';
          btn.textContent = 'Play';
          btn.addEventListener('click', () => this.onAction(playsForCard[0]!));
          actArea.appendChild(btn);
        } else {
          for (const ca of playsForCard) {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.textContent = 'Play: ' + buildCardLabel(ca);
            btn.addEventListener('click', () => this.onAction(ca));
            actArea.appendChild(btn);
          }
        }
        entry.appendChild(actArea);
      }

      this.cardEl.appendChild(entry);
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private addBtn(label: string, onClick: () => void, _cancel = false, primary = false, disabled = false): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `action-btn${primary ? ' primary' : ''}${disabled ? ' disabled' : ''}`;
    btn.textContent = label;
    if (disabled) {
      btn.disabled = true;
      btn.style.opacity = '0.45';
      btn.style.cursor = 'not-allowed';
    } else {
      btn.addEventListener('click', onClick);
    }
    this.btnsEl.appendChild(btn);
    return btn;
  }

  private addHint(text: string): void {
    const el = document.createElement('div');
    el.className = 'panel-hint';
    el.textContent = text;
    this.btnsEl.appendChild(el);
  }

  // ── Log ──────────────────────────────────────────────────────────────────────

  private renderLog(log: readonly string[]): void {
    this.logEl.innerHTML = log.slice(-160)
      .map(e => `<div class="log-entry">${escapeHtml(e)}</div>`)
      .join('');
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }
}

// Short descriptions for play-on-draw card notices (Change 2)
const CARD_DESCRIPTIONS: Partial<Record<string, string>> = {
  mineInspection:    'Gained 1 plate per mine in play.',
  solarFlare:        'All players gained 2 power tokens.',
  overstockSupplies: 'Drew 3 board pieces to place.',
};

const PIECE_DISPLAY: Partial<Record<string, string>> = {
  blank:         'Blank',
  mine:          'Mine',
  plateFact:     'Plate Factory',
  sphereFact:    'Sphere Factory',
  tesseractFact: 'Tesseract Factory',
  powerPlant:    'Power Plant',
};

function ptLabel(pos: number): string {
  const edges = ['L', 'UL', 'UR', 'R', 'LR', 'LL'] as const;
  return (edges[Math.floor(pos / 2) % 6] ?? '?') + (pos % 2 === 0 ? 'a' : 'b');
}

function buildCardLabel(a: Action & { type: 'PLAY_CARD' }): string {
  if (a.pieceId && a.toPieceId) return `${a.pieceId}→${a.toPieceId} mod${a.controlModule ?? '?'}`;
  if (a.pieceId && a.bufferType) return `${a.pieceId} ${a.bufferType}`;
  if (a.pieceId) return a.pieceId;
  if (a.stackIndex !== undefined) return `stack ${a.stackIndex + 1}`;
  return '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// What operating this factory will cost its owner: power tokens + the exact materials
// consumed (from the input buffer, or completed from inventory via an input teleporter),
// and the product. Returns null if it can't currently operate. Used to label the
// operate button clearly so a player knows what a roll will spend.
function operateConsumption(
  piece: { type: PieceType; input: { slots: ReadonlyArray<Material | null>; teleporterOwner: PlayerId | null } | null; output: unknown },
  player: { id: PlayerId; inventory: Readonly<Record<Material, number>> },
): { power: number; consumed: Material[]; product: Material } | null {
  if (!piece.input || !piece.output) return null;
  let slots: ReadonlyArray<Material | null> = piece.input.slots;
  if (slots.some(s => s === null)) {
    if (piece.input.teleporterOwner === player.id) {
      const c = findInputCompletion(piece.type, slots, player.inventory);
      if (!c) return null;
      slots = c.newSlots;
    } else {
      return null;
    }
  }
  const filled = { ...piece, input: { ...piece.input, slots } } as Parameters<typeof factoryExpectedProduct>[0];
  const product = factoryExpectedProduct(filled);
  if (!product) return null;
  const consumed = slots.filter((s): s is Material => s !== null);
  const power = product === 'ore' ? 0 : FACTORY_POWER_COST[product];
  return { power, consumed, product };
}

// All Control Modules 1..CONTROL_MODULE_MAX in order (3 rows of 6). Modules still in the
// player's tray (available to play) show bright; modules already placed on a building
// (in play) show dark grey — so it's obvious at a glance which numbers are used vs left.
function controlModuleGrid(available: ReadonlyArray<number>): string {
  const avail = new Set(available);
  const cells: string[] = [];
  for (let n = 1; n <= CONTROL_MODULE_MAX; n++) {
    const used = !avail.has(n);
    // <div> (not <span>): a trailing <span> would match `.stat-row span:last-child`
    // and get right-aligned, so the "18" cell would sit off-centre.
    cells.push(`<div class="cm-cell${used ? ' used' : ''}">${n}</div>`);
  }
  return `<div class="cm-grid">${cells.join('')}</div>`;
}
