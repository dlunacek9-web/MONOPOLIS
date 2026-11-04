import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three';
import type { BufferGeometry, Material, Object3D } from 'three';
import { HOTEL_LEVEL } from '../core';
import { PALETTE } from './palette';
import { facadeTextures, neonTexture, seededRandom } from './textures';
import type { Facade } from './textures';
import type { Rect } from './layout';

const solids = new Map<string, MeshLambertMaterial>();
const glows = new Map<string, MeshBasicMaterial>();

export function solid(color: string): MeshLambertMaterial {
  let material = solids.get(color);
  if (!material) {
    material = new MeshLambertMaterial({ color, flatShading: true });
    solids.set(color, material);
  }
  return material;
}

/** Materiál, který svítí sám a nereaguje na stín. */
export function glow(color: string): MeshBasicMaterial {
  let material = glows.get(color);
  if (!material) {
    material = new MeshBasicMaterial({ color });
    glows.set(color, material);
  }
  return material;
}

function shaded<T extends Mesh>(mesh: T): T {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function place<T extends Object3D>(object: T, x: number, y: number, z: number): T {
  object.position.set(x, y, z);
  return object;
}

/** Kvádr stojící spodkem na `y`. */
export function box(
  w: number,
  h: number,
  d: number,
  material: Material | string,
  x = 0,
  y = 0,
  z = 0,
): Mesh {
  const paint = typeof material === 'string' ? solid(material) : material;
  return place(shaded(new Mesh(new BoxGeometry(w, h, d), paint)), x, y + h / 2, z);
}

export function cylinder(
  rTop: number,
  rBottom: number,
  h: number,
  material: Material | string,
  x = 0,
  y = 0,
  z = 0,
  segments = 8,
): Mesh {
  const paint = typeof material === 'string' ? solid(material) : material;
  const geometry = new CylinderGeometry(rTop, rBottom, h, segments);
  return place(shaded(new Mesh(geometry, paint)), x, y + h / 2, z);
}

export function cone(
  radius: number,
  h: number,
  material: Material | string,
  x = 0,
  y = 0,
  z = 0,
  segments = 6,
): Mesh {
  const paint = typeof material === 'string' ? solid(material) : material;
  const geometry = new ConeGeometry(radius, h, segments);
  return place(shaded(new Mesh(geometry, paint)), x, y + h / 2, z);
}

export function group(...children: Object3D[]): Group {
  const result = new Group();
  if (children.length) result.add(...children);
  return result;
}

const facades = new Map<number, Facade>();

function facadeOf(variant: number): Facade {
  const index = variant % PALETTE.brick.length;
  let facade = facades.get(index);
  if (!facade) {
    facade = facadeTextures(PALETTE.brick[index]!, 97 + index * 31);
    facades.set(index, facade);
  }
  return facade;
}

/** Činžák s okny v jednotném měřítku bez ohledu na rozměry. */
export function tenement(w: number, h: number, d: number, variant: number): Group {
  const facade = facadeOf(variant);
  const wall = new MeshLambertMaterial({
    map: facade.map,
    emissiveMap: facade.glow,
    emissive: '#ffffff',
    emissiveIntensity: 1,
  });
  const geometry = new BoxGeometry(w, h, d);
  const uv = geometry.getAttribute('uv');
  const windowPitch = 0.62;
  const vScale = Math.max(1, Math.round(h / windowPitch)) / 4;
  // Pořadí stěn v BoxGeometry: +x, -x, +y, -y, +z, -z, každá má čtyři vrcholy.
  [d, d, 0, 0, w, w].forEach((span, face) => {
    const uScale = Math.max(1, Math.round(span / windowPitch)) / 4;
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
    }
  });
  const roof = solid(PALETTE.roof);
  const body = shaded(new Mesh(geometry, [wall, wall, roof, roof, wall, wall]));
  body.position.y = h / 2;
  const cap = box(w + 0.1, 0.1, d + 0.1, PALETTE.roof, 0, h, 0);
  return group(body, cap);
}

