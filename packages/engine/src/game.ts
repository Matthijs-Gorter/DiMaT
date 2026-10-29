import { createBoard, adjacentVertices } from './board.js';
import { randomInt, shuffle } from './random.js';
import { RESOURCES, type DevCard, type GameAction, type GameEvent, type GameSettings, type GameState, type Player, type PlayerView, type ReplayInput, type Resource, type ResourceSet, type Transition } from './types.js';

const ZERO = (): ResourceSet => ({brick:0,lumber:0,wool:0,grain:0,ore:0});
const START_BANK = (): ResourceSet => ({brick:19,lumber:19,wool:19,grain:19,ore:19});
const COSTS = {
  road:{brick:1,lumber:1}, settlement:{brick:1,lumber:1,wool:1,grain:1},
  city:{grain:2,ore:3}, developmentCard:{wool:1,grain:1,ore:1},
} as const;
const DEV_CARDS: DevCard[] = [
  ...Array<DevCard>(14).fill('knight'), ...Array<DevCard>(5).fill('victoryPoint'),
  ...Array<DevCard>(2).fill('roadBuilding'), ...Array<DevCard>(2).fill('yearOfPlenty'), ...Array<DevCard>(2).fill('monopoly'),
];
const asId=(i:number)=>`p${i}`;
function canonical(value:unknown):string {if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;return JSON.stringify(value);}
const sum=(r:Partial<ResourceSet>)=>RESOURCES.reduce((n,k)=>n+(r[k]??0),0);
const canPay=(p:Player,cost:Partial<ResourceSet>)=>RESOURCES.every(r=>p.resources[r]>=(cost[r]??0));
const ownIndex=(s:GameState,id:string)=>s.players.findIndex(p=>p.id===id);
const ownDev=(s:GameState,p:number,kind:DevCard)=>s.players[p]!.devCards.some(c=>c.kind===kind&&c.boughtTurn<s.turnNumber);

