import { describe, expect, it } from 'vitest';
import { createGame, viewFor } from '@dimat/engine';
import { chooseHeuristicAction, chooseRandomAction } from '../src/index.js';

function responderView(playerResources:{brick:number;lumber:number;wool:number;grain:number;ore:number}){
  const state=createGame(22);state.phase='build';state.activePlayer=0;state.players[0]!.resources.brick=1;
  state.players[1]!.resources={...playerResources};
  state.tradeOffer={id:1,proposerId:'p0',give:{brick:1},want:{lumber:1},targets:['p1'],declinedBy:[]};
  return viewFor(state,'p1');
}

describe('trade offer bot responses',()=>{
  it('accepts when the bot receives a missing resource and gives a surplus one',()=>{
    const view=responderView({brick:0,lumber:2,wool:0,grain:0,ore:0});
    expect(chooseHeuristicAction(view)).toMatchObject({type:'acceptTrade',playerId:'p1'});
  });

  it('declines when the offered trade does not provide a missing resource or needs its last card',()=>{
    const view=responderView({brick:1,lumber:1,wool:0,grain:0,ore:0});
    expect(chooseHeuristicAction(view)).toMatchObject({type:'declineTrade',playerId:'p1'});
  });

  it('randomly selects a legal response without countering',()=>{
    const view=responderView({brick:0,lumber:2,wool:0,grain:0,ore:0});
    const action=chooseRandomAction(view,42);
    expect(view.legalActions).toContainEqual(action);
    expect(['acceptTrade','declineTrade']).toContain(action.type);
  });
});
