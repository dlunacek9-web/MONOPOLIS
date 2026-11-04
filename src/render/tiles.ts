import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Object3D } from 'three';
import { BOARD } from '../core';
import type { Deed, GameState, TileId } from '../core';
import { cs } from '../i18n/cs';
import { buildRect, lotRect, plaqueRect } from './layout';
import type { Rect } from './layout';
import {
  airportModel,
  box,
  buildingsFor,
  forSaleSign,
  group,
  jailModel,
  kioskModel,
  officeModel,
  ownerFlag,
  parkingModel,
  place,
  powerPlantModel,
  raidModel,
  solid,
  stationModel,
  startModel,
  waterTowerModel,
} from './models';
import type { RaidModel } from './models';
import { PALETTE, PLAYER_COLORS } from './palette';
import { drawPlaque, plaqueCanvas } from './textures';
import { footText, iconFor, shortTileName, tileCity, tileColor } from './tile-info';

export type Highlight = 'none' | 'current' | 'build' | 'focus' | 'selected';

const HIGHLIGHT_COLORS: Record<Exclude<Highlight, 'none'>, string> = {
  current: PALETTE.highlightCurrent,
  build: PALETTE.highlightBuild,
  focus: PALETTE.highlightFocus,
  selected: PALETTE.neon[0]!,
};

const FRAME_THICKNESS = 0.09;

/** Rámeček kolem parcely. Má vlastní materiál, aby šel přebarvit. */
function frame(rect: Rect, y: number, material: MeshBasicMaterial): Group {
  const t = FRAME_THICKNESS;
  const edge = (w: number, d: number, x: number, z: number) => {
    const mesh = new Mesh(box(w, 0.03, d, material).geometry, material);
    return place(mesh, x, y, z);
  };
  return group(
    edge(rect.w, t, rect.x, rect.z - rect.d / 2 + t / 2),
    edge(rect.w, t, rect.x, rect.z + rect.d / 2 - t / 2),
    edge(t, rect.d, rect.x - rect.w / 2 + t / 2, rect.z),
    edge(t, rect.d, rect.x + rect.w / 2 - t / 2, rect.z),
  );
}

/** Stavby na políčkách, která nejde zastavět domy. */
function landmarkFor(tile: TileId, rect: Rect): { model: Object3D | null; raid: RaidModel | null } {
  const kind = BOARD[tile]!;
  let model: Object3D | null = null;
  let raid: RaidModel | null = null;
  switch (kind.kind) {
    case 'start':
      model = startModel(cs.city.startSign);
      break;
    case 'jail':
      model = jailModel();
      break;
    case 'parking':
      model = parkingModel();
      break;
    case 'goToJail':
      raid = raidModel();
      model = raid.model;
      break;
    case 'station':
      model = tile === 25 || tile === 35 ? airportModel(rect) : stationModel(rect);
      break;
    case 'utility':
      model = tile === 12 ? powerPlantModel() : waterTowerModel();
      break;
    case 'tax':
      model = officeModel();
      break;
    case 'card':
      model = kind.deck === 'tip' ? kioskModel(cs.city.kioskSign) : officeModel();
      break;
    case 'property':
      break;
  }
  if (model) model.position.set(rect.x, 0.12, rect.z);
  return { model, raid };
}

/** Jedna parcela: zem, štítek, vlastník, budovy a zvýraznění. */
export class TileVisual {
  readonly root = group();
  readonly pick: Mesh;
  readonly raid: RaidModel | null;
  private readonly lotMesh: Mesh;
  private readonly plaqueElement: HTMLCanvasElement;
  private readonly plaqueMap: CanvasTexture;
  private readonly ownerMaterial = new MeshBasicMaterial({ color: PALETTE.white });
  private readonly ownerFrame: Group;
  private readonly highlightMaterial = new MeshBasicMaterial({ color: PALETTE.white });
  private readonly highlightFrame: Group;
  private readonly build: Rect;
  private plaqueKey = '';
  private buildingKey = '';
  private buildings: Group | null = null;
  private marker: Group | null = null;

