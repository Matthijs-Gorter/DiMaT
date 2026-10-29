export const RESOURCES = ['brick', 'lumber', 'wool', 'grain', 'ore'] as const;
export type BaseResource = (typeof RESOURCES)[number];
export type Resource = BaseResource | (string & { readonly __resourceExtension?: never });
export type ResourceSet = Record<BaseResource, number> & Record<string, number>;
export type DevCard = 'knight' | 'victoryPoint' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly';
export type TileKind = Resource | 'desert';
export type EdgeKind = 'land' | 'coast' | 'sea';

export interface Tile { id: number; q: number; r: number; kind: TileKind; number: number | null; vertices: number[]; edges: number[]; islandId: number; }
export interface Vertex { id: number; x: number; y: number; edges: number[]; tiles: number[]; harbor?: { id: number; kind: 'generic' | Resource; ratio: number }; }
export interface Edge { id: number; vertices: [number, number]; tiles: number[]; kind: EdgeKind; }
export interface Board { tiles: Tile[]; vertices: Vertex[]; edges: Edge[]; desertTile: number; }
export interface Building { owner: number; kind: 'settlement' | 'city'; }
export interface Road { owner: number; }
export interface HeldDevCard { kind: DevCard; boughtTurn: number; }
export interface Player { id: string; resources: ResourceSet; devCards: HeldDevCard[]; knightsPlayed: number; roadsLeft: number; settlementsLeft: number; citiesLeft: number; revealedVictoryPoints: number; }
export interface GameSettings { playerCount: 3 | 4; victoryTarget: number; }
export type Phase = 'setupSettlement' | 'setupRoad' | 'roll' | 'discard' | 'robber' | 'build' | 'finished';
export interface GameState {
  version: 1; seed: number; rngState: number; settings: GameSettings; board: Board; players: Player[];
  buildings: Array<Building | null>; roads: Array<Road | null>; bank: ResourceSet; devDeck: DevCard[]; playedDevCards: DevCard[];
  phase: Phase; activePlayer: number; setupOrder: number[]; setupPosition: number; setupRoadVertex: number | null;
  pendingDiscards: number[]; afterRobberPhase: 'roll' | 'build'; robberTile: number; turnNumber: number; hasPlayedDevCard: boolean;
  longestRoadHolder: number | null; largestArmyHolder: number | null; winner: number | null; lastRoll: [number, number] | null;
}

export interface BaseAction { playerId: string; }
export type GameAction =
  | (BaseAction & { type: 'placeSettlement'; vertex: number })
  | (BaseAction & { type: 'placeRoad'; edge: number })
  | (BaseAction & { type: 'roll' })
  | (BaseAction & { type: 'discard'; resources: Partial<ResourceSet> })
  | (BaseAction & { type: 'moveRobber'; tile: number; victimId?: string })
  | (BaseAction & { type: 'buildRoad'; edge: number })
  | (BaseAction & { type: 'buildSettlement'; vertex: number })
  | (BaseAction & { type: 'buildCity'; vertex: number })
  | (BaseAction & { type: 'buyDevelopmentCard' })
  | (BaseAction & { type: 'playKnight'; tile: number; victimId?: string })
  | (BaseAction & { type: 'playRoadBuilding'; edges: number[] })
  | (BaseAction & { type: 'playYearOfPlenty'; resources: Resource[] })
  | (BaseAction & { type: 'playMonopoly'; resource: Resource })
  | (BaseAction & { type: 'domesticTrade'; partnerId: string; give: Resource; receive: Resource; giveCount: number; receiveCount: number })
  | (BaseAction & { type: 'maritimeTrade'; give: Resource; receive: Resource })
  | (BaseAction & { type: 'endTurn' })
  | (BaseAction & { type: 'revealVictoryPoint' });
export interface GameEvent { type: string; privateTo?: string; [key: string]: unknown; }
export interface Transition { state: GameState; events: GameEvent[]; }
export interface ReplayInput { seed: number; settings: GameSettings; actions: GameAction[]; }
export interface PlayerView {
  playerId: string; phase: Phase; activePlayerId: string; turnNumber: number; hasPlayedDevCard: boolean; bank: ResourceSet; developmentCardsRemaining: number; seed: number; settings: GameSettings;
  players: Array<{ id: string; resourceCount: number; developmentCardCount: number; visibleVictoryPoints: number; roadsLeft: number; settlementsLeft: number; citiesLeft: number; knightsPlayed: number; longestRoadLength: number; hasLongestRoad: boolean; hasLargestArmy: boolean }>;
  ownResources: ResourceSet; ownDevelopmentCards: HeldDevCard[]; buildings: Array<Building | null>; roads: Array<Road | null>;
  board: Board; robberTile: number; legalActions: GameAction[]; winnerId: string | null; lastRoll: [number, number] | null;
}
