import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { PALETTE } from './palette';

const FONT = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')!];
}

function texture(source: HTMLCanvasElement): CanvasTexture {
  const result = new CanvasTexture(source);
  result.colorSpace = SRGBColorSpace;
  result.anisotropy = 8;
  return result;
}

/** Malý seedovaný generátor. Vzhled města je pořád stejný a nesahá na RNG hry. */
export function seededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

export function skyTexture(): CanvasTexture {
  const [element, ctx] = canvas(4, 256);
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, PALETTE.skyTop);
  gradient.addColorStop(1, PALETTE.skyBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 256);
  return texture(element);
}

/** Plochá silueta mraku jako na malovaném pozadí. */
export function cloudTexture(seed: number): CanvasTexture {
  const [element, ctx] = canvas(512, 256);
  const random = seededRandom(seed);
  ctx.fillStyle = PALETTE.cloud;
  for (let i = 0; i < 9; i++) {
    const x = 70 + random() * 370;
    const radius = 30 + random() * 55 * (1 - Math.abs(x - 256) / 300);
    ctx.beginPath();
    ctx.arc(x, 200 - radius * 0.7, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillRect(40, 195, 432, 30);
  return texture(element);
}

export interface Facade {
  map: CanvasTexture;
  glow: CanvasTexture;
}

/** Zeď s okny. Rozsvícená okna jsou v druhé textuře, aby svítila i ve stínu. */
export function facadeTextures(brick: string, seed: number): Facade {
  const size = 256;
  const [element, ctx] = canvas(size, size);
  const [glowElement, glowCtx] = canvas(size, size);
  const random = seededRandom(seed);
  ctx.fillStyle = brick;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#00000018';
  for (let y = 0; y < size; y += 8) ctx.fillRect(0, y, size, 2);
  glowCtx.fillStyle = '#000';
  glowCtx.fillRect(0, 0, size, size);
  const cell = size / 4;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      const x = col * cell + cell * 0.24;
      const y = row * cell + cell * 0.18;
      const lit = random() < 0.38;
      ctx.fillStyle = '#00000030';
      ctx.fillRect(x - 4, y - 4, cell * 0.52 + 8, cell * 0.64 + 8);
      ctx.fillStyle = lit ? PALETTE.windowLit : PALETTE.windowDark;
      ctx.fillRect(x, y, cell * 0.52, cell * 0.64);
      if (lit) {
        glowCtx.fillStyle = PALETTE.windowLit;
        glowCtx.fillRect(x, y, cell * 0.52, cell * 0.64);
      }
    }
  }
  const map = texture(element);
  const glow = texture(glowElement);
  for (const item of [map, glow]) {
    item.wrapS = RepeatWrapping;
    item.wrapT = RepeatWrapping;
  }
  return { map, glow };
}

export function neonTexture(text: string, color: string): { map: CanvasTexture; aspect: number } {
  const height = 128;
  const [, probeCtx] = canvas(8, 8);
  probeCtx.font = `900 italic 84px ${FONT}`;
  const width = Math.ceil(probeCtx.measureText(text).width) + 80;
  const [element, ctx] = canvas(width, height);
  ctx.font = `900 italic 84px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffffd0';
  ctx.font = `900 italic 80px ${FONT}`;
  ctx.fillText(text, width / 2, height / 2);
  return { map: texture(element), aspect: width / height };
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export interface PlaqueContent {
  band: { bg: string; ink: string };
  city: string;
  icon: string;
  name: string;
  foot: string;
  ownerColor: string | null;
  mortgaged: boolean;
}

/** Štítek parcely namalovaný na zemi. Velikost písma se přizpůsobí délce názvu. */
export function drawPlaque(target: HTMLCanvasElement, content: PlaqueContent): void {
  const ctx = target.getContext('2d')!;
  const { width, height } = target;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = content.mortgaged ? PALETTE.plaqueMortgaged : PALETTE.plaque;
  ctx.fillRect(0, 0, width, height);

  const bandHeight = Math.round(height * 0.24);
  ctx.fillStyle = content.band.bg;
  ctx.fillRect(0, 0, width, bandHeight);
  const footHeight = content.foot ? Math.round(height * 0.26) : 0;
  if (content.foot) {
    ctx.fillStyle = content.ownerColor ?? '#00000018';
    ctx.fillRect(0, height - footHeight, width, footHeight);
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = content.band.ink;
  ctx.font = `800 ${Math.round(bandHeight * 0.72)}px ${FONT}`;
  ctx.fillText(
    content.city ? content.city.toUpperCase() : content.icon,
    width / 2,
    bandHeight / 2 + 2,
  );

  const padding = width * 0.04;
  const areaTop = bandHeight;
  const areaHeight = height - bandHeight - footHeight;
  let size = Math.round(areaHeight * 0.62);
  let lines: string[] = [];
  for (; size > 14; size -= 2) {
    ctx.font = `800 ${size}px ${FONT}`;
    lines = wrapLines(ctx, content.name, width - padding * 2);
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    if (lines.length * size * 1.08 <= areaHeight && widest <= width - padding * 2) break;
  }
  ctx.fillStyle = PALETTE.plaqueText;
  const lineHeight = size * 1.08;
  const start = areaTop + areaHeight / 2 - ((lines.length - 1) * lineHeight) / 2 + 2;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, start + i * lineHeight));

  if (content.foot) {
    ctx.fillStyle = content.ownerColor ? '#ffffff' : PALETTE.plaqueText;
    ctx.font = `800 ${Math.round(footHeight * 0.68)}px ${FONT}`;
    ctx.fillText(content.foot, width / 2, height - footHeight / 2 + 2);
  }
}

export function plaqueCanvas(aspect: number): { element: HTMLCanvasElement; map: CanvasTexture } {
  const [element] = canvas(512, Math.round(512 / aspect));
  return { element, map: texture(element) };
}
