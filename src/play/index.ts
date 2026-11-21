// Play controller: the DOM-free brain of the game screen. The 3D table and the HTML interface
// render `PlayController.view` and forward taps to it; every action it sends comes from the
// engine's legalActions for the current state (plus the dice roll, which the host fills in).
//
// Item ids accepted by choose():
//   bank:placeBelt | bank:buyBelt | bank:undoBelts | bank:buyCard | bank:buyMine | bank:teleporter | bank:exchange
//   card:<cardType>                     a card in view.hand
//   module:<n>                          a lit Control Module in view.tray
//   menu:...                            an item of view.menu
//   op:<pieceId>:run | op:<pieceId>:skip  an option of a prompt in view.prompts
//   anything else listed in view.choices

export { PlayController, targetKey } from './controller';
export type { PlayControllerOptions } from './controller';
export type { Item, PlayView, Prompt, Selection, TrayEntry } from './types';