export function createGame(seed:number,settings:Partial<GameSettings>={}):GameState {
  const playerCount=settings.playerCount??4;
  if(settings.victoryTarget!==undefined&&(!Number.isInteger(settings.victoryTarget)||settings.victoryTarget<1))throw new RangeError('victoryTarget must be a positive integer');
  if(playerCount!==3&&playerCount!==4)throw new RangeError('The base game supports three or four players');
  const normalizedSeed=seed>>>0||0x9e3779b9;
  const {board,rngState:boardRng}=createBoard(normalizedSeed);
  const deck=shuffle(DEV_CARDS,boardRng);
  const players:Player[]=Array.from({length:playerCount},(_,i)=>({id:asId(i),resources:ZERO(),devCards:[],knightsPlayed:0,roadsLeft:15,settlementsLeft:5,citiesLeft:4,revealedVictoryPoints:0}));
  return {
    version:1,seed:normalizedSeed,rngState:deck.state,settings:{playerCount,victoryTarget:settings.victoryTarget??10},board,players,
    buildings:Array(board.vertices.length).fill(null),roads:Array(board.edges.length).fill(null),bank:START_BANK(),devDeck:deck.items,playedDevCards:[],
    phase:'setupSettlement',activePlayer:0,setupOrder:[...Array.from({length:playerCount},(_,i)=>i),...Array.from({length:playerCount},(_,i)=>playerCount-1-i)],setupPosition:0,setupRoadVertex:null,
    pendingDiscards:[],afterRobberPhase:'build',robberTile:board.desertTile,turnNumber:0,hasPlayedDevCard:false,longestRoadHolder:null,largestArmyHolder:null,winner:null,lastRoll:null,
  };
}
function legalSettlement(s:GameState,p:number,v:number,setup=false):boolean {
  if(s.buildings[v])return false;
  if(adjacentVertices(s.board,v).some(n=>s.buildings[n]))return false;
  return setup||s.board.vertices[v]!.edges.some(e=>s.roads[e]?.owner===p);
}
function edgeCanExtend(s:GameState,p:number,eid:number):boolean {
  if(s.roads[eid])return false; const e=s.board.edges[eid]!;
  return e.vertices.some(v=>{
    const b=s.buildings[v]; if(b&&b.owner!==p)return false;
    return (b?.owner===p)||s.board.vertices[v]!.edges.some(other=>other!==eid&&s.roads[other]?.owner===p);
  });
}
function giveResources(s:GameState,p:number,amount:Partial<ResourceSet>,events:GameEvent[],reason:string) {
  const player=s.players[p]!;
  for(const resource of RESOURCES){const n=Math.max(0,Math.min(amount[resource]??0,s.bank[resource]));if(n){s.bank[resource]-=n;player.resources[resource]+=n;events.push({type:'resourcesGained',playerId:player.id,privateTo:player.id,resource,count:n,reason});}}
}
function payResources(s:GameState,p:number,amount:Partial<ResourceSet>,events:GameEvent[],reason:string) {
  const player=s.players[p]!; for(const resource of RESOURCES){const n=amount[resource]??0;player.resources[resource]-=n;s.bank[resource]+=n;if(n)events.push({type:'resourcesPaid',playerId:player.id,privateTo:player.id,resource,count:n,reason});}
}
function score(s:GameState,p:number):number {
  return s.buildings.reduce((n,b)=>n+(b?.owner===p?(b.kind==='city'?2:1):0),0)
    +s.players[p]!.devCards.filter(c=>c.kind==='victoryPoint').length+s.players[p]!.revealedVictoryPoints
    +(s.longestRoadHolder===p?2:0)+(s.largestArmyHolder===p?2:0);
}
export function longestRoadLength(s:GameState,p:number):number {
  const ownEdges=s.roads.map((r,i)=>r?.owner===p?i:-1).filter(i=>i>=0); let best=0;
  const walk=(vertex:number,used:Set<number>,length:number)=>{
    if(length>best)best=length;
    if(length<ownEdges.length&&length>best+ownEdges.length) return;
    const b=s.buildings[vertex]; if(b&&b.owner!==p&&length>0)return;
    for(const eid of s.board.vertices[vertex]!.edges){if(s.roads[eid]?.owner!==p||used.has(eid))continue;const e=s.board.edges[eid]!;const next=e.vertices[0]===vertex?e.vertices[1]:e.vertices[0];used.add(eid);walk(next,used,length+1);used.delete(eid);}
  };
  const starts=new Set<number>(); for(const eid of ownEdges)for(const v of s.board.edges[eid]!.vertices)starts.add(v);
  for(const v of starts)walk(v,new Set(),0);
  return best;
}
export function recomputeAwards(s:GameState) {
  const roadLengths=s.players.map((_,p)=>longestRoadLength(s,p)); const roadMax=Math.max(...roadLengths);
  const currentRoadHolderKeeps=s.longestRoadHolder!==null&&roadLengths[s.longestRoadHolder]===roadMax&&roadMax>=5;
  if(!currentRoadHolderKeeps){
    const winners=roadLengths.map((n,p)=>n===roadMax&&n>=5?p:-1).filter(p=>p>=0);s.longestRoadHolder=winners.length===1?winners[0]!:null;
  }
  const army=s.players.map(p=>p.knightsPlayed);const armyMax=Math.max(...army);
  const currentArmyHolderKeeps=s.largestArmyHolder!==null&&army[s.largestArmyHolder]===armyMax&&armyMax>=3;
  if(!currentArmyHolderKeeps){
    const winners=army.map((n,p)=>n===armyMax&&n>=3?p:-1).filter(p=>p>=0);s.largestArmyHolder=winners.length===1?winners[0]!:null;
  }
}
function checkWin(s:GameState,player:number,events:GameEvent[]) {
  if(s.winner!==null||s.phase==='setupSettlement'||s.phase==='setupRoad')return;
  if(score(s,player)>=s.settings.victoryTarget){s.winner=player;s.phase='finished';events.push({type:'gameWon',playerId:s.players[player]!.id,score:score(s,player)});}
}
function getRobberVictims(s:GameState,tile:number,p:number):number[]{
  return [...new Set(s.board.tiles[tile]!.vertices.map(v=>s.buildings[v]?.owner).filter((n):n is number=>n!==undefined&&n!==p&&sum(s.players[n]!.resources)>0))];
}
function moveRobber(s:GameState,p:number,tile:number,victimId:string|undefined,events:GameEvent[]) {
  s.robberTile=tile;events.push({type:'robberMoved',playerId:s.players[p]!.id,tile});
  if(victimId){const victim=ownIndex(s,victimId);const cardCount=sum(s.players[victim]!.resources);const draw=randomInt(s.rngState,cardCount);s.rngState=draw.state;let selected:Resource='brick';let cursor=draw.value;for(const r of RESOURCES){if(cursor<s.players[victim]!.resources[r]){selected=r;break;}cursor-=s.players[victim]!.resources[r];}
    s.players[victim]!.resources[selected]--;s.players[p]!.resources[selected]++;events.push({type:'resourceStolen',fromPlayerId:victimId,toPlayerId:s.players[p]!.id});}
}
function dice(s:GameState):[number,number] {
  const a=randomInt(s.rngState,6); const b=randomInt(a.state,6); s.rngState=b.state; return [a.value+1,b.value+1];
}
function rollResources(s:GameState,result:number,events:GameEvent[]) {
  const owed:ResourceSet[]=s.players.map(()=>ZERO());
  for(const tile of s.board.tiles){if(tile.number!==result||tile.id===s.robberTile||tile.kind==='desert')continue;
    for(const v of tile.vertices){const b=s.buildings[v];if(!b)continue;owed[b.owner]![tile.kind as Resource]+=b.kind==='city'?2:1;}
  }
  for(const resource of RESOURCES){const recipients=owed.map((r,p)=>r[resource]>0?p:-1).filter(p=>p>=0);const total=recipients.reduce((n,p)=>n+owed[p]![resource],0);if(!total)continue;
    if(total<=s.bank[resource]){for(const p of recipients)giveResources(s,p,{[resource]:owed[p]![resource]},events,'production');}
    else if(recipients.length===1)giveResources(s,recipients[0]!,{[resource]:s.bank[resource]},events,'bank-shortage');
    else events.push({type:'productionBlocked',resource,players:recipients.map(p=>s.players[p]!.id)});
  }
}
function combos(s:GameState,p:number,count:number,base:ResourceSet=ZERO()):Partial<ResourceSet>[] {
  const result:Partial<ResourceSet>[]=[];const rec=(i:number,left:number,cur:ResourceSet)=>{if(i===RESOURCES.length){if(left===0)result.push({...cur});return;}const r=RESOURCES[i]!;for(let n=0;n<=Math.min(left,s.players[p]!.resources[r]);n++){cur[r]=n;rec(i+1,left-n,cur);}cur[r]=0;};rec(0,count,{...base});return result;
}
function victoryPointActionAvailable(s:GameState,p:number):boolean {
  const vp=s.players[p]!.devCards.filter(c=>c.kind==='victoryPoint').length;return vp>0&&score(s,p)>=s.settings.victoryTarget;
}

