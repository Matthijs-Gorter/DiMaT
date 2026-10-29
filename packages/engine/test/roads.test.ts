import { describe, expect, it } from 'vitest';
import { apply, legalActions, longestRoadLength, recomputeAwards } from '../src/index.js';
import { connectRoad, placeSetupSettlement, stateAt } from './helpers.js';
import type { GameState } from '../src/types.js';

function findCycle(state:GameState,length:number):number[]{
  const board=state.board;
  for(let start=0;start<board.vertices.length;start++){
    const path:number[]=[];const visit=(v:number,used:Set<number>):number[]|null=>{
      if(path.length===length)return v===start?path.slice():null;
      for(const eid of board.vertices[v]!.edges){if(used.has(eid))continue;const e=board.edges[eid]!;const n=e.vertices[0]===v?e.vertices[1]:e.vertices[0];if(n<start&&n!==start)continue;path.push(eid);used.add(eid);const result=visit(n,used);if(result)return result;used.delete(eid);path.pop();}
      return null;
    };const result=visit(start,new Set());if(result)return result;
  }
  throw new Error(`No cycle length ${length}`);
}
function findDisjointPath(state:GameState,length:number,blocked:number[]):number[]{const ban=new Set(blocked);const b=state.board;for(let start=0;start<b.vertices.length;start++){const path:number[]=[];const used=new Set<number>();const go=(v:number):boolean=>{if(path.length===length)return true;for(const e of b.vertices[v]!.edges){if(ban.has(e)||used.has(e))continue;const x=b.edges[e]!;const n=x.vertices[0]===v?x.vertices[1]:x.vertices[0];path.push(e);used.add(e);if(go(n))return true;used.delete(e);path.pop();}return false;};if(go(start))return path;}throw new Error('No disjoint route');}
function findPath(state:GameState,length:number):number[]{
  const board=state.board;for(let start=0;start<board.vertices.length;start++){const path:number[]=[];const used=new Set<number>();const visit=(v:number):boolean=>{if(path.length===length)return true;for(const e of board.vertices[v]!.edges){if(used.has(e))continue;const edge=board.edges[e]!;const n=edge.vertices[0]===v?edge.vertices[1]:edge.vertices[0];path.push(e);used.add(e);if(visit(n))return true;used.delete(e);path.pop();}return false;};if(visit(start))return path;}throw new Error('No path found');
}
describe('Longest Road',()=>{
  it('counts a six-edge loop without repeating edges',()=>{const s=stateAt();for(const edge of findCycle(s,6))connectRoad(s,edge);expect(longestRoadLength(s,0)).toBe(6);});
  it('counts only the longest branch rather than summing branches',()=>{const s=stateAt();const pairs:[[number,number],[number,number],[number,number],[number,number],[number,number],[number,number]]=[[0,1],[1,2],[2,3],[3,4],[2,5],[5,6]];s.board.vertices=Array.from({length:7},(_,id)=>({id,x:id,y:0,edges:[],tiles:[]}));s.board.edges=pairs.map(([a,b],id)=>({id,vertices:[a,b] as [number,number],tiles:[],kind:'land' as const}));for(const e of s.board.edges)for(const v of e.vertices)s.board.vertices[v]!.edges.push(e.id);s.roads=Array.from({length:6},()=>({owner:0}));expect(longestRoadLength(s,0)).toBe(4);});

  it('does not extend through an opponent building',()=>{const s=stateAt();let blockedEdge=-1;for(const edge of s.board.edges){const [a,b]=edge.vertices;for(const next of s.board.vertices[b]!.edges){if(next===edge.id)continue;const end=s.board.edges[next]!.vertices.find(v=>v!==b)!;if(s.board.vertices[end]!.edges.some(other=>other!==next&&s.board.edges[other]!.vertices.some(v=>v!==end&&v!==b))){s.buildings[a]={owner:0,kind:'settlement'};s.buildings[b]={owner:1,kind:'settlement'};s.roads[edge.id]={owner:0};blockedEdge=next;break;}}if(blockedEdge>=0)break;}expect(blockedEdge).toBeGreaterThanOrEqual(0);expect(legalActions(s,'p0').some(a=>a.type==='buildRoad'&&a.edge===blockedEdge)).toBe(false);});
  it('stops at an opponent building',()=>{const s=stateAt();const path=findPath(s,5);for(const e of path)connectRoad(s,e);const split=s.board.edges[path[2]!]!.vertices[1];s.buildings[split]={owner:1,kind:'settlement'};expect(longestRoadLength(s,0)).toBeLessThan(5);});
  it('awards exactly five segments, but not four',()=>{const s=stateAt();for(const e of findPath(s,4))connectRoad(s,e);recomputeAwards(s);expect(s.longestRoadHolder).toBeNull();connectRoad(s,findPath(s,5).find(e=>!s.roads[e])!);recomputeAwards(s);expect(s.longestRoadHolder).toBe(0);});
  it('keeps the incumbent on a tie',()=>{const s=stateAt();const path=findPath(s,5);for(const e of path)connectRoad(s,e,0);const other=findPath(s,5).filter(e=>!s.roads[e]).slice(0,5);for(const e of other)connectRoad(s,e,1);s.longestRoadHolder=0;recomputeAwards(s);expect(s.longestRoadHolder).toBe(0);});
  it('clears ownership when multiple new players tie',()=>{const s=stateAt();const p0=findPath(s,5);for(const e of p0)connectRoad(s,e,0);const p1=findDisjointPath(s,5,s.roads.map((r,i)=>r?i:-1).filter(i=>i>=0));for(const e of p1)connectRoad(s,e,1);recomputeAwards(s);expect(s.longestRoadHolder).toBeNull();});
});

describe('piece limits and awards',()=>{
  it('returns the settlement piece when upgrading to a city',()=>{const s=stateAt();const vertex=10;placeSetupSettlement(s,vertex);const edge=s.board.vertices[vertex]!.edges[0]!;connectRoad(s,edge);s.players[0]!.resources={brick:0,lumber:0,wool:0,grain:2,ore:3};s.bank={brick:19,lumber:19,wool:19,grain:17,ore:16};const a=legalActions(s,'p0').find(x=>x.type==='buildCity'&&x.vertex===vertex)!;const n=apply(s,a).state;expect(n.players[0]!.settlementsLeft).toBe(5);expect(n.players[0]!.citiesLeft).toBe(3);});
});
