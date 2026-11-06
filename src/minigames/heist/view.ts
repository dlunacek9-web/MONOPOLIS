import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
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
  RingGeometry,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material, Object3D } from 'three';
import { box, cylinder, glow, group } from '../../render/models';
import { PALETTE } from '../../render/palette';
import { figure, swing, translucent } from '../figure';
import type { Figure } from '../figure';
import { BACK_Z, FRONT_Z, HALF_X, HALF_Z } from './map';
import type { Obstacle } from './map';
import { CAMERA_HALF_ANGLE } from './sim';
import type { Camera, Cop, HeistSim } from './sim';

const LOOK = {
  bank: { floor: '#8d9299', wall: '#6d6a72', accent: '#2f6f62' },
  hotel: { floor: '#7d3440', wall: '#a2694f', accent: '#d9a441' },
};
const SKY = '#26263f';
const STREET = '#4a4650';
const VAULT_FLOOR = '#5d6068';
const SUIT = '#23232b';
const UNIFORM = '#2f3c63';
const BAG = '#c9a35a';
const FAN_CALM = '#ffd65a';
const FAN_ALERT = '#ff3b3b';
const SIREN_RED = new Color('#ff5a5a');
const SIREN_BLUE = new Color('#6a8cff');
const NIGHT_AMBIENT = new Color('#9a9cc4');
const CAMERA_UP = 27;
const CAMERA_BACK = 19;
const CAMERA_FOV = 52;
const FOLLOW_RANGE_X = 14;
const FOLLOW_RANGE_Z = 9;
const FOLLOW_RATE = 4;
const FAN_RAYS = 16;
const WALL_HEIGHT = 2.4;
/** Přední zeď je nízká, ať nezakrývá dění v hale. */
const FRONT_WALL_HEIGHT = 1;
const SIREN_RATE = 7;

function bagModel(): Group {
  return group(
    box(1, 0.8, 0.8, BAG),
    box(0.42, 0.26, 0.42, '#a8853f', 0, 0.8, 0),
    box(0.5, 0.1, 0.1, '#2a7d4f', 0, 0.35, 0.41),
  );
}