export function pine(scale = 1): Group {
  return group(
    cylinder(0.05 * scale, 0.08 * scale, 0.35 * scale, PALETTE.wood),
    cone(0.42 * scale, 0.8 * scale, PALETTE.leaf, 0, 0.3 * scale, 0),
    cone(0.32 * scale, 0.7 * scale, PALETTE.leaf, 0, 0.75 * scale, 0),
  );
}

export function neonSign(
  text: string,
  color: string,
  height: number,
): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const { map, aspect } = neonTexture(text, color);
  const material = new MeshBasicMaterial({
    map,
    transparent: true,
    side: DoubleSide,
    depthWrite: false,
    fog: false,
  });
  return new Mesh(new PlaneGeometry(height * aspect, height), material);
}

function house(color: string, x: number, z: number, scale: number): Group {
  const base = box(0.42 * scale, 0.36 * scale, 0.42 * scale, PALETTE.plaque, x, 0, z);
  const roof = cone(0.38 * scale, 0.3 * scale, color, x, 0.36 * scale, z, 4);
  roof.rotation.y = Math.PI / 4;
  const door = box(0.1 * scale, 0.18 * scale, 0.02, PALETTE.darkMetal, x, 0, z + 0.22 * scale);
  return group(base, roof, door);
}

/** Domy a hotel na parcele. Domy mají střechu v barvě města. */
export function buildingsFor(level: number, rect: Rect, color: string, tile: number): Group {
  const result = group();
  result.position.set(rect.x, 0.12, rect.z);
  if (level === 0) return result;
  if (level === HOTEL_LEVEL) {
    const body = tenement(rect.w * 0.82, 2, rect.d * 0.8, tile);
    const stripe = box(rect.w * 0.84, 0.1, rect.d * 0.82, glow(color), 0, 1.72, 0);
    result.add(body, stripe);
    return result;
  }
  const horizontal = rect.w >= rect.d;
  const span = horizontal ? rect.w : rect.d;
  const pitch = span / level;
  for (let i = 0; i < level; i++) {
    const offset = -span / 2 + pitch * (i + 0.5);
    result.add(horizontal ? house(color, offset, 0, 1.2) : house(color, 0, offset, 1.2));
  }
  return result;
}

export function ownerFlag(color: string): Group {
  return group(
    cylinder(0.025, 0.03, 0.9, PALETTE.white),
    box(0.42, 0.26, 0.03, color, 0.22, 0.62, 0),
  );
}

export function forSaleSign(): Group {
  return group(
    box(0.05, 0.42, 0.05, PALETTE.wood),
    box(0.44, 0.24, 0.04, PALETTE.plaque, 0, 0.36, 0),
  );
}

/* Stavby na políčkách, která nejsou běžný pozemek. Střed stojí na (0, 0). */

export function stationModel(rect: Rect): Group {
  const horizontal = rect.w >= rect.d;
  const long = Math.max(rect.w, rect.d);
  const wagon = group(
    box(long * 0.8, 0.46, 0.46, PALETTE.freight, 0, 0.16, 0),
    box(long * 0.82, 0.05, 0.5, PALETTE.darkMetal, 0, 0.62, 0),
    box(long * 0.8, 0.14, 0.38, PALETTE.darkMetal),
    box(long * 0.2, 0.3, 0.02, PALETTE.windowDark, 0, 0.22, 0.24),
  );
  wagon.position.z = 0.12;
  const platform = box(long * 0.92, 0.08, 0.9, PALETTE.concrete);
  const result = group(platform, wagon);
  if (!horizontal) result.rotation.y = Math.PI / 2;
  return result;
}

