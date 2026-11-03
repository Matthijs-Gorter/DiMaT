import {
  BEGINNER_MAP_CODE, RESOURCES, adjacentEmptyCoordinates, computeRegions, cornerPoint, evaluateMapQuality, mapTileCenter,
  generateMap, key, neighbor, validateMap, vertexKey,
  type MapDefinition, type MapTile, type MapTileKind, type Resource, type TerrainStyle
} from '@dimat/maps';
import { mapDefinitionSchema } from '@dimat/protocol';
import { readApiJson } from './api-json.js';
import { createTerrainTileVisual, mapHarborCenter, terrainTileColor } from './terrain-rendering.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
type EditorTool = 'select' | 'add' | 'remove' | 'terrain' | 'number' | 'harbor' | 'river';
type Harbor = MapDefinition['harbors'][number];
type River = MapDefinition['rivers'][number];

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text) result.textContent = text;
  return result;
}
function svgNode(tag: string): SVGElement { return document.createElementNS(SVG_NS, tag); }
function editorIcon(name: 'back' | 'undo' | 'redo' | 'load' | 'save' | 'sparkle' | 'feather'): SVGSVGElement {
  const paths: Record<typeof name, string[]> = {
    back: ['M19 12H5', 'm12 19-7-7 7-7'], undo: ['M3 7v6h6', 'M4 13a8 8 0 1 0 2-5.5L3 10'],
    redo: ['M21 7v6h-6', 'M20 13a8 8 0 1 1-2-5.5l3 2.5'], load: ['M3 7h7l2 2h9v11H3z', 'M12 16V10', 'm9 13 3-3 3 3'],
    save: ['M5 3h12l3 3v15H4V3z', 'M8 3v6h8V3', 'M8 21v-7h8v7'],
    sparkle: ['m12 3 1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3z', 'm19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z'],
    feather: ['M20 4c-7 0-12 2-14 7-1 3 1 6 4 6 5 0 8-6 10-13z', 'M4 21c2-5 6-8 11-11', 'M8 17l-3-1', 'M12 13l-1-3']
  };
  const svg = svgNode('svg') as SVGSVGElement; svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.classList.add('map-editor-icon');
  for (const d of paths[name]) { const path = svgNode('path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}
function point(q: number, r: number, corner: number): [number, number] {
  const [x, y] = cornerPoint(q, r, corner);
  return [x * Math.sqrt(3), y];
}
function center(q: number, r: number): [number, number] { return mapTileCenter(q, r); }
function sideKey(q: number, r: number, side: number): string {
  const adjacent = neighbor({ q, r }, side);
  return [key({ q, r }), key(adjacent)].sort().join('|');
}
function emptyMap(): MapDefinition {
  return {
    schemaVersion: 1, id: 'custom-empty', name: 'Nieuwe kaart', style: 'custom', seed: 1,
    players: { min: 2, max: 8 }, victoryTarget: 10, tiles: [], harbors: [], rivers: [], islands: [],
    features: [], allowSeparateIslands: false, meta: { generatorVersion: 2, options: { balance: 'random' } }
  };
}
function resource(kind: MapTileKind): kind is Resource { return (RESOURCES as readonly string[]).includes(kind); }
function mapMessage(text: string): string {
  const translations: Record<string, string> = {
    'map has no land tiles': 'De kaart heeft geen landtegels.',
    'No legal pair of starting settlements exists.': 'Er is geen geldig paar startlocaties voor nederzettingen.',
    'The weakest legal starting pairs produce less than half the expected resources of the strongest typical pairs.': 'De zwakste geldige startparen leveren minder dan de helft op van de verwachte grondstoffen van de sterkste gebruikelijke paren.',
    'Starting-pair production varies considerably; consider balanced mode or editing number tokens.': 'De productie tussen startparen verschilt sterk. Overweeg een gebalanceerde indeling of pas de nummertokens aan.',
    "2 legal starting combinations are unusually weak compared to the map's other choices.": 'Twee geldige startcombinaties zijn opvallend zwakker dan de andere keuzes op de kaart.'
  };
  const combinationMatch = text.match(/^(\d+) legal starting combinations are unusually (weak|strong) compared with the map's other choices\.$/);
  if (combinationMatch) return `${combinationMatch[1]} geldige startcombinaties zijn opvallend ${combinationMatch[2] === 'weak' ? 'zwakker' : 'sterker'} dan de andere keuzes op de kaart.`;
  const setupMatch = text.match(/^fewer than (\d+) non-adjacent legal setup vertices$/);
  if (setupMatch) return `Deze kaart heeft te weinig gescheiden startlocaties voor ${setupMatch[1]} nederzettingen. Voeg tegels toe via Bewerken → Tegel toevoegen of verlaag het aantal deelnemers.`;
  const tileCountMatch = text.match(/^only (\d+) land tiles for up to (\d+) players$/);
  if (tileCountMatch) return `Deze kaart heeft ${tileCountMatch[1]} landtegels voor maximaal ${tileCountMatch[2]} deelnemers; de startkeuzes kunnen krap zijn.`;
  return translations[text] ?? text;
}

export function mountMapEditor(root: HTMLElement, onBack: () => void, onStartGame: (map: MapDefinition, humanCount: number, botCount: number) => Promise<void>): void {
  let map: MapDefinition | undefined, statusMessage = '', shareCode = '';
  let selectedTile: string | null = null, selectedHarbor: number | null = null, selectedRiver: string | null = null;
  let tool: EditorTool = 'select';

  const page = node('main', 'map-editor'), heading = node('header', 'map-editor-heading'), back = node('button', 'gx-btn map-editor-back', 'Terug');
  back.type = 'button'; back.onclick = onBack;
  const brand = node('strong', 'map-editor-brand', 'DiMaT'), titleBadge = node('span', 'map-editor-title-badge', 'Map-editor');
  const headingActions = node('div', 'map-editor-header-actions'), undo = node('button', 'gx-btn map-editor-undo', 'Ongedaan maken'), redo = node('button', 'gx-btn map-editor-redo', 'Opnieuw');
  undo.type = 'button'; redo.type = 'button'; undo.disabled = true; redo.disabled = true;
  back.prepend(editorIcon('back')); undo.prepend(editorIcon('undo')); redo.prepend(editorIcon('redo')); titleBadge.prepend(editorIcon('feather'));
  heading.append(back, brand, titleBadge, headingActions); headingActions.append(undo, redo); page.append(heading);
  const generator = node('section', 'card map-generator'), style = node('select'), size = node('input'), players = node('output');
  const humanCount = node('select'), botCount = node('select');
  const islands = node('input'), rivers = node('select'), lakes = node('input'), seed = node('input'), balance = node('select');
  for (const name of ['standard', 'continent', 'archipelago', 'river', 'lakes', 'atoll', 'irregular', 'random'] as TerrainStyle[]) style.append(new Option(name, name));
  for (let count = 1; count <= 8; count++) humanCount.append(new Option(String(count), String(count)));
  for (let count = 0; count <= 7; count++) botCount.append(new Option(String(count), String(count)));
  humanCount.value = '1'; botCount.value = '2'; players.dataset.count = '3';
  humanCount.setAttribute('aria-label', 'Menselijke spelers'); botCount.setAttribute('aria-label', 'AI-bots');
  players.setAttribute('aria-label', 'Totaal spelers');
  size.type = 'number'; size.min = '19'; size.max = '150'; size.value = '19'; size.setAttribute('aria-label', 'Landtegels');
  islands.type = 'number'; islands.min = '2'; islands.max = '20'; islands.value = '3'; islands.setAttribute('aria-label', 'Aantal eilanden');
  rivers.append(new Option('1 rivier', '1'), new Option('2 rivieren', '2'));
  lakes.type = 'number'; lakes.min = '1'; lakes.max = '3'; lakes.value = '2'; lakes.setAttribute('aria-label', 'Aantal meren');
  seed.type = 'number'; seed.value = '1'; seed.setAttribute('aria-label', 'Seed');
  balance.append(new Option('Willekeurige indeling', 'random'), new Option('Gebalanceerde start', 'balanced'));
  const fields = node('div', 'map-editor-fields');
  for (const [label, control] of [['Stijl', style], ['Menselijke spelers', humanCount], ['AI-bots', botCount], ['Totaal spelers', players], ['Landtegels', size], ['Eilanden', islands], ['Rivieren', rivers], ['Meren', lakes], ['Seed', seed], ['Balans', balance]] as const) {
    const item = node('label', '', label); item.append(control); fields.append(item);
  }
  const generate = node('button', 'primary map-editor-generate', 'Genereer kaart'); generate.type = 'button';
  generate.prepend(editorIcon('sparkle'));
  const startGame = node('button', 'primary map-editor-start-game', 'Start spel'); startGame.type = 'button'; startGame.hidden = true; startGame.disabled = true;
  const blank = node('button', '', 'Lege kaart'); blank.type = 'button';
  const beginner = node('button', '', 'Beginnerskaart'); beginner.type = 'button'; beginner.dataset.testid = 'load-beginner-map';
  generator.append(fields, beginner, generate, startGame);
  const updateParticipantTotal = (changed: 'humans' | 'bots' | 'both' = 'both') => {
    let humans = Number(humanCount.value), bots = Number(botCount.value);
    if (changed === 'humans' && (humans + bots < 2 || humans + bots > 8)) {
      const valid = Array.from({ length: 8 }, (_, index) => index).filter(count => count + bots >= 2 && count + bots <= 8);
      bots = valid.includes(bots) ? bots : valid[0] ?? Math.max(0, Math.min(7, 2 - humans)); botCount.value = String(bots);
    }
    if (changed === 'bots' && (humans + bots < 2 || humans + bots > 8)) {
      const valid = Array.from({ length: 8 }, (_, index) => index + 1).filter(count => count + bots >= 2 && count + bots <= 8);
      humans = valid.includes(humans) ? humans : valid[0] ?? 1; humanCount.value = String(humans);
    }
    humans = Number(humanCount.value); bots = Number(botCount.value);
    for (const option of Array.from(humanCount.options)) option.disabled = Number(option.value) + bots < 2 || Number(option.value) + bots > 8;
    for (const option of Array.from(botCount.options)) option.disabled = humans + Number(option.value) < 2 || humans + Number(option.value) > 8;
    players.dataset.count = String(humans + bots);
    players.textContent = `${humans + bots} / 8 spelers`;
    players.classList.toggle('at-limit', humans + bots === 8);
    if (map) updateReport();
  };
  humanCount.onchange = () => updateParticipantTotal('humans'); botCount.onchange = () => updateParticipantTotal('bots');

  const toolbar = node('section', 'card map-editor-tools'), toolSelect = node('select'), terrain = node('select'), number = node('select');
  const harborKind = node('select'), showNumbers = node('input'), showTerrainLabels = node('input'), avoidAdjacentRed = node('input');
  const toolNames: Array<[EditorTool, string]> = [['select', 'Selecteren'], ['add', 'Tegel toevoegen'], ['remove', 'Tegel verwijderen'], ['terrain', 'Terrein wijzigen'], ['number', 'Nummer wijzigen'], ['harbor', 'Haven plaatsen / verplaatsen'], ['river', 'Rivier tekenen / wissen']];
  for (const [value, label] of toolNames) toolSelect.append(new Option(label, value));
  for (const kind of [...RESOURCES, 'desert', 'water'] as MapTileKind[]) terrain.append(new Option(kind, kind));
  for (const value of [2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) number.append(new Option(String(value), String(value)));
  for (const kind of ['generic', ...RESOURCES]) harborKind.append(new Option(kind, kind));
  avoidAdjacentRed.type = 'checkbox'; avoidAdjacentRed.checked = true; avoidAdjacentRed.setAttribute('aria-label', 'Geen aangrenzende rode nummers');
  toolSelect.setAttribute('aria-label', 'Bewerkgereedschap'); terrain.setAttribute('aria-label', 'Terreintype');
  number.setAttribute('aria-label', 'Tegelnummer'); harborKind.setAttribute('aria-label', 'Haventype');
  const numberToggle = node('label', 'map-editor-toggle', 'Nummertokens tonen'); showNumbers.type = 'checkbox'; showNumbers.checked = true; numberToggle.prepend(showNumbers);
  const labelsToggle = node('label', 'map-editor-toggle', 'Terreinlabels tonen'); showTerrainLabels.type = 'checkbox'; labelsToggle.prepend(showTerrainLabels);
  const toolsFields = node('div', 'map-editor-fields');
  for (const [label, control] of [['Gereedschap', toolSelect], ['Terrein', terrain], ['Nummer', number], ['Haventype', harborKind]] as const) {
    const item = node('label', '', label); item.append(control); toolsFields.append(item);
  }
  const loadCode = node('input'); loadCode.placeholder = 'Deelcode'; loadCode.setAttribute('aria-label', 'Kaartcode');
  const load = node('button', 'map-editor-accent', 'Kaart laden'); load.type = 'button';
  load.prepend(editorIcon('load'));
  const exportJson = node('button', '', 'Download JSON'); exportJson.type = 'button';
  const importJson = node('button', '', 'Importeer JSON'); importJson.type = 'button';
  const jsonFile = node('input'); jsonFile.type = 'file'; jsonFile.accept = '.json,application/json'; jsonFile.hidden = true; jsonFile.setAttribute('aria-label', 'JSON-bestand');
  const name = node('input'); name.placeholder = 'Kaartnaam'; name.maxLength = 100; name.setAttribute('aria-label', 'Kaartnaam');
  const validation = node('div', 'map-validation'), quality = node('div', 'map-quality'), feedback = node('div', 'map-editor-feedback');
  const selectedInfo = node('div', 'map-selection-info');
  const save = node('button', 'primary map-editor-save', 'Opslaan'); save.type = 'button'; save.setAttribute('aria-label', 'Opslaan en deelcode maken'); save.disabled = true;
  save.prepend(editorIcon('save'));
  const mapBoard = node('div', 'map-editor-board');
  const redToggle = node('label', 'map-editor-toggle', 'Houd 6/8 uit elkaar'); redToggle.prepend(avoidAdjacentRed);
  const editorHeading = node('h2', 'map-editor-panel-title', 'Bewerken');
  const mapNameLabel = node('label', 'map-editor-name-label', 'Kaartnaam'); mapNameLabel.append(name);
  const tabs = node('div', 'map-editor-tabs'), editTab = node('button', 'is-active', 'Bewerken'), settingsTab = node('button', '', 'Instellingen');
  editTab.type = 'button'; settingsTab.type = 'button'; editTab.setAttribute('role', 'tab'); settingsTab.setAttribute('role', 'tab');
  editTab.setAttribute('aria-selected', 'true'); settingsTab.setAttribute('aria-selected', 'false');
  tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Editorpanelen'); tabs.append(editTab, settingsTab);
  const editPanel = node('div', 'map-editor-tab-panel'), settingsPanel = node('div', 'map-editor-tab-panel');
  editPanel.setAttribute('role', 'tabpanel'); settingsPanel.setAttribute('role', 'tabpanel'); settingsPanel.hidden = true;
  editPanel.append(toolsFields, selectedInfo, blank);
  settingsPanel.append(redToggle, numberToggle, labelsToggle, mapNameLabel, loadCode, exportJson, importJson, jsonFile);
  const selectTab = (editing: boolean) => {
    editTab.classList.toggle('is-active', editing); settingsTab.classList.toggle('is-active', !editing);
    editTab.setAttribute('aria-selected', String(editing)); settingsTab.setAttribute('aria-selected', String(!editing));
    editPanel.hidden = !editing; settingsPanel.hidden = editing;
  };
  editTab.onclick = () => selectTab(true); settingsTab.onclick = () => selectTab(false);
  toolbar.append(editorHeading, tabs, editPanel, settingsPanel);
  const settingsDetails = node('section', 'map-editor-details map-editor-settings');
  const qualityDetails = node('details', 'map-editor-details map-editor-quality-details');
  const settingsSummary = node('h2', 'map-editor-detail-summary', 'Kaartinstellingen'), qualitySummary = node('summary', 'map-editor-detail-summary', 'Kaartkwaliteit');
  settingsDetails.append(settingsSummary, generator);
  qualityDetails.append(qualitySummary, quality, validation);
  const rightPanel = node('aside', 'map-editor-right'); rightPanel.append(settingsDetails, qualityDetails, feedback);
  const canvasHint = node('p', 'map-editor-canvas-hint', 'Klik op een + om een tegel te plaatsen');
  const canvasPanel = node('section', 'map-editor-canvas-panel is-empty'); canvasPanel.append(canvasHint, mapBoard);
  headingActions.append(load, save);
  const layout = node('div', 'map-editor-layout'); layout.append(toolbar, canvasPanel, rightPanel);
  const footer = node('footer', 'map-editor-summary');
  page.append(layout, footer); root.replaceChildren(page);

  function updateRegions(): void {
    if (!map) return;
    map.tiles.sort((a, b) => a.r - b.r || a.q - b.q);
    const regions = computeRegions(map), counts = new Map<number, number>();
    map.tiles = map.tiles.map(tile => {
      if (tile.kind === 'water') return { ...tile, islandId: 0 };
      const islandId = regions.get(key(tile)) ?? 0; counts.set(islandId, (counts.get(islandId) ?? 0) + 1);
      return { ...tile, islandId };
    });
    map.islands = [...counts].sort(([a], [b]) => a - b).map(([id, tileCount]) => ({ id, tileCount, specialVP: 0 }));
  }
  function markCustom(): void {
    if (!map) return;
    map.style = 'custom'; map.meta.generatorVersion = 2;
    map.meta.options = { ...(map.meta.options ?? {}), balance: balance.value };
    map.name = name.value.trim() || 'Eigen kaart'; shareCode = ''; statusMessage = '';
  }
  function outerWaterKeys(definition: MapDefinition): Set<string> {
    const index = new Map(definition.tiles.map(tile => [key(tile), tile] as const));
    const coords = definition.tiles.map(tile => tile), minQ = Math.min(...coords.map(tile => tile.q)) - 1;
    const maxQ = Math.max(...coords.map(tile => tile.q)) + 1, minR = Math.min(...coords.map(tile => tile.r)) - 1;
    const maxR = Math.max(...coords.map(tile => tile.r)) + 1;
    const queue: Array<{ q: number; r: number }> = [], outside = new Set<string>();
    const add = (coord: { q: number; r: number }) => {
      const id = key(coord), tile = index.get(id);
      if (outside.has(id) || coord.q < minQ || coord.q > maxQ || coord.r < minR || coord.r > maxR || tile?.kind !== undefined && tile.kind !== 'water') return;
      outside.add(id); queue.push(coord);
    };
    for (let q = minQ; q <= maxQ; q++) { add({ q, r: minR }); add({ q, r: maxR }); }
    for (let r = minR; r <= maxR; r++) { add({ q: minQ, r }); add({ q: maxQ, r }); }
    for (let cursor = 0; cursor < queue.length; cursor++) for (let side = 0; side < 6; side++) add(neighbor(queue[cursor]!, side));
    return outside;
  }
  function outerCoast(q: number, r: number, side: number): boolean {
    if (!map) return false;
    const byKey = new Map(map.tiles.map(tile => [key(tile), tile] as const));
    const tile = byKey.get(key({ q, r })), across = neighbor({ q, r }, side);
    if (!tile || tile.kind === 'water' || byKey.get(key(across))?.kind && byKey.get(key(across))?.kind !== 'water') return false;
    const acrossTile = byKey.get(key(across));
    if (acrossTile?.kind === 'water') return outerWaterKeys(map).has(key(across));
    return true;
  }
  function harborPlacementValid(q: number, r: number, side: number, ignoreId?: number): boolean {
    if (!map || !outerCoast(q, r, side)) return false;
    const candidate = new Set([vertexKey(q, r, side), vertexKey(q, r, (side + 1) % 6)]);
    return map.harbors.filter(harbor => harbor.id !== ignoreId).every(harbor =>
      !candidate.has(vertexKey(harbor.tile.q, harbor.tile.r, harbor.side)) &&
      !candidate.has(vertexKey(harbor.tile.q, harbor.tile.r, (harbor.side + 1) % 6))
    );
  }
  function validRiver(q: number, r: number, side: number): boolean {
    if (!map) return false;
    const index = new Map(map.tiles.map(tile => [key(tile), tile] as const));
    return index.get(key({ q, r }))?.kind !== undefined && index.get(key({ q, r }))?.kind !== 'water' &&
      index.get(key(neighbor({ q, r }, side)))?.kind !== undefined && index.get(key(neighbor({ q, r }, side)))?.kind !== 'water';
  }
  function riverTouchesExisting(q: number, r: number, side: number): boolean {
    if (!map || map.rivers.length === 0) return true;
    const candidate = new Set([`${point(q, r, side).join(',')}`, `${point(q, r, (side + 1) % 6).join(',')}`]);
    return map.rivers.some(river => candidate.has(point(river.tile.q, river.tile.r, river.side).join(',')) || candidate.has(point(river.tile.q, river.tile.r, (river.side + 1) % 6).join(',')));
  }
  function validRiverPlacement(q: number, r: number, side: number): boolean {
    if (!map || !validRiver(q, r, side) || !riverTouchesExisting(q, r, side)) return false;
    const trial = { ...map, rivers: [...map.rivers, { tile: { q, r }, side: side as River['side'] }] };
    const regions = computeRegions(trial), sizes = new Map<number, number>();
    for (const tile of map.tiles) if (tile.kind !== 'water') {
      const region = regions.get(key(tile)); sizes.set(region ?? -1, (sizes.get(region ?? -1) ?? 0) + 1);
    }
    return [...sizes.values()].every(size => size >= 3);
  }
  function targetCandidates(): Array<{ q: number; r: number }> {
    if (!map) return [];
    if (map.tiles.length === 0) return Array.from({ length: 6 }, (_, side) => neighbor({ q: 0, r: 0 }, side));
    if (map.tiles.every(tile => tile.kind === 'water')) {
      const occupied = new Set(map.tiles.map(tile => key(tile))), candidates = new Map<string, { q: number; r: number }>();
      for (const tile of map.tiles) for (let side = 0; side < 6; side++) { const next = neighbor(tile, side); if (!occupied.has(key(next))) candidates.set(key(next), next); }
      return [...candidates.values()].sort((a, b) => a.r - b.r || a.q - b.q);
    }
    return adjacentEmptyCoordinates(map);
  }
  function mapViewBox(): string {
    if (!map || map.tiles.length === 0) return '-4 -4 8 8';
    const all = [...map.tiles, ...targetCandidates().map(coord => ({ ...coord, kind: 'water' as const, number: null, islandId: 0 }))];
    const vertices = all.flatMap(tile => Array.from({ length: 6 }, (_, corner) => point(tile.q, tile.r, corner)));
    const xs = vertices.map(([x]) => x), ys = vertices.map(([, y]) => y);
    const left = Math.min(...xs) - 1, top = Math.min(...ys) - 1;
    return `${left} ${top} ${Math.max(...xs) - left + 1} ${Math.max(...ys) - top + 1}`;
  }
  function draw(): void {
    mapBoard.replaceChildren(); if (!map) { canvasPanel.classList.add('is-empty'); return; }
    canvasPanel.classList.toggle('is-empty', map.tiles.length === 0);
    const svg = svgNode('svg'); svg.setAttribute('viewBox', mapViewBox()); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Bewerkbare kaart');
    svg.classList.add('map-editor-svg');
    const riverKeys = new Set(map.rivers.map(river => sideKey(river.tile.q, river.tile.r, river.side)));
    const harborByEdge = new Map(map.harbors.map(harbor => [sideKey(harbor.tile.q, harbor.tile.r, harbor.side), harbor] as const));
    for (const tile of map.tiles) {
      const [cx, cy] = center(tile.q, tile.r), group = createTerrainTileVisual(tile.kind, cx, cy, tile.number, {
        showNumber: showNumbers.checked, showLabel: showTerrainLabels.checked, className: `editor-terrain-${tile.kind}`
      });
      group.dataset.tile = key(tile);
      if (selectedTile === key(tile)) group.classList.add('editor-selected');
      const corners = Array.from({ length: 6 }, (_, corner) => point(tile.q, tile.r, corner));
      const hit = svgNode('polygon'); hit.setAttribute('points', corners.map(([x, y]) => `${x},${y}`).join(' '));
      hit.setAttribute('fill', 'transparent'); hit.setAttribute('stroke', 'transparent'); hit.setAttribute('class', 'map-tile-hit');
      hit.dataset.tile = key(tile); hit.addEventListener('click', event => { event.stopPropagation(); onTile(tile); }); group.append(hit);
      svg.append(group);
    }
    if (tool === 'add') for (const coord of targetCandidates()) {
      const [cx, cy] = center(coord.q, coord.r), outline = svgNode('polygon');
      outline.setAttribute('points', Array.from({ length: 6 }, (_, corner) => point(coord.q, coord.r, corner).join(',')).join(' '));
      outline.setAttribute('class', 'map-add-target'); outline.dataset.tile = key(coord);
      outline.setAttribute('fill', terrainTileColor(terrain.value as MapTileKind));
      outline.addEventListener('click', event => { event.stopPropagation(); addTile(coord.q, coord.r); }); svg.append(outline);
      const plus = svgNode('text'); plus.setAttribute('x', String(cx)); plus.setAttribute('y', String(cy + .18)); plus.setAttribute('text-anchor', 'middle'); plus.setAttribute('class', 'map-add-label'); plus.textContent = '+'; svg.append(plus);
    }
    const drawnEdges = new Set<string>();
    for (const tile of map.tiles) if (tile.kind !== 'water') for (let side = 0; side < 6; side++) {
      const id = sideKey(tile.q, tile.r, side), [aX, aY] = point(tile.q, tile.r, side), [bX, bY] = point(tile.q, tile.r, (side + 1) % 6);
      if (drawnEdges.has(id)) continue;
      drawnEdges.add(id);
      const existingRiver = riverKeys.has(id), harbor = harborByEdge.get(id), movingHarborId = selectedHarbor ?? undefined;
      const isHarborTarget = tool === 'harbor' && harborPlacementValid(tile.q, tile.r, side, movingHarborId);
      const isRiverTarget = tool === 'river' && (existingRiver || validRiverPlacement(tile.q, tile.r, side));
      if (existingRiver || isRiverTarget) {
        const line = svgNode('line'); line.setAttribute('x1', String(aX)); line.setAttribute('y1', String(aY)); line.setAttribute('x2', String(bX)); line.setAttribute('y2', String(bY));
        line.setAttribute('class', `map-river-edge${existingRiver ? ' river-existing' : ' river-candidate'}${selectedRiver === id ? ' editor-selected' : ''}`);
        line.addEventListener('click', event => { event.stopPropagation(); onRiver(tile.q, tile.r, side); }); svg.append(line);
      }
      if (harbor || isHarborTarget) {
        const marker = svgNode('g'); marker.setAttribute('class', `map-harbor${isHarborTarget ? ' harbor-target' : ''}${harbor ? ' harbor-existing' : ''}`);
        marker.dataset.edge = id;
        const [mx, my] = mapHarborCenter(tile.q, tile.r, side);
        const firstConnector = svgNode('line'); firstConnector.setAttribute('x1', String(aX)); firstConnector.setAttribute('y1', String(aY)); firstConnector.setAttribute('x2', String(mx)); firstConnector.setAttribute('y2', String(my)); firstConnector.setAttribute('class', 'harbor-connector'); marker.append(firstConnector);
        const secondConnector = svgNode('line'); secondConnector.setAttribute('x1', String(bX)); secondConnector.setAttribute('y1', String(bY)); secondConnector.setAttribute('x2', String(mx)); secondConnector.setAttribute('y2', String(my)); secondConnector.setAttribute('class', 'harbor-connector'); marker.append(secondConnector);
        const hitArea = svgNode('circle'); hitArea.setAttribute('cx', String(mx)); hitArea.setAttribute('cy', String(my)); hitArea.setAttribute('r', '.55');
        hitArea.setAttribute('fill', 'transparent'); hitArea.setAttribute('pointer-events', 'all'); hitArea.setAttribute('class', 'map-harbor-hit'); marker.append(hitArea);
        const circle = svgNode('circle'); circle.setAttribute('cx', String(mx)); circle.setAttribute('cy', String(my)); circle.setAttribute('r', harbor ? '.32' : '.22');
        circle.setAttribute('class', 'map-harbor-marker'); marker.append(circle);
        if (harbor) {
          const label = svgNode('text'); label.setAttribute('x', String(mx)); label.setAttribute('y', String(my + .11)); label.setAttribute('text-anchor', 'middle');
          label.setAttribute('class', 'map-harbor-label'); label.textContent = harbor.kind === 'generic' ? '3:1' : `2:1 ${harbor.kind.slice(0, 1).toUpperCase()}`; marker.append(label);
        }
        marker.addEventListener('click', event => { event.stopPropagation(); onHarbor(tile.q, tile.r, side, harbor); }); svg.append(marker);
      }
    }
    mapBoard.append(svg);
  }
  function addTile(q: number, r: number): void {
    if (!map || map.tiles.some(tile => tile.q === q && tile.r === r)) return;
    const kind = terrain.value as MapTileKind;
    const tile: MapTile = { q, r, kind, number: resource(kind) ? Number(number.value) : null, islandId: 0, fixedKind: true, ...(resource(kind) ? { fixedNumber: true } : {}) };
    map.tiles.push(tile); selectedTile = key(tile); selectedHarbor = null; selectedRiver = null; markCustom(); updateRegions(); refresh();
  }
  function onTile(tile: MapTile): void {
    if (!map) return;
    if (tool === 'remove') {
      const id = key(tile); map.tiles = map.tiles.filter(candidate => key(candidate) !== id);
      map.rivers = map.rivers.filter(river => key(river.tile) !== id && key(neighbor(river.tile, river.side)) !== id);
      map.harbors = map.harbors.filter(harbor => key(harbor.tile) !== id);
      selectedTile = null; markCustom(); updateRegions(); refresh(); return;
    }
    selectedTile = key(tile); selectedHarbor = null; selectedRiver = null;
    if (tool === 'terrain') {
      const kind = terrain.value as MapTileKind;
      map.tiles = map.tiles.map(candidate => key(candidate) !== key(tile) ? candidate : {
        ...candidate, kind, number: resource(kind) ? candidate.number ?? Number(number.value) : null,
        fixedKind: true, ...(resource(kind) ? { fixedNumber: candidate.fixedNumber ?? false } : { fixedNumber: false })
      });
      markCustom(); updateRegions();
    } else if (tool === 'number' && resource(tile.kind)) {
      map.tiles = map.tiles.map(candidate => key(candidate) === key(tile) ? { ...candidate, number: Number(number.value), fixedNumber: true } : candidate);
      markCustom();
    }
    refresh();
  }
  function onRiver(q: number, r: number, side: number): void {
    if (!map) return;
    const id = sideKey(q, r, side), index = map.rivers.findIndex(river => sideKey(river.tile.q, river.tile.r, river.side) === id);
    if (tool === 'select' && index >= 0) { selectedRiver = id; selectedTile = null; selectedHarbor = null; refresh(); return; }
    if (index >= 0) { map.rivers.splice(index, 1); selectedRiver = null; }
    else {
      if (!validRiverPlacement(q, r, side)) return;
      map.rivers.push({ tile: { q, r }, side: side as River['side'] }); selectedRiver = id;
    }
    selectedTile = null; markCustom(); updateRegions(); refresh();
  }
  function onHarbor(q: number, r: number, side: number, existing?: Harbor): void {
    if (!map) return;
    if (existing) { selectedHarbor = existing.id; selectedTile = null; selectedRiver = null; refresh(); return; }
    if (!harborPlacementValid(q, r, side, selectedHarbor ?? undefined)) return;
    const occupied = map.harbors.find(harbor => sideKey(harbor.tile.q, harbor.tile.r, harbor.side) === sideKey(q, r, side));
    const kind = harborKind.value === 'generic' ? 'generic' : harborKind.value as Resource;
    const ratio = kind === 'generic' ? 3 : 2;
    if (selectedHarbor !== null) {
      const moving = map.harbors.find(harbor => harbor.id === selectedHarbor);
      if (!moving || occupied) return;
      moving.tile = { q, r }; moving.side = side as Harbor['side']; moving.kind = kind; moving.ratio = ratio;
    } else if (!occupied) map.harbors.push({ id: Math.max(-1, ...map.harbors.map(harbor => harbor.id)) + 1, kind, ratio, tile: { q, r }, side: side as Harbor['side'] });
    markCustom(); refresh();
  }
  function updateSelection(): void {
    selectedInfo.replaceChildren();
    const current = map?.tiles.find(tile => key(tile) === selectedTile);
    const selectedPort = map?.harbors.find(harbor => harbor.id === selectedHarbor);
    const selectedStream = map?.rivers.find(river => sideKey(river.tile.q, river.tile.r, river.side) === selectedRiver);
    if (current) {
      selectedInfo.append(node('strong', '', `Geselecteerd: ${current.kind} ${key(current)}`));
      const remove = node('button', '', 'Verwijder tegel'); remove.type = 'button'; remove.onclick = () => { tool = 'remove'; toolSelect.value = 'remove'; onTile(current); }; selectedInfo.append(remove);
    } else if (selectedPort) {
      selectedInfo.append(node('strong', '', `Haven ${selectedPort.kind} · ${key(selectedPort.tile)}`));
      const change = node('button', '', 'Haventype toepassen'); change.type = 'button'; change.onclick = () => {
        const kind = harborKind.value === 'generic' ? 'generic' : harborKind.value as Resource;
        selectedPort.kind = kind; selectedPort.ratio = kind === 'generic' ? 3 : 2; markCustom(); refresh();
      };
      const reposition = node('button', '', 'Verplaats haven'); reposition.type = 'button'; reposition.onclick = () => { tool = 'harbor'; toolSelect.value = 'harbor'; refresh(); };
      const remove = node('button', '', 'Verwijder haven'); remove.type = 'button'; remove.onclick = () => { map!.harbors = map!.harbors.filter(port => port.id !== selectedPort.id); selectedHarbor = null; markCustom(); refresh(); };
      selectedInfo.append(change, reposition, remove);
    } else if (selectedStream) {
      selectedInfo.append(node('strong', '', `Riviersegment ${key(selectedStream.tile)} · zijde ${selectedStream.side + 1}`));
      const remove = node('button', '', 'Verwijder riviersegment'); remove.type = 'button'; remove.onclick = () => {
        map!.rivers = map!.rivers.filter(river => sideKey(river.tile.q, river.tile.r, river.side) !== selectedRiver);
        selectedRiver = null; markCustom(); updateRegions(); refresh();
      }; selectedInfo.append(remove);
    }
  }
  function updateReport(): void {
    validation.replaceChildren(); quality.replaceChildren();
    if (!map) { save.disabled = true; startGame.disabled = true; startGame.hidden = true; feedback.replaceChildren(); if (statusMessage) feedback.append(node('p', 'map-share-code', statusMessage)); footer.replaceChildren(node('span', 'map-editor-summary-empty', 'Genereer een kaart of begin met een lege kaart.')); return; }
    let result: ReturnType<typeof validateMap>;
    try { result = validateMap(map, { custom: true, balance: 'random', players: Number(players.dataset.count), minIslandSize: 1, avoidAdjacentRed: avoidAdjacentRed.checked }); }
    catch (error) { result = { ok: false, errors: [error instanceof Error ? error.message : 'Kaart kan niet worden gevalideerd.'], warnings: [] }; }
    const landCount = map.tiles.filter(tile => tile.kind !== 'water').length;
    validation.append(node('p', result.ok ? 'map-valid' : 'map-invalid', `${landCount} landtegels · ${result.errors.length} harde fouten · ${result.warnings.length} waarschuwingen`));
    for (const error of result.errors) validation.append(node('p', 'map-error', mapMessage(error)));
    for (const warning of result.warnings) validation.append(node('p', 'map-warning', mapMessage(warning)));
    const report = evaluateMapQuality(map, Number(players.dataset.count));
    const score = report.overallQualityScore, scorePanel = node('div', `map-quality-overview score-${score < 40 ? 'low' : score < 70 ? 'medium' : 'high'}`);
    const medallion = node('div', 'map-quality-medallion'); medallion.setAttribute('role', 'img'); medallion.setAttribute('aria-label', `Kaartkwaliteit ${score} van 100`);
    medallion.append(node('strong', '', String(score)), node('span', '', '/100'));
    const metrics = node('div', 'map-quality-metrics');
    for (const [label, value] of [
      ['Startlocaties voor deelnemers', `${report.availableSetupPositions}/${report.requiredSetupPositions}`],
      ['Startcombinaties', String(report.legalStartingCombinationCount)],
      ['Resourceverdeling', `${report.resourceDistributionScore}/100`],
      ['Productie (mediaan)', report.medianExpectedCardsPerRoll.toFixed(2)],
      ['Variatie per startpaar', `${report.resourceDiversityAverage.toFixed(1)} / 5`]
    ]) { const row = node('div', 'map-quality-metric'); row.append(node('span', '', label), node('strong', '', value)); metrics.append(row); }
    scorePanel.append(medallion, metrics); quality.append(node('h3', '', 'Kaartkwaliteit'), scorePanel);
    quality.append(node('small', 'map-quality-explanation', 'Score combineert startfairness, resourcevariatie en de verwachte productie. Een lage score is advies, geen afkeuring.'));
    for (const warning of report.warnings) quality.append(node('p', 'map-warning', mapMessage(warning)));
    feedback.replaceChildren();
    if (!result.ok) feedback.append(node('p', 'map-start-blocked', `Starten geblokkeerd: ${mapMessage(result.errors[0] ?? 'Kaart kan niet worden gevalideerd.')}`));
    if (statusMessage) feedback.append(node('p', 'map-share-code', statusMessage));
    if (shareCode) {
      const share = node('div', 'map-share-result'); share.append(node('strong', 'map-share-code', `Deelcode: ${shareCode}`));
      const copyCode = node('button', 'map-editor-copy-code', 'Kopieer code'); copyCode.type = 'button'; copyCode.onclick = async () => {
        try { await navigator.clipboard.writeText(shareCode); copyCode.textContent = 'Gekopieerd ✓'; }
        catch { loadCode.value = shareCode; loadCode.select(); copyCode.textContent = 'Code geselecteerd'; }
      };
      share.append(copyCode); feedback.append(share);
    }
    save.disabled = !result.ok;
    startGame.hidden = !result.ok; startGame.disabled = !result.ok;
    footer.replaceChildren();
    const qualityItem = node('span', 'map-editor-summary-quality', `⬡ Kaartkwaliteit ${score}/100`), countItem = node('span', '', `${landCount} landtegels`);
    const errorsItem = node('span', `map-editor-summary-errors${result.errors.length ? ' has-errors' : ''}`, `⛔ ${result.errors.length} harde fouten`);
    const warningsItem = node('span', `map-editor-summary-warnings${result.warnings.length ? ' has-warnings' : ''}`, `⚠ ${result.warnings.length} waarschuwingen`);
    footer.append(qualityItem, countItem, errorsItem, warningsItem);
  }
  function refresh(): void { draw(); updateSelection(); updateReport(); }
  async function selectBeginner(): Promise<void> {
    statusMessage = 'Beginnerskaart laden…'; refresh();
    try {
      const response = await fetch(`/api/maps/${BEGINNER_MAP_CODE}`), payload = await readApiJson<{ map: MapDefinition; message?: string }>(response, 'Beginnerskaart laden');
      if (!response.ok) throw new Error(payload.message ?? 'Beginnerskaart kon niet worden geladen.');
      map = payload.map as MapDefinition; name.value = map.name; shareCode = BEGINNER_MAP_CODE; statusMessage = 'Vaste beginnerskaart geladen.';
      selectedTile = null; selectedHarbor = null; selectedRiver = null; tool = 'select'; toolSelect.value = tool; refresh();
    } catch (error) { statusMessage = error instanceof Error ? error.message : 'Beginnerskaart kon niet worden geladen.'; refresh(); }
  }
  function createGeneratedMap(): void {
    map = undefined; shareCode = ''; statusMessage = '';
    try {
      const styleName = style.value as TerrainStyle, playerCount = Number(players.dataset.count) as 2 | 3 | 4 | 5 | 6 | 7 | 8;
      const target = Number(size.value);
      map = generateMap({
        style: styleName, seed: Number(seed.value), players: playerCount, balance: balance.value as 'random' | 'balanced',
        ...(styleName === 'standard' ? {} : { landTarget: target }),
        ...(styleName === 'archipelago' ? { islandCount: Number(islands.value) } : {}),
        ...(styleName === 'river' ? { riverCount: Number(rivers.value) } : {}),
        ...(styleName === 'lakes' ? { lakeCount: Number(lakes.value) } : {}),
        avoidAdjacentRed: avoidAdjacentRed.checked
      });
      name.value = map.name; selectedTile = null; selectedHarbor = null; selectedRiver = null; tool = 'select'; toolSelect.value = tool;
    } catch (error) { statusMessage = error instanceof Error ? error.message : 'Kaartgeneratie mislukt.'; }
    refresh();
  }
  generate.onclick = createGeneratedMap;
  startGame.onclick = async () => {
    if (!map || startGame.disabled) return;
    startGame.disabled = true; startGame.textContent = 'Starten…'; statusMessage = ''; updateReport();
    try { await onStartGame(structuredClone(map), Number(humanCount.value), Number(botCount.value)); }
    catch (error) { statusMessage = error instanceof Error ? error.message : 'Spel starten is mislukt.'; updateReport(); }
    finally { startGame.textContent = 'Start spel'; }
  };
  updateParticipantTotal();
  blank.onclick = () => { map = emptyMap(); name.value = map.name; selectedTile = null; selectedHarbor = null; selectedRiver = null; tool = 'add'; toolSelect.value = tool; statusMessage = 'Kies een terreintype en klik op een groen gemarkeerde plek om te beginnen.'; refresh(); };
  beginner.onclick = () => { void selectBeginner(); };
  toolSelect.onchange = () => { tool = toolSelect.value as EditorTool; refresh(); };
  for (const control of [showNumbers, showTerrainLabels]) control.onchange = draw;
  avoidAdjacentRed.onchange = () => {
    if (map) map.meta.options = { ...(map.meta.options ?? {}), avoidAdjacentRed: avoidAdjacentRed.checked };
    updateReport();
  };
  style.onchange = () => { avoidAdjacentRed.checked = style.value !== 'random'; };
  terrain.onchange = draw; harborKind.onchange = () => { if (selectedHarbor !== null) updateSelection(); };
  name.oninput = () => { markCustom(); updateReport(); };
  load.onclick = async () => {
    const code = loadCode.value.trim().toUpperCase(); if (!code) return;
    try {
      const response = await fetch(`/api/maps/${encodeURIComponent(code)}`), payload = await readApiJson<{ map: MapDefinition; message?: string }>(response, 'Kaart laden');
      if (!response.ok) throw new Error(payload.message ?? 'Kaart kon niet worden geladen.');
      map = payload.map as MapDefinition; name.value = map.name; shareCode = code; statusMessage = 'Kaart geladen.';
      selectedTile = null; selectedHarbor = null; selectedRiver = null; updateRegions(); refresh();
    } catch (error) { statusMessage = error instanceof Error ? error.message : 'Kaart kon niet worden geladen.'; refresh(); }
  };
  exportJson.onclick = () => {
    if (!map) return;
    const filename = `${map.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dimat-map'}.json`;
    const url = URL.createObjectURL(new Blob([`${JSON.stringify(map, null, 2)}\n`], { type: 'application/json' }));
    const anchor = node('a'); anchor.href = url; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    statusMessage = 'JSON-bestand gedownload.'; updateReport();
  };
  importJson.onclick = () => jsonFile.click();
  jsonFile.onchange = async () => {
    const file = jsonFile.files?.[0]; if (!file) return;
    try {
      const decoded: unknown = JSON.parse(await file.text()), parsed = mapDefinitionSchema.safeParse(decoded);
      if (!parsed.success) throw new Error('Dit JSON-bestand heeft geen geldige kaartstructuur.');
      const imported = parsed.data as MapDefinition;
      const validationResult = validateMap(imported, {
        custom: imported.style === 'custom',
        balance: imported.meta.options?.balance === 'balanced' ? 'balanced' : 'random',
        players: Number(players.dataset.count),
        minIslandSize: 1,
        avoidAdjacentRed: imported.meta.options?.avoidAdjacentRed !== false
      });
      map = imported; name.value = imported.name;
      balance.value = imported.meta.options?.balance === 'balanced' ? 'balanced' : 'random';
      avoidAdjacentRed.checked = imported.meta.options?.avoidAdjacentRed !== false;
      shareCode = ''; selectedTile = null; selectedHarbor = null; selectedRiver = null; tool = 'select'; toolSelect.value = tool;
      statusMessage = validationResult.ok
        ? `JSON-bestand ${file.name} geïmporteerd.`
        : `JSON-bestand ${file.name} geïmporteerd; herstel ${validationResult.errors.length} kaartfout(en) voordat je opslaat.`;
    } catch (error) {
      statusMessage = error instanceof Error ? error.message : 'JSON-bestand kon niet worden geïmporteerd.';
    } finally { jsonFile.value = ''; refresh(); }
  };
  save.onclick = async () => {
    if (!map) return;
    save.disabled = true; statusMessage = 'Kaart opslaan…'; updateReport();
    try {
      const response = await fetch('/api/maps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(map) });
      const payload = await readApiJson<{ shareCode: string; message?: string; details?: { errors?: string[] } }>(response, 'Kaart opslaan');
      if (!response.ok) {
        const details = Array.isArray(payload.details?.errors) ? ` ${payload.details.errors.join('; ')}` : '';
        throw new Error(`${payload.message ?? 'Kaart opslaan mislukt.'}${details}`);
      }
      shareCode = payload.shareCode; statusMessage = 'Kaart opgeslagen.'; updateReport();
    } catch (error) { statusMessage = error instanceof Error ? error.message : 'Kaart opslaan mislukt.'; updateReport(); }
  };
  map = emptyMap(); name.value = map.name; tool = 'add'; toolSelect.value = tool; refresh();
}
