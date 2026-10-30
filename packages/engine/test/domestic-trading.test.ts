import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { apply, createGame, legalActions, replayGame, RESOURCES, resourceTotal, viewFor, type GameAction, type GameState } from '../src/index.js';
import { stateAt } from './helpers.js';

function giveTo(state:GameState,player:number,resource:(typeof RESOURCES)[number],count:number){
  state.players[0]!.resources[resource]-=count;
  state.players[player]!.resources[resource]+=count;
}
function offer(state:GameState,overrides:Partial<Extract<GameAction,{type:'proposeTrade'}>>={}):Extract<GameAction,{type:'proposeTrade'}>{
  return {type:'proposeTrade',playerId:'p0',give:{brick:1},want:{wool:1},targets:['p1'],...overrides};
}

describe('consent-based domestic trade',()=>{
  it('proposes, declines and exposes the public decline state',()=>{
    const state=stateAt('build');giveTo(state,1,'wool',1);
    const proposed=apply(state,offer(state));
    expect(proposed.state.tradeOffer).toMatchObject({proposerId:'p0',give:{brick:1},want:{wool:1},targets:['p1'],declinedBy:[]});
    expect(viewFor(proposed.state,'p0').tradeOffer).toEqual(viewFor(proposed.state,'p1').tradeOffer);
    const declined=apply(proposed.state,{type:'declineTrade',playerId:'p1',offerId:proposed.state.tradeOffer!.id});
    expect(declined.state.tradeOffer?.declinedBy).toEqual(['p1']);
    expect(declined.events.map(event=>event.type)).toContain('tradeDeclined');
  });

  it('accepts and atomically transfers a multi-resource bundle',()=>{
    const state=stateAt('build');giveTo(state,1,'wool',2);giveTo(state,1,'grain',1);
    const proposed=apply(state,offer(state,{give:{brick:2,lumber:1},want:{wool:2,grain:1}}));
    const result=apply(proposed.state,{type:'acceptTrade',playerId:'p1',offerId:proposed.state.tradeOffer!.id});
    expect(result.state.players[0]!.resources).toMatchObject({brick:17,lumber:18,wool:19,grain:19});
    expect(result.state.players[1]!.resources).toMatchObject({brick:2,lumber:1,wool:0,grain:0});
    expect(result.state.tradeOffer).toBeNull();
    expect(result.events.map(event=>event.type)).toContain('domesticTradeCompleted');
  });

  it('rejects invalid bundle shape, insufficient proposer holdings and invalid targets',()=>{
    const state=stateAt('build');
    expect(()=>apply(state,offer(state,{give:{brick:0},want:{wool:1}}))).toThrow();
    expect(()=>apply(state,offer(state,{give:{brick:1},want:{brick:1}}))).toThrow();
    expect(()=>apply(state,offer(state,{give:{brick:20},want:{wool:1}}))).toThrow();
    expect(()=>apply(state,offer(state,{targets:['p0']}))).toThrow();
    expect(()=>apply(state,offer(state,{targets:[]}))).toThrow();
    expect(legalActions(state,'p0').some(action=>action.type==='proposeTrade')).toBe(false);
    expect(()=>apply({...state,phase:'roll'},offer(state))).toThrow();
    expect(()=>apply({...state,activePlayer:1},offer(state))).toThrow();
  });

  it('rechecks both hands when an offer is accepted',()=>{
    for(const depletedHand of ['proposer','recipient'] as const){
      const state=stateAt('build');giveTo(state,1,'wool',1);
      const proposed=apply(state,offer(state)).state;
      if(depletedHand==='proposer')proposed.players[0]!.resources.brick=0;
      else proposed.players[1]!.resources.wool=0;
      expect(()=>apply(proposed,{type:'acceptTrade',playerId:'p1',offerId:proposed.tradeOffer!.id})).toThrow();
      expect(proposed.tradeOffer).not.toBeNull();
    }
  });

  it('cancels the offer on construction and turn end',()=>{
    for(const actionType of ['buildRoad','endTurn'] as const){
      const state=stateAt('build');giveTo(state,1,'wool',1);state.buildings[0]={owner:0,kind:'settlement'};
      const proposed=apply(state,offer(state)).state;
      const action:GameAction=actionType==='endTurn'?{type:'endTurn',playerId:'p0'}:{type:'buildRoad',playerId:'p0',edge:state.board.vertices[0]!.edges.find(edge=>!state.roads[edge])!};
      const result=apply(proposed,action);
      expect(result.state.tradeOffer).toBeNull();
      expect(result.events.map(event=>event.type)).toContain('tradeCancelled');
    }
  });

  it('permits one counter-offer only to the original proposer',()=>{
    const state=stateAt('build');giveTo(state,1,'wool',1);
    const proposed=apply(state,offer(state)).state;
    const counter=apply(proposed,{type:'counterTrade',playerId:'p1',offerId:proposed.tradeOffer!.id,partnerId:'p0',give:{wool:1},want:{ore:1}});
    expect(counter.state.tradeOffer).toMatchObject({proposerId:'p1',give:{wool:1},want:{ore:1},targets:['p0']});
    expect(legalActions(counter.state,'p0').some(action=>action.type==='counterTrade')).toBe(false);
    const accepted=apply(counter.state,{type:'acceptTrade',playerId:'p0',offerId:counter.state.tradeOffer!.id});
    expect(accepted.state.players[0]!.resources).toMatchObject({wool:19,ore:18});
    expect(accepted.state.tradeOffer).toBeNull();
    expect(()=>apply(counter.state,{type:'counterTrade',playerId:'p0',offerId:counter.state.tradeOffer!.id,partnerId:'p1',give:{ore:1},want:{brick:1}})).toThrow();
  });

  it('cancels an offer explicitly and replaces it with a new offer',()=>{
    const state=stateAt('build');giveTo(state,1,'wool',2);
    const first=apply(state,offer(state)).state;
    const replacement=apply(first,offer(first,{give:{lumber:1},want:{wool:1}}));
    expect(replacement.state.tradeOffer?.id).not.toBe(first.tradeOffer?.id);
    const cancelled=apply(replacement.state,{type:'cancelTrade',playerId:'p0',offerId:replacement.state.tradeOffer!.id});
    expect(cancelled.state.tradeOffer).toBeNull();
  });

  it('replays a legacy immediate domestic trade action',()=>{
    const state=stateAt('build');giveTo(state,1,'wool',1);
    const legacy={type:'domesticTrade',playerId:'p0',partnerId:'p1',give:'brick',receive:'wool',giveCount:1,receiveCount:1} satisfies GameAction;
    const result=apply(state,legacy);
    expect(result.state.players[0]!.resources).toMatchObject({brick:18,wool:19});
    expect(result.events.map(event=>event.type)).toContain('domesticTradeCompleted');
  });

  it('replays a legacy immediate domestic trade inside a saved action log',()=>{
    let seed=1,state=createGame(seed),actions:GameAction[]=[];
    for(;seed<100;seed++){
      actions=[];state=createGame(seed);
      while(state.phase!=='build'){
        const actor=state.phase==='discard'?state.players[state.pendingDiscards[0]!]!.id:state.players[state.activePlayer]!.id;
        const options=legalActions(state,actor),action=options.find(candidate=>candidate.type==='roll')??options[0];
        if(!action)throw new Error(`No action while preparing legacy replay in ${state.phase}`);
        actions.push(action);state=apply(state,action).state;
      }
      const give=RESOURCES.find(resource=>state.players[0]!.resources[resource]>0);
      const receive=RESOURCES.find(resource=>resource!==give&&state.players[1]!.resources[resource]>0);
      if(give&&receive){
        const legacy:GameAction={type:'domesticTrade',playerId:'p0',partnerId:'p1',give,receive,giveCount:1,receiveCount:1};
        actions.push(legacy);state=apply(state,legacy).state;break;
      }
    }
    expect(replayGame({seed,settings:{playerCount:4,victoryTarget:10},actions})).toEqual(state);
  });

  it('replays a consent-based offer and acceptance from the action log',()=>{
    let seed=1,actions:GameAction[]=[],state=createGame(seed);
    for(;seed<100;seed++){
      actions=[];state=createGame(seed);
      while(state.phase!=='build'){
        const actor=state.phase==='discard'?state.players[state.pendingDiscards[0]!]!.id:state.players[state.activePlayer]!.id;
        const options=legalActions(state,actor);
        const action=options.find(candidate=>candidate.type==='roll')??options[0];
        if(!action)throw new Error(`No action while preparing replay in ${state.phase}`);
        actions.push(action);state=apply(state,action).state;
      }
      const give=RESOURCES.find(resource=>state.players[0]!.resources[resource]>0);
      const want=RESOURCES.find(resource=>resource!==give&&state.players[1]!.resources[resource]>0);
      if(give&&want)break;
    }
    const give=RESOURCES.find(resource=>state.players[0]!.resources[resource]>0)!;
    const want=RESOURCES.find(resource=>resource!==give&&state.players[1]!.resources[resource]>0)!;
    const proposal:GameAction={type:'proposeTrade',playerId:'p0',give:{[give]:1},want:{[want]:1},targets:['p1']};
    actions.push(proposal);state=apply(state,proposal).state;
    const acceptance:GameAction={type:'acceptTrade',playerId:'p1',offerId:state.tradeOffer!.id};
    actions.push(acceptance);state=apply(state,acceptance).state;
    expect(replayGame({seed,settings:{playerCount:4,victoryTarget:10},actions})).toEqual(state);
  });

  it('keeps every resource total constant through accepted bundles',()=>{
    fc.assert(fc.property(fc.integer({min:1,max:4}),fc.integer({min:1,max:4}),(giveCount,wantCount)=>{
      const state=stateAt('build');giveTo(state,1,'wool',wantCount);
      const before=Object.fromEntries(RESOURCES.map(resource=>[resource,resourceTotal(state,resource)]));
      const proposal=apply(state,offer(state,{give:{brick:giveCount},want:{wool:wantCount}})).state;
      const result=apply(proposal,{type:'acceptTrade',playerId:'p1',offerId:proposal.tradeOffer!.id}).state;
      for(const resource of RESOURCES)expect(resourceTotal(result,resource)).toBe(before[resource]);
    }),{numRuns:50});
  });
});
