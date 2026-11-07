import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  Raycaster,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material, Object3D } from 'three';
import {
  DEFENSE_COLS,
  DEFENSE_PATH,
  DEFENSE_ROWS,
  REPLAY_SPEED,
  TICKS_PER_SECOND,
  TOWERS,
  cellXY,
  sectorOfCell,
} from '../../core';
import type { DefenseTower, EnemyKind, TowerKind, WaveSim } from '../../core';
import { box, cylinder, glow, group } from '../../render/models';
import { figure, swing, translucent } from '../figure';
import type { Figure } from '../figure';

/** Velikost políčka ve světě. */
const S = 2;
const SKY = '#8fc7e8';
const GRASS = '#6aa54c';
const ASPHALT = '#4a4650';
const CURB = '#d8d2c4';
const HALL = '#e9dcc0';
const CAMERA_FOV = 42;
const TICK = 1 / (TICKS_PER_SECOND * REPLAY_SPEED);

const ENEMY_LOOK: Record<EnemyKind, { body: string; cap: string; scale: number }> = {
  thug: { body: '#3b3b46', cap: '#d6453a', scale: 0.8 },
  biker: { body: '#1d1d22', cap: '#f0b62a', scale: 0.8 },
  van: { body: '#5a5f6e', cap: '#222', scale: 1 },
  boss: { body: '#f2efe6', cap: '#1d1d22', scale: 1.25 },
};

export function cellToWorld(cell: number): [number, number] {
  const [x, y] = cellXY(cell);
  return [(x - DEFENSE_COLS / 2 + 0.5) * S, (y - DEFENSE_ROWS / 2 + 0.5) * S];
}

/** Bod v tisícinách políčka na souřadnice světa. */
function milliToWorld(x: number, y: number): [number, number] {
  return [(x / 1_000 - DEFENSE_COLS / 2) * S, (y / 1_000 - DEFENSE_ROWS / 2) * S];
}

function towerModel(kind: TowerKind, level: number, color: string): Group {
  const root = group(cylinder(0.85, 0.95, 0.25 + level * 0.12, color));
  const base = 0.25 + level * 0.12;
  let guard: Figure;
  if (kind === 'sniper') {
    root.add(
      box(1.1, 1.6, 1.1, '#8a7a66', 0, base, 0),
      box(1.4, 0.15, 1.4, '#6b5d4c', 0, base + 1.6, 0),
    );
    guard = figure('#2f3a2f', '#59683d');
    guard.root.position.y = base + 1.75;
  } else if (kind === 'clerk') {
    root.add(
      box(1.2, 0.6, 0.6, '#9c6b3f', 0, base, 0.35),
      box(0.5, 0.08, 0.36, '#f4efe2', 0.1, base + 0.6, 0.35),
    );
    guard = figure('#7d828c', '#4b4f57');
    guard.root.position.set(0, base, -0.25);
  } else {
    guard = figure('#141418', '#141418');
    guard.root.position.y = base;
  }
  guard.root.scale.setScalar(kind === 'sniper' ? 0.55 : 0.75);
  guard.root.rotation.y = Math.PI;
  root.add(guard.root);
  for (let i = 0; i < level; i++) {
    root.add(box(0.22, 0.22, 0.22, glow('#ffd65a'), -0.35 + i * 0.35, base + 0.02, 0.85));
  }
  return root;
}