function generateLegalActions(s:GameState,playerId:string,options:{includeTrades?:boolean;includeDomesticTrade?:boolean;includeMaritimeTrade?:boolean}={}):GameAction[] {
  const includeDomesticTrade=options.includeDomesticTrade??options.includeTrades??true;const includeMaritimeTrade=options.includeMaritimeTrade??options.includeTrades??true;
  const p=ownIndex(s,playerId);if(p<0||s.phase==='finished'||s.winner!==null)return[];
  const base={playerId};const out:GameAction[]=[];const card=s.players[p]!;
  if(s.phase==='setupSettlement'){
    if(p!==s.setupOrder[s.setupPosition])return[];
    for(let v=0;v<s.board.vertices.length;v++)if(legalSettlement(s,p,v,true))out.push({...base,type:'placeSettlement',vertex:v});
  }else if(s.phase==='setupRoad'){
    if(p!==s.setupOrder[s.setupPosition]||s.setupRoadVertex===null)return[];
    for(const eid of s.board.vertices[s.setupRoadVertex]!.edges)if(!s.roads[eid])out.push({...base,type:'placeRoad',edge:eid});
  }else if(s.phase==='discard'){
    if(s.pendingDiscards[0]!==p)return[];const amount=Math.floor(sum(card.resources)/2);
    for(const resources of combos(s,p,amount))out.push({...base,type:'discard',resources});
  }else if(s.phase==='robber'){
    if(p!==s.activePlayer)return[];
    for(const tile of s.board.tiles){if(tile.id===s.robberTile)continue;const victims=getRobberVictims(s,tile.id,p);if(victims.length===0)out.push({...base,type:'moveRobber',tile:tile.id});else for(const v of victims)out.push({...base,type:'moveRobber',tile:tile.id,victimId:s.players[v]!.id});}
  }else if(s.phase==='roll'){
    if(p!==s.activePlayer)return[];out.push({...base,type:'roll'});
    if(!s.hasPlayedDevCard&&ownDev(s,p,'knight')){
      for(const tile of s.board.tiles)if(tile.id!==s.robberTile){const victims=getRobberVictims(s,tile.id,p);if(!victims.length)out.push({...base,type:'playKnight',tile:tile.id});else for(const v of victims)out.push({...base,type:'playKnight',tile:tile.id,victimId:s.players[v]!.id});}
    }
    if(victoryPointActionAvailable(s,p))out.push({...base,type:'revealVictoryPoint'});
  }else if(s.phase==='build'){
    if(p!==s.activePlayer)return[];out.push({...base,type:'endTurn'});if(victoryPointActionAvailable(s,p))out.push({...base,type:'revealVictoryPoint'});
    if(card.roadsLeft>0&&canPay(card,COSTS.road))for(let eid=0;eid<s.board.edges.length;eid++)if(edgeCanExtend(s,p,eid))out.push({...base,type:'buildRoad',edge:eid});
    if(card.settlementsLeft>0&&canPay(card,COSTS.settlement))for(let v=0;v<s.board.vertices.length;v++)if(legalSettlement(s,p,v))out.push({...base,type:'buildSettlement',vertex:v});
    if(card.citiesLeft>0&&canPay(card,COSTS.city))for(let v=0;v<s.board.vertices.length;v++)if(s.buildings[v]?.owner===p&&s.buildings[v]?.kind==='settlement')out.push({...base,type:'buildCity',vertex:v});
    if(s.devDeck.length&&canPay(card,COSTS.developmentCard))out.push({...base,type:'buyDevelopmentCard'});
    if(!s.hasPlayedDevCard){
      if(ownDev(s,p,'knight'))for(const a of generateLegalActions({...s,phase:'roll'},playerId,{includeTrades:false}))if(a.type==='playKnight')out.push(a);
      if(ownDev(s,p,'roadBuilding')){
        const edges=s.board.edges.map((e)=>e.id).filter(e=>edgeCanExtend(s,p,e));if(edges.length&&card.roadsLeft>0){for(const edge of edges)out.push({...base,type:'playRoadBuilding',edges:[edge]});if(card.roadsLeft>1){for(const first of edges){const simulated=structuredClone(s);simulated.roads[first]={owner:p};for(const second of s.board.edges.map(e=>e.id))if(second!==first&&edgeCanExtend(simulated,p,second))out.push({...base,type:'playRoadBuilding',edges:[first,second]});}}}
      }
      if(ownDev(s,p,'yearOfPlenty'))for(const a of RESOURCES)for(const b of RESOURCES)if(s.bank[a]>0&&(a===b?s.bank[a]>1:s.bank[b]>0))out.push({...base,type:'playYearOfPlenty',resources:[a,b]});
      if(ownDev(s,p,'monopoly'))for(const resource of RESOURCES)out.push({...base,type:'playMonopoly',resource});
    }
    if(includeDomesticTrade)for(let partner=0;partner<s.players.length;partner++)if(partner!==p)for(const give of RESOURCES)for(const receive of RESOURCES)if(give!==receive){
      const maxGive=card.resources[give],maxReceive=s.players[partner]!.resources[receive];for(let g=1;g<=maxGive;g++)for(let r=1;r<=maxReceive;r++)out.push({...base,type:'domesticTrade',partnerId:s.players[partner]!.id,give,receive,giveCount:g,receiveCount:r});
    }
    if(includeMaritimeTrade)for(const give of RESOURCES){const ownedHarbors=s.board.vertices.map((v,i)=>s.buildings[i]?.owner===p?v.harbor:null).filter((h):h is NonNullable<typeof h>=>!!h);let ratio=4;for(const h of ownedHarbors)if(h.kind==='generic')ratio=Math.min(ratio,3);else if(h.kind===give)ratio=2;if(card.resources[give]<ratio)continue;for(const receive of RESOURCES)if(receive!==give&&s.bank[receive]>0)out.push({...base,type:'maritimeTrade',give,receive});}
  }
  return out;
}