export function airportModel(rect: Rect): Group {
  const horizontal = rect.w >= rect.d;
  const fuselage = cylinder(0.11, 0.11, 0.95, PALETTE.white, 0, -0.48, 0);
  fuselage.rotation.x = Math.PI / 2;
  fuselage.position.set(0, 0.28, 0.1);
  const wings = box(1, 0.04, 0.24, PALETTE.white, 0, 0.26, 0.05);
  const tail = box(0.03, 0.22, 0.2, PALETTE.freight, 0, 0.32, -0.3);
  const plane = group(fuselage, wings, tail);
  plane.rotation.y = 0.5;
  plane.position.x = -0.15;
  const tower = group(
    cylinder(0.08, 0.1, 1.1, PALETTE.concrete),
    cylinder(0.2, 0.14, 0.2, glow(PALETTE.windowLit), 0, 1.1, 0),
    cylinder(0.22, 0.22, 0.04, PALETTE.darkMetal, 0, 1.3, 0),
  );
  tower.position.set(horizontal ? 0.75 : 0.4, 0, horizontal ? 0 : -0.35);
  return group(box(rect.w * 0.9, 0.04, rect.d * 0.9, PALETTE.road), plane, tower);
}

export function powerPlantModel(): Group {
  const tower = (x: number, z: number, h: number) =>
    group(
      cylinder(0.26, 0.38, h, PALETTE.concrete, x, 0, z, 10),
      cylinder(0.2, 0.2, 0.02, PALETTE.darkMetal, x, h, z, 10),
    );
  return group(tower(-0.3, 0, 1.15), tower(0.38, 0.05, 0.9));
}

export function waterTowerModel(): Group {
  const leg = (x: number, z: number) => box(0.05, 0.85, 0.05, PALETTE.darkMetal, x, 0, z);
  return group(
    leg(-0.22, -0.22),
    leg(0.22, -0.22),
    leg(-0.22, 0.22),
    leg(0.22, 0.22),
    cylinder(0.36, 0.36, 0.42, PALETTE.neon[3]!, 0, 0.85, 0, 10),
    cone(0.38, 0.18, PALETTE.darkMetal, 0, 1.27, 0, 10),
  );
}

/** Úřad se sloupy: finanční úřad a daně. */
export function officeModel(): Group {
  const result = group(
    box(1.25, 0.08, 0.8, PALETTE.concrete),
    box(1.05, 0.56, 0.5, PALETTE.brick[3]!, 0, 0.08, -0.1),
    box(1.2, 0.1, 0.72, PALETTE.concrete, 0, 0.64, 0),
  );
  for (const x of [-0.45, -0.15, 0.15, 0.45]) {
    result.add(cylinder(0.04, 0.04, 0.56, PALETTE.plaque, x, 0.08, 0.26, 6));
  }
  const roof = cone(0.72, 0.22, PALETTE.roof, 0, 0.74, 0, 4);
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.6;
  result.add(roof);
  return result;
}

/** Stánek, kde se dají potkat kámoši a jejich tipy. */
export function kioskModel(sign: string): Group {
  const neon = neonSign(sign, PALETTE.neon[1]!, 0.26);
  neon.position.set(0, 0.92, 0.32);
  return group(
    box(1, 0.55, 0.6, PALETTE.brick[1]!),
    box(0.82, 0.24, 0.02, glow(PALETTE.windowLit), 0, 0.2, 0.31),
    box(1.14, 0.06, 0.82, PALETTE.neon[0]!, 0, 0.55, 0.08),
    neon,
  );
}

export function startModel(banner: string): Group {
  const sign = neonSign(banner, PALETTE.neon[0]!, 0.7);
  sign.position.set(0, 1.42, 0.05);
  const stack = (x: number, z: number, h: number) => box(0.3, h, 0.2, '#6db66a', x, 0.08, z);
  return group(
    box(0.14, 1.7, 0.14, PALETTE.darkMetal, -1.45, 0, 0),
    box(0.14, 1.7, 0.14, PALETTE.darkMetal, 1.45, 0, 0),
    box(3.04, 0.12, 0.14, PALETTE.darkMetal, 0, 1.7, 0),
    sign,
    stack(-0.7, -0.1, 0.34),
    stack(-0.35, -0.2, 0.2),
    stack(0.7, -0.15, 0.26),
  );
}