  constructor(readonly tile: TileId) {
    const lot = lotRect(tile);
    this.build = buildRect(tile);
    this.lotMesh = box(lot.w, 0.12, lot.d, PALETTE.lot, lot.x, 0, lot.z);
    this.lotMesh.castShadow = false;
    this.root.add(this.lotMesh);

    const plaque = plaqueRect(tile);
    const canvas = plaqueCanvas(plaque.w / plaque.d);
    this.plaqueElement = canvas.element;
    this.plaqueMap = canvas.map;
    const plate = new Mesh(
      new PlaneGeometry(plaque.w, plaque.d),
      new MeshBasicMaterial({ map: this.plaqueMap, fog: false }),
    );
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(plaque.x, 0.135, plaque.z);
    this.root.add(plate);

    const outline = lot;
    this.ownerFrame = frame(outline, 0.13, this.ownerMaterial);
    this.ownerFrame.visible = false;
    this.highlightFrame = frame(outline, 0.15, this.highlightMaterial);
    this.highlightFrame.visible = false;
    this.root.add(this.ownerFrame, this.highlightFrame);

    const { model, raid } = landmarkFor(tile, this.build);
    this.raid = raid;
    if (model) this.root.add(model);

    this.pick = new Mesh(new PlaneGeometry(outline.w, outline.d), solid(PALETTE.white));
    this.pick.rotation.x = -Math.PI / 2;
    this.pick.position.set(outline.x, 0.2, outline.z);
    this.pick.visible = false;
    this.pick.userData.tile = tile;
    this.root.add(this.pick);
  }

  update(state: GameState, highlight: Highlight): void {
    const deed = state.deeds[this.tile] ?? null;
    this.updatePlaque(state, deed);
    this.updateBuildings(deed);
    if (deed && deed.owner !== null) {
      this.ownerMaterial.color.set(PLAYER_COLORS[deed.owner]!);
      this.ownerFrame.visible = true;
    } else {
      this.ownerFrame.visible = false;
    }
    this.lotMesh.material = solid(deed?.mortgaged ? PALETTE.lotMortgaged : PALETTE.lot);
    this.highlightFrame.visible = highlight !== 'none';
    if (highlight !== 'none') this.highlightMaterial.color.set(HIGHLIGHT_COLORS[highlight]);
  }

  /** Zvýraznění pulzuje, aby šlo rychle najít, o které políčko jde. */
  tick(time: number): void {
    if (!this.highlightFrame.visible) return;
    this.highlightFrame.position.y = 0.02 + Math.sin(time * 5) * 0.02;
  }

  dispose(): void {
    this.plaqueMap.dispose();
  }

  private updatePlaque(state: GameState, deed: Deed | null): void {
    const foot = footText(state, this.tile);
    const owner = deed?.owner ?? null;
    const key = `${foot}|${owner}|${deed?.mortgaged ?? false}`;
    if (key === this.plaqueKey) return;
    this.plaqueKey = key;
    drawPlaque(this.plaqueElement, {
      band: tileColor(this.tile),
      city: tileCity(this.tile),
      icon: iconFor(this.tile),
      name: shortTileName(this.tile),
      foot,
      ownerColor: owner === null ? null : PLAYER_COLORS[owner]!,
      mortgaged: deed?.mortgaged ?? false,
    });
    this.plaqueMap.needsUpdate = true;
  }

  private updateBuildings(deed: Deed | null): void {
    if (!deed) return;
    const key = `${deed.level}|${deed.owner}`;
    if (key === this.buildingKey) return;
    this.buildingKey = key;
    if (this.buildings) this.root.remove(this.buildings);
    if (this.marker) this.root.remove(this.marker);
    this.buildings = null;
    this.marker = null;
    const tile = BOARD[this.tile]!;
    if (tile.kind === 'property') {
      this.buildings = buildingsFor(deed.level, this.build, tileColor(this.tile).bg, this.tile);
      this.root.add(this.buildings);
    }
    if (deed.level > 0) return;
    if (deed.owner !== null) {
      this.marker = ownerFlag(PLAYER_COLORS[deed.owner]!);
    } else if (tile.kind === 'property') {
      this.marker = forSaleSign();
    }
    if (this.marker) {
      const inset = Math.min(this.build.w, 1) * 0.3;
      this.marker.position.set(this.build.x + inset, 0.12, this.build.z);
      this.root.add(this.marker);
    }
  }
}