export function apply(state:GameState,action:GameAction):Transition {
  const legal=generateLegalActions(state,action.playerId,{includeDomesticTrade:action.type==='domesticTrade',includeMaritimeTrade:action.type==='maritimeTrade'});if(!legal.some(a=>canonical(a)===canonical(action)))throw new Error(`Illegal action ${action.type} for ${action.playerId} during ${state.phase}`);
  const s=structuredClone(state);const events:GameEvent[]=[];const p=ownIndex(s,action.playerId);const player=s.players[p]!;
  switch(action.type){
    case 'placeSettlement': {
      s.buildings[action.vertex]={owner:p,kind:'settlement'};player.settlementsLeft--;events.push({type:'settlementPlaced',playerId:player.id,vertex:action.vertex});
      if(s.phase==='setupSettlement'){s.setupRoadVertex=action.vertex;s.phase='setupRoad';}
      else {payResources(s,p,COSTS.settlement,events,'build');recomputeAwards(s);}
      break;
    }
    case 'placeRoad': {
      s.roads[action.edge]={owner:p};player.roadsLeft--;events.push({type:'roadPlaced',playerId:player.id,edge:action.edge});
      if(s.phase==='setupRoad'){
        if(s.setupPosition>=s.settings.playerCount)s.board.tiles.filter(t=>t.vertices.includes(s.setupRoadVertex!)&&t.kind!=='desert').forEach(t=>giveResources(s,p,{[t.kind as Resource]:1},events,'second-settlement'));
        s.setupPosition++;s.setupRoadVertex=null;
        if(s.setupPosition>=s.setupOrder.length){s.phase='roll';s.activePlayer=0;s.turnNumber=1;}else{s.activePlayer=s.setupOrder[s.setupPosition]!;s.phase='setupSettlement';}
      }else{payResources(s,p,COSTS.road,events,'build');recomputeAwards(s);}
      break;
    }
    case 'roll': {
      const rolled=dice(s);s.lastRoll=rolled;const result=rolled[0]+rolled[1];events.push({type:'diceRolled',playerId:player.id,dice:rolled,result});
      if(result===7){s.pendingDiscards=s.players.map((pl,i)=>sum(pl.resources)>7?i:-1).filter(i=>i>=0);if(s.pendingDiscards.length)s.phase='discard';else{s.phase='robber';s.afterRobberPhase='build';}}
      else{rollResources(s,result,events);s.phase='build';}break;
    }
    case 'discard': {
      payResources(s,p,action.resources,events,'discard');s.pendingDiscards.shift();if(!s.pendingDiscards.length){s.phase='robber';s.afterRobberPhase='build';}break;
    }
    case 'moveRobber': {
      moveRobber(s,p,action.tile,action.victimId,events);s.phase=s.afterRobberPhase;break;
    }
    case 'buildRoad': {
      payResources(s,p,COSTS.road,events,'build');s.roads[action.edge]={owner:p};player.roadsLeft--;recomputeAwards(s);events.push({type:'roadBuilt',playerId:player.id,edge:action.edge});break;
    }
    case 'buildSettlement': {
      payResources(s,p,COSTS.settlement,events,'build');s.buildings[action.vertex]={owner:p,kind:'settlement'};player.settlementsLeft--;recomputeAwards(s);events.push({type:'settlementBuilt',playerId:player.id,vertex:action.vertex});break;
    }
    case 'buildCity': {
      payResources(s,p,COSTS.city,events,'build');s.buildings[action.vertex]={owner:p,kind:'city'};player.settlementsLeft++;player.citiesLeft--;recomputeAwards(s);events.push({type:'cityBuilt',playerId:player.id,vertex:action.vertex});break;
    }
    case 'buyDevelopmentCard': {
      payResources(s,p,COSTS.developmentCard,events,'development-card');const card=s.devDeck.pop()!;player.devCards.push({kind:card,boughtTurn:s.turnNumber});events.push({type:'developmentCardBought',playerId:player.id});break;
    }
    case 'playKnight': {
      removeDev(player,'knight',s.turnNumber);s.playedDevCards.push('knight');player.knightsPlayed++;s.hasPlayedDevCard=true;s.afterRobberPhase=s.phase as 'roll'|'build';s.phase='robber';moveRobber(s,p,action.tile,action.victimId,events);s.phase=s.afterRobberPhase;recomputeAwards(s);events.push({type:'knightPlayed',playerId:player.id});break;
    }
    case 'playRoadBuilding': {
      removeDev(player,'roadBuilding',s.turnNumber);s.playedDevCards.push('roadBuilding');s.hasPlayedDevCard=true;
      for(const edge of action.edges){s.roads[edge]={owner:p};player.roadsLeft--;events.push({type:'roadBuiltFree',playerId:player.id,edge});}
      recomputeAwards(s);events.push({type:'roadBuildingPlayed',playerId:player.id});break;
    }
    case 'playYearOfPlenty': {
      removeDev(player,'yearOfPlenty',s.turnNumber);s.playedDevCards.push('yearOfPlenty');s.hasPlayedDevCard=true;const amounts=ZERO();for(const r of action.resources)amounts[r]++;giveResources(s,p,amounts,events,'year-of-plenty');events.push({type:'yearOfPlentyPlayed',playerId:player.id});break;
    }
    case 'playMonopoly': {
      removeDev(player,'monopoly',s.turnNumber);s.playedDevCards.push('monopoly');s.hasPlayedDevCard=true;let total=0;for(let i=0;i<s.players.length;i++)if(i!==p){total+=s.players[i]!.resources[action.resource];s.players[i]!.resources[action.resource]=0;}player.resources[action.resource]+=total;events.push({type:'monopolyPlayed',playerId:player.id,resource:action.resource,count:total});break;
    }
    case 'domesticTrade': {
      const partner=ownIndex(s,action.partnerId);player.resources[action.give]-=action.giveCount;s.players[partner]!.resources[action.give]+=action.giveCount;s.players[partner]!.resources[action.receive]-=action.receiveCount;player.resources[action.receive]+=action.receiveCount;events.push({type:'domesticTradeCompleted',playerId:player.id,partnerId:action.partnerId});break;
    }
    case 'maritimeTrade': {
      const harbor=s.board.vertices.map((v,i)=>s.buildings[i]?.owner===p?v.harbor:null).filter((h):h is NonNullable<typeof h>=>!!h);let ratio=4;for(const h of harbor)if(h.kind==='generic')ratio=Math.min(ratio,3);else if(h.kind===action.give)ratio=2;
      payResources(s,p,{[action.give]:ratio},events,'maritime-trade');giveResources(s,p,{[action.receive]:1},events,'maritime-trade');events.push({type:'maritimeTradeCompleted',playerId:player.id,give:action.give,receive:action.receive,ratio});break;
    }
    case 'revealVictoryPoint': {
      const i=player.devCards.findIndex(c=>c.kind==='victoryPoint');if(i>=0){player.devCards.splice(i,1);s.playedDevCards.push('victoryPoint');player.revealedVictoryPoints++;}events.push({type:'victoryPointRevealed',playerId:player.id});break;
    }
    case 'endTurn': {
      s.activePlayer=(s.activePlayer+1)%s.players.length;s.turnNumber++;s.hasPlayedDevCard=false;s.phase='roll';events.push({type:'turnEnded',playerId:player.id,nextPlayerId:s.players[s.activePlayer]!.id});break;
    }
    default: throw new Error(`Unsupported action ${(action as {type:string}).type}`);
  }
  checkWin(s,p,events);
  return {state:s,events};
}
function removeDev(player:Player,kind:DevCard,turn:number){const i=player.devCards.findIndex(c=>c.kind===kind&&c.boughtTurn<turn);if(i<0)throw new Error(`Missing card ${kind}`);player.devCards.splice(i,1);}

