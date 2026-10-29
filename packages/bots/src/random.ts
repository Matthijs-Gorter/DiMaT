import { randomInt, type GameAction, type PlayerView } from '@dimat/engine';

/** Selects a legal action deterministically from a caller-provided decision seed. */
export function chooseRandomAction(view: PlayerView, seed: number): GameAction {
  const actions=view.legalActions;
  if(!actions.length)throw new Error(`No legal actions for ${view.playerId} in ${view.phase}`);
  return chooseRandomFromActions(actions.filter(a=>a.type!=='domesticTrade'),seed);
}

/** Random policy with a modest preference for scoring actions to keep games progressing. */
export function chooseRandomFromActions(actions:readonly GameAction[],seed:number):GameAction {
  if(!actions.length)throw new Error('Cannot choose from an empty action list');
  const groups=new Map<string,GameAction[]>();for(const action of actions){const group=groups.get(action.type)??[];group.push(action);groups.set(action.type,group);}
  const scoring=['buildSettlement','buildCity','buyDevelopmentCard','revealVictoryPoint'];
  const scoreActions=scoring.flatMap(type=>groups.get(type)??[]);
  const draw=randomInt(seed>>>0||1,100).value;
  if(scoreActions.length&&draw<65)return scoreActions[randomInt((seed^0x9e3779b9)>>>0||1,scoreActions.length).value]!;
  const endTurn=groups.get('endTurn');
  const construction=['buildRoad','playRoadBuilding','playKnight','playYearOfPlenty','playMonopoly','maritimeTrade'];
  const other=construction.flatMap(type=>groups.get(type)??[]);
  if(other.length&&draw<90)return other[randomInt((seed^0x85ebca6b)>>>0||1,other.length).value]!;
  if(endTurn)return endTurn[0]!;
  const pool=scoreActions.length?scoreActions:other.length?other:actions;
  return pool[randomInt((seed^0xc2b2ae35)>>>0||1,pool.length).value]!;
}
