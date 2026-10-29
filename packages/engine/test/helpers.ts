import { createGame } from '../src/index.js';
import { randomInt } from '../src/random.js';
import type { GameState } from '../src/types.js';

export function stateAt(phase:'roll'|'build'|'robber'='build'):GameState {
  const state=createGame(1);state.phase=phase;state.activePlayer=0;state.turnNumber=1;
  state.setupPosition=state.setupOrder.length;state.setupRoadVertex=null;state.pendingDiscards=[];
  state.players[0]!.resources={brick:19,lumber:19,wool:19,grain:19,ore:19};
  state.bank={brick:0,lumber:0,wool:0,grain:0,ore:0};
  return state;
}
export function rngStateForRoll(total:number):number {
  for(let seed=1;seed<1_000_000;seed++){
    const a=randomInt(seed,6);const b=randomInt(a.state,6);
    if(a.value+b.value+2===total)return seed;
  }
  throw new Error(`No RNG seed found for roll ${total}`);
}
export function placeSetupSettlement(state:GameState,vertex:number):void {
  state.buildings[vertex]={owner:state.activePlayer,kind:'settlement'};state.players[state.activePlayer]!.settlementsLeft--;
}
export function connectRoad(state:GameState,edge:number,owner=0):void {state.roads[edge]={owner};state.players[owner]!.roadsLeft--;}