export function viewFor(s:GameState,playerId:string):PlayerView {
  const p=ownIndex(s,playerId);if(p<0)throw new Error(`Unknown player ${playerId}`);
  return {playerId,phase:s.phase,activePlayerId:s.players[s.activePlayer]!.id,turnNumber:s.turnNumber,hasPlayedDevCard:s.hasPlayedDevCard,bank:{...s.bank},developmentCardsRemaining:s.devDeck.length,seed:s.seed,settings:{...s.settings},
    players:s.players.map((pl,i)=>({id:pl.id,resourceCount:sum(pl.resources),developmentCardCount:pl.devCards.length,visibleVictoryPoints:score(s,i)-pl.devCards.filter(c=>c.kind==='victoryPoint').length,roadsLeft:pl.roadsLeft,settlementsLeft:pl.settlementsLeft,citiesLeft:pl.citiesLeft,knightsPlayed:pl.knightsPlayed,longestRoadLength:longestRoadLength(s,i),hasLongestRoad:s.longestRoadHolder===i,hasLargestArmy:s.largestArmyHolder===i})),
    ownResources:{...s.players[p]!.resources},ownDevelopmentCards:structuredClone(s.players[p]!.devCards),buildings:structuredClone(s.buildings),roads:structuredClone(s.roads),board:structuredClone(s.board),robberTile:s.robberTile,legalActions:legalActions(s,playerId),winnerId:s.winner===null?null:s.players[s.winner]!.id,lastRoll:s.lastRoll?([...s.lastRoll] as [number,number]):null};
}
export function replayGame(input:ReplayInput):GameState {let state=createGame(input.seed,input.settings);for(const action of input.actions)state=apply(state,action).state;return state;}
export function legalActions(state:GameState,playerId:string):GameAction[]{return generateLegalActions(state,playerId);}
export function publicActionList(state:GameState,playerId:string):readonly GameAction[]{return legalActions(state,playerId);}
export function legalActionsForRandomBot(state:GameState,playerId:string):GameAction[]{return generateLegalActions(state,playerId,{includeDomesticTrade:false,includeMaritimeTrade:true});}
export function resourceTotal(state:GameState,resource:Resource):number{return state.bank[resource]+state.players.reduce((n,p)=>n+p.resources[resource],0);}
export function cardCounts(state:GameState):Record<DevCard,number>{const result:Record<DevCard,number>={knight:state.devDeck.filter(c=>c==='knight').length,victoryPoint:state.devDeck.filter(c=>c==='victoryPoint').length,roadBuilding:state.devDeck.filter(c=>c==='roadBuilding').length,yearOfPlenty:state.devDeck.filter(c=>c==='yearOfPlenty').length,monopoly:state.devDeck.filter(c=>c==='monopoly').length};for(const p of state.players)for(const c of p.devCards)result[c.kind]++;for(const c of state.playedDevCards)result[c]++;return result;}