/** 3D podoba heistu: jen čte stav simulace, nic v ní nemění. */
export class HeistView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 300);
  private readonly observer: ResizeObserver;
  private readonly focus = new Vector3();
  private readonly ambient = new AmbientLight(NIGHT_AMBIENT, 0.6);
  private readonly thief: Figure;
  private readonly load: Group[] = [];
  private readonly bags: Group[] = [];
  private readonly cops = new Map<Cop, Figure>();
  private readonly fans: {
    camera: Camera;
    mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
    body: Group;
  }[] = [];
  private readonly door = new Group();
  private readonly vaultBeacon: Mesh;
  private readonly vanBeacon: Mesh<ConeGeometry, MeshBasicMaterial>;
  private readonly sirens: Mesh<ConeGeometry, MeshBasicMaterial>[] = [];
  private time = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly sim: HeistSim,
    color: string,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.append(this.renderer.domElement);

    this.buildAtmosphere();
    this.buildGround();
    for (const o of sim.map.obstacles) this.scene.add(this.buildObstacle(o));

    this.thief = figure(SUIT, color);
    const ring = new Mesh(new RingGeometry(0.75, 1, 24), translucent(color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.thief.root.add(ring);
    for (let i = 0; i < sim.maxBags; i++) {
      // Pytle se vrší na zádech, ať je náklad vidět i bez ukazatele.
      const carried = bagModel();
      carried.scale.setScalar(0.72);
      carried.position.set(i % 2 ? 0.22 : -0.22, 1.1 + Math.floor(i / 2) * 0.62, -0.62);
      carried.visible = false;
      this.thief.root.add(carried);
      this.load.push(carried);
    }
    this.scene.add(this.thief.root);

    for (const bag of sim.bags) {
      const model = bagModel();
      model.scale.setScalar(1.3);
      model.position.set(bag.x, 0, bag.z);
      this.scene.add(model);
      this.bags.push(model);
    }
    for (const camera of sim.cameras) this.buildCamera(camera);
    this.buildDoor();

    const { vaultSpot, van } = sim.map;
    this.vaultBeacon = new Mesh(
      new ConeGeometry(1.6, 14, 12, 1, true),
      translucent(FAN_CALM, 0.16),
    );
    this.vaultBeacon.position.set(vaultSpot.x, 7, vaultSpot.z);
    this.vanBeacon = new Mesh(new ConeGeometry(3, 14, 12, 1, true), translucent('#2ee6b6', 0));
    this.vanBeacon.position.set(van.x, 7, van.z);
    this.scene.add(this.vaultBeacon, this.vanBeacon);
    for (const spawn of sim.map.copSpawns) this.buildPatrolCar(spawn.x, spawn.z);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.placeCamera(1);
  }

  private buildAtmosphere(): void {
    this.scene.background = new Color(SKY);
    this.scene.fog = new Fog(SKY, 55, 140);
    this.scene.add(new HemisphereLight('#b6bdea', '#3b3530', 1.3), this.ambient);
    const moon = new DirectionalLight('#d5dcff', 1.5);
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

  private buildGround(): void {
    const look = LOOK[this.sim.map.target];
    const street = box(HALF_X * 2 + 30, 1, HALF_Z * 2 + 40, STREET, 0, -1, 6);
    const floor = box(HALF_X * 2, 0.04, FRONT_Z + HALF_Z, look.floor, 0, 0, (FRONT_Z - HALF_Z) / 2);
    const vault = box(18, 0.06, HALF_Z + BACK_Z, VAULT_FLOOR, 0, 0, (BACK_Z - HALF_Z) / 2);
    const rug = box(9, 0.07, 5, look.accent, 0, 0, 1);
    for (const flat of [street, floor, vault, rug]) flat.castShadow = false;
    const back = box(HALF_X * 2 + 2, WALL_HEIGHT, 1, look.wall, 0, 0, -HALF_Z - 0.5);
    this.scene.add(street, floor, vault, rug, back);
  }

  private buildObstacle(o: Obstacle): Object3D {
    const look = LOOK[this.sim.map.target];
    let model: Group;
    if (o.kind === 'wall') {
      const height = o.z === FRONT_Z ? FRONT_WALL_HEIGHT : WALL_HEIGHT;
      model = group(box(o.hx * 2, height, o.hz * 2, look.wall));
    } else if (o.kind === 'pillar') {
      model = group(cylinder(o.hx, o.hx, 3, PALETTE.concrete, 0, 0, 0, 10));
    } else if (o.kind === 'counter') {
      model = group(
        box(o.hx * 2, 1.1, o.hz * 2, PALETTE.wood),
        box(o.hx * 2 + 0.2, 0.12, o.hz * 2 + 0.2, look.accent, 0, 1.1, 0),
      );
    } else if (o.kind === 'desk') {
      model = group(
        box(o.hx * 2, 0.9, o.hz * 2, PALETTE.wood),
        box(0.7, 0.5, 0.1, PALETTE.darkMetal, 0, 0.9, 0),
      );
    } else if (o.kind === 'shelf') {
      model = group(
        box(o.hx * 2, 1.8, o.hz * 2, PALETTE.darkMetal),
        box(o.hx * 2 + 0.1, 0.14, o.hz * 2 + 0.1, '#ffd24a', 0, 1.1, 0),
      );
    } else {
      model = group(
        box(o.hx * 2, 1.9, o.hz * 2, '#e4e0d4', 0, 0.35, 0),
        box(0.9, 0.55, o.hz * 2, PALETTE.darkMetal, o.hx - 0.5, 1.25, 0),
        box(o.hx * 2, 0.3, 0.06, '#c5392f', 0, 1, o.hz),
      );
    }
    model.position.set(o.x, 0, o.z);
    return model;
  }

  private buildCamera(camera: Camera): void {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(FAN_RAYS * 9), 3));
    const mesh = new Mesh(geometry, translucent(FAN_CALM, 0.28));
    mesh.frustumCulled = false;
    const body = group(
      box(0.5, 0.35, 0.8, PALETTE.darkMetal),
      box(0.2, 0.2, 0.1, glow(FAN_ALERT), 0, 0.08, 0.42),
    );
    // Kamera sedí na zdi, a ta přední je nízká.
    const onFront = camera.z > 0;
    body.position.set(camera.x, onFront ? FRONT_WALL_HEIGHT : WALL_HEIGHT, camera.z);
    this.scene.add(mesh, body);
    this.fans.push({ camera, mesh, body });
  }

  private buildDoor(): void {
    const { door } = this.sim.map;
    this.door.add(
      box(door.hx * 2, WALL_HEIGHT, door.hz * 2 + 0.3, PALETTE.darkMetal),
      cylinder(0.8, 0.8, 0.2, '#ffd24a', 0, 1.1, door.hz + 0.2, 12),
    );
    this.door.position.set(door.x, 0, door.z);
    this.scene.add(this.door);
  }

  private buildPatrolCar(x: number, z: number): void {
    const siren = new Mesh(new ConeGeometry(2.4, 10, 10, 1, true), translucent('#ff4040', 0));
    siren.position.set(x, 5, z);
    this.sirens.push(siren);
    this.scene.add(siren);
  }

  private addCop(cop: Cop): Figure {
    const look = figure(UNIFORM, '#1d2540');
    look.root.add(box(0.2, 0.2, 0.2, glow(FAN_ALERT), 0, 2.45, 0));
    this.scene.add(look.root);
    this.cops.set(cop, look);
    return look;
  }

  private resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(blend: number): void {
    const p = this.sim.thief;
    const x = Math.max(-FOLLOW_RANGE_X, Math.min(FOLLOW_RANGE_X, p.x));
    const z = Math.max(-FOLLOW_RANGE_Z, Math.min(FOLLOW_RANGE_Z, p.z));
    this.focus.x += (x - this.focus.x) * blend;
    this.focus.z += (z - this.focus.z) * blend;
    this.camera.position.set(this.focus.x, CAMERA_UP, this.focus.z + CAMERA_BACK);
    this.camera.lookAt(this.focus.x, 0, this.focus.z - 1);
  }

  private updateFan(fan: HeistView['fans'][number]): void {
    const { camera, mesh, body } = fan;
    body.rotation.y = camera.yaw;
    const attribute = mesh.geometry.getAttribute('position') as BufferAttribute;
    const positions = attribute.array as Float32Array;
    const write = (index: number, x: number, z: number) => {
      positions[index] = x;
      positions[index + 1] = 0.1;
      positions[index + 2] = z;
    };
    const rim = (ray: number): [number, number] => {
      const angle = camera.yaw - CAMERA_HALF_ANGLE + (2 * CAMERA_HALF_ANGLE * ray) / FAN_RAYS;
      const reach = this.sim.cameraReach(camera, angle);
      return [camera.x + Math.sin(angle) * reach, camera.z + Math.cos(angle) * reach];
    };
    let previous = rim(0);
    for (let ray = 0; ray < FAN_RAYS; ray++) {
      const next = rim(ray + 1);
      write(ray * 9, camera.x, camera.z);
      write(ray * 9 + 3, previous[0], previous[1]);
      write(ray * 9 + 6, next[0], next[1]);
      previous = next;
    }
    attribute.needsUpdate = true;
    mesh.material.color.set(this.sim.seen || this.sim.alarm ? FAN_ALERT : FAN_CALM);
    // Po poplachu už kamery nic neřeší, jen by zakrývaly policii.
    mesh.visible = !this.sim.alarm;
  }

  private updateAlarm(): void {
    const { sim } = this;
    if (!sim.alarm) return;
    const wave = Math.sin(this.time * SIREN_RATE);
    this.ambient.color.copy(wave > 0 ? SIREN_RED : SIREN_BLUE);
    this.ambient.intensity = 0.7 + Math.abs(wave) * 0.5;
    this.vanBeacon.material.opacity = 0.2 + Math.sin(this.time * 5) * 0.06;
    for (const siren of this.sirens) siren.material.opacity = 0.1 + Math.max(0, wave) * 0.15;
  }

  render(dt: number): void {
    this.time += dt;
    const { sim } = this;
    const p = sim.thief;
    this.thief.root.position.set(p.x, 0, p.z);
    this.thief.root.rotation.y = p.yaw;
    swing(this.thief, p.speed, dt);
    this.load.forEach((model, index) => (model.visible = index < sim.carried));
    sim.bags.forEach((bag, index) => {
      const model = this.bags[index]!;
      model.visible = !bag.carried;
      model.position.set(bag.x, 0, bag.z);
    });
    for (const cop of sim.cops) {
      const look = this.cops.get(cop) ?? this.addCop(cop);
      look.root.position.set(cop.x, 0, cop.z);
      look.root.rotation.y = cop.yaw;
      swing(look, cop.speed, dt);
    }
    for (const fan of this.fans) this.updateFan(fan);
    this.vaultBeacon.visible = !sim.vaultOpen;
    if (sim.vaultOpen) this.door.position.x = Math.min(this.door.position.x + dt * 4, 5);
    this.updateAlarm();
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
