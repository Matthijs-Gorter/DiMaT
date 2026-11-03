import type { MapTileKind, Resource } from '@dimat/maps';
import { cornerPoint } from '@dimat/maps';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TILE_ASSETS: Partial<Record<MapTileKind, string>> = {
  brick: 'brick.png', lumber: 'hout.png', wool: 'schaap.png', grain: 'graan.png', ore: 'erts.png', desert: 'woestijn.png'
};
const ART = { canvasWidth: 1225, canvasHeight: 1311, x: 47, y: 1, width: 1132, height: 1309 };
const PIPS: Readonly<Record<number, number>> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const LABELS: Record<MapTileKind, string> = {
  brick: 'Heuvel', lumber: 'Bos', wool: 'Weide', grain: 'Akker', ore: 'Gebergte', desert: 'Woestijn',
  water: 'Water', gold: 'Goud', fog: 'Mist'
};
const COLORS: Record<MapTileKind, string> = {
  brick: '#b86550', lumber: '#4f8d59', wool: '#a7c77b', grain: '#e2bc55', ore: '#74828b', desert: '#d9b880',
  water: '#468fb5', gold: '#e9cf56', fog: '#99a5ad'
};

export interface TerrainLayerOptions { showNumber?: boolean; showLabel?: boolean; outline?: boolean; className?: string; }

function svg(tag: string): SVGElement { return document.createElementNS(SVG_NS, tag); }

export function terrainImagePath(kind: MapTileKind): string | null {
  const asset = TILE_ASSETS[kind];
  return asset ? `/tiles/${asset}` : null;
}

/** Same actual terrain image and scaled hex geometry used by the game board and map editor. */
export function createTerrainTileVisual(kind: MapTileKind, cx: number, cy: number, number: number | null, options: TerrainLayerOptions = {}): SVGGElement {
  const group = svg('g') as SVGGElement;
  group.setAttribute('class', `terrain-tile-visual${options.className ? ` ${options.className}` : ''}`);
  const artWidth = 2 * Math.sqrt(3) * ((Math.sqrt(3) - .1) / Math.sqrt(3)) / ART.width;
  const x = cx - (ART.x + ART.width / 2) * artWidth;
  const y = cy - (ART.y + ART.height / 2) * artWidth;
  const image = svg('image');
  const path = terrainImagePath(kind);
  if (path) {
    image.setAttribute('href', path);
    image.setAttribute('x', String(x)); image.setAttribute('y', String(y));
    image.setAttribute('width', String(ART.canvasWidth * artWidth)); image.setAttribute('height', String(ART.canvasHeight * artWidth));
    image.setAttribute('preserveAspectRatio', 'xMidYMid meet'); image.setAttribute('class', 'terrain-art');
    image.setAttribute('pointer-events', 'none'); group.append(image);
  } else {
    const water = svg('path');
    water.setAttribute('d', hexPath(cx, cy));
    water.setAttribute('fill', COLORS[kind]); water.setAttribute('class', `terrain-art terrain-art-${kind}`); group.append(water);
  }
  if (options.outline !== false) {
    const outline = svg('path'); outline.setAttribute('d', hexPath(cx, cy));
    outline.setAttribute('class', 'terrain-art-outline'); outline.setAttribute('pointer-events', 'none'); group.append(outline);
  }
  if (options.showNumber && number !== null) {
    const token = svg('circle'); token.setAttribute('cx', String(cx)); token.setAttribute('cy', String(cy)); token.setAttribute('r', '.6');
    token.setAttribute('class', `number-token${number === 6 || number === 8 ? ' hot' : ''}`); group.append(token);
    const label = svg('text'); label.setAttribute('x', String(cx)); label.setAttribute('y', String(cy + .16));
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'number-label'); label.textContent = String(number); group.append(label);
    const pips = PIPS[number] ?? 0;
    for (let index = 0; index < pips; index++) {
      const pip = svg('circle'); pip.setAttribute('cx', String(cx + (index - (pips - 1) / 2) * .16)); pip.setAttribute('cy', String(cy + .43));
      pip.setAttribute('r', '.045'); pip.setAttribute('class', 'pip-dot'); group.append(pip);
    }
  }
  if (options.showLabel) {
    const label = svg('text'); label.setAttribute('x', String(cx)); label.setAttribute('y', String(cy + .8));
    label.setAttribute('text-anchor', 'middle'); label.setAttribute('class', 'terrain-name-label'); label.textContent = LABELS[kind]; group.append(label);
  }
  return group;
}

export function terrainTileColor(kind: MapTileKind): string { return COLORS[kind]; }
export function terrainResourceForKind(kind: MapTileKind): Resource | null {
  return kind === 'brick' || kind === 'lumber' || kind === 'wool' || kind === 'grain' || kind === 'ore' ? kind : null;
}

function hexPath(cx: number, cy: number): string {
  const corners: ReadonlyArray<readonly [number, number]> = [[1, -1], [1, 1], [0, 2], [-1, 1], [-1, -1], [0, -2]];
  return `${corners.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${cx + x * Math.sqrt(3)} ${cy + y}`).join(' ')} Z`;
}

export function mapHarborCenter(q: number, r: number, side: number): [number, number] {
  const first = cornerPoint(q, r, side), second = cornerPoint(q, r, (side + 1) % 6);
  const middle: [number, number] = [(first[0] + second[0]) * Math.sqrt(3) / 2, (first[1] + second[1]) / 2];
  const inside: [number, number] = [(2 * q + r) * Math.sqrt(3), 3 * r];
  const dx = middle[0] - inside[0], dy = middle[1] - inside[1], length = Math.hypot(dx, dy) || 1;
  return [middle[0] + dx / length * 1.1, middle[1] + dy / length * 1.1];
}
