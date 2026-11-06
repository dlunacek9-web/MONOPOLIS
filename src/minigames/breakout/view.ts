import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material, Object3D } from 'three';
import { box, cylinder, floatingRock, glow, group, tenement } from '../../render/models';
import { PALETTE } from '../../render/palette';
import { figure, swing, translucent } from '../figure';
import type { Figure } from '../figure';
import { GATE_WIDTH, HALF_X, HALF_Z } from './map';
import type { Obstacle, Point } from './map';
import { VISION_HALF_ANGLE, VISION_RANGE } from './sim';
import type { BreakoutSim, Guard } from './sim';

const NIGHT = {
  sky: '#2c2a44',
  ground: '#6b6660',
  court: '#7b6f64',
  line: '#d8cdb4',
  jumpsuit: '#f08a24',
  uniform: '#2f3c63',
  beam: '#fff2c4',
  visionCalm: '#ffd65a',
  visionAlert: '#ff3b3b',
  key: '#ffd24a',
  gateLocked: '#e04848',
  gateOpen: '#2ee6b6',
};
const CAMERA_UP = 27;
const CAMERA_BACK = 19;
const CAMERA_FOV = 52;
const FOLLOW_RANGE_X = 12;
const FOLLOW_RANGE_Z = 9;
const FOLLOW_RATE = 4;
const VISION_RAYS = 18;
const WALL_HEIGHT = 2.2;
const SOUTH_WALL_HEIGHT = 1;

interface GuardVisual {
  guard: Guard;
  figure: Figure;
  mark: Group;
  fan: Mesh<BufferGeometry, MeshBasicMaterial>;
}

