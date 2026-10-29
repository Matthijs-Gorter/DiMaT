import type { GameAction, GameEvent, PlayerView, Resource } from '@dimat/engine';
import type { BotStatus, RoomLifecycle, ServerMessage } from '@dimat/protocol';
import { findLegalDiscardAction } from './discard-action.js';
import './style.css';

type SeatSummary={playerId:string;displayName:string;bot:boolean};
type PlacementMode='road'|'settlement'|'city'|'robber'|null;
type PendingAction={sequence:number;targetKey?:string};
const SVG_NS='http://www.w3.org/2000/svg';
const COLORS=['#37a9d2','#e16c59','#e2b941','#7b68c6'];
const BOARD_VIEWBOX=[-10,-9,20,18] as const;
const PIPS:Record<number,number>={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const RESOURCE_ICON:Record<'brick'|'lumber'|'wool'|'grain'|'ore',string>={brick:'▦',lumber:'♣',wool:'❖',grain:'✳',ore:'⬡'};
const TILE_ASSETS:Record<Resource|'desert',string>={brick:'hill.svg',lumber:'forest.svg',wool:'pasture.svg',grain:'field.svg',ore:'mountain.svg',desert:'desert.svg'};
const root=document.querySelector<HTMLDivElement>('#app')!;
let view:PlayerView|undefined;
let playerId='';let seatToken='';let roomId='';let socket:WebSocket|undefined;
let events:string[]=[];let seats:SeatSummary[]=[];let botStatuses:BotStatus[]=[];
let chatMessages:Array<{playerId:string;text:string;createdAt:number}>=[];
let lifecycle:RoomLifecycle='lobby';let gameStartedReceived=false;
let placementMode:PlacementMode=null;let pending:PendingAction|null=null;let robberChoices:GameAction[]|null=null;
let debugEnabled=new URLSearchParams(location.search).get('debug')==='1';let connectionState='connecting';let latencyMs:number|null=null;let lastServerError:Record<string,unknown>|null=null;let debugData:Record<string,unknown>|null=null;

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{
  const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;
};
const svgElement=(tag:string)=>document.createElementNS(SVG_NS,tag);
function playerColor(id:string){const index=Number(id.replace(/^p/,''));return COLORS[Number.isFinite(index)?index%COLORS.length:0]!;}
function playerName(id:string){return seats.find(seat=>seat.playerId===id)?.displayName||id;}
const RESOURCE_NAMES:Record<string,string>={brick:'baksteen',lumber:'hout',wool:'wol',grain:'graan',ore:'erts'};
function eventText(event:GameEvent){
  const data=event as Record<string,unknown>,name=typeof data.playerId==='string'?playerName(data.playerId):'';
  switch(event.type){
    case 'settlementPlaced':return `${name} plaatste een nederzetting`;
    case 'roadPlaced':return `${name} plaatste een weg`;
    case 'roadBuilt':case 'roadBuiltFree':return `${name} bouwde een weg`;
    case 'settlementBuilt':return `${name} bouwde een nederzetting`;
    case 'cityBuilt':return `${name} bouwde een stad`;
    case 'diceRolled':return `${name} gooide ${String(data.result)} (${Array.isArray(data.dice)?data.dice.join(' + '):''})`;
    case 'resourcesGained':return `${name} ontving ${String(data.count)} ${RESOURCE_NAMES[String(data.resource)]??String(data.resource)}`;
    case 'resourcesPaid':return `${name} betaalde ${String(data.count)} ${RESOURCE_NAMES[String(data.resource)]??String(data.resource)}`;
    case 'resourceStolen':return `${playerName(String(data.toPlayerId))} stal een kaart van ${playerName(String(data.fromPlayerId))}`;
    case 'robberMoved':return `${name} verplaatste de rover`;
    case 'developmentCardBought':return `${name} kocht een ontwikkelingskaart`;
    case 'knightPlayed':return `${name} speelde een ridder`;
    case 'roadBuildingPlayed':return `${name} speelde Wegenbouw`;
    case 'yearOfPlentyPlayed':return `${name} speelde Jaar van overvloed`;
    case 'monopolyPlayed':return `${name} speelde Monopolie`;
    case 'domesticTradeCompleted':return `${name} ruilde met ${playerName(String(data.partnerId))}`;
    case 'maritimeTradeCompleted':return `${name} ruilde ${data.ratio}:1 bij de bank`;
    case 'victoryPointRevealed':return `${name} onthulde een overwinningspunt`;
    case 'turnEnded':return `${name} beëindigde de beurt`;
    case 'gameWon':return `${name} heeft het spel gewonnen!`;
    case 'productionBlocked':return `Geen ${RESOURCE_NAMES[String(data.resource)]??String(data.resource)} geproduceerd: de bank had te weinig kaarten`;
    default:return 'Spelgebeurtenis';
  }
}
function canonicalClient(value:unknown):string{if(Array.isArray(value))return `[${value.map(canonicalClient).join(',')}]`;if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${canonicalClient(item)}`).join(',')}}`;return JSON.stringify(value);}
function clientHash(value:unknown){let hash=2166136261;for(const char of canonicalClient(value))hash=Math.imul(hash^char.charCodeAt(0),16777619);return(hash>>>0).toString(16).padStart(8,'0');}
function errorText(code:string,message:string){
  const local:Record<string,string>={GAME_NOT_STARTED:'Het spel is nog niet gestart.',GAME_FINISHED:'Dit spel is afgelopen.',NOT_YOUR_TURN:'Je bent nog niet aan de beurt.',ILLEGAL_ACTION:'Deze actie mag nu niet.',WAITING_FOR_PLAYERS:'Wacht tot beide menselijke spelers zijn aangesloten.',ROOM_NOT_FOUND:'Deze kamer bestaat niet (meer).'};
  return local[code]??message;
}
function shell(){
  root.replaceChildren();const header=element('header','top');
  header.append(element('strong','brand','DiMaT'),element('span',`connection-indicator state-${connectionState}`,`Browser board game · ${roomId?connectionState:'offline'}`));
  const theme=element('button','','Licht/donker');theme.onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;localStorage.setItem('dimat-theme',next);};
  const debug=element('button',debugEnabled?'selected':'','Debug');debug.setAttribute('aria-pressed',String(debugEnabled));debug.onclick=()=>{debugEnabled=!debugEnabled;const url=new URL(location.href);if(debugEnabled)url.searchParams.set('debug','1');else url.searchParams.delete('debug');history.replaceState({},'',url);render();void refreshDebugData();};
  header.append(theme,debug);root.append(header);const main=element('main');root.append(main);return main;
}
function lobby(message='Maak een kamer of gebruik een uitnodigingslink.'){
  const main=shell(),card=element('section','card lobby');
  card.append(element('h1','','Speel samen'),element('p','muted',message));
  const name=element('input');name.placeholder='Je naam';name.maxLength=32;name.value=localStorage.getItem('dimat-name')??'';
  const create=element('button','primary','Nieuwe kamer (1 bot)'),createMore=element('button','','Nieuwe kamer (2 bots)'),status=element('p','muted');
  const row=element('div','row');row.append(name,create,createMore);card.append(row,status);main.append(card);
  async function make(botCount:1|2){
    if(!name.value.trim()){status.textContent='Vul eerst je naam in.';name.focus();return;}
    localStorage.setItem('dimat-name',name.value.trim());status.textContent='Kamer maken…';
    try{const response=await fetch('/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:name.value.trim(),botCount})});const data=await response.json();if(!response.ok)throw new Error(data.message??'Kamer maken mislukt');
      roomId=data.roomId;seatToken=data.seatToken;playerId=data.playerId;history.replaceState({},'',`/play/${roomId}`);connect(name.value.trim());
    }catch(error){status.textContent=error instanceof Error?error.message:'Verbinding mislukt';}
  }
  create.onclick=()=>void make(1);createMore.onclick=()=>void make(2);
  const path=location.pathname.split('/');
  if(path[1]==='play'&&path[2]){roomId=path[2]!;const join=element('button','','Deelnemen aan kamer');join.onclick=()=>{if(!name.value.trim()){status.textContent='Vul je naam in.';return;}localStorage.setItem('dimat-name',name.value.trim());connect(name.value.trim());};row.append(join);}
}
function connect(displayName:string){
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
  (window as Window&{dimatSend?:WebSocket}).dimatSend=socket;
  socket.onopen=()=>{connectionState='connected';socket?.send(JSON.stringify({type:'join',roomId,seatToken:seatToken||undefined,displayName}));void measureLatency();};
  socket.onmessage=event=>{
    const message=JSON.parse(event.data) as ServerMessage;
    if(message.type==='error'){pending=null;robberChoices=null;lastServerError={code:message.code,message:message.message,details:message.details};events.unshift(`Fout ${message.code}: ${errorText(message.code,message.message)}`);render();}
    else if(message.type==='joined'){seatToken=message.seatToken;playerId=message.playerId;lifecycle=message.lifecycle;gameStartedReceived=false;localStorage.setItem(`dimat-seat-${roomId}`,seatToken);render();}
    else if(message.type==='gameStarted'||message.type==='gameFinished'){view=message.view;lifecycle=message.type==='gameFinished'?'finished':'started';gameStartedReceived=message.type==='gameStarted';render();void refreshDebugData();}
    else if(message.type==='update'){
      if(view)view={...view,...message.patch};events=[...message.events.map(eventText),...events].slice(0,50);
      if(pending&&message.clientSequence===pending.sequence){pending=null;robberChoices=null;placementMode=null;}
      if(view?.winnerId){lifecycle='finished';gameStartedReceived=false;}render();void refreshDebugData();
    }else if(message.type==='chat'){chatMessages=[...chatMessages,{playerId:message.playerId,text:message.text,createdAt:message.createdAt}].slice(-100);render();}
    else if(message.type==='room'){seats=message.seats;botStatuses=message.botStatuses;lifecycle=message.lifecycle;if(lifecycle!=='started')gameStartedReceived=false;render();void refreshDebugData();}
  };
  socket.onclose=()=>{gameStartedReceived=false;connectionState='disconnected';events.unshift('Verbinding verbroken. Vernieuw of gebruik dezelfde uitnodigingslink om opnieuw te verbinden.');render();};
}
async function measureLatency(){try{const start=performance.now();const response=await fetch(`/api/rooms/${roomId}`);if(response.ok)latencyMs=Math.round(performance.now()-start);}catch{latencyMs=null;}if(debugEnabled)render();}
async function refreshDebugData(){if(!debugEnabled||!roomId)return;try{const response=await fetch(`/api/debug/rooms/${roomId}?playerId=${encodeURIComponent(playerId)}`);debugData=response.ok?await response.json() as Record<string,unknown>:null;if(debugData&&view){const serverHash=debugData.viewHash;debugData.clientViewHash=clientHash(view);debugData.viewHashMatches=serverHash===debugData.clientViewHash;}render();}catch{debugData=null;}}
function sendAction(action:GameAction,targetKey?:string){
  if(!gameStartedReceived||lifecycle!=='started'||pending||!view?.legalActions.some(legal=>JSON.stringify(legal)===JSON.stringify(action)))return;
  if(socket?.readyState!==WebSocket.OPEN){events.unshift('Verbinding is nog niet klaar.');render();return;}
  const sequence=Date.now();pending={sequence,...(targetKey?{targetKey}:{})};render();
  socket.send(JSON.stringify({type:'action',sequence,action}));
}
function createLine(parent:SVGElement,a:readonly[number,number],b:readonly[number,number],className:string){
  const line=svgElement('line');line.setAttribute('x1',String(a[0]));line.setAttribute('y1',String(a[1]));line.setAttribute('x2',String(b[0]));line.setAttribute('y2',String(b[1]));line.setAttribute('class',className);parent.append(line);return line;
}
function pointForVertex(v:PlayerView,id:number):[number,number]{const vertex=v.board.vertices[id]!;return [vertex.x*Math.sqrt(3),vertex.y];}
function tileCenter(q:number,r:number):[number,number]{return [(2*q+r)*Math.sqrt(3),3*r];}
function pointList(v:PlayerView,ids:number[]){return ids.map(id=>pointForVertex(v,id));}
function convexHull(points:Array<[number,number]>):Array<[number,number]>{
  const sorted=[...points].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(o:readonly[number,number],a:readonly[number,number],b:readonly[number,number])=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower:Array<[number,number]>=[],upper:Array<[number,number]>=[];
  for(const p of sorted){while(lower.length>=2&&cross(lower[lower.length-2]!,lower[lower.length-1]!,p)<=0)lower.pop();lower.push(p);}
  for(const p of sorted.slice().reverse()){while(upper.length>=2&&cross(upper[upper.length-2]!,upper[upper.length-1]!,p)<=0)upper.pop();upper.push(p);}
  lower.pop();upper.pop();return lower.concat(upper);
}
function activePlacementMode(v:PlayerView):PlacementMode{
  if(v.phase==='setupSettlement')return 'settlement';if(v.phase==='setupRoad')return 'road';if(v.phase==='robber')return 'robber';return placementMode;
}
function drawTerrainIcon(group:SVGElement,kind:string,x:number,y:number){
  const icon=svgElement('text');icon.setAttribute('x',String(x));icon.setAttribute('y',String(y));icon.setAttribute('text-anchor','middle');icon.setAttribute('class','terrain-icon');
  const glyph:Record<string,string>={brick:'▰',lumber:'♣',wool:'❖',grain:'✳',ore:'⬡',desert:'≈'};icon.textContent=glyph[kind]??'◆';group.append(icon);
}
function drawBoard(host:HTMLElement,v:PlayerView){
  const svg=svgElement('svg') as SVGSVGElement;svg.setAttribute('viewBox',BOARD_VIEWBOX.join(' '));svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.setAttribute('role','img');svg.setAttribute('aria-label','Game board');svg.classList.add('board');
  const mode=activePlacementMode(v);const defs=svgElement('defs'),tileLayer=svgElement('g'),roadLayer=svgElement('g'),harborLayer=svgElement('g'),pieceLayer=svgElement('g'),targetLayer=svgElement('g'),previewLayer=svgElement('g');
  tileLayer.setAttribute('class','tile-layer');roadLayer.setAttribute('class','road-layer');harborLayer.setAttribute('class','harbor-layer');pieceLayer.setAttribute('class','piece-layer');targetLayer.setAttribute('class','target-layer');previewLayer.setAttribute('class','preview-layer');
  const shore=convexHull(v.board.vertices.filter(vertex=>vertex.tiles.length===1).map(vertex=>pointForVertex(v,vertex.id)));
  const beach=svgElement('polygon');beach.setAttribute('points',shore.map(p=>p.join(',')).join(' '));beach.setAttribute('class','beach-rim');tileLayer.append(beach);
  const vertexTargets=new Map<number,GameAction>();
  if(mode==='settlement')for(const action of v.legalActions)if(action.type==='placeSettlement'||action.type==='buildSettlement')vertexTargets.set(action.vertex,action);
  if(mode==='city')for(const action of v.legalActions)if(action.type==='buildCity')vertexTargets.set(action.vertex,action);
  const edgeTargets=new Map<number,GameAction>();
  if(mode==='road')for(const action of v.legalActions)if(action.type==='placeRoad'||action.type==='buildRoad')edgeTargets.set(action.edge,action);
  const tileTargets=new Map<number,GameAction[]>();
  if(mode==='robber')for(const action of v.legalActions)if(action.type==='moveRobber'||action.type==='playKnight'){const tile='tile'in action?action.tile:-1;const list=tileTargets.get(tile)??[];list.push(action);tileTargets.set(tile,list);}

  for(const tile of v.board.tiles){
    const rolled=v.lastRoll?v.lastRoll[0]+v.lastRoll[1]:null;const produces=tile.number!==null&&tile.number===rolled;const polygon=svgElement('polygon'),points=pointList(v,tile.vertices),clip=svgElement('clipPath');clip.id=`tile-art-clip-${tile.id}`;clip.setAttribute('clipPathUnits','userSpaceOnUse');const clipShape=svgElement('polygon');clipShape.setAttribute('points',points.map(p=>p.join(',')).join(' '));clip.append(clipShape);defs.append(clip);
    const [x,y]=tileCenter(tile.q,tile.r),art=svgElement('image');art.setAttribute('href',`/tiles/${TILE_ASSETS[tile.kind]}`);art.setAttribute('x',String(x-Math.sqrt(3)));art.setAttribute('y',String(y-2));art.setAttribute('width',String(2*Math.sqrt(3)));art.setAttribute('height','4');art.setAttribute('preserveAspectRatio','none');art.setAttribute('clip-path',`url(#${clip.id})`);art.setAttribute('class',`terrain-art${produces?' producing':''}`);art.setAttribute('pointer-events','none');art.dataset.kind=tile.kind;art.dataset.tile=String(tile.id);tileLayer.append(art);
    polygon.setAttribute('points',points.map(p=>p.join(',')).join(' '));polygon.setAttribute('class',`hex terrain-${tile.kind}${tile.id===v.robberTile?' robber-tile':''}${produces?' producing':''}`);polygon.dataset.tile=String(tile.id);
    const title=svgElement('title');title.textContent=tile.number?`${tile.kind}: ${tile.number}, ${PIPS[tile.number]} pip(s)`:`${tile.kind}`;polygon.append(title);tileLayer.append(polygon);
    drawTerrainIcon(tileLayer,tile.kind,x,y+.58);
    if(tile.number){
      const token=svgElement('circle');token.setAttribute('cx',String(x));token.setAttribute('cy',String(y));token.setAttribute('r','.73');token.setAttribute('class',`number-token${tile.number===6||tile.number===8?' hot':''}`);const probability=svgElement('title');probability.textContent=`Kans: ${PIPS[tile.number]}/36 (${((PIPS[tile.number]??0)/36*100).toFixed(1)}%)`;token.append(probability);tileLayer.append(token);
      const number=svgElement('text');number.setAttribute('x',String(x));number.setAttribute('y',String(y+.16));number.setAttribute('text-anchor','middle');number.setAttribute('class','number-label');number.textContent=String(tile.number);tileLayer.append(number);
      const count=PIPS[tile.number]??0;for(let pip=0;pip<count;pip++){const dot=svgElement('circle');dot.setAttribute('cx',String(x+(pip-(count-1)/2)*.16));dot.setAttribute('cy',String(y+.43));dot.setAttribute('r','.045');dot.setAttribute('class','pip-dot');tileLayer.append(dot);}
    }
    if(tile.id===v.robberTile){const pawn=svgElement('g');pawn.setAttribute('class','robber-pawn');pawn.setAttribute('transform',`translate(${x-.78},${y-.38})`);const head=svgElement('circle');head.setAttribute('cx','0');head.setAttribute('cy','-.2');head.setAttribute('r','.18');const body=svgElement('path');body.setAttribute('d','M-.29 .26 Q-.24 -.08 0 -.08 Q.24 -.08 .29 .26 Z');pawn.append(head,body);tileLayer.append(pawn);}
    const actions=tileTargets.get(tile.id);if(actions?.length){const hit=svgElement('polygon');hit.setAttribute('points',points.map(p=>p.join(',')).join(' '));hit.setAttribute('class',`board-target legal-tile${pending?.targetKey===`tile-${tile.id}`?' pending':''}`);hit.dataset.targetKey=`tile-${tile.id}`;hit.addEventListener('click',()=>chooseRobberAction(actions,tile.id));targetLayer.append(hit);}
  }
  for(const edge of v.board.edges){
    const [a,b]=edge.vertices.map(id=>pointForVertex(v,id)) as [[number,number],[number,number]];
    const road=v.roads[edge.id];if(road){const piece=createLine(roadLayer,a,b,`road-piece player-${road.owner}`);piece.setAttribute('stroke-width','.38');}
    const action=edgeTargets.get(edge.id);if(action){const highlight=createLine(targetLayer,a,b,'legal-road-highlight');highlight.setAttribute('stroke','#a5ffc2');highlight.setAttribute('stroke-width','.2');highlight.setAttribute('stroke-dasharray','.1 .09');highlight.setAttribute('pointer-events','none');const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),halfWidth=.36,nx=-dy/length*halfWidth,ny=dx/length*halfWidth;const hit=svgElement('polygon');hit.setAttribute('points',[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]].map(point=>point.join(',')).join(' '));hit.setAttribute('class',`board-target road-edge legal${pending?.targetKey===`edge-${edge.id}`?' pending':''}`);hit.setAttribute('fill','#fff');hit.setAttribute('fill-opacity','.001');hit.setAttribute('pointer-events','all');hit.dataset.targetKey=`edge-${edge.id}`;targetLayer.append(hit);
      hit.addEventListener('click',()=>sendAction(action,`edge-${edge.id}`));hit.addEventListener('pointerenter',()=>showPiecePreview(previewLayer,'road',[(a[0]+b[0])/2,(a[1]+b[1])/2],playerColor(playerId),[a,b]));hit.addEventListener('pointerleave',()=>previewLayer.replaceChildren());}
  }
  const harbors=new Map<number,{vertices:number[];kind:string;ratio:number}>();
  for(const vertex of v.board.vertices)if(vertex.harbor){const item=harbors.get(vertex.harbor.id)??{vertices:[],kind:vertex.harbor.kind,ratio:vertex.harbor.ratio};item.vertices.push(vertex.id);harbors.set(vertex.harbor.id,item);}
  for(const harbor of harbors.values()){
    if(harbor.vertices.length!==2)continue;const pts=pointList(v,harbor.vertices),center:[number,number]=[(pts[0]![0]+pts[1]![0])/2,(pts[0]![1]+pts[1]![1])/2];const active=harbor.vertices.some(id=>v.buildings[id]?.owner===Number(playerId.slice(1)));
    const group=svgElement('g');group.setAttribute('class',`harbor${active?' harbor-active':''}`);for(const point of pts)createLine(group,center,point,'harbor-connector');const marker=svgElement('circle');marker.setAttribute('cx',String(center[0]));marker.setAttribute('cy',String(center[1]));marker.setAttribute('r','.62');marker.setAttribute('class','harbor-marker');group.append(marker);const label=svgElement('text');label.setAttribute('x',String(center[0]));label.setAttribute('y',String(center[1]+.14));label.setAttribute('text-anchor','middle');label.setAttribute('class','harbor-label');label.textContent=harbor.kind==='generic'?`${harbor.ratio}:1`:`${harbor.ratio}:1 ${RESOURCE_ICON[harbor.kind as keyof typeof RESOURCE_ICON]??'◆'}`;group.append(label);harborLayer.append(group);
  }
  for(const vertex of v.board.vertices){
    const [x,y]=pointForVertex(v,vertex.id),building=v.buildings[vertex.id];
    if(building){const group=svgElement('g');group.setAttribute('class',`building-piece player-${building.owner}`);group.setAttribute('transform',`translate(${x},${y})`);if(building.kind==='settlement'){const house=svgElement('path');house.setAttribute('d','M-.48 .02 L0 -.5 L.48 .02 V.47 H-.48 Z');group.append(house);}else{const house=svgElement('path');house.setAttribute('d','M-.55 -.25 L-.22 -.55 L.12 -.25 L.4 -.48 L.55 -.28 V.48 H-.55 Z');group.append(house);const door=svgElement('rect');door.setAttribute('x','-.12');door.setAttribute('y','.12');door.setAttribute('width','.24');door.setAttribute('height','.36');door.setAttribute('class','building-door');group.append(door);}pieceLayer.append(group);}
    const action=vertexTargets.get(vertex.id);if(action){const glow=svgElement('circle');glow.setAttribute('cx',String(x));glow.setAttribute('cy',String(y));glow.setAttribute('r','.43');glow.setAttribute('class',`legal-vertex-glow${pending?.targetKey===`vertex-${vertex.id}`?' pending':''}`);targetLayer.append(glow);const hit=svgElement('circle');hit.setAttribute('cx',String(x));hit.setAttribute('cy',String(y));hit.setAttribute('r','1.05');hit.setAttribute('fill','transparent');hit.setAttribute('pointer-events','all');hit.setAttribute('class',`board-target spot legal legal-vertex${pending?.targetKey===`vertex-${vertex.id}`?' pending':''}`);hit.dataset.targetKey=`vertex-${vertex.id}`;hit.addEventListener('click',()=>sendAction(action,`vertex-${vertex.id}`));hit.addEventListener('pointerenter',()=>showPiecePreview(previewLayer,action.type==='buildCity'?'city':'settlement',[x,y],playerColor(playerId)));hit.addEventListener('pointerleave',()=>previewLayer.replaceChildren());targetLayer.append(hit);}
  }
  svg.append(defs,tileLayer,roadLayer,harborLayer,pieceLayer,targetLayer,previewLayer);let box=[-10,-9,20,18],drag:{x:number;y:number;box:number[];moved:boolean}|null=null;const pointers=new Map<number,{x:number;y:number}>();let pinchStart:{distance:number;box:number[]}|null=null;
  const controls=element('div','board-controls'),zoomOut=element('button','','−'),zoomLabel=element('span','muted','100%'),zoomIn=element('button','','+'),center=element('button','','Hercentreer');zoomOut.setAttribute('aria-label','Uitzoomen');zoomIn.setAttribute('aria-label','Inzoomen');
  const constrainViewBox=(next:number[])=>{
    const [baseX,baseY,baseWidth,baseHeight]=BOARD_VIEWBOX,[width,height]=next.slice(2);
    const limitCenter=(center:number,size:number,baseCenter:number,baseSize:number)=>Math.max(baseCenter-Math.max(0,(size-baseSize)/2)-baseSize*.25,Math.min(baseCenter+Math.max(0,(size-baseSize)/2)+baseSize*.25,center));
    const x=limitCenter(next[0]!+width/2,width,baseX+baseWidth/2,baseWidth)-width/2;
    const y=limitCenter(next[1]!+height/2,height,baseY+baseHeight/2,baseHeight)-height/2;
    return [x,y,width,height];
  };
  const updateViewBox=()=>svg.setAttribute('viewBox',box.join(' '));
  const setZoom=(factor:number)=>{const width=Math.max(13,Math.min(30,box[2]!*factor)),height=width*.9,cx=box[0]!+box[2]!/2,cy=box[1]!+box[3]!/2;box=constrainViewBox([cx-width/2,cy-height/2,width,height]);updateViewBox();zoomLabel.textContent=`${Math.round(BOARD_VIEWBOX[2]/width*100)}%`;};
  zoomOut.onclick=()=>setZoom(1.15);zoomIn.onclick=()=>setZoom(.87);center.onclick=()=>{box=[...BOARD_VIEWBOX];updateViewBox();zoomLabel.textContent='100%';};controls.append(zoomOut,zoomLabel,zoomIn,center);
  svg.addEventListener('wheel',event=>{event.preventDefault();setZoom(event.deltaY>0?1.08:.92);},{passive:false});
  svg.addEventListener('pointerdown',event=>{if(event.button!==0||event.target instanceof Element&&event.target.closest('.board-target'))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});svg.setPointerCapture(event.pointerId);if(pointers.size===2){const [a,b]=[...pointers.values()];pinchStart={distance:Math.hypot(a!.x-b!.x,a!.y-b!.y),box:[...box]};drag=null;return;}drag={x:event.clientX,y:event.clientY,box:[...box],moved:false};});
  svg.addEventListener('pointermove',event=>{if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pinchStart&&pointers.size>=2){const [a,b]=[...pointers.values()],distance=Math.max(1,Math.hypot(a!.x-b!.x,a!.y-b!.y)),start=pinchStart.box,width=Math.max(13,Math.min(30,start[2]!*pinchStart.distance/distance)),height=width*.9;box=constrainViewBox([start[0]!+(start[2]!-width)/2,start[1]!+(start[3]!-height)/2,width,height]);updateViewBox();zoomLabel.textContent=`${Math.round(BOARD_VIEWBOX[2]/width*100)}%`;return;}if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;if(!drag.moved)return;const rect=svg.getBoundingClientRect(),start=drag.box;box=constrainViewBox([start[0]!-dx*start[2]!/rect.width,start[1]!-dy*start[3]!/rect.height,start[2]!,start[3]!]);updateViewBox();});
  svg.addEventListener('pointerup',event=>{pointers.delete(event.pointerId);if(pointers.size<2)pinchStart=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);drag=null;});svg.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);pinchStart=null;drag=null;});
  host.replaceChildren(controls,svg);
}
function showPiecePreview(layer:SVGElement,kind:'road'|'settlement'|'city',point:[number,number],color:string,edge?:[[number,number],[number,number]]){
  layer.replaceChildren();if(kind==='road'&&edge){const preview=createLine(layer,edge[0],edge[1],'piece-preview');preview.setAttribute('stroke',color);preview.setAttribute('stroke-width','.38');return;}
  const preview=svgElement('circle');preview.setAttribute('cx',String(point[0]));preview.setAttribute('cy',String(point[1]));preview.setAttribute('r',kind==='city'?'.68':'.5');preview.setAttribute('fill',color);preview.setAttribute('class','piece-preview');layer.append(preview);
}
function chooseRobberAction(actions:GameAction[],tileId:number){
  if(actions.length===1){sendAction(actions[0]!,`tile-${tileId}`);return;}
  robberChoices=actions;render();
}
function submitBuildMode(mode:PlacementMode){placementMode=mode;robberChoices=null;render();}
function actionButton(label:string,action:GameAction,cls=''){
  const button=element('button',cls,label);button.disabled=!!pending;button.onclick=()=>sendAction(action);return button;
}
function renderBuildBar(viewState:PlayerView){
  const bar=element('section','build-bar');bar.setAttribute('aria-label','Bouwen en acties');
  const mode=activePlacementMode(viewState);
  const modes:[Exclude<PlacementMode,null>,string,string,boolean][]=[
    ['road','Weg','1 baksteen · 1 hout',viewState.legalActions.some(a=>a.type==='buildRoad'||a.type==='placeRoad')],
    ['settlement','Nederzetting','1 baksteen · 1 hout · 1 wol · 1 graan',viewState.legalActions.some(a=>a.type==='buildSettlement'||a.type==='placeSettlement')],
    ['city','Stad','2 graan · 3 erts',viewState.legalActions.some(a=>a.type==='buildCity')]
  ];
  for(const [kind,label,cost,enabled] of modes){const button=element('button',`build-mode${mode===kind?' selected':''}`,label);button.title=cost;button.disabled=!enabled||!!pending;button.setAttribute('aria-pressed',String(mode===kind));button.onclick=()=>submitBuildMode(mode===kind?null:kind);bar.append(button);}
  const purchase=viewState.legalActions.find(a=>a.type==='buyDevelopmentCard');if(purchase)bar.append(actionButton('Ontwikkelingskaart',purchase,'build-mode'));
  const roll=viewState.legalActions.find(a=>a.type==='roll');if(roll)bar.append(actionButton('Gooi de dobbelstenen',roll,'primary'));
  const end=viewState.legalActions.find(a=>a.type==='endTurn');if(end)bar.append(actionButton('Beurt beëindigen',end));
  const knight=viewState.legalActions.find(a=>a.type==='playKnight');if(knight){const button=element('button',`build-mode${mode==='robber'?' selected':''}`,'Ridder spelen');button.title='Verplaats de rover en kies eventueel een speler om te beroven.';button.onclick=()=>submitBuildMode('robber');bar.append(button);}
  if(placementMode&&viewState.phase!=='setupSettlement'&&viewState.phase!=='setupRoad'&&viewState.phase!=='robber'){const cancel=element('button','','Annuleer plaatsing');cancel.onclick=()=>{placementMode=null;render();};bar.append(cancel);}
  return bar;
}
function renderDebugActions(viewState:PlayerView){
  if(!debugEnabled)return null;const details=element('details','debug-actions'),summary=element('summary','','Debugpaneel');details.append(summary);
  const grouped=viewState.legalActions.reduce<Record<string,number>>((counts,action)=>{counts[action.type]=(counts[action.type]??0)+1;return counts;},{}),localHash=clientHash(viewState);
  const diagnostic={connection:connectionState,latencyMs,roomId,seatToken:seatToken?'stored':'missing',playerId,phase:viewState.phase,activePlayerId:viewState.activePlayerId,pendingAction:pending,pendingDecisions:debugData?.pendingDiscards??[],seed:viewState.seed,settings:viewState.settings,clientViewHash:localHash,serverViewHash:debugData?.viewHash??'unavailable (run server with DEBUG=1)',viewHashMatches:debugData?.viewHash===undefined?'unavailable':debugData.viewHash===localHash,legalActionCounts:grouped,lastServerError,botStatuses,engineVersion:'1',protocolVersion:'1'};
  const status=element('p',debugData?.viewHash&&debugData.viewHash!==localHash?'debug-mismatch':'muted',`Verbinding: ${connectionState}${latencyMs!==null?` · ${latencyMs} ms`:''} · stoel ${playerId} · ${viewState.phase}`);details.append(status);
  if(debugData?.viewHash&&debugData.viewHash!==localHash)details.append(element('p','debug-mismatch','Waarschuwing: server- en clientweergave verschillen.'));
  const snapshot=element('details','debug-section'),snapshotTitle=element('summary','','Sessie en toestand');snapshot.append(snapshotTitle);const snapshotJson=element('pre','debug-json',JSON.stringify(diagnostic,null,2));snapshot.append(snapshotJson);details.append(snapshot);
  const actionSummary=element('details','debug-section'),actionTitle=element('summary','',`Legale acties (${viewState.legalActions.length})`);actionSummary.append(actionTitle);actionSummary.append(element('pre','debug-json',JSON.stringify({counts:grouped,actions:viewState.legalActions},null,2)));details.append(actionSummary);
  const historySummary=element('details','debug-section'),historyTitle=element('summary','','Laatste acties en gebeurtenissen');historySummary.append(historyTitle);historySummary.append(element('pre','debug-json',JSON.stringify({actions:debugData?.lastActions??[],events:debugData?.lastEvents??events.slice(0,50)},null,2)));details.append(historySummary);
  const botSummary=element('details','debug-section'),botTitle=element('summary','','Botstatus');botSummary.append(botTitle);botSummary.append(element('pre','debug-json',JSON.stringify(debugData?.players??botStatuses,null,2)));details.append(botSummary);
  if(lastServerError)details.append(element('pre','debug-json',JSON.stringify(lastServerError,null,2)));
  const copy=element('button','','Kopieer debugbundel'),download=element('button','','Download replay');copy.onclick=async()=>{const bundle={diagnostic,server:debugData,view:viewState,lastEvents:events,lastServerError,versions:{engine:'1',protocol:'1'},userAgent:navigator.userAgent};const json=JSON.stringify(bundle,null,2);try{await navigator.clipboard.writeText(json);copy.textContent='Debugbundel gekopieerd ✓';}catch{const temp=element('textarea','copy-fallback');temp.value=json;document.body.append(temp);temp.select();document.execCommand('copy');temp.remove();copy.textContent='Debugbundel gekopieerd ✓';}};download.disabled=!debugData||!Array.isArray(debugData.actions);download.onclick=()=>{if(!debugData)return;const replay={seed:viewState.seed,settings:viewState.settings,actions:debugData.actions};const url=URL.createObjectURL(new Blob([JSON.stringify(replay,null,2)],{type:'application/json'}));const link=element('a');link.href=url;link.download=`dimat-${roomId}-replay.json`;document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);};details.append(copy,download);
  const select=element('select','actions');select.append(new Option('Kies een legale actie…',''));
  for(const action of viewState.legalActions){const label=action.type+('vertex'in action?` · vertex ${action.vertex}`:'edge'in action?` · edge ${action.edge}`:'tile'in action?` · tile ${action.tile}`:'');select.append(new Option(label,JSON.stringify(action)));}
  const submit=element('button','','Verstuur actie');submit.disabled=!!pending;submit.onclick=()=>{if(select.value)sendAction(JSON.parse(select.value) as GameAction);};details.append(select,submit);return details;
}
function renderRobberPicker(){
  if(!robberChoices)return null;const picker=element('section','card victim-picker');picker.append(element('h2','','Kies een speler om te beroven'));
  for(const action of robberChoices){if(action.type!=='moveRobber'&&action.type!=='playKnight')continue;const victim='victimId'in action?action.victimId:undefined;const label=victim?`Steel een kaart van ${playerName(victim)}`:'Verplaats rover zonder slachtoffer';const button=element('button',victim?`player-choice player-${Number(victim.slice(1))}`:'',label);button.disabled=!!pending;button.onclick=()=>{robberChoices=null;sendAction(action,`tile-${action.tile}`);};picker.append(button);}
  const cancel=element('button','','Annuleer');cancel.onclick=()=>{robberChoices=null;render();};picker.append(cancel);return picker;
}
function renderDevelopmentHand(viewState:PlayerView){
  const section=element('section','development-hand');section.append(element('h2','','Ontwikkelingskaarten'));
  if(!viewState.ownDevelopmentCards.length){section.append(element('p','muted','Nog geen ontwikkelingskaarten.'));return section;}
  const labels:Record<string,string>={knight:'Ridder',victoryPoint:'Overwinningspunt',roadBuilding:'Wegenbouw',yearOfPlenty:'Jaar van overvloed',monopoly:'Monopolie'};
  for(const card of viewState.ownDevelopmentCards){
    const cardBox=element('div','dev-card');const playable=viewState.legalActions.filter(action=>action.type===({knight:'playKnight',roadBuilding:'playRoadBuilding',yearOfPlenty:'playYearOfPlenty',monopoly:'playMonopoly'} as Record<string,string>)[card.kind]);
    const canPlay=card.kind==='victoryPoint'?viewState.legalActions.some(action=>action.type==='revealVictoryPoint'):card.boughtTurn<viewState.turnNumber&&!viewState.hasPlayedDevCard&&playable.length>0;
    cardBox.append(element('strong','',labels[card.kind]??card.kind));
    if(card.kind==='victoryPoint'){cardBox.append(element('span','pill','Verborgen VP'));if(canPlay){const reveal=viewState.legalActions.find(action=>action.type==='revealVictoryPoint');if(reveal)cardBox.append(actionButton('Tonen',reveal));}}
    else if(card.boughtTurn>=viewState.turnNumber)cardBox.append(element('span','muted','Niet speelbaar deze beurt (net gekocht)'));
    else if(viewState.hasPlayedDevCard)cardBox.append(element('span','muted','Al een ontwikkelingskaart gespeeld deze beurt'));
    else if(!canPlay)cardBox.append(element('span','muted','Nu niet beschikbaar'));
    else if(card.kind==='knight'){const play=element('button','','Ridder spelen');play.onclick=()=>submitBuildMode('robber');cardBox.append(play);}
    else for(const action of playable.slice(0,5)){const label=action.type==='playMonopoly'?`Kies ${action.resource}`:action.type==='playYearOfPlenty'?`Kies ${action.resources.join(' + ')}`:action.type==='playRoadBuilding'?`Plaats ${action.edges.length} weg(en)`:'Spelen';cardBox.append(actionButton(label,action));}
    section.append(cardBox);
  }
  return section;
}
function renderDiscardPrompt(viewState:PlayerView){
  if(viewState.phase!=='discard')return null;const legal=viewState.legalActions.filter((action):action is Extract<GameAction,{type:'discard'}>=>action.type==='discard');if(!legal.length)return null;
  const required=Object.values(legal[0]!.resources).reduce<number>((total,count)=>total+(count??0),0),card=element('section','card discard-prompt');card.append(element('h2','','Weggooien na een 7'),element('p','muted',`Kies precies ${required} kaarten om af te leggen.`));
  const form=element('form','discard-form');form.noValidate=true;const fields=new Map<Resource,HTMLInputElement>();const total=element('output','discard-total',`0 / ${required} gekozen`);const submit=element('button','primary','Kaarten afleggen');submit.type='submit';submit.disabled=true;const feedback=element('p','discard-error');feedback.setAttribute('aria-live','polite');
  function update(){const selected=[...fields.values()].reduce((n,input)=>n+(Number(input.value)||0),0);const withinLimits=[...fields].every(([resource,input])=>Number(input.value)>=0&&Number(input.value)<=viewState.ownResources[resource]&&Number.isInteger(Number(input.value)));total.textContent=`${selected} / ${required} gekozen`;total.classList.toggle('valid',selected===required&&withinLimits);submit.disabled=selected!==required||!withinLimits||!!pending;}
  for(const resource of ['brick','lumber','wool','grain','ore'] as Resource[]){const label=element('label','discard-field');const name=element('span','',`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${resource}`);const available=element('small','',`${viewState.ownResources[resource]} beschikbaar`);const input=element('input');input.type='number';input.min='0';input.max=String(viewState.ownResources[resource]);input.step='1';input.value='0';input.inputMode='numeric';input.setAttribute('aria-label',`${resource} om af te leggen`);input.addEventListener('input',update);fields.set(resource,input);label.append(name,available,input);form.append(label);}
  form.append(total,submit,feedback);form.onsubmit=event=>{event.preventDefault();update();if(submit.disabled)return;const resources=Object.fromEntries([...fields].map(([resource,input])=>[resource,Number(input.value)])) as Partial<Record<Resource,number>>;const action=findLegalDiscardAction(viewState.legalActions,resources);if(!action){feedback.textContent='Deze combinatie is geen beschikbare aflegactie. Controleer je selectie.';return;}feedback.textContent='';sendAction(action);};card.append(form);return card;
}
function renderTradePanel(viewState:PlayerView){
  const bankTrades=viewState.legalActions.filter((action):action is Extract<GameAction,{type:'maritimeTrade'}>=>action.type==='maritimeTrade');if(!bankTrades.length)return null;const panel=element('section','card trade-panel');panel.append(element('h2','','Bank- en havenhandel'),element('p','muted','Kies een beschikbare ruil op basis van je kaarten, bankvoorraad en havens.'));
  const seen=new Set<string>();for(const action of bankTrades){const key=`${action.give}:${action.receive}`;if(seen.has(key))continue;seen.add(key);const harbors=viewState.board.vertices.filter(vertex=>vertex.harbor&&viewState.buildings[vertex.id]?.owner===Number(viewState.playerId.slice(1))).map(vertex=>vertex.harbor!);const ratio=harbors.some(harbor=>harbor.kind===action.give)?2:harbors.some(harbor=>harbor.kind==='generic')?3:4;panel.append(actionButton(`${ratio} ${action.give} → 1 ${action.receive}`,action));}
  return panel;
}
function renderChat(){
  const panel=element('section','card chat-panel');panel.append(element('h2','','Chat'));const transcript=element('div','chat-transcript');transcript.setAttribute('aria-live','polite');for(const message of chatMessages){const line=element('p',`chat-line player-${Number(message.playerId.slice(1))}`);line.append(element('strong','',playerName(message.playerId)),document.createTextNode(`: ${message.text}`));transcript.append(line);}panel.append(transcript);
  const form=element('form','chat-form'),input=element('input');input.maxLength=240;input.placeholder='Typ een bericht…';input.setAttribute('aria-label','Chatbericht');const send=element('button','primary','Verstuur');send.type='submit';form.append(input,send);form.onsubmit=event=>{event.preventDefault();const text=input.value.trim();if(!text||socket?.readyState!==WebSocket.OPEN)return;socket.send(JSON.stringify({type:'chat',text}));input.value='';input.focus();};panel.append(form);return panel;
}
function render(){
  if(!roomId){lobby();return;}
  const main=shell();main.dataset.gameLifecycle=lifecycle;const header=element('div','roomhead');
  header.append(element('h1','','Speltafel'),element('span','pill',`Kamer ${roomId}`));
  const invite=element('button','','Kopieer uitnodiging'),copyStatus=element('span','copy-status');
  invite.onclick=async()=>{const url=`${location.origin}/play/${roomId}`;try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(url);else{const temp=element('textarea');temp.value=url;temp.readOnly=true;temp.className='copy-fallback';document.body.append(temp);temp.select();const copied=document.execCommand('copy');temp.remove();if(!copied)throw new Error('Clipboard unavailable');}copyStatus.textContent='Uitnodiging gekopieerd ✓';}catch{copyStatus.textContent='Kopiëren geblokkeerd. Selecteer de link:';const field=element('input','invite-url');field.value=url;field.readOnly=true;field.onclick=()=>field.select();copyStatus.append(field);field.select();}};
  header.append(invite,copyStatus);main.append(header);
  const errorList=events.filter(item=>item.startsWith('Fout ')).slice(0,3);if(errorList.length){const alerts=element('div','toast-stack');for(const error of errorList)alerts.append(element('p','toast',error));main.append(alerts);}
  const roster=element('section','card roster');roster.append(element('h2','','Spelers'));const list=element('div','row');
  for(const seat of seats){const status=botStatuses.find(item=>item.playerId===seat.playerId);const label=`${seat.displayName||'wacht op speler'}${seat.bot?` · bot${status?.status==='thinking'?' · denkt…':status?.status==='recovering'?' · herstelt':status?.status==='stalled'?' · vastgelopen':''}`:''}`;const badge=element('span','pill',label);badge.style.borderColor=playerColor(seat.playerId);badge.dataset.playerId=seat.playerId;if(status?.reason)badge.title=status.reason;list.append(badge);}
  roster.append(list);if(seats.length){const start=element('button','primary','Start spel');start.disabled=lifecycle!=='lobby'||playerId!=='p0'||seats.some(seat=>!seat.bot&&!seat.displayName);start.onclick=()=>socket?.send(JSON.stringify({type:'start'}));roster.append(start);}main.append(roster);
  if(lifecycle==='lobby'){main.append(element('section','card waiting','Wacht tot beide menselijke spelers zijn aangesloten. Daarna kan de host het spel starten.'));return;}
  if(!view){main.append(element('section','card waiting','Spel wordt geladen…'));return;}
  const active=activePlacementMode(view);const hint=element('div','hint-box',pending?'Actie wordt bevestigd…':active==='road'?'Klik een groen gemarkeerde weg.':active==='settlement'?'Klik een groen gemarkeerd kruispunt.':active==='city'?'Klik een eigen nederzetting om deze te upgraden.':active==='robber'?'Klik een gemarkeerd veld om de rover te verplaatsen.':view.phase==='roll'?'Gooi de dobbelstenen om je beurt te beginnen.':'Kies een bouwactie of andere legale zet.');main.append(hint);
  const grid=element('div','gamegrid'),board=element('section','card boardcard');drawBoard(board,view);
  const side=element('aside','card game-sidebar');side.append(element('h2','','Spel'),element('p','muted',`Fase: ${view.phase} · Beurt: ${playerName(view.activePlayerId)}`));
  const dice=element('div','dice');if(view.lastRoll){dice.append(element('span','die',String(view.lastRoll[0])),element('span','die',String(view.lastRoll[1])),element('strong','dice-total',`= ${view.lastRoll[0]+view.lastRoll[1]}`));}else dice.append(element('span','muted','Dobbelstenen nog niet gegooid'));side.append(dice);
  const hand=element('div','hand');for(const resource of ['brick','lumber','wool','grain','ore'] as Resource[]){const cell=element('div','resource');cell.append(document.createTextNode(`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${resource}`),element('b','',String(view.ownResources[resource])));hand.append(cell);}
  const bank=element('section','bank-panel');bank.append(element('h2','','Bank · ontwikkelingsstapel'));const bankCounts=element('div','hand');for(const resource of ['brick','lumber','wool','grain','ore'] as Resource[]){const cell=element('div','resource');cell.append(document.createTextNode(`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${resource}`),element('b','',String(view.bank[resource])));bankCounts.append(cell);}bank.append(bankCounts,element('p','muted',`${view.developmentCardsRemaining} ontwikkelingskaarten over`));side.append(bank,renderDevelopmentHand(view));
  const players=element('div','players');for(const player of view.players){const isActive=player.id===view.activePlayerId,status=botStatuses.find(item=>item.playerId===player.id);const panel=element('article',`player-panel player-${Number(player.id.slice(1))}${isActive?' active':''}`);panel.append(element('strong','',`${playerName(player.id)}${player.id===playerId?' (jij)':''}`));const badges=element('div','player-badges');if(isActive)badges.append(element('span','pill','Aan zet'));if(seats.find(seat=>seat.playerId===player.id)?.bot)badges.append(element('span','pill',status?.status==='thinking'?'Bot denkt…':'Bot'));panel.append(badges,element('p','player-card-count',`${player.resourceCount+player.developmentCardCount} kaarten`));players.append(panel);}
  const left=element('aside','card game-left-sidebar');left.setAttribute('aria-label','Spelers en gebeurtenissen');left.append(element('h2','','Spelers'),players,element('h2','event-log-title','Gebeurtenissen'));for(const line of events.filter(item=>!item.startsWith('Fout ')).slice(0,10))left.append(element('p','event',line));
  const picker=renderRobberPicker();if(picker)side.append(picker);
  const discard=renderDiscardPrompt(view);if(discard)side.append(discard);const trade=renderTradePanel(view);if(trade)side.append(trade);
  const debug=renderDebugActions(view);if(debug)side.append(debug);
  side.append(renderChat());
  grid.append(left,board,side);const bottom=element('section','bottom-bar');bottom.append(element('h2','','Jouw hand'),hand,renderBuildBar(view));main.append(grid,bottom);
}

