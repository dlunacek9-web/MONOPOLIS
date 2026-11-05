import { Group } from 'three';
import { box, group } from '../render/models';

const SKIN = '#e8b48c';

export interface Figure {
  root: Group;
  legs: [Group, Group];
  arms: [Group, Group];
  phase: number;
}

function limb(color: string, x: number, y: number, length: number, width: number): Group {
  const pivot = new Group();
  pivot.position.set(x, y, 0);
  pivot.add(box(width, length, width, color, 0, -length, 0));
  return pivot;
}

/** Postavička s přehnanou hlavou. Rameno a nohy se kývají kolem kloubů. */
export function figure(body: string, cap: string): Figure {
  const legs: [Group, Group] = [
    limb(body, -0.22, 0.8, 0.8, 0.28),
    limb(body, 0.22, 0.8, 0.8, 0.28),
  ];
  const arms: [Group, Group] = [
    limb(body, -0.5, 1.6, 0.72, 0.22),
    limb(body, 0.5, 1.6, 0.72, 0.22),
  ];
  const root = group(
    ...legs,
    ...arms,
    box(0.8, 0.85, 0.5, body, 0, 0.8, 0),
    box(0.62, 0.56, 0.6, SKIN, 0, 1.65, 0),
    box(0.72, 0.2, 0.7, cap, 0, 2.2, 0),
    box(0.42, 0.08, 0.26, cap, 0, 2.2, 0.42),
  );
  return { root, legs, arms, phase: 0 };
}