export function jailModel(): Group {
  const result = group(
    box(3.4, 0.06, 1.3, PALETTE.concrete),
    box(1.2, 0.8, 0.8, PALETTE.brick[2]!, -1, 0.06, -0.15),
    box(0.3, 1.5, 0.3, PALETTE.concrete, 1.45, 0.06, -0.45),
    box(0.46, 0.2, 0.46, PALETTE.darkMetal, 1.45, 1.56, -0.45),
  );
  for (let i = 0; i < 9; i++) {
    result.add(box(0.03, 0.62, 0.03, PALETTE.darkMetal, -0.3 + i * 0.2, 0.06, 0.6));
  }
  result.add(box(1.7, 0.04, 0.04, PALETTE.darkMetal, 0.5, 0.66, 0.6));
  return result;
}

export function parkingModel(): Group {
  const result = group(box(3.4, 0.04, 1.25, PALETTE.road));
  for (let i = 0; i < 6; i++) {
    result.add(box(0.04, 0.01, 0.7, PALETTE.roadLine, -1.4 + i * 0.56, 0.04, -0.2));
  }
  const parked = (x: number, color: string) => {
    const car = group(
      box(0.34, 0.16, 0.6, color, 0, 0.06, 0),
      box(0.28, 0.13, 0.3, PALETTE.windowDark, 0, 0.22, -0.02),
    );
    car.position.set(x, 0.04, -0.2);
    return car;
  };
  result.add(parked(-1.12, PALETTE.concrete), parked(0.56, PALETTE.brick[1]!));
  return result;
}

export interface RaidModel {
  model: Group;
  lights: { red: MeshBasicMaterial; blue: MeshBasicMaterial };
}

export function raidModel(): RaidModel {
  const red = new MeshBasicMaterial({ color: PALETTE.policeRed });
  const blue = new MeshBasicMaterial({ color: PALETTE.police });
  const barrier = (x: number) =>
    group(
      box(0.86, 0.12, 0.06, PALETTE.white, x, 0.22, 0.25),
      box(0.05, 0.3, 0.05, PALETTE.darkMetal, x - 0.38, 0, 0.25),
      box(0.05, 0.3, 0.05, PALETTE.darkMetal, x + 0.38, 0, 0.25),
    );
  const car = group(
    box(0.42, 0.18, 0.8, PALETTE.white, 0, 0.06, 0),
    box(0.36, 0.16, 0.42, PALETTE.windowDark, 0, 0.24, -0.04),
    box(0.14, 0.06, 0.1, red, -0.08, 0.4, -0.04),
    box(0.14, 0.06, 0.1, blue, 0.08, 0.4, -0.04),
  );
  car.rotation.y = 1.2;
  car.position.set(0.1, 0, -0.1);
  return { model: group(barrier(-1), barrier(1), car), lights: { red, blue } };
}

/* Auta hráčů. Přední část míří do +z, spodek stojí na y = 0. */

interface CarShape {
  length: number;
  width: number;
  bodyHeight: number;
  cabinLength: number;
  cabinHeight: number;
  cabinZ: number;
}

const CAR_SHAPES: readonly CarShape[] = [
  {
    length: 0.78,
    width: 0.36,
    bodyHeight: 0.13,
    cabinLength: 0.3,
    cabinHeight: 0.11,
    cabinZ: -0.06,
  },
  {
    length: 0.72,
    width: 0.38,
    bodyHeight: 0.2,
    cabinLength: 0.42,
    cabinHeight: 0.15,
    cabinZ: -0.08,
  },
  {
    length: 0.78,
    width: 0.38,
    bodyHeight: 0.18,
    cabinLength: 0.26,
    cabinHeight: 0.14,
    cabinZ: 0.16,
  },
  {
    length: 0.9,
    width: 0.36,
    bodyHeight: 0.14,
    cabinLength: 0.5,
    cabinHeight: 0.12,
    cabinZ: -0.08,
  },
];

