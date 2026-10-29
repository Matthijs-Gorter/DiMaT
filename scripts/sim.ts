import { apply, cardCounts, createGame, legalActionsForRandomBot, resourceTotal, type GameAction, type GameState, RESOURCES } from '../packages/engine/src/index.js';
import { chooseRandomFromActions } from '../packages/bots/src/index.js';

export function assertInvariant(state:GameState):void {
  for(const r of RESOURCES){if(state.bank[r]<0)throw new Error(`Negative bank stock for ${r}`);if(resourceTotal(state,r)!==19)throw new Error(`Card circulation changed for ${r}: ${resourceTotal(state,r)}`);}
  const cards=cardCounts(state);const expected={knight:14,victoryPoint:5,roadBuilding:2,yearOfPlenty:2,monopoly:2};
  for(const key of Object.keys(expected) as (keyof typeof expected)[])if(cards[key]!==expected[key])throw new Error(`Development card count changed for ${key}`);
  for(let p=0;p<state.players.length;p++){
    const player=state.players[p]!;const roads=state.roads.filter(r=>r?.owner===p).length;const settlements=state.buildings.filter(b=>b?.owner===p&&b.kind==='settlement').length;const cities=state.buildings.filter(b=>b?.owner===p&&b.kind==='city').length;
    if(player.roadsLeft+roads!==15)throw new Error(`Road piece limit violated for ${player.id}`);
    if(player.settlementsLeft+settlements!==5)throw new Error(`Settlement piece limit violated for ${player.id}`);
    if(player.citiesLeft+cities!==4)throw new Error(`City piece limit violated for ${player.id}`);
  }
  if(state.phase!=='finished'){
    const current=state.phase==='discard'?state.pendingDiscards[0]:state.activePlayer;
    if(current===undefined||legalActionsForRandomBot(state,state.players[current]!.id).length===0)throw new Error(`No legal action in ${state.phase}`);
  }
}

export function simulateGame(seed:number,playerCount:3|4=4,maxActions=20000):{state:GameState;actions:GameAction[]} {
  let state=createGame(seed,{playerCount});const actions:GameAction[]=[];let decisionSeed=(seed^0xa5a5a5a5)>>>0;
  for(let i=0;i<maxActions&&state.phase!=='finished';i++){
    const playerIndex=state.phase==='discard'?state.pendingDiscards[0]!:state.activePlayer;
    const choices=legalActionsForRandomBot(state,state.players[playerIndex]!.id);
    const action=chooseRandomFromActions(choices,decisionSeed);decisionSeed=(Math.imul(decisionSeed,1664525)+1013904223)>>>0;
    const transition=apply(state,action);state=transition.state;actions.push(action);assertInvariant(state);
  }
  if(state.phase!=='finished')throw new Error(`Game exceeded ${maxActions} actions (seed ${seed})`);
  if(state.winner===null)throw new Error(`Finished game has no winner (seed ${seed})`);
  const visible=state.buildings.reduce((n,b)=>n+(b?.owner===state.winner?(b.kind==='city'?2:1):0),0);
  const points=visible+state.players[state.winner]!.devCards.filter(c=>c.kind==='victoryPoint').length+state.players[state.winner]!.revealedVictoryPoints+(state.longestRoadHolder===state.winner?2:0)+(state.largestArmyHolder===state.winner?2:0);
  if(points<state.settings.victoryTarget)throw new Error(`Winner did not reach target (seed ${seed}): ${points}`);
  return {state,actions};
}

function parseArgs(args:string[]):{games:number;seed:number}{let games=1000,seed=1;for(let i=0;i<args.length;i++){if(args[i]==='--games')games=Number(args[++i]);else if(args[i]==='--seed')seed=Number(args[++i]);else throw new Error(`Unknown argument: ${args[i]}`);}if(!Number.isInteger(games)||games<1||!Number.isInteger(seed))throw new Error('Expected positive integer --games and integer --seed');return{games,seed};}
if(process.argv[1]?.endsWith('/sim.ts')){
  const {games,seed}=parseArgs(process.argv.slice(2));let actions=0;const started=Date.now();
  for(let i=0;i<games;i++){const result=simulateGame(seed+i);actions+=result.actions.length;if((i+1)%1000===0)console.log(`Completed ${i+1}/${games} games`);}
  console.log(`OK: ${games} games, ${actions} actions, seed ${seed}, ${Date.now()-started} ms`);
}
