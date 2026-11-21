import type { PieceType, Material } from '../../engine/config';

export const PLAYER_COLORS: Record<number, string> = {
  0: '#e74c3c', // red
  1: '#3498db', // blue
  2: '#2ecc71', // green
  3: '#9b59b6', // purple
};

export const PLAYER_NAMES: Record<number, string> = {
  0: 'Player 1',
  1: 'Player 2',
  2: 'Player 3',
  3: 'Player 4',
};

export const PIECE_FILL: Record<PieceType, string> = {
  blank:         '#3a3a4a',
  mine:          '#6d4c41',
  plateFact:     '#1565c0',
  sphereFact:    '#2e7d32',
  tesseractFact: '#827717',
  powerPlant:    '#bf360c',
};

export const PIECE_STROKE: Record<PieceType, string> = {
  blank:         '#555568',
  mine:          '#a1887f',
  plateFact:     '#42a5f5',
  sphereFact:    '#66bb6a',
  tesseractFact: '#ffee58',
  powerPlant:    '#ff7043',
};

export const PIECE_LABEL: Record<PieceType, string> = {
  blank:         '·',
  mine:          'M',
  plateFact:     'PL',
  sphereFact:    'SP',
  tesseractFact: 'TS',
  powerPlant:    'PP',
};

export const MATERIAL_FILL: Record<Material, string> = {
  ore:       '#9e9e9e',
  plate:     '#78909c',
  sphere:    '#b2dfdb',
  tesseract: '#fff176',
};
