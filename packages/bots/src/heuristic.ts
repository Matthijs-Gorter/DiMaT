import type { GameAction, PlayerView, Resource } from '@dimat/engine';

const pipValue:Record<number,number>={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
/** Small deterministic policy: prefer immediate points, then productive settlement sites and useful roads. */
export function chooseHeuristicAction(view:PlayerView):GameAction {
 const actions=view.legalActions.filter(a=>a.type!=='domesticTrade');if(!actions.length)throw new Error(`No legal actions for ${view.playerId}`);
 const held=new Set<Resource>(['brick','lumber','wool','grain','ore'].filter(r=>view.ownResources[r]>0) as Resource[]);
 const score=(a:GameAction):number=>{
  if(a.type==='buildSettlement'){const v=view.board.vertices[a.vertex]!;const diversity=new Set(v.tiles.map(id=>view.board.tiles[id]!.kind).filter(k=>k!=='desert')).size;const pips=v.tiles.reduce((n,id)=>n+pipValue[view.board.tiles[id]!.number??0],0);return 100+pips+diversity*2;}
  if(a.type==='buildCity')return 95;
  if(a.type==='buyDevelopmentCard')return 62;
  if(a.type==='buildRoad'||a.type==='playRoadBuilding')return 30;
  if(a.type==='playKnight')return 28;
  if(a.type==='playYearOfPlenty'||a.type==='playMonopoly')return 20;
  if(a.type==='maritimeTrade')return held.has(a.receive)?8:15;
  if(a.type==='endTurn')return 0;
  return 5;
 };
 return [...actions].sort((a,b)=>score(b)-score(a))[0]!;
}
