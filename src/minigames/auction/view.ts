import {
  AmbientLight,
  Color,
  ConeGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Material } from 'three';
import { box } from '../../render/models';
import { figure } from '../figure';
import type { Figure } from '../figure';

const HALL = {
  sky: '#2a1420',
  floor: '#5d3b2c',
  carpet: '#8c2336',
  wall: '#4a2030',
  curtain: '#a32a3f',
  wood: '#6e4326',
  gold: '#ffc94d',
  suit: '#26222e',
  hat: '#14110f',
  paddle: '#f5efdc',
};
const ROW_HALF_WIDTH = 7;
/** Krajní dražitelé stojí blíž ke kameře, ať je prostřední nezakrývají panely dole. */
const ROW_Z = -1.5;
const ROW_CURVE = 1.2;
const PODIUM_Z = -5;
const RAISE_SECONDS = 0.8;
const KNOCK_SECONDS = 0.35;
const ARM_UP = -2.9;
/** Jak rychle se ruka a dřepnutí dotáhnou k cíli. */
const EASE = 10;

export interface SeatState {
  id: number;
  leading: boolean;
  out: boolean;
}

interface Seat {
  id: number;
  figure: Figure;
  ring: Mesh<RingGeometry, MeshBasicMaterial>;
  beam: Mesh<ConeGeometry, MeshBasicMaterial>;
  raise: number;
  slump: number;
  out: boolean;
  phase: number;
}

function translucent(color: string, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** 3D dražební síň: jen ukazuje, co se v dražbě děje. */
export class AuctionView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(46, 1, 0.5, 200);
  private readonly observer: ResizeObserver;
  private readonly seats = new Map<number, Seat>();
  private readonly gavelArm: Group;
  private knock = 0;
  private time = 0;

  constructor(
    private readonly host: HTMLElement,
    players: readonly { id: number; color: string }[],
    lotColor: string,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    host.append(this.renderer.domElement);

    this.scene.background = new Color(HALL.sky);
    this.scene.fog = new Fog(HALL.sky, 24, 60);
    this.scene.add(new HemisphereLight('#ffd9b0', '#3a2028', 1.3));
    this.scene.add(new AmbientLight('#b08a80', 0.5));
    const lamp = new DirectionalLight('#fff0cf', 1.6);
    lamp.position.set(-6, 18, 12);
    this.scene.add(lamp);

    this.buildHall(lotColor);
    this.gavelArm = this.buildAuctioneer();
    players.forEach((player, index) => this.addSeat(player, index, players.length));

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.camera.position.set(0, 8.5, 13.5);
    this.camera.lookAt(0, 2.6, -3);
  }

  private buildHall(lotColor: string): void {
    this.scene.add(box(50, 1, 40, HALL.floor, 0, -1, 0));
    this.scene.add(box(9, 0.04, 26, HALL.carpet, 0, 0, 2));
    this.scene.add(box(50, 16, 1, HALL.wall, 0, 0, -11));
    for (let x = -18; x <= 18; x += 3) {
      this.scene.add(box(2.2, 13, 0.6, HALL.curtain, x, 0, -10.2));
    }
    // Dražený pozemek stojí v barvě města na stojanu vedle řečnického pultu.
    this.scene.add(box(0.2, 3.4, 0.2, HALL.wood, 4.2, 0, PODIUM_Z));
    this.scene.add(box(3, 2.2, 0.2, HALL.gold, 4.2, 2.6, PODIUM_Z));
    this.scene.add(box(2.6, 1.8, 0.24, lotColor, 4.2, 2.8, PODIUM_Z));
    this.scene.add(box(6, 1, 4, HALL.wood, 0, 0, PODIUM_Z - 1));
  }

  private buildAuctioneer(): Group {
    const person = figure(HALL.suit, HALL.hat);
    person.root.position.set(0, 1, PODIUM_Z - 1.4);
    person.root.add(box(0.5, 0.7, 0.5, HALL.hat, 0, 2.4, 0));
    person.arms[1].rotation.x = ARM_UP / 2;
    const gavel = box(0.6, 0.26, 0.26, HALL.wood, 0, -0.95, 0);
    person.arms[1].add(gavel);
    this.scene.add(person.root);
    this.scene.add(box(3, 1.1, 1, HALL.wood, 0, 0.6, PODIUM_Z + 0.2));
    this.scene.add(box(3.2, 0.14, 1.2, HALL.gold, 0, 1.7, PODIUM_Z + 0.2));
    return person.arms[1];
  }

  private addSeat(player: { id: number; color: string }, index: number, count: number): void {
    const person = figure(HALL.suit, player.color);
    const shift = count === 1 ? 0 : (index / (count - 1)) * 2 - 1;
    const x = shift * ROW_HALF_WIDTH;
    const z = ROW_Z + Math.abs(shift) * ROW_CURVE;
    person.root.position.set(x, 0, z);
    person.root.rotation.y = Math.PI + Math.atan2(-x, z - PODIUM_Z);
    person.arms[1].add(box(0.5, 0.5, 0.08, HALL.paddle, 0, -1.05, 0));
    person.arms[1].add(box(0.42, 0.14, 0.1, player.color, 0, -0.85, 0));

    const ring = new Mesh(new RingGeometry(0.85, 1.15, 24), translucent(player.color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.07, z);
    this.scene.add(ring);
    const beam = new Mesh(new ConeGeometry(1.5, 13, 16, 1, true), translucent(HALL.gold, 0));
    beam.position.set(x, 6.5, z);
    this.scene.add(beam);
    this.scene.add(person.root);
    this.seats.set(player.id, {
      id: player.id,
      figure: person,
      ring,
      beam,
      raise: 0,
      slump: 0,
      out: false,
      phase: index * 1.7,
    });
  }

  update(states: readonly SeatState[]): void {
    for (const state of states) {
      const seat = this.seats.get(state.id);
      if (!seat) continue;
      seat.out = state.out;
      seat.beam.material.opacity = state.leading ? 0.2 : 0;
      seat.ring.material.opacity = state.out ? 0.2 : 0.9;
    }
  }

  /** Hráč právě přihodil: zvedne pádlo. */
  raisePaddle(id: number): void {
    const seat = this.seats.get(id);
    if (seat) seat.raise = RAISE_SECONDS;
  }

  knockGavel(): void {
    this.knock = KNOCK_SECONDS;
  }

  render(dt: number): void {
    this.time += dt;
    const blend = Math.min(1, dt * EASE);
    for (const seat of this.seats.values()) {
      seat.raise = Math.max(0, seat.raise - dt);
      const arm = seat.figure.arms[1];
      const target = seat.raise > 0 ? ARM_UP : -0.25;
      arm.rotation.x += (target - arm.rotation.x) * blend;
      seat.slump += ((seat.out ? 1 : 0) - seat.slump) * blend;
      seat.figure.root.rotation.x = seat.slump * 0.45;
      seat.figure.root.position.y = Math.abs(Math.sin(this.time * 2 + seat.phase)) * 0.06;
    }
    this.knock = Math.max(0, this.knock - dt);
    this.gavelArm.rotation.x = ARM_UP / 2 - Math.sin((this.knock / KNOCK_SECONDS) * Math.PI) * 1.1;
    this.camera.position.x = Math.sin(this.time * 0.35) * 0.5;
    this.camera.lookAt(0, 2.6, -3);
    this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
