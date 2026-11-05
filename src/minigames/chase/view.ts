import {
  AmbientLight,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material } from 'three';
import {
  box,
  carModel,
  cone,
  cylinder,
  floatingRock,
  glow,
  group,
  pine,
  solid,
  tenement,
} from '../../render/models';
import { PALETTE } from '../../render/palette';
import { BLOCK, BOUND, GRID, PITCH, ROAD, randomFrom } from './map';
import type { Car, ChaseSim, CrashEvent } from './sim';

const CAR_SCALE = 5.2;
const BUILDING_SCALE = 5;
const CURB = 0.35;
const CAMERA_BACK = 17;
const CAMERA_UP = 9.5;
const BASE_FOV = 62;
const BOOST_FOV = 76;
const SPARK_COUNT = 40;
const SPARK_LIFE = 0.7;
const TRAFFIC_COLORS = ['#c9b79a', '#8fa3a8', '#b98a6a', '#a8a06a', '#7d8a70', '#c4a4a0'];

interface CarVisual {
  car: Car;
  model: Group;
  lightRed: Mesh | null;
  lightBlue: Mesh | null;
}

interface Spark {
  mesh: Mesh;
  life: number;
  vx: number;
  vy: number;
  vz: number;
}

/** 3D podoba honičky: jen čte stav simulace, nic v ní nemění. */
export class ChaseView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.5, 320);
  private readonly sun = new DirectionalLight(PALETTE.sun, 2.2);
  private readonly visuals: CarVisual[] = [];
  private readonly sparks: Spark[] = [];
  private readonly arrow = new Group();
  private readonly observer: ResizeObserver;
  private readonly lookAt = new Vector3();
  private time = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly sim: ChaseSim,
    color: string,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.append(this.renderer.domElement);
    this.buildAtmosphere();
    this.buildCity();
    this.buildGoal();
    this.buildCars(color);
    this.buildSparks();
    this.buildArrow();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.placeCamera(1);
  }

  private buildAtmosphere(): void {
    this.scene.background = new Color(PALETTE.fog);
    this.scene.fog = new Fog(PALETTE.fog, 70, 300);
    this.scene.add(new HemisphereLight(PALETTE.hemiSky, PALETTE.hemiGround, 1.6));
    this.scene.add(new AmbientLight(PALETTE.hemiSky, 0.35));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const reach = 70;
    Object.assign(this.sun.shadow.camera, {
      left: -reach,
      right: reach,
      top: reach,
      bottom: -reach,
      near: 1,
      far: 260,
    });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
  }

  private buildCity(): void {
    const random = randomFrom(this.sim.map.seed ^ 0x51ab);
    const size = BOUND * 2;
    const ground = box(size + 16, 1, size + 16, PALETTE.road, 0, -1, 0);
    ground.castShadow = false;
    const rock = floatingRock(BOUND + 8, 60, this.sim.map.seed);
    rock.position.y = -1;
    this.scene.add(ground, rock, this.buildDashes());
    const span = (GRID * PITCH) / 2;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = (i + 0.5) * PITCH - span;
        const z = (j + 0.5) * PITCH - span;
        this.scene.add(this.buildBlock(x, z, i + j, random));
      }
    }
    for (const barricade of this.sim.map.barricades) {
      this.scene.add(this.buildBarricade(barricade.x, barricade.z, barricade.alongX));
    }
    this.scene.add(this.buildBorder());
  }

  private buildDashes(): InstancedMesh {
    const span = (GRID * PITCH) / 2;
    const items: { x: number; z: number; along: boolean }[] = [];
    for (let line = 0; line <= GRID; line++) {
      for (let at = -span + ROAD; at < span; at += 6) {
        if (Math.abs(((at + span) % PITCH) - PITCH / 2) > BLOCK / 2 - 2) continue;
        const offset = line * PITCH - span;
        items.push({ x: at, z: offset, along: true }, { x: offset, z: at, along: false });
      }
    }
    const dash = box(2.6, 0.04, 0.3, PALETTE.roadLine);
    const mesh = new InstancedMesh(dash.geometry, solid(PALETTE.roadLine), items.length);
    const dummy = new Object3D();
    items.forEach((item, index) => {
      dummy.position.set(item.x, 0.03, item.z);
      dummy.rotation.y = item.along ? 0 : Math.PI / 2;
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    return mesh;
  }

  /** Jedna čtvrť. Směrem k dálnici jsou domy vyšší, takže je cíl cítit i bez mapy. */
  private buildBlock(x: number, z: number, progress: number, random: () => number): Group {
    const block = group(box(BLOCK, CURB, BLOCK, PALETTE.pavement));
    block.children[0]!.castShadow = false;
    const cell = BLOCK / 2;
    for (const dx of [-0.5, 0.5]) {
      for (const dz of [-0.5, 0.5]) {
        const roll = random();
        if (roll < 0.18) {
          const tree = pine(BUILDING_SCALE * (0.9 + random() * 0.4));
          tree.position.set(dx * cell, CURB, dz * cell);
          block.add(tree);
          continue;
        }
        const footprint = (cell * (0.72 + random() * 0.2)) / BUILDING_SCALE;
        const height = 1.2 + random() * 1.8 + (progress / (GRID * 2)) * 3.2;
        const house = tenement(footprint, height, footprint, Math.floor(random() * 4));
        house.scale.setScalar(BUILDING_SCALE);
        house.position.set(dx * cell, CURB, dz * cell);
        block.add(house);
      }
    }
    block.position.set(x, 0, z);
    return block;
  }

  private buildBarricade(x: number, z: number, alongX: boolean): Group {
    const barricade = group();
    for (let at = -ROAD / 2 + 1; at <= ROAD / 2 - 1; at += 2.25) {
      const panel = box(0.5, 1.5, 2, at % 4.5 < 2.25 ? PALETTE.white : PALETTE.policeRed, 0, 0, at);
      barricade.add(panel);
      barricade.add(cone(0.6, 1.4, '#f28c28', 1.5, 0, at));
    }
    barricade.position.set(x, 0, z);
    barricade.rotation.y = alongX ? 0 : Math.PI / 2;
    return barricade;
  }

  private buildBorder(): Group {
    const border = group();
    const edge = BOUND + 1;
    const length = edge * 2 + 2;
    border.add(
      box(length, 1.4, 2, PALETTE.concrete, 0, 0, edge),
      box(length, 1.4, 2, PALETTE.concrete, 0, 0, -edge),
      box(2, 1.4, length, PALETTE.concrete, edge, 0, 0),
      box(2, 1.4, length, PALETTE.concrete, -edge, 0, 0),
    );
    return border;
  }

  /** Dálnice: portál se zářícím sloupem, který je vidět přes celé město. */
  private buildGoal(): void {
    const { x, z } = this.sim.goal;
    const color = PALETTE.neon[0]!;
    const beam = new Mesh(
      new CylinderGeometry(7, 7, 120, 16, 1, true),
      new MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    beam.position.set(x, 60, z);
    const ring = cylinder(9, 9, 0.08, glow(color), x, 0.02, z, 24);
    ring.castShadow = false;
    this.scene.add(beam, ring);
  }

  private buildCars(color: string): void {
    for (const car of this.sim.cars) {
      let model: Group;
      let lightRed: Mesh | null = null;
      let lightBlue: Mesh | null = null;
      if (car.kind === 'runner') {
        model = carModel(0, color);
      } else if (car.kind === 'police') {
        model = carModel(1, PALETTE.white);
        model.add(box(0.36, 0.05, 0.3, PALETTE.police, 0, 0.21, 0.12));
        lightRed = box(
          0.13,
          0.05,
          0.08,
          new MeshBasicMaterial({ color: PALETTE.policeRed }),
          -0.08,
        );
        lightBlue = box(0.13, 0.05, 0.08, new MeshBasicMaterial({ color: PALETTE.police }), 0.08);
        for (const light of [lightRed, lightBlue]) {
          light.position.y = 0.42;
          model.add(light);
        }
      } else {
        model = carModel(car.id, TRAFFIC_COLORS[car.id % TRAFFIC_COLORS.length]!);
      }
      model.scale.setScalar(CAR_SCALE);
      this.scene.add(model);
      this.visuals.push({ car, model, lightRed, lightBlue });
    }
  }

  private buildSparks(): void {
    const colors = ['#ffb13d', '#ff6a2a', PALETTE.windowLit];
    for (let i = 0; i < SPARK_COUNT; i++) {
      const mesh = box(0.5, 0.5, 0.5, glow(colors[i % colors.length]!));
      mesh.castShadow = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this.sparks.push({ mesh, life: 0, vx: 0, vy: 0, vz: 0 });
    }
  }

  /** Šipka nad autem ukazuje vzdušnou čarou k dálnici. */
  private buildArrow(): void {
    const tip = new Mesh(new ConeGeometry(0.9, 2.6, 4), glow(PALETTE.neon[0]!));
    tip.rotation.x = Math.PI / 2;
    this.arrow.add(tip);
    this.scene.add(this.arrow);
  }

  private resize(): void {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private placeCamera(blend: number): void {
    const { runner } = this.sim;
    const forwardX = Math.sin(runner.yaw);
    const forwardZ = Math.cos(runner.yaw);
    this.camera.position.lerp(
      new Vector3(runner.x - forwardX * CAMERA_BACK, CAMERA_UP, runner.z - forwardZ * CAMERA_BACK),
      blend,
    );
    this.lookAt.lerp(new Vector3(runner.x + forwardX * 7, 1.5, runner.z + forwardZ * 7), blend);
    this.camera.lookAt(this.lookAt);
    const fov = runner.boosting ? BOOST_FOV : BASE_FOV;
    this.camera.fov += (fov - this.camera.fov) * Math.min(1, blend * 1.2);
    this.camera.updateProjectionMatrix();
  }

  private spawnSparks(crash: CrashEvent): void {
    const amount = Math.min(14, Math.round(crash.force));
    let spawned = 0;
    for (const spark of this.sparks) {
      if (spark.life > 0) continue;
      spark.life = SPARK_LIFE * (0.5 + Math.random() * 0.5);
      spark.mesh.position.set(crash.x, 1.2, crash.z);
      spark.mesh.visible = true;
      spark.vx = (Math.random() - 0.5) * 22;
      spark.vy = 6 + Math.random() * 12;
      spark.vz = (Math.random() - 0.5) * 22;
      if (++spawned >= amount) break;
    }
  }

  private updateSparks(dt: number): void {
    for (const spark of this.sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      spark.vy -= 30 * dt;
      spark.mesh.position.x += spark.vx * dt;
      spark.mesh.position.y = Math.max(0.2, spark.mesh.position.y + spark.vy * dt);
      spark.mesh.position.z += spark.vz * dt;
      spark.mesh.visible = spark.life > 0;
    }
  }

  render(dt: number): void {
    this.time += dt;
    const flash = Math.floor(this.time * 7) % 2 === 0;
    for (const visual of this.visuals) {
      const { car, model } = visual;
      model.position.set(car.x, 0, car.z);
      model.rotation.y = car.yaw;
      if (visual.lightRed) visual.lightRed.visible = flash;
      if (visual.lightBlue) visual.lightBlue.visible = !flash;
    }
    for (const crash of this.sim.takeCrashes()) this.spawnSparks(crash);
    this.updateSparks(dt);
    const { runner, goal } = this.sim;
    this.arrow.position.set(runner.x, 6, runner.z);
    this.arrow.rotation.y = Math.atan2(goal.x - runner.x, goal.z - runner.z);
    this.sun.position.set(runner.x + 50, 90, runner.z + 30);
    this.sun.target.position.set(runner.x, 0, runner.z);
    this.placeCamera(Math.min(1, dt * 5));
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
