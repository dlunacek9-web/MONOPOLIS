import type { GroupId } from '../core';

/** Barvy hráčů a měst sdílí 3D scéna, 2D deska i panely rozhraní. */
export const PLAYER_COLORS = ['#e6195f', '#0a84d6', '#e08a00', '#17a34a'];

export const GROUP_COLORS: Record<GroupId, { bg: string; ink: string }> = {
  most: { bg: '#7a4a2b', ink: '#fff' },
  ostrava: { bg: '#8fd8f5', ink: '#10202b' },
  usti: { bg: '#d9379f', ink: '#fff' },
  olomouc: { bg: '#f28c28', ink: '#1d1205' },
  plzen: { bg: '#d92b2b', ink: '#fff' },
  brno: { bg: '#f7d531', ink: '#201b02' },
  vary: { bg: '#1f9d55', ink: '#fff' },
  praha: { bg: '#2347c5', ink: '#fff' },
};

/** Celá atmosféra scény. Noční varianta by byla jen další sada těchto hodnot. */
export const PALETTE = {
  skyTop: '#d9a878',
  skyBottom: '#f1dcb6',
  fog: '#ecd3a8',
  cloud: '#f6e7c8',
  hemiSky: '#fff1d6',
  hemiGround: '#8f6f55',
  sun: '#ffdcae',
  grass: '#b3a766',
  grassDark: '#98904f',
  dryGrass: '#d8b56a',
  rock: ['#8d7158', '#73594a', '#5c493e'],
  road: '#5a5350',
  roadLine: '#efe3c8',
  curb: '#cdb9a0',
  pavement: '#b9a68f',
  lot: '#a89c62',
  lotMortgaged: '#6f675e',
  brick: ['#8a6a58', '#a2694f', '#77685f', '#94826a'],
  roof: '#b4a08f',
  concrete: '#b5ada2',
  darkMetal: '#3b3a45',
  wood: '#7a5a42',
  freight: '#9c4630',
  leaf: '#55663f',
  windowDark: '#37363f',
  windowLit: '#fff0bd',
  neon: ['#2ee6b6', '#ff4f8b', '#ffd24a', '#6fb7ff'],
  plaque: '#f6ecd8',
  plaqueMortgaged: '#a79f92',
  plaqueText: '#2a211c',
  white: '#ffffff',
  police: '#3d7bff',
  policeRed: '#ff3b3b',
  highlightCurrent: '#ffffff',
  highlightFocus: '#ff3d7f',
  highlightBuild: '#ffc400',
};
