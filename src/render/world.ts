import {
  CanvasTexture,
  ConeGeometry,
  InstancedMesh,
  Matrix4,
  Object3D,
  Scene,
  Sprite,
  SpriteMaterial,
} from 'three';
import { cs } from '../i18n/cs';
import { ISLAND_HALF, ROAD_CENTER, ROAD_WIDTH } from './layout';
import { box, floatingRock, group, neonSign, pine, place, solid, tenement } from './models';
import { PALETTE } from './palette';
import { cloudTexture, seededRandom } from './textures';

const CITY_HALF = ROAD_CENTER - ROAD_WIDTH / 2;
const CENTER_STREET = 1.1;

function roadRing(): Object3D {
  const outer = ROAD_CENTER + ROAD_WIDTH / 2;
  const length = outer * 2;
  const road = group();
  const strip = (w: number, d: number, x: number, z: number) => {
    const mesh = box(w, 0.14, d, PALETTE.road, x, 0, z);
    mesh.castShadow = false;
    return mesh;
  };
  road.add(
    strip(length, ROAD_WIDTH, 0, ROAD_CENTER),
    strip(length, ROAD_WIDTH, 0, -ROAD_CENTER),
    strip(ROAD_WIDTH, length, ROAD_CENTER, 0),
    strip(ROAD_WIDTH, length, -ROAD_CENTER, 0),
  );
  return road;
}

function roadDashes(): InstancedMesh {
  const positions: [number, number, boolean][] = [];
  for (let offset = -ROAD_CENTER + 1; offset < ROAD_CENTER; offset += 1) {
    positions.push([offset, ROAD_CENTER, true], [offset, -ROAD_CENTER, true]);
    positions.push([ROAD_CENTER, offset, false], [-ROAD_CENTER, offset, false]);
  }
  const dash = box(0.46, 0.012, 0.05, PALETTE.roadLine);
  const dashes = new InstancedMesh(dash.geometry, solid(PALETTE.roadLine), positions.length);
  const dummy = new Object3D();
  positions.forEach(([x, z, along], i) => {
    dummy.position.set(x, 0.146, z);
    dummy.rotation.y = along ? 0 : Math.PI / 2;
    dummy.updateMatrix();
    dashes.setMatrixAt(i, dummy.matrix);
  });
  return dashes;
}

/** Centrum: čtyři čtvrti kolem křižovatky, nejvyšší budovy uprostřed. */
function downtown(): Object3D {
  const city = group();
  const random = seededRandom(20260411);
  const pavement = box(CITY_HALF * 2, 0.1, CITY_HALF * 2, PALETTE.pavement);
  pavement.castShadow = false;
  city.add(pavement);
  const street = (w: number, d: number) => {
    const mesh = box(w, 0.04, d, PALETTE.road, 0, 0.1, 0);
    mesh.castShadow = false;
    return mesh;
  };
  city.add(street(CITY_HALF * 2, CENTER_STREET), street(CENTER_STREET, CITY_HALF * 2));

  const cells = [1.75, 4.25, 6.9];
  let variant = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const cx of cells) {
        for (const cz of cells) {
          const x = sx * cx;
          const z = sz * cz;
          const distance = Math.hypot(cx, cz);
          // Vzdálené okraje jsou nízké a parkové, aby nezakrývaly silnici za městem.
          if (distance > 7 && random() < 0.42) {
            for (let i = 0; i < 3; i++) {
              const tree = pine(0.9 + random() * 0.7);
              tree.position.set(x + (random() - 0.5) * 1.5, 0.1, z + (random() - 0.5) * 1.5);
              city.add(tree);
            }
            continue;
          }
          const w = 1.5 + random() * 0.45;
          const d = 1.5 + random() * 0.45;
          const h = 0.8 + Math.max(0, 8.5 - distance) * 0.62 + random() * 0.9;
          const block = tenement(w, h, d, variant++);
          block.position.set(x, 0.1, z);
          city.add(block);
          if (h > 3.2 && random() < 0.55) {
            const signs = cs.city.signs;
            const sign = neonSign(
              signs[variant % signs.length]!,
              PALETTE.neon[variant % PALETTE.neon.length]!,
              0.42,
            );
            sign.position.set(x, 0.1 + h * (0.45 + random() * 0.3), z + d / 2 + 0.03);
            sign.scale.setScalar(Math.min(1, (w - 0.1) / (sign.geometry.parameters.width || 1)));
            city.add(sign);
          }
        }
      }
    }
  }

  const tower = tenement(1.9, 8.4, 1.9, 2);
  tower.position.set(0, 0.1, -3.4);
  const brand = neonSign(cs.title, PALETTE.neon[2]!, 1.05);
  brand.position.set(0, 9.25, -3.4);
  const mast = box(0.08, 0.6, 0.08, PALETTE.darkMetal, 0, 8.6, -3.4);
  city.add(tower, brand, mast);
  return city;
}