function enemyModel(kind: EnemyKind): { root: Group; walker: Figure | null; bar: Mesh } {
  const look = ENEMY_LOOK[kind];
  const root = new Group();
  let walker: Figure | null = null;
  if (kind === 'van') {
    root.add(
      box(1.3, 1.1, 1.9, look.body, 0, 0.3, 0),
      box(1.2, 0.5, 0.5, '#9cd0e8', 0, 0.85, 0.75),
      cylinder(0.25, 0.25, 0.2, '#111', -0.65, 0.05, 0.6),
      cylinder(0.25, 0.25, 0.2, '#111', 0.65, 0.05, -0.6),
    );
  } else if (kind === 'biker') {
    root.add(box(0.4, 0.45, 1.5, '#b3262d', 0, 0.25, 0));
    // Motorkář sedí, nohama nekývá.
    const rider = figure(look.body, look.cap);
    rider.root.scale.setScalar(0.55);
    rider.root.position.y = 0.25;
    root.add(rider.root);
  } else {
    walker = figure(look.body, look.cap);
    walker.root.scale.setScalar(0.6 * look.scale);
    root.add(walker.root);
  }
  const bar = box(1.2, 0.14, 0.14, glow('#3ee05a'), 0, 0, 0);
  bar.position.y = kind === 'boss' ? 2.3 : 1.9;
  root.add(box(1.26, 0.18, 0.1, glow('#300'), 0, bar.position.y - 0.09, -0.04), bar);
  return { root, walker, bar };
}

interface EnemyMesh {
  root: Group;
  walker: Figure | null;
  bar: Mesh;
  from: [number, number];
  to: [number, number];
}