/** 3D podoba útěku: jen čte stav simulace, nic v ní nemění. */
export class BreakoutView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 300);
  private readonly observer: ResizeObserver;
  private readonly focus = new Vector3();
  private readonly prisoner: Figure;
  private readonly guards: GuardVisual[] = [];
  private readonly spots: { disc: Mesh; beam: Mesh }[] = [];
  private readonly key = new Group();
  private readonly keyBeacon: Mesh;
  private readonly gate = new Group();
  private readonly gateBeacon: Mesh<CircleGeometry | ConeGeometry, MeshBasicMaterial>;
  private time = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly sim: BreakoutSim,
    color: string,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.append(this.renderer.domElement);

    this.buildAtmosphere();
    this.buildYard();
    for (const obstacle of sim.map.obstacles) this.scene.add(this.buildObstacle(obstacle));

    this.prisoner = figure(NIGHT.jumpsuit, color);
    const ring = new Mesh(new RingGeometry(0.75, 1, 24), translucent(color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.prisoner.root.add(ring);
    this.scene.add(this.prisoner.root);

    for (const guard of sim.guards) this.guards.push(this.buildGuard(guard));
    for (const spot of sim.spots) this.spots.push(this.buildSpot(spot.radius));

    this.keyBeacon = new Mesh(new ConeGeometry(1.5, 16, 12, 1, true), translucent(NIGHT.key, 0.16));
    this.buildKey();
    this.gateBeacon = new Mesh(
      new ConeGeometry(2.4, 16, 12, 1, true),
      translucent(NIGHT.gateOpen, 0),
    );
    this.buildGate();

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.placeCamera(1);
  }

  private buildAtmosphere(): void {
    this.scene.background = new Color(NIGHT.sky);
    this.scene.fog = new Fog(NIGHT.sky, 55, 140);
    this.scene.add(new HemisphereLight('#a9b4e8', '#3b3530', 1.25));
    this.scene.add(new AmbientLight('#8c8fb8', 0.55));
    const moon = new DirectionalLight('#c9d4ff', 1.5);
    moon.position.set(-25, 50, 20);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, {
      left: -HALF_X - 6,
      right: HALF_X + 6,
      top: HALF_Z + 12,
      bottom: -HALF_Z - 12,
      near: 1,
      far: 140,
    });
    moon.shadow.bias = -0.0006;
    this.scene.add(moon);
  }

  private buildYard(): void {
    const ground = box(HALF_X * 2 + 22, 1, HALF_Z * 2 + 34, NIGHT.ground, 0, -1, 4);
    ground.castShadow = false;
    const rock = floatingRock(HALF_X + 16, 55, this.sim.map.seed);
    rock.position.y = -1;
    this.scene.add(ground, rock);

    // Hřiště na vycházky: jen malba na zemi, překážkám nevadí.
    const court = box(16, 0.02, 11, NIGHT.court, 0, 0, 7);
    court.castShadow = false;
    const line = box(16, 0.03, 0.14, NIGHT.line, 0, 0, 7);
    line.castShadow = false;
    this.scene.add(court, line);

    this.scene.add(this.buildWalls());
    for (const [x, z] of [
      [-HALF_X, -HALF_Z],
      [HALF_X, -HALF_Z],
      [-HALF_X, HALF_Z],
      [HALF_X, HALF_Z],
    ] as const) {
      this.scene.add(this.buildTower(x, z));
    }

    // Cely jsou daleko za nízkou zdí, ať nezakrývají hráče u startu.
    const block = tenement(HALF_X * 1.4, 7, 7, 2);
    block.position.set(0, 0, HALF_Z + 11);
    const door = box(3, 2.6, 0.5, PALETTE.darkMetal, 0, 0, HALF_Z);
    this.scene.add(block, door);
  }

  private buildWalls(): Group {
    const paint = PALETTE.concrete;
    const gateX = this.sim.map.gate.x;
    const westEnd = gateX - GATE_WIDTH / 2;
    const eastEnd = gateX + GATE_WIDTH / 2;
    const north = (from: number, to: number) =>
      box(to - from, WALL_HEIGHT, 1, paint, (from + to) / 2, 0, -HALF_Z - 0.5);
    const result = group(
      north(-HALF_X - 1, westEnd),
      north(eastEnd, HALF_X + 1),
      box(1, WALL_HEIGHT, HALF_Z * 2, paint, -HALF_X - 0.5, 0, 0),
      box(1, WALL_HEIGHT, HALF_Z * 2, paint, HALF_X + 0.5, 0, 0),
      box(HALF_X * 2 + 2, SOUTH_WALL_HEIGHT, 1, paint, 0, 0, HALF_Z + 0.5),
    );
    // Sloupky s ostnatým drátem, ať je z dálky jasné, že tohle není park.
    for (let x = -HALF_X; x <= HALF_X; x += 6) {
      if (x > westEnd - 0.5 && x < eastEnd + 0.5) continue;
      result.add(box(0.14, 1.2, 0.14, PALETTE.darkMetal, x, WALL_HEIGHT, -HALF_Z - 0.5));
    }
    return result;
  }

  private buildTower(x: number, z: number): Group {
    const tower = group(
      cylinder(0.8, 1.1, z < 0 ? 8 : 3, PALETTE.concrete),
      box(3, 1.6, 3, PALETTE.darkMetal, 0, z < 0 ? 8 : 3, 0),
      box(3.5, 0.2, 3.5, PALETTE.concrete, 0, z < 0 ? 9.6 : 4.6, 0),
    );
    tower.position.set(x, 0, z);
    return tower;
  }

  private buildObstacle(o: Obstacle): Object3D {
    let model: Group;
    if (o.kind === 'wall') {
      model = group(box(o.hx * 2, 1.7, o.hz * 2, PALETTE.brick[1]!));
    } else if (o.kind === 'crates') {
      model = group(
        box(o.hx * 2, 1.3, o.hz * 2, PALETTE.wood),
        box(o.hx * 1.1, 0.9, o.hz * 1.1, '#8f6d4e', o.hx * 0.25, 1.3, -o.hz * 0.2),
      );
    } else if (o.kind === 'van') {
      const across = o.hx > o.hz;
      const [nx, nz] = across ? [1, 0] : [0, 1];
      model = group(
        box(o.hx * 2, 1.7, o.hz * 2, '#d9d6cc', 0, 0.35, 0),
        box(
          across ? 0.9 : o.hx * 2,
          0.5,
          across ? o.hz * 2 : 0.9,
          PALETTE.darkMetal,
          nx * (o.hx - 0.5),
          1.2,
          nz * (o.hz - 0.5),
        ),
        box(across ? o.hx * 2 : 0.1, 0.3, across ? 0.1 : o.hz * 2, '#2347c5', 0, 0.95, 0),
      );
    } else {
      model = group(
        box(o.hx * 2, 1.9, o.hz * 2, PALETTE.brick[2]!),
        box(o.hx * 2 + 0.5, 0.3, o.hz * 2 + 0.5, PALETTE.roof, 0, 1.9, 0),
      );
    }
    model.position.set(o.x, 0, o.z);
    return model;
  }

  private buildGuard(guard: Guard): GuardVisual {
    const look = figure(NIGHT.uniform, '#1d2540');
    const mark = group(
      box(0.26, 0.8, 0.26, glow(NIGHT.visionAlert)),
      box(0.26, 0.26, 0.26, glow(NIGHT.visionAlert), 0, -0.45, 0),
    );
    mark.position.y = 3.3;
    mark.visible = false;
    look.root.add(mark);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(VISION_RAYS * 9), 3));
    const fan = new Mesh(geometry, translucent(NIGHT.visionCalm, 0.28));
    fan.frustumCulled = false;
    this.scene.add(look.root, fan);
    return { guard, figure: look, mark, fan };
  }

  private buildSpot(radius: number): { disc: Mesh; beam: Mesh } {
    const disc = new Mesh(new CircleGeometry(radius, 28), translucent(NIGHT.beam, 0.42));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.07;
    const beam = new Mesh(new ConeGeometry(1, 1, 16, 1, true), translucent(NIGHT.beam, 0.09));
    this.scene.add(disc, beam);
    return { disc, beam };
  }

  private buildKey(): void {
    const paint = glow(NIGHT.key);
    this.key.add(
      cylinder(0.45, 0.45, 0.16, paint, 0, 0.55, 0, 12),
      box(0.18, 0.18, 1.2, paint, 0, 0.55, 0.9),
      box(0.18, 0.18, 0.34, paint, 0.18, 0.55, 1.36),
    );
    const { x, z } = this.sim.map.key;
    this.key.position.set(x, 1, z);
    this.keyBeacon.position.set(x, 8, z);
    this.scene.add(this.key, this.keyBeacon);
  }

  private buildGate(): void {
    const { gate } = this.sim.map;
    for (let i = 0; i < 9; i++) {
      this.gate.add(box(0.16, WALL_HEIGHT + 0.6, 0.16, PALETTE.darkMetal, (i - 4) * 0.72, 0, 0));
    }
    this.gate.add(box(GATE_WIDTH, 0.26, 0.2, glow(NIGHT.gateLocked), 0, 1.2, 0));
    this.gate.position.set(gate.x, 0, -HALF_Z - 0.5);
    this.gateBeacon.position.set(gate.x, 8, gate.z);
    this.scene.add(this.gate, this.gateBeacon);
  }

  private resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(blend: number): void {
    const p = this.sim.prisoner;
    const x = Math.max(-FOLLOW_RANGE_X, Math.min(FOLLOW_RANGE_X, p.x));
    const z = Math.max(-FOLLOW_RANGE_Z, Math.min(FOLLOW_RANGE_Z, p.z));
    this.focus.x += (x - this.focus.x) * blend;
    this.focus.z += (z - this.focus.z) * blend;
    this.camera.position.set(this.focus.x, CAMERA_UP, this.focus.z + CAMERA_BACK);
    this.camera.lookAt(this.focus.x, 0, this.focus.z - 1);
  }

  private updateFan(visual: GuardVisual): void {
    const { guard, fan } = visual;
    const attribute = fan.geometry.getAttribute('position') as BufferAttribute;
    const positions = attribute.array as Float32Array;
    const point = (index: number, at: Point) => {
      positions[index] = at.x;
      positions[index + 1] = 0.09;
      positions[index + 2] = at.z;
    };
    const rim = (ray: number): Point => {
      const angle = guard.yaw - VISION_HALF_ANGLE + (2 * VISION_HALF_ANGLE * ray) / VISION_RAYS;
      const reach = this.sim.rayLength(guard, angle, VISION_RANGE);
      return { x: guard.x + Math.sin(angle) * reach, z: guard.z + Math.cos(angle) * reach };
    };
    let previous = rim(0);
    for (let ray = 0; ray < VISION_RAYS; ray++) {
      const next = rim(ray + 1);
      point(ray * 9, guard);
      point(ray * 9 + 3, previous);
      point(ray * 9 + 6, next);
      previous = next;
    }
    attribute.needsUpdate = true;
    const alert = guard.mode !== 'patrol';
    fan.material.color.set(alert ? NIGHT.visionAlert : NIGHT.visionCalm);
    visual.mark.visible = alert;
  }

  private updateSpot(index: number): void {
    const spot = this.sim.spots[index]!;
    const visual = this.spots[index]!;
    visual.disc.position.x = spot.x;
    visual.disc.position.z = spot.z;
    const from = new Vector3(spot.tower.x, 10, spot.tower.z);
    const to = new Vector3(spot.x, 0, spot.z);
    const axis = from.clone().sub(to);
    const length = axis.length();
    // Kužel má špičku nahoře, proto míří od terče k věži.
    visual.beam.position.copy(to).addScaledVector(axis, 0.5);
    visual.beam.scale.set(spot.radius, length, spot.radius);
    visual.beam.quaternion.copy(
      new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.normalize()),
    );
  }

  render(dt: number): void {
    this.time += dt;
    const { sim } = this;
    const p = sim.prisoner;
    this.prisoner.root.position.set(p.x, 0, p.z);
    this.prisoner.root.rotation.y = p.yaw;
    swing(this.prisoner, p.speed, dt);
    for (const visual of this.guards) {
      const { guard, figure: look } = visual;
      look.root.position.set(guard.x, 0, guard.z);
      look.root.rotation.y = guard.yaw;
      swing(look, guard.speed, dt);
      this.updateFan(visual);
    }
    sim.spots.forEach((_, index) => this.updateSpot(index));

    this.key.visible = !sim.hasKey;
    this.keyBeacon.visible = !sim.hasKey;
    this.key.rotation.y = this.time * 2;
    this.key.position.y = 1 + Math.sin(this.time * 3) * 0.2;
    if (sim.hasKey) {
      // Brána se otevře a rozsvítí, teď je to jediný cíl.
      this.gate.position.y = Math.max(this.gate.position.y - dt * 3, -WALL_HEIGHT - 1);
      this.gateBeacon.material.opacity = 0.24 + Math.sin(this.time * 5) * 0.06;
    }
    this.placeCamera(1 - Math.exp(-FOLLOW_RATE * dt));
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.observer.disconnect();
    this.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      node.geometry.dispose();
      const materials: Material[] = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