function tufts(count: number, half: number, avoid: number, seed: number): InstancedMesh {
  const random = seededRandom(seed);
  const tuft = new ConeGeometry(0.1, 0.34, 5);
  const mesh = new InstancedMesh(tuft, solid(PALETTE.dryGrass), count);
  const matrix = new Matrix4();
  for (let i = 0; i < count; i++) {
    let x: number;
    let z: number;
    do {
      x = (random() * 2 - 1) * half;
      z = (random() * 2 - 1) * half;
    } while (Math.max(Math.abs(x), Math.abs(z)) < avoid);
    const scale = 0.6 + random() * 0.8;
    matrix.makeScale(scale, scale, scale);
    matrix.setPosition(x, 0.17 * scale, z);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.castShadow = true;
  return mesh;
}

function mainIsland(): Object3D {
  const edge = ISLAND_HALF * 2;
  const crust = box(edge, 0.5, edge, PALETTE.grass, 0, -0.5, 0);
  const rock = floatingRock(ISLAND_HALF - 0.05, 13, 7);
  rock.position.y = -0.5;
  const rimTrees = group();
  const random = seededRandom(404);
  for (let i = 0; i < 14; i++) {
    const along = (random() * 2 - 1) * (ISLAND_HALF - 0.4);
    const across = ISLAND_HALF - 0.28;
    const horizontal = i % 2 === 0;
    const sign = i % 4 < 2 ? 1 : -1;
    const tree = pine(0.75 + random() * 0.5);
    tree.position.set(horizontal ? along : sign * across, 0, horizontal ? sign * across : along);
    rimTrees.add(tree);
  }
  return group(crust, rock, tufts(70, ISLAND_HALF - 0.08, ISLAND_HALF - 0.65, 11), rimTrees);
}

function smallIsland(size: number, depth: number, seed: number): Object3D {
  const random = seededRandom(seed);
  const top = box(size * 2, 0.3, size * 2, PALETTE.grassDark, 0, -0.3, 0);
  const rock = floatingRock(size - 0.02, depth, seed);
  rock.position.y = -0.3;
  const result = group(top, rock);
  const trees = 2 + Math.floor(random() * 3);
  for (let i = 0; i < trees; i++) {
    const tree = pine(1.4 + random() * 1.4);
    tree.position.set((random() * 2 - 1) * (size - 0.6), 0, (random() * 2 - 1) * (size - 0.6));
    result.add(tree);
  }
  if (random() < 0.7) {
    const block = tenement(2, 3 + random() * 2.5, 2, seed);
    block.position.set((random() - 0.5) * size * 0.7, 0, (random() - 0.5) * size * 0.7);
    result.add(block);
  }
  return result;
}

function backdrop(scene: Scene): CanvasTexture[] {
  const islands: [number, number, number, number, number][] = [
    [-33, -9, -24, 5, 6],
    [34, -12, -30, 6, 7],
    [-20, -16, -46, 7, 8],
    [19, -8, -58, 8, 9],
    [-44, -14, -2, 4, 5],
    [46, -18, -4, 5, 6],
    [-36, -26, 20, 4, 5],
    [36, -28, 22, 3.5, 4],
  ];
  islands.forEach(([x, y, z, size, depth], i) => {
    scene.add(place(smallIsland(size, depth, 300 + i * 17), x, y, z));
  });

  const textures: CanvasTexture[] = [];
  // Kamera se dívá dolů, takže mraky leží pod ostrovem a dávají mu pocit výšky.
  const clouds: [number, number, number, number][] = [
    [-40, -34, 8, 70],
    [38, -36, 4, 80],
    [0, -40, 34, 90],
    [-16, -32, -40, 80],
    [44, -30, -44, 70],
    [-58, -30, -36, 70],
  ];
  clouds.forEach(([x, y, z, scale], i) => {
    const map = cloudTexture(50 + i * 9);
    textures.push(map);
    const material = new SpriteMaterial({ map, transparent: true, opacity: 0.85, fog: false });
    const sprite = new Sprite(material);
    sprite.scale.set(scale, scale / 2, 1);
    scene.add(place(sprite, x, y, z));
  });
  return textures;
}

/** Postaví statickou část světa. Parcely a auta přidává `CityView`. */
export function buildWorld(scene: Scene): CanvasTexture[] {
  scene.add(mainIsland(), roadRing(), roadDashes(), downtown());
  return backdrop(scene);
}