/** 3D podoba Války gangů: mapa, věže, gang a výstřely. Pravidla nezná, jen kreslí. */
export class DefenseView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 1, 300);
  private readonly observer: ResizeObserver;
  private readonly towers = new Map<number, { key: string; root: Group }>();
  private readonly enemies = new Map<number, EnemyMesh>();
  private readonly cursor: Mesh<RingGeometry, MeshBasicMaterial>;
  private readonly range: Mesh;
  private readonly shotLines: Line[] = [];
  private readonly raycaster = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  private sim: WaveSim | null = null;
  private acc = 0;

  constructor(
    private readonly host: HTMLElement,
    /** Barva dílu každého obránce v pořadí dílů. */
    private readonly colors: readonly string[],
    private readonly mySector: number,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.append(this.renderer.domElement);
    this.buildWorld();

    this.cursor = new Mesh(
      new RingGeometry(0.2, S * 0.48, 4, 1, Math.PI / 4),
      translucent('#fff', 0.8),
    );
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.position.y = 0.08;
    this.cursor.visible = false;
    this.range = new Mesh(new RingGeometry(0.95, 1, 48), translucent('#fff', 0.55));
    this.range.rotation.x = -Math.PI / 2;
    this.range.position.y = 0.1;
    this.range.visible = false;
    this.scene.add(this.cursor, this.range);
    for (let i = 0; i < 24; i++) {
      const line = new Line(
        new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]),
        new LineBasicMaterial({ color: '#fff36b' }),
      );
      line.visible = false;
      this.shotLines.push(line);
      this.scene.add(line);
    }

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private buildWorld(): void {
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 70, 150);
    this.scene.add(
      new AmbientLight('#ffffff', 0.55),
      new HemisphereLight('#fff6e0', '#5d7a4a', 0.5),
    );
    const sun = new DirectionalLight('#fff3dc', 1.6);
    sun.position.set(-18, 34, 14);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, {
      left: -30,
      right: 30,
      top: 20,
      bottom: -20,
      near: 1,
      far: 90,
    });
    this.scene.add(sun);

    const w = DEFENSE_COLS * S;
    const d = DEFENSE_ROWS * S;
    this.scene.add(box(w + 6, 1, d + 6, '#5b8f45', 0, -1.02, 0));
    const path = new Set(DEFENSE_PATH);
    for (let cell = 0; cell < DEFENSE_COLS * DEFENSE_ROWS; cell++) {
      const [x, z] = cellToWorld(cell);
      if (path.has(cell)) {
        this.scene.add(box(S, 0.04, S, ASPHALT, x, -0.02, z));
        continue;
      }
      const sector = sectorOfCell(cell, this.colors.length);
      const mine = sector === this.mySector;
      const tile = box(S * 0.94, 0.06, S * 0.94, mine ? '#b4ec84' : GRASS, x, -0.02, z);
      this.scene.add(tile);
      // Cizí díl má okraj v barvě obránce, vlastní díl svítí.
      const edge = translucent(this.colors[sector] ?? '#fff', mine ? 0.5 : 0.28);
      const mark = new Mesh(new RingGeometry(S * 0.4, S * 0.47, 4, 1, Math.PI / 4), edge);
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(x, 0.05, z);
      this.scene.add(mark);
    }
    // Obrubník kolem cesty, ať je vidět i na první pohled.
    for (const cell of DEFENSE_PATH) {
      const [x, z] = cellToWorld(cell);
      this.scene.add(box(S * 0.12, 0.12, S * 0.12, CURB, x, 0, z));
    }
    const [ex, ez] = cellToWorld(DEFENSE_PATH[0]!);
    this.scene.add(this.gangHideout(ex - S * 1.6, ez));
    const [hx, hz] = cellToWorld(DEFENSE_PATH.at(-1)!);
    this.scene.add(this.townHall(hx + S * 1.7, hz));
  }

  private gangHideout(x: number, z: number): Group {
    const hideout = group(box(2.6, 1.8, 3, '#5a4a52'), box(2.8, 0.3, 3.2, '#3a2f35', 0, 1.8, 0));
    hideout.position.set(x, 0, z);
    return hideout;
  }

  private townHall(x: number, z: number): Group {
    const hall = group(
      box(3, 2.4, 4, HALL),
      box(3.4, 0.4, 4.4, '#c9b48a', 0, 2.4, 0),
      cylinder(0.7, 0.7, 1.2, '#c9b48a', 0, 2.8, 0),
      box(0.8, 0.8, 0.1, glow('#ffd65a'), -1.52, 1.3, 0),
    );
    for (let i = 0; i < 4; i++) hall.add(box(0.3, 2.4, 0.3, '#fff', -1.6, 0, -1.5 + i));
    hall.position.set(x, 0, z);
    return hall;
  }

  private resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Celá mapa se musí vejít i na úzké obrazovce.
    const fit = Math.max(1, 1.9 / this.camera.aspect);
    // Dole je panel se stavbou, mapa proto sedí v horní části obrazovky.
    this.camera.position.set(0, 40 * fit, 24 * fit);
    this.camera.lookAt(0, 0, 6.5);
    this.camera.updateProjectionMatrix();
  }

  /** Políčko pod myší, nebo `null` mimo mapu. */
  pick(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, new Vector3());
    if (!hit) return null;
    const x = Math.floor(hit.x / S + DEFENSE_COLS / 2);
    const y = Math.floor(hit.z / S + DEFENSE_ROWS / 2);
    if (x < 0 || y < 0 || x >= DEFENSE_COLS || y >= DEFENSE_ROWS) return null;
    return y * DEFENSE_COLS + x;
  }

  /** Kurzor nad políčkem a dosah věže, která by tam stála. */
  setCursor(cell: number | null, ok: boolean, kind: TowerKind | null, level = 1): void {
    this.cursor.visible = cell !== null;
    this.range.visible = cell !== null && kind !== null;
    if (cell === null) return;
    const [x, z] = cellToWorld(cell);
    this.cursor.position.set(x, 0.08, z);
    this.cursor.material.color.set(ok ? '#ffffff' : '#ff4d4d');
    if (kind) {
      const r = ((TOWERS[kind].range[level - 1] ?? 0) / 1_000) * S;
      this.range.scale.setScalar(r);
      this.range.position.set(x, 0.1, z);
    }
  }

  setTowers(towers: readonly DefenseTower[], owners: readonly number[]): void {
    const seen = new Set<number>();
    for (const tower of towers) {
      seen.add(tower.cell);
      const key = `${tower.kind}${tower.level}`;
      const old = this.towers.get(tower.cell);
      if (old?.key === key) continue;
      if (old) this.remove(old.root);
      const color = this.colors[owners.indexOf(tower.owner)] ?? '#fff';
      const root = towerModel(tower.kind, tower.level, color);
      const [x, z] = cellToWorld(tower.cell);
      root.position.set(x, 0, z);
      // Nová věž doskočí na místo.
      root.scale.setScalar(0.4);
      this.scene.add(root);
      this.towers.set(tower.cell, { key, root });
    }
    for (const [cell, entry] of this.towers) {
      if (seen.has(cell)) continue;
      this.remove(entry.root);
      this.towers.delete(cell);
    }
  }

  /** Spustí přehrávání vlny. Simulace se krokuje tady, po 100 ms. */
  play(sim: WaveSim): void {
    this.clearEnemies();
    this.sim = sim;
    this.acc = 0;
  }

  get playing(): boolean {
    return this.sim !== null;
  }

  render(dt: number): void {
    for (const { root } of this.towers.values()) {
      const s = Math.min(1, root.scale.x + dt * 4);
      root.scale.setScalar(s);
    }
    if (this.sim) this.advance(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private advance(dt: number): void {
    const sim = this.sim!;
    this.acc += dt;
    while (this.acc >= TICK && !sim.done) {
      this.acc -= TICK;
      for (const e of this.enemies.values()) e.from = e.to;
      sim.step();
      this.syncEnemies(sim);
    }
    const t = Math.min(1, this.acc / TICK);
    for (const e of this.enemies.values()) {
      const x = e.from[0] + (e.to[0] - e.from[0]) * t;
      const z = e.from[1] + (e.to[1] - e.from[1]) * t;
      const dx = e.to[0] - e.from[0];
      const dz = e.to[1] - e.from[1];
      if (dx || dz) e.root.rotation.y = Math.atan2(dx, dz);
      e.root.position.set(x, 0, z);
      if (e.walker) swing(e.walker, 6, dt);
    }
    this.drawShots(sim);
    if (sim.done) {
      this.sim = null;
      this.clearEnemies();
      for (const line of this.shotLines) line.visible = false;
    }
  }

  private syncEnemies(sim: WaveSim): void {
    const alive = new Set<number>();
    for (const enemy of sim.enemies) {
      alive.add(enemy.id);
      let mesh = this.enemies.get(enemy.id);
      const pos = milliToWorld(enemy.x, enemy.y);
      if (!mesh) {
        const model = enemyModel(enemy.kind);
        this.scene.add(model.root);
        mesh = { ...model, from: pos, to: pos };
        this.enemies.set(enemy.id, mesh);
      }
      mesh.to = pos;
      mesh.bar.scale.x = Math.max(0.02, enemy.hp / enemy.maxHp);
      mesh.bar.position.x = -0.6 * (1 - mesh.bar.scale.x);
    }
    for (const [id, mesh] of this.enemies) {
      if (alive.has(id)) continue;
      this.remove(mesh.root);
      this.enemies.delete(id);
    }
  }

  private drawShots(sim: WaveSim): void {
    this.shotLines.forEach((line, i) => {
      const shot = sim.shots[i];
      const enemy = shot && this.enemies.get(shot.enemy);
      const tower = shot && sim.towerCells[shot.tower];
      line.visible = Boolean(enemy && tower !== undefined);
      if (!enemy || tower === undefined) return;
      const [tx, tz] = cellToWorld(tower);
      const attr = line.geometry.getAttribute('position');
      attr.setXYZ(0, tx, 1.4, tz);
      attr.setXYZ(1, enemy.root.position.x, 0.8, enemy.root.position.z);
      attr.needsUpdate = true;
    });
  }

  private clearEnemies(): void {
    for (const mesh of this.enemies.values()) this.remove(mesh.root);
    this.enemies.clear();
  }

  private remove(object: Object3D): void {
    this.scene.remove(object);
    object.traverse((child) => {
      if (child instanceof Mesh) child.geometry.dispose();
    });
  }

  dispose(): void {
    this.observer.disconnect();
    this.scene.traverse((child) => {
      if (child instanceof Mesh || child instanceof Line) {
        child.geometry.dispose();
        const material = child.material as Material | Material[];
        if (!Array.isArray(material)) material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
