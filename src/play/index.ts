// Play controller: the DOM-free brain of the game screen. The 3D table and the HTML interface
// render `PlayController.view` and forward taps to it; every action it sends comes from the
// engine's legalActions for the current state (plus the dice roll, which the host fills in).
//
// Item ids accepted by choose():
//   bank:placeBelt | bank:removeBelt | bank:buyBelt | bank:undoBelts | bank:buyCard | bank:buyMine | bank:teleporter | bank:exchange
//   inv:plate | inv:sphere | inv:tesseract   a material in view.inventory (offers to break it down)
//   route:own | route:buy | route:cancel | route:continue   a planned belt route (view.route)
//   card:<cardType>                     a card in view.hand
//   module:<n>                          a lit Control Module in view.tray
//   menu:...                            an item of view.menu
//   op:<pieceId>:run | op:<pieceId>:skip  an option of a prompt in view.prompts
//   anything else listed in view.choices

export { PlayController, targetKey } from './controller';
export type { PlayControllerOptions } from './controller';
export type { Item, PlayView, Prompt, Selection, SupplyView, TrayEntry } from './types';
export { turnQueue } from './queue';
export type { QueueItem, TurnQueue, ChipStatus } from './queue';
export type { RouteSeg, Seg, Tier } from './route';
