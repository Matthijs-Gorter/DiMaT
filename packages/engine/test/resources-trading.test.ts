import { describe, expect, it } from 'vitest';
import { apply, legalActions, RESOURCES, resourceTotal } from '../src/index.js';
import { rngStateForRoll, stateAt } from './helpers.js';

describe('production and robber',()=>{
  it('blocks production when multiple players are owed a resource the bank cannot cover',()=>{
    const s=stateAt('roll');const tile=s.board.tiles.find(t=>t.kind==='brick')!;tile.number=5;s.robberTile=s.board.desertTile;s.buildings[tile.vertices[0]!]={owner:0,kind:'settlement'};s.buildings[tile.vertices[1]!]={owner:1,kind:'settlement'};s.bank.brick=1;s.players[0]!.resources.brick=0;s.players[1]!.resources.brick=0;s.rngState=rngStateForRoll(5);const n=apply(s,{playerId:'p0',type:'roll'}).state;expect(n.players[0]!.resources.brick).toBe(0);expect(n.players[1]!.resources.brick).toBe(0);expect(n.bank.brick).toBe(1);
  });
  it('gives the remainder to a sole recipient during bank shortage',()=>{
    const s=stateAt('roll');const tile=s.board.tiles.find(t=>t.kind==='ore')!;tile.number=5;s.buildings[tile.vertices[0]!]={owner:0,kind:'settlement'};s.players[0]!.resources.ore=0;s.bank.ore=1;s.rngState=rngStateForRoll(5);const n=apply(s,{playerId:'p0',type:'roll'}).state;expect(n.players[0]!.resources.ore).toBe(1);expect(n.bank.ore).toBe(0);
  });
  it('moves a stolen card without revealing its resource in the public event',()=>{
    const s=stateAt('robber');const tile=s.board.tiles.find(t=>t.id!==s.robberTile)!;s.buildings[tile.vertices[0]!]={owner:1,kind:'settlement'};s.players[1]!.resources.wool=1;s.players[0]!.resources={brick:0,lumber:0,wool:0,grain:0,ore:0};const a=legalActions(s,'p0').find(x=>x.type==='moveRobber'&&x.tile===tile.id&&x.victimId==='p1')!;const n=apply(s,a);expect(n.state.players[0]!.resources.wool).toBe(1);expect(JSON.stringify(n.events)).not.toContain('wool');const repeated=apply(structuredClone(s),a).state;expect(repeated.players[0]!.resources).toEqual(n.state.players[0]!.resources);
  });
  it('keeps resource circulation constant through production and steals',()=>{const s=stateAt('roll');for(const r of RESOURCES)expect(resourceTotal(s,r)).toBe(19);});
});

describe('trade rules',()=>{
  it('rejects same-resource trades and non-active-player trades',()=>{
    const s=stateAt('build');expect(legalActions(s,'p0').some(a=>a.type==='domesticTrade'||a.type==='proposeTrade')).toBe(false);expect(legalActions(s,'p1')).toEqual([]);
  });
  it('uses the best accessible harbor ratio',()=>{
    const s=stateAt('build');const harbors=s.board.vertices.map((v,i)=>v.harbor?i:-1).filter(v=>v>=0);for(const v of harbors)s.buildings[v]={owner:0,kind:'settlement'};s.players[0]!.resources.brick=2;s.bank.wool=1;const a=legalActions(s,'p0').find(x=>x.type==='maritimeTrade'&&x.give==='brick'&&x.receive==='wool');expect(a).toBeDefined();const result=apply(s,a!).events.find(e=>e.type==='maritimeTradeCompleted');expect(result?.ratio).toBe(2);
  });
  it('preserves each resource total after a maritime trade',()=>{const s=stateAt('build');const v=s.board.vertices.findIndex(x=>x.harbor?.kind==='generic');s.buildings[v]={owner:0,kind:'settlement'};s.players[0]!.resources={brick:3,lumber:0,wool:18,grain:0,ore:0};s.bank={brick:16,lumber:19,wool:1,grain:19,ore:19};const action=legalActions(s,'p0').find(x=>x.type==='maritimeTrade'&&x.give==='brick'&&x.receive==='wool')!;const n=apply(s,action).state;for(const r of RESOURCES)expect(resourceTotal(n,r)).toBe(19);});
});

describe('maritime ratios and domestic bundles',()=>{
  function stateForRatio(ratio:2|3|4){
    const s=stateAt('build');const harbor=ratio===4?undefined:s.board.vertices.findIndex(v=>v.harbor?.kind===(ratio===3?'generic':'brick'));
    if(harbor!==undefined&&harbor>=0)s.buildings[harbor]={owner:0,kind:'settlement'};
    s.players[0]!.resources={brick:ratio,lumber:0,wool:18,grain:0,ore:0};s.bank={brick:19-ratio,lumber:19,wool:1,grain:19,ore:19};return s;
  }
  it('uses 4:1 default maritime trade',()=>{const s=stateForRatio(4);expect(legalActions(s,'p0').some(a=>a.type==='maritimeTrade'&&a.give==='brick')).toBe(true);s.players[0]!.resources.brick=3;s.bank.brick=16;expect(legalActions(s,'p0').some(a=>a.type==='maritimeTrade'&&a.give==='brick')).toBe(false);});
  it('uses 3:1 with an accessible generic harbor',()=>{const s=stateForRatio(3);expect(legalActions(s,'p0').some(a=>a.type==='maritimeTrade'&&a.give==='brick')).toBe(true);});
  it('uses 2:1 with the matching specific harbor',()=>{const s=stateForRatio(2);expect(legalActions(s,'p0').some(a=>a.type==='maritimeTrade'&&a.give==='brick')).toBe(true);});
  it('does not enumerate the unbounded proposal-term combinations',()=>{const s=stateAt('build');expect(legalActions(s,'p0').some(a=>a.type==='proposeTrade'||a.type==='domesticTrade')).toBe(false);});
});

describe('production details',()=>{
  it('pays one resource per settlement and two per city, and blocks robber production',()=>{
    const s=stateAt('roll');const tile=s.board.tiles.find(t=>t.kind==='grain')!;tile.number=5;s.robberTile=s.board.desertTile;const settlement=tile.vertices[0]!,city=tile.vertices[1]!;s.buildings[settlement]={owner:0,kind:'settlement'};s.buildings[city]={owner:0,kind:'city'};s.players[0]!.resources.grain=16;s.bank.grain=3;s.rngState=rngStateForRoll(5);const n=apply(s,{playerId:'p0',type:'roll'}).state;expect(n.players[0]!.resources.grain).toBe(19);expect(n.bank.grain).toBe(0);
    const blocked=stateAt('roll');const blockedTile=blocked.board.tiles.find(t=>t.kind==='grain')!;blockedTile.number=5;blocked.robberTile=blockedTile.id;blocked.buildings[blockedTile.vertices[0]!]={owner:0,kind:'settlement'};blocked.players[0]!.resources.grain=18;blocked.bank.grain=1;blocked.rngState=rngStateForRoll(5);expect(apply(blocked,{playerId:'p0',type:'roll'}).state.players[0]!.resources.grain).toBe(18);
  });
});
