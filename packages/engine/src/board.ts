import { RESOURCES, type Board, type Edge, type Resource, type Tile, type Vertex } from './types.js';
import { shuffle } from './random.js';

const POSITIONS: Array<[number, number]> = [];
for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) if (Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)) <= 2) POSITIONS.push([q, r]);
const CORNERS: Array<[number, number]> = [[2,0],[1,1],[-1,1],[-2,0],[-1,-1],[1,-1]];
const NUMBER_TOKENS = [2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12];
const HARBOR_KINDS: Array<'generic' | Resource> = ['generic','generic','generic','generic',...RESOURCES];

export function createBoard(seed: number): { board: Board; rngState: number } {
  const kinds: Array<Resource | 'desert'> = ['brick','brick','brick','lumber','lumber','lumber','lumber','wool','wool','wool','wool','grain','grain','grain','grain','ore','ore','ore','desert'];
  const shuffledKinds = shuffle(kinds, seed); const shuffledNumbers = shuffle(NUMBER_TOKENS, shuffledKinds.state);
  const vertexByKey = new Map<string, Vertex>(); const edgeByKey = new Map<string, Edge>();
  const tiles: Tile[] = [];
  const point = (q: number, r: number, corner: number): [number, number] => [3*q + CORNERS[corner]![0], 2*r + q + CORNERS[corner]![1]];
  for (let i = 0; i < POSITIONS.length; i++) {
    const [q,r] = POSITIONS[i]!; const verts: number[] = [];
    for (let c = 0; c < 6; c++) {
      const [x,y] = point(q,r,c); const key = `${x},${y}`;
      if (!vertexByKey.has(key)) vertexByKey.set(key, { id: vertexByKey.size, x, y, edges: [], tiles: [] });
      verts.push(vertexByKey.get(key)!.id);
    }
    const edgeIds: number[] = [];
    for (let c = 0; c < 6; c++) {
      const a=verts[c]!, b=verts[(c+1)%6]!; const key=[a,b].sort((x,y)=>x-y).join(':');
      if (!edgeByKey.has(key)) edgeByKey.set(key,{id:edgeByKey.size,vertices:[Math.min(a,b),Math.max(a,b)],tiles:[],kind:'land'});
      const edge=edgeByKey.get(key)!; edge.tiles.push(i); edgeIds.push(edge.id);
    }
    const kind=shuffledKinds.items[i]!; const number=kind==='desert'?null:0;
    tiles.push({id:i,q,r,kind,number,vertices:verts,edges:edgeIds,islandId:0});
  }
  const vertices=[...vertexByKey.values()]; const edges=[...edgeByKey.values()];
  for (const e of edges) for (const v of e.vertices) vertices[v]!.edges.push(e.id);
  for (const t of tiles) for (const v of t.vertices) vertices[v]!.tiles.push(t.id);
  const desert=tiles.find(t=>t.kind==='desert')!;
  // Assign number tokens independently of resource layout, preserving the exact token multiset.
  const tokenOrder=shuffle(NUMBER_TOKENS, shuffledNumbers.state).items; let tokenIndex=0;
  for (const t of tiles) t.number=t.kind==='desert'?null:tokenOrder[tokenIndex++]!;
  const coastEdges=edges.filter(e=>e.tiles.length===1).sort((a,b)=>{const ea=vertices[a.vertices[0]]!,eb=vertices[a.vertices[1]]!,fa=vertices[b.vertices[0]]!,fb=vertices[b.vertices[1]]!;return Math.atan2((ea.y+eb.y)/2,(ea.x+eb.x)/2)-Math.atan2((fa.y+fb.y)/2,(fa.x+fb.x)/2);});
  const harborKinds=shuffle(HARBOR_KINDS, tokenIndex + shuffledKinds.state).items;
  // Each harbor occupies the two endpoints of one spaced coastal edge.
  for (let h=0;h<9;h++) {const edge=coastEdges[Math.floor((h+0.5)*coastEdges.length/9)]!;for(const v of edge.vertices)vertices[v]!.harbor={id:h,kind:harborKinds[h]!,ratio:harborKinds[h]==='generic'?3:2};}
  const board={tiles,vertices,edges,desertTile:desert.id};
  return {board,rngState:shuffle(NUMBER_TOKENS,shuffledNumbers.state).state};
}

export function adjacentVertices(board: Board, vertexId: number): number[] {
  return board.vertices[vertexId]!.edges.flatMap(id=>board.edges[id]!.vertices).filter(id=>id!==vertexId);
}
export function adjacentTiles(board: Board, vertexId: number): number[] { return board.vertices[vertexId]!.tiles; }