export function carModel(player: number, color: string): Group {
  const shape = CAR_SHAPES[player % CAR_SHAPES.length]!;
  const result = group(
    box(shape.width, shape.bodyHeight, shape.length, color, 0, 0.07, 0),
    box(
      shape.width * 0.84,
      shape.cabinHeight,
      shape.cabinLength,
      color,
      0,
      0.07 + shape.bodyHeight,
      shape.cabinZ,
    ),
    box(
      shape.width * 0.86,
      shape.cabinHeight * 0.62,
      shape.cabinLength * 1.02,
      PALETTE.windowDark,
      0,
      0.09 + shape.bodyHeight,
      shape.cabinZ,
    ),
  );
  const front = shape.length / 2;
  for (const side of [-1, 1]) {
    result.add(
      box(0.07, 0.05, 0.02, glow(PALETTE.windowLit), side * shape.width * 0.32, 0.12, front),
    );
    result.add(
      box(0.07, 0.04, 0.02, glow(PALETTE.policeRed), side * shape.width * 0.32, 0.13, -front),
    );
    for (const z of [-front * 0.62, front * 0.62]) {
      const wheel = cylinder(0.07, 0.07, 0.05, PALETTE.darkMetal, 0, 0, 0, 8);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(side * (shape.width / 2 + 0.005), 0.07, z);
      result.add(wheel);
    }
  }
  if (player % CAR_SHAPES.length === 0) {
    result.add(box(shape.width * 0.9, 0.03, 0.08, PALETTE.darkMetal, 0, 0.28, -front + 0.05));
  }
  return result;
}

/** Bílá šipka nad autem hráče, který je na tahu. */
export function turnChevron(): Mesh {
  const geometry = new ConeGeometry(0.2, 0.34, 4);
  const chevron = new Mesh(geometry, new MeshBasicMaterial({ color: PALETTE.white }));
  chevron.rotation.x = Math.PI;
  return chevron;
}

/** Spodek plovoucího ostrova: vrstvy skály zužující se do špičky, s nepravidelnými hranami. */
export function floatingRock(halfSize: number, depth: number, seed: number): Group {
  const random = seededRandom(seed);
  const result = group();
  const layers = 3;
  let top = halfSize * Math.SQRT2;
  let y = 0;
  for (let i = 0; i < layers; i++) {
    const h = (depth / layers) * (0.8 + i * 0.2);
    const bottom = top * (i === layers - 1 ? 0.22 : 0.72);
    const segments = i === 0 ? 4 : 6 + i;
    const geometry = new CylinderGeometry(top, bottom, h, segments, 1, false, Math.PI / 4);
    jitterRing(geometry, i === 0 ? 0 : top * 0.05, bottom * 0.14, random);
    const mesh = shaded(new Mesh(geometry, solid(PALETTE.rock[i % PALETTE.rock.length]!)));
    mesh.position.y = y - h / 2;
    result.add(mesh);
    y -= h;
    top = bottom * 1.02;
  }
  return result;
}

/** Posune vrcholy tak, aby zůstaly napojené: stejná poloha dostane stejný posun. */
function jitterRing(
  geometry: BufferGeometry,
  topAmount: number,
  bottomAmount: number,
  random: () => number,
): void {
  const position = geometry.getAttribute('position');
  const shifts = new Map<string, [number, number]>();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    if (Math.hypot(x, z) < 1e-6) continue;
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let shift = shifts.get(key);
    if (!shift) {
      const amount = y > 0 ? topAmount : bottomAmount;
      shift = [(random() - 0.5) * amount * 2, (random() - 0.5) * amount * 2];
      shifts.set(key, shift);
    }
    position.setXYZ(i, x + shift[0], y, z + shift[1]);
  }
  geometry.computeVertexNormals();
}