document.documentElement.dataset.theme=localStorage.getItem('dimat-theme')??'dark';
const savedRoom=location.pathname.split('/')[2];roomId=savedRoom??'';
if(roomId){seatToken=localStorage.getItem(`dimat-seat-${roomId}`)??'';const name=localStorage.getItem('dimat-name')??'';if(name)connect(name);else lobby('Vul je naam in om aan te sluiten.');}else lobby();
document.addEventListener('keydown',event=>{if(event.key!=='`'||event.ctrlKey||event.metaKey||event.altKey)return;const target=event.target;if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement)return;debugEnabled=!debugEnabled;const url=new URL(location.href);if(debugEnabled)url.searchParams.set('debug','1');else url.searchParams.delete('debug');history.replaceState({},'',url);render();void refreshDebugData();});
window.addEventListener('error',event=>{const message=event.error instanceof Error?event.error.message:event.message;root.replaceChildren();const card=element('section','card fatal-error');card.append(element('h1','','DiMaT liep vast'),element('p','',message));const copy=element('button','','Kopieer foutinformatie');copy.onclick=async()=>{const bundle=JSON.stringify({message,stack:event.error instanceof Error?event.error.stack:undefined,roomId,playerId,view,userAgent:navigator.userAgent},null,2);try{await navigator.clipboard.writeText(bundle);copy.textContent='Gekopieerd ✓';}catch{copy.textContent='Kopiëren niet beschikbaar';}};root.append(card);});
window.addEventListener('unhandledrejection',event=>{lastServerError={code:'CLIENT_UNHANDLED_REJECTION',message:String(event.reason)};events.unshift(`Fout CLIENT_UNHANDLED_REJECTION: ${String(event.reason)}`);if(roomId)render();});
