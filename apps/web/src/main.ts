import type { GameAction, PlayerView, Resource } from '@dimat/engine';
import type { BotStatus, RoomLifecycle, ServerMessage } from '@dimat/protocol';
import './style.css';

type SeatSummary={playerId:string;displayName:string;bot:boolean};
type PlacementMode='road'|'settlement'|'city'|'robber'|null;
type PendingAction={sequence:number;targetKey?:string};
const SVG_NS='http://www.w3.org/2000/svg';
const COLORS=['#37a9d2','#e16c59','#e2b941','#7b68c6'];
const PIPS:Record<number,number>={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const RESOURCE_ICON:Record<'brick'|'lumber'|'wool'|'grain'|'ore',string>={brick:'▦',lumber:'♣',wool:'❖',grain:'✳',ore:'⬡'};
const root=document.querySelector<HTMLDivElement>('#app')!;
let view:PlayerView|undefined;
let playerId='';let seatToken='';let roomId='';let socket:WebSocket|undefined;
let events:string[]=[];let seats:SeatSummary[]=[];let botStatuses:BotStatus[]=[];
let lifecycle:RoomLifecycle='lobby';let gameStartedReceived=false;
let placementMode:PlacementMode=null;let pending:PendingAction|null=null;let robberChoices:GameAction[]|null=null;
const debugMode=new URLSearchParams(location.search).get('debug')==='1';

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{
  const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;
};
const svgElement=(tag:string)=>document.createElementNS(SVG_NS,tag);
function playerColor(id:string){const index=Number(id.replace(/^p/,''));return COLORS[Number.isFinite(index)?index%COLORS.length:0]!;}
function playerName(id:string){return seats.find(seat=>seat.playerId===id)?.displayName||id;}
function errorText(code:string,message:string){
  const local:Record<string,string>={GAME_NOT_STARTED:'Het spel is nog niet gestart.',GAME_FINISHED:'Dit spel is afgelopen.',NOT_YOUR_TURN:'Je bent nog niet aan de beurt.',ILLEGAL_ACTION:'Deze actie mag nu niet.',WAITING_FOR_PLAYERS:'Wacht tot beide menselijke spelers zijn aangesloten.',ROOM_NOT_FOUND:'Deze kamer bestaat niet (meer).'};
  return local[code]??message;
}
function shell(){
  root.replaceChildren();const header=element('header','top');
  header.append(element('strong','brand','DiMaT'),element('span','muted','Browser board game · online'));
  const theme=element('button','','Licht/donker');theme.onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;localStorage.setItem('dimat-theme',next);};
  header.append(theme);root.append(header);const main=element('main');root.append(main);return main;
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
  socket.onopen=()=>socket?.send(JSON.stringify({type:'join',roomId,seatToken:seatToken||undefined,displayName}));
  socket.onmessage=event=>{
    const message=JSON.parse(event.data) as ServerMessage;
    if(message.type==='error'){pending=null;robberChoices=null;events.unshift(`Fout ${message.code}: ${errorText(message.code,message.message)}`);render();}
    else if(message.type==='joined'){seatToken=message.seatToken;playerId=message.playerId;lifecycle=message.lifecycle;gameStartedReceived=false;localStorage.setItem(`dimat-seat-${roomId}`,seatToken);render();}
    else if(message.type==='gameStarted'||message.type==='gameFinished'){view=message.view;lifecycle=message.type==='gameFinished'?'finished':'started';gameStartedReceived=message.type==='gameStarted';render();}
    else if(message.type==='update'){
      if(view)view={...view,...message.patch};events=[...message.events.map(item=>String(item.type)),...events].slice(0,50);
      if(pending&&message.clientSequence===pending.sequence){pending=null;robberChoices=null;placementMode=null;}
      if(view?.winnerId){lifecycle='finished';gameStartedReceived=false;}render();
    }else if(message.type==='room'){seats=message.seats;botStatuses=message.botStatuses;lifecycle=message.lifecycle;if(lifecycle!=='started')gameStartedReceived=false;render();}
  };
  socket.onclose=()=>{gameStartedReceived=false;events.unshift('Verbinding verbroken. Vernieuw of gebruik dezelfde uitnodigingslink om opnieuw te verbinden.');render();};
}
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
  const svg=svgElement('svg') as SVGSVGElement;svg.setAttribute('viewBox','-10 -9 20 18');svg.setAttribute('role','img');svg.setAttribute('aria-label','Game board');svg.classList.add('board');
  const mode=activePlacementMode(v);const tileLayer=svgElement('g'),roadLayer=svgElement('g'),harborLayer=svgElement('g'),pieceLayer=svgElement('g'),targetLayer=svgElement('g'),previewLayer=svgElement('g');
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
    const polygon=svgElement('polygon'),points=pointList(v,tile.vertices);polygon.setAttribute('points',points.map(p=>p.join(',')).join(' '));polygon.setAttribute('class',`hex terrain-${tile.kind}${tile.id===v.robberTile?' robber-tile':''}`);polygon.dataset.tile=String(tile.id);
    const title=svgElement('title');title.textContent=tile.number?`${tile.kind}: ${tile.number}, ${PIPS[tile.number]} pip(s)`:`${tile.kind}`;polygon.append(title);tileLayer.append(polygon);
    const [x,y]=tileCenter(tile.q,tile.r);drawTerrainIcon(tileLayer,tile.kind,x,y+.58);
    if(tile.number){
      const token=svgElement('circle');token.setAttribute('cx',String(x));token.setAttribute('cy',String(y));token.setAttribute('r','.73');token.setAttribute('class',`number-token${tile.number===6||tile.number===8?' hot':''}`);tileLayer.append(token);
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
  svg.append(tileLayer,roadLayer,harborLayer,pieceLayer,targetLayer,previewLayer);host.replaceChildren(svg);
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
  if(!debugMode)return null;const details=element('details','debug-actions'),summary=element('summary','','Debug: handmatige actie');details.append(summary);
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
  const form=element('form','discard-form');form.noValidate=true;const fields=new Map<Resource,HTMLInputElement>();const total=element('output','discard-total',`0 / ${required} gekozen`);const submit=element('button','primary','Kaarten afleggen');submit.type='submit';submit.disabled=true;
  function update(){const selected=[...fields.values()].reduce((n,input)=>n+(Number(input.value)||0),0);const withinLimits=[...fields].every(([resource,input])=>Number(input.value)>=0&&Number(input.value)<=viewState.ownResources[resource]&&Number.isInteger(Number(input.value)));total.textContent=`${selected} / ${required} gekozen`;total.classList.toggle('valid',selected===required&&withinLimits);submit.disabled=selected!==required||!withinLimits||!!pending;}
  for(const resource of ['brick','lumber','wool','grain','ore'] as Resource[]){const label=element('label','discard-field');const name=element('span','',`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${resource}`);const available=element('small','',`${viewState.ownResources[resource]} beschikbaar`);const input=element('input');input.type='number';input.min='0';input.max=String(viewState.ownResources[resource]);input.step='1';input.value='0';input.inputMode='numeric';input.setAttribute('aria-label',`${resource} om af te leggen`);input.addEventListener('input',update);fields.set(resource,input);label.append(name,available,input);form.append(label);}
  form.append(total,submit);form.onsubmit=event=>{event.preventDefault();update();if(submit.disabled)return;const resources=Object.fromEntries([...fields].map(([resource,input])=>[resource,Number(input.value)])) as Partial<Record<Resource,number>>;sendAction({type:'discard',playerId:viewState.playerId,resources});};card.append(form);return card;
}
function renderTradePanel(viewState:PlayerView){
  const bankTrades=viewState.legalActions.filter((action):action is Extract<GameAction,{type:'maritimeTrade'}>=>action.type==='maritimeTrade');if(!bankTrades.length)return null;const panel=element('section','card trade-panel');panel.append(element('h2','','Bank- en havenhandel'),element('p','muted','Kies een beschikbare ruil op basis van je kaarten, bankvoorraad en havens.'));
  const seen=new Set<string>();for(const action of bankTrades){const key=`${action.give}:${action.receive}`;if(seen.has(key))continue;seen.add(key);const harbors=viewState.board.vertices.filter(vertex=>vertex.harbor&&viewState.buildings[vertex.id]?.owner===Number(viewState.playerId.slice(1))).map(vertex=>vertex.harbor!);const ratio=harbors.some(harbor=>harbor.kind===action.give)?2:harbors.some(harbor=>harbor.kind==='generic')?3:4;panel.append(actionButton(`${ratio} ${action.give} → 1 ${action.receive}`,action));}
  return panel;
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
  const hand=element('div','hand');for(const resource of ['brick','lumber','wool','grain','ore'] as Resource[]){const cell=element('div','resource');cell.append(document.createTextNode(`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${resource}`),element('b','',String(view.ownResources[resource])));hand.append(cell);}side.append(hand);
  const bank=element('section','bank-panel');bank.append(element('h2','','Bank · ontwikkelingsstapel'));const bankCounts=element('div','hand');for(const resource of ['brick','lumber','wool','grain','ore'] as Resource[]){const cell=element('div','resource');cell.append(document.createTextNode(`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${resource}`),element('b','',String(view.bank[resource])));bankCounts.append(cell);}bank.append(bankCounts,element('p','muted',`${view.developmentCardsRemaining} ontwikkelingskaarten over`));side.append(bank,renderDevelopmentHand(view));
  const players=element('div','players');for(const player of view.players){const isActive=player.id===view.activePlayerId,status=botStatuses.find(item=>item.playerId===player.id);const panel=element('article',`player-panel player-${Number(player.id.slice(1))}${isActive?' active':''}`);panel.append(element('strong','',`${playerName(player.id)}${player.id===playerId?' (jij)':''}`));const badges=element('div','player-badges');if(isActive)badges.append(element('span','pill','Aan zet'));if(seats.find(seat=>seat.playerId===player.id)?.bot)badges.append(element('span','pill',status?.status==='thinking'?'Bot denkt…':'Bot'));if(player.hasLongestRoad)badges.append(element('span','pill','Langste handelsroute'));if(player.hasLargestArmy)badges.append(element('span','pill','Grootste riddermacht'));panel.append(badges,element('p','',`${player.visibleVictoryPoints} VP zichtbaar · ${player.resourceCount} grondstofkaarten · ${player.developmentCardCount} ontwikkelingskaarten`),element('p','',`${player.knightsPlayed} ridders · route ${player.longestRoadLength} · ${player.roadsLeft} wegen · ${player.settlementsLeft} nederzettingen · ${player.citiesLeft} steden`));players.append(panel);}side.append(players);
  const picker=renderRobberPicker();if(picker)side.append(picker);
  const discard=renderDiscardPrompt(view);if(discard)side.append(discard);const trade=renderTradePanel(view);if(trade)side.append(trade);
  const debug=renderDebugActions(view);if(debug)side.append(debug);
  side.append(element('h2','','Gebeurtenissen'));for(const line of events.filter(item=>!item.startsWith('Fout ')).slice(0,10))side.append(element('p','event',line));
  grid.append(board,side);main.append(grid,renderBuildBar(view));
}

document.documentElement.dataset.theme=localStorage.getItem('dimat-theme')??'dark';
const savedRoom=location.pathname.split('/')[2];roomId=savedRoom??'';
if(roomId){seatToken=localStorage.getItem(`dimat-seat-${roomId}`)??'';const name=localStorage.getItem('dimat-name')??'';if(name)connect(name);else lobby('Vul je naam in om aan te sluiten.');}else lobby();
