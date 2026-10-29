import { describe, expect, it } from 'vitest';
import { apply, createGame, legalActions, RESOURCES } from '../src/index.js';
import { rngStateForRoll, stateAt } from './helpers.js';

describe('setup',()=>{
  it('uses forward then reverse order for three players',()=>{
    const s=createGame(2,{playerCount:3});expect(s.setupOrder).toEqual([0,1,2,2,1,0]);
    for(const player of [0,1,2,2,1]){expect(s.activePlayer).toBe(player);const v=legalActions(s,s.players[player]!.id).find(a=>a.type==='placeSettlement')!;const one=apply(s,v).state;const edge=legalActions(one,one.players[player]!.id).find(a=>a.type==='placeRoad')!;const two=apply(one,edge).state;Object.assign(s,two);}
    expect(s.activePlayer).toBe(0);
  });
  it('requires each setup road to attach to the settlement just placed',()=>{
    const s=createGame(4);const a=legalActions(s,'p0').find(x=>x.type==='placeSettlement')!;const one=apply(s,a).state;const options=legalActions(one,'p0');expect(options.length).toBeGreaterThan(0);expect(options.every(x=>x.type==='placeRoad'&&one.board.edges[x.edge]!.vertices.includes(a.vertex))).toBe(true);
  });
  it('enforces setup distance rule',()=>{
    const s=createGame(5);const a=legalActions(s,'p0').find(x=>x.type==='placeSettlement')!;const one=apply(s,a).state;const road=legalActions(one,'p0')[0]!;const two=apply(one,road).state;const forbidden=two.board.vertices[a.vertex]!.edges.flatMap(e=>two.board.edges[e]!.vertices).find(v=>v!==a.vertex)!;expect(legalActions(two,two.players[two.activePlayer]!.id).some(x=>x.type==='placeSettlement'&&x.vertex===forbidden)).toBe(false);
  });
  it('pays one resource per adjacent producing tile for the second settlement',()=>{
    const s=createGame(8,{playerCount:3});for(let i=0;i<3;i++){const v=legalActions(s,s.players[s.activePlayer]!.id).find(a=>a.type==='placeSettlement')!;let next=apply(s,v).state;const r=legalActions(next,next.players[next.activePlayer]!.id).find(a=>a.type==='placeRoad')!;next=apply(next,r).state;Object.assign(s,next);}
    const p=s.activePlayer;const v=legalActions(s,s.players[p]!.id).find(a=>a.type==='placeSettlement')!;let next=apply(s,v).state;const road=legalActions(next,next.players[p]!.id).find(a=>a.type==='placeRoad')!;next=apply(next,road).state;
    const expected=RESOURCES.reduce((out,r)=>{out[r]=s.board.tiles.filter(t=>t.vertices.includes(v.vertex)&&t.kind===r).length;return out;},{brick:0,lumber:0,wool:0,grain:0,ore:0});expect(next.players[p]!.resources).toEqual(expected);
  });
});

describe('turn state and seven',()=>{
  it('does not permit building or trading before the roll',()=>{const s=stateAt('roll');const actions=legalActions(s,'p0');expect(actions.map(a=>a.type)).toEqual(['roll']);expect(()=>apply(s,{playerId:'p0',type:'buildRoad',edge:0})).toThrow(/Illegal action/);});
  it('nine cards discard four, while exactly seven cards keep all cards',()=>{
    const s=stateAt('roll');s.players[0]!.resources={brick:0,lumber:0,wool:0,grain:0,ore:0};s.bank={brick:10,lumber:19,wool:19,grain:19,ore:19};s.players[1]!.resources={brick:9,lumber:0,wool:0,grain:0,ore:0};s.rngState=rngStateForRoll(7);let n=apply(s,legalActions(s,'p0')[0]!).state;expect(n.phase).toBe('discard');const choices=legalActions(n,'p1');expect(choices.every(a=>a.type==='discard'&&Object.values(a.resources).reduce<number>((x,y)=>x+(y??0),0)===4)).toBe(true);
    const discard=choices[0]!;n=apply(n,discard).state;expect(n.players[1]!.resources.brick).toBe(5);expect(n.phase).toBe('robber');
    const seven=stateAt('roll');seven.players[0]!.resources={brick:0,lumber:0,wool:0,grain:0,ore:0};seven.players[1]!.resources={brick:7,lumber:0,wool:0,grain:0,ore:0};seven.rngState=rngStateForRoll(7);expect(apply(seven,legalActions(seven,'p0')[0]!).state.phase).toBe('robber');
  });
  it('requires a new robber tile and permits no victim when none is adjacent',()=>{const s=stateAt('robber');const actions=legalActions(s,'p0');expect(actions.every(a=>a.type==='moveRobber'&&a.tile!==s.robberTile&&!a.victimId)).toBe(true);});
  it('does not mutate the source state and accepts equivalent object-key ordering',()=>{const s=stateAt('roll');const before=structuredClone(s);apply(s,{type:'roll',playerId:'p0'});expect(s).toEqual(before);expect(()=>apply(s,{type:'roll',playerId:'p0'})).not.toThrow();});
  it('cannot end the turn during discards or a pending robber move',()=>{const s=stateAt('robber');expect(legalActions(s,'p0').some(a=>a.type==='endTurn')).toBe(false);s.phase='discard';s.pendingDiscards=[0];expect(legalActions(s,'p0').some(a=>a.type==='endTurn')).toBe(false);});
});

describe('piece supply and components',()=>{
  it('uses the standard 19 tile, 54 vertex, 72 edge and development-card set',()=>{const s=createGame(17);expect(s.board.tiles).toHaveLength(19);expect(s.board.vertices).toHaveLength(54);expect(s.board.edges).toHaveLength(72);expect(s.bank).toEqual({brick:19,lumber:19,wool:19,grain:19,ore:19});expect(s.devDeck).toHaveLength(25);for(let harborId=0;harborId<9;harborId++){const vertices=s.board.vertices.filter(v=>v.harbor?.id===harborId);expect(vertices).toHaveLength(2);expect(vertices[0]!.edges.some(e=>s.board.edges[e]!.vertices.includes(vertices[1]!.id))).toBe(true);}});
  it('does not offer road or settlement construction when the matching supply is exhausted',()=>{const s=stateAt('build');s.players[0]!.roadsLeft=0;s.players[0]!.settlementsLeft=0;expect(legalActions(s,'p0').some(a=>a.type==='buildRoad'||a.type==='buildSettlement')).toBe(false);});
});
