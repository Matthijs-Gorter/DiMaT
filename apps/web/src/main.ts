import type { GameAction, GameEvent, PlayerView, Resource } from '@dimat/engine';
import type { BotStatus, RoomLifecycle, ServerMessage } from '@dimat/protocol';
import { BEGINNER_MAP_CODE, cornerPoint, mapTileCenter, type MapDefinition, type MapTileKind } from '@dimat/maps';
import { findLegalDiscardAction } from './discard-action.js';
import { mountMapEditor } from './map-editor.js';
import { createTerrainTileVisual, mapHarborCenter } from './terrain-rendering.js';
import { readApiJson } from './api-json.js';
import './style.css';
import './game-ui.css';
import './theme.css'; // Single source of truth for all editable UI colors.

document.documentElement.dataset.theme=localStorage.getItem('dimat-theme')??'dark';
document.body.classList.add('surface-page');

type SeatSummary={playerId:string;displayName:string;bot:boolean};
type PlacementMode='road'|'settlement'|'city'|'robber'|null;
type PendingAction={sequence:number;targetKey?:string};
const SVG_NS='http://www.w3.org/2000/svg';
const themeColor=(name:string)=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COLORS=['--dimat-player-0','--dimat-player-1','--dimat-player-2','--dimat-player-3'].map(themeColor);
const PIPS:Record<number,number>={2:1,3:2,4:3,5:4,6:5,8:5,9:4,10:3,11:2,12:1};
const RESOURCE_ICON:Record<'brick'|'lumber'|'wool'|'grain'|'ore',string>={brick:'▦',lumber:'♣',wool:'❖',grain:'✳',ore:'⬡'};
const ROAD_STROKE='.2';
const HARBOR_MARKER_SIZE=.9;
const HARBOR_OFFSET=1.1;
const root=document.querySelector<HTMLDivElement>('#app')!;
let view:PlayerView|undefined;
let playerId='';let seatToken='';let roomId='';let socket:WebSocket|undefined;
let events:string[]=[];let seats:SeatSummary[]=[];let botStatuses:BotStatus[]=[];
let chatMessages:Array<{playerId:string;text:string;createdAt:number}>=[];
let lifecycle:RoomLifecycle='lobby';let gameStartedReceived=false;let tradeOpen=false;let tradeTab:'players'|'bank'='players';
let tradeDraftGive:Partial<Record<Resource,number>>={};let tradeDraftWant:Partial<Record<Resource,number>>={};let tradeDraftTargets=new Set<string>();let tradeTargetsInitialized=false;let tradeCounterVisible=false;
let tradeFeedback='';let bankGive:Resource='brick';let bankReceive:Resource='lumber';let bankQuantity=1;let bankQueue:{give:Resource;receive:Resource;remaining:number}|null=null;
let placementMode:PlacementMode=null;let buildModeOpen=false;let pending:PendingAction|null=null;let robberChoices:GameAction[]|null=null;
let debugEnabled=new URLSearchParams(location.search).get('debug')==='1';let devCardsOpen=false;let connectionState='connecting';let latencyMs:number|null=null;let lastServerError:Record<string,unknown>|null=null;let debugData:Record<string,unknown>|null=null;

const element=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text='')=>{
  const node=document.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;return node;
};
type ResourceCounter={value:number;max:number;output:HTMLOutputElement;minus:HTMLButtonElement;plus:HTMLButtonElement;refresh:()=>void};
function resourceCounter(title:string,max:number,minusLabel:string,plusLabel:string,onChange:()=>void,subtitle?:string,initial=0){
  const row=element('div','resource-counter-row'),label=element('div','resource-counter-label'),controls=element('div','resource-counter-controls');
  label.append(element('span','resource-counter-name',title));if(subtitle)label.append(element('small','resource-counter-subtitle',subtitle));
  const minus=element('button','resource-counter-button resource-counter-minus','−'),output=element('output','resource-counter-value','0'),plus=element('button','resource-counter-button resource-counter-plus','+');
  minus.type='button';plus.type='button';minus.setAttribute('aria-label',minusLabel);plus.setAttribute('aria-label',plusLabel);
  const counter:ResourceCounter={value:Math.max(0,Math.min(max,initial)),max,output,minus,plus,refresh:()=>{}};
  const refresh=()=>{output.value=String(counter.value);minus.disabled=counter.value<=0||!!pending;plus.disabled=counter.value>=counter.max||!!pending;};
  counter.refresh=refresh;
  const animateValue=()=>{if(typeof output.animate==='function')output.animate([{transform:'scale(1.16)',color:'var(--gx-gold)'},{transform:'scale(1)',color:'var(--gx-text)'}],{duration:180,easing:'ease-out'});};
  minus.onclick=()=>{counter.value=Math.max(0,counter.value-1);refresh();animateValue();onChange();};
  plus.onclick=()=>{counter.value=Math.min(counter.max,counter.value+1);refresh();animateValue();onChange();};
  controls.append(minus,output,plus);row.append(label,controls);refresh();return{row,counter};
}
const svgElement=(tag:string)=>document.createElementNS(SVG_NS,tag);
function playerColor(id:string){const index=Number(id.replace(/^p/,''));return COLORS[Number.isFinite(index)?index%COLORS.length:0]!;}
function playerName(id:string){return seats.find(seat=>seat.playerId===id)?.displayName||id;}
type NoticeKind='info'|'success'|'warning'|'error';
type Notice={id:string;kind:NoticeKind;text:string;field?:string};
let transientNotices:Notice[]=[];
const dismissedNotices=new Set<string>();
const noticeTimers=new Map<string,number>();
let noticeSeq=0;
const NOTICE_ICON:Record<NoticeKind,string>={info:'i',success:'✓',warning:'!',error:'!'};
function pushNotice(kind:NoticeKind,text:string,opts:{ttl?:number;field?:string}={}){
  const id=`n${++noticeSeq}`;
  const ttl=opts.ttl??(kind==='success'?4000:kind==='info'?6000:kind==='error'?10000:0);
  transientNotices=[...transientNotices,{id,kind,text,...(opts.field?{field:opts.field}:{})}].slice(-3);
  if(ttl>0)noticeTimers.set(id,window.setTimeout(()=>dismissNotice(id),ttl));
  renderNotices();
}
function dismissNotice(id:string){
  dismissedNotices.add(id);
  transientNotices=transientNotices.filter(notice=>notice.id!==id);
  const timer=noticeTimers.get(id);if(timer!==undefined){window.clearTimeout(timer);noticeTimers.delete(id);}
  renderNotices();
}
function currentInstruction():Notice|null{
  if(!view||lifecycle!=='started')return null;
  const mine=view.activePlayerId===view.playerId,mode=activePlacementMode(view);
  const pieces=Object.values(view.buildings).filter(Boolean).length+Object.values(view.roads).filter(Boolean).length;
  let text='',kind:NoticeKind='info';
  if(view.phase==='discard'){
    if(view.legalActions.some(action=>action.type==='discard')){text='Er is een 7 gegooid: kies kaarten om af te leggen in het rechterpaneel.';kind='warning';}
  }else if(mine){
    if(mode==='road')text='Klik op een groen gemarkeerde weg om een weg te plaatsen.';
    else if(mode==='settlement')text='Klik op een groen gemarkeerd kruispunt om een nederzetting te plaatsen.';
    else if(mode==='city')text='Klik op een eigen nederzetting om deze te upgraden tot stad.';
    else if(mode==='robber')text='Klik op een gemarkeerd veld om de rover te verplaatsen.';
    else if(view.phase==='roll')text='Gooi de dobbelstenen om je beurt te beginnen.';
  }
  if(!text)return null;
  const id=`hint:${view.phase}:${mode??'-'}:${view.turnNumber}:${view.activePlayerId}:${pieces}`;
  return dismissedNotices.has(id)?null:{id,kind,text};
}
function renderNotices(){
  let host=document.getElementById('gx-notices');
  if(!host){host=document.createElement('div');host.id='gx-notices';host.setAttribute('role','status');host.setAttribute('aria-live','polite');document.body.append(host);}
  const instruction=currentInstruction(),wanted=[...(instruction?[instruction]:[]),...transientNotices],wantedIds=new Set(wanted.map(notice=>notice.id));
  for(const node of Array.from(host.children) as HTMLElement[]){
    if(!wantedIds.has(node.dataset.id??'')&&!node.classList.contains('leaving')){node.classList.add('leaving');window.setTimeout(()=>node.remove(),200);}
  }
  for(const notice of wanted){
    if(host.querySelector(`[data-id="${notice.id}"]:not(.leaving)`))continue;
    const node=element('div',`gx-notice gx-${notice.kind}`);node.dataset.id=notice.id;
    node.append(element('span','gx-notice-icon',NOTICE_ICON[notice.kind]),element('span','gx-notice-text',notice.text));
    if(notice.field){const input=element('input','gx-notice-field');input.value=notice.field;input.readOnly=true;input.onclick=()=>input.select();node.append(input);}
    const close=element('button','gx-notice-close','×');close.type='button';close.setAttribute('aria-label','Melding sluiten');close.onclick=()=>dismissNotice(notice.id);node.append(close);
    host.append(node);
  }
}
const PHASE_LABELS:Record<string,string>={setupSettlement:'Opzet · nederzetting',setupRoad:'Opzet · weg',roll:'Dobbelen',build:'Bouwen & ruilen',robber:'Rover verplaatsen',discard:'Kaarten afleggen',finished:'Afgelopen'};
const phaseLabel=(phase:string)=>PHASE_LABELS[phase]??phase;
const RESOURCE_ORDER:Resource[]=['lumber','brick','wool','grain','ore'];
const RESOURCE_SVG:Record<Resource,string>={
  lumber:'<path d="M12 2.5 5.5 12H9l-3.5 5.5h13L15 12h3.5z"/><rect x="11" y="17" width="2" height="4.5" rx=".6"/>',
  brick:'<rect x="2.5" y="5" width="9" height="5" rx="1"/><rect x="12.5" y="5" width="9" height="5" rx="1"/><rect x="2.5" y="11.5" width="4.5" height="5" rx="1"/><rect x="8" y="11.5" width="8" height="5" rx="1"/><rect x="17" y="11.5" width="4.5" height="5" rx="1"/>',
  wool:'<circle cx="8" cy="12" r="4"/><circle cx="13" cy="9" r="4.5"/><circle cx="17" cy="13" r="3.6"/><rect x="6.5" y="12" width="12" height="5" rx="2.5"/>',
  grain:'<path d="M12 21V10" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/><ellipse cx="9" cy="10" rx="2" ry="3.2" transform="rotate(-28 9 10)"/><ellipse cx="15" cy="10" rx="2" ry="3.2" transform="rotate(28 15 10)"/><ellipse cx="9.3" cy="15.5" rx="2" ry="3.2" transform="rotate(-28 9.3 15.5)"/><ellipse cx="14.7" cy="15.5" rx="2" ry="3.2" transform="rotate(28 14.7 15.5)"/><ellipse cx="12" cy="5.5" rx="1.9" ry="3.2"/>',
  ore:'<path d="M12 2.5 20.5 9 17.5 20h-11L3.5 9z"/>'
};
const ACTION_SVG={
  road:'<path d="M5 19 19 5" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" fill="none"/>',
  settlement:'<path d="M12 3.5 20 11v9.5H4V11z"/>',
  city:'<path d="M3 20.5V11l4-3 4 3V7.5l4.5-4L21 7.5v13z"/>'
};
const svgIcon=(inner:string,cls='')=>{const span=element('span',cls);span.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;return span;};
const resourceIcon=(resource:Resource)=>svgIcon(RESOURCE_SVG[resource],`gx-ricon res-${resource}`);
function resourceSlot(resource:Resource,count:number,small=false){
  const slot=element('div',`gx-slot res-${resource}${count===0?' zero':''}${small?' small':''}`);slot.dataset.resource=resource;
  slot.title=`${RESOURCE_NAMES[resource]}: ${count}`;slot.setAttribute('role','group');slot.setAttribute('aria-label',`${RESOURCE_NAMES[resource]}: ${count}`);
  slot.append(resourceIcon(resource),element('span','gx-slot-name',RESOURCE_NAMES[resource]),element('span','gx-slot-count',String(count)));
  return slot;
}
const RESOURCE_NAMES:Record<Resource,string>={brick:'brick',lumber:'hout',wool:'wol',grain:'graan',ore:'erts'};
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
    case 'tradeOffered':return `${name} deed een ruilvoorstel`;
    case 'tradeCountered':return `${name} deed een tegenbod aan ${playerName(String(data.partnerId))}`;
    case 'tradeDeclined':return `${name} wees een ruilvoorstel af`;
    case 'tradeCancelled':return `${name} annuleerde het ruilvoorstel`;
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
  const local:Record<string,string>={GAME_NOT_STARTED:'Het spel is nog niet gestart.',GAME_FINISHED:'Dit spel is afgelopen.',NOT_YOUR_TURN:'Je bent nog niet aan de beurt.',ILLEGAL_ACTION:'Deze actie mag nu niet.',WAITING_FOR_PLAYERS:'Wacht tot de gekozen menselijke spelers zijn aangesloten.',ROOM_NOT_FOUND:'Deze kamer bestaat niet (meer).'};
  return local[code]??message;
}
function shell(){
  root.replaceChildren();const header=element('header','top');
  const connectionLabel=({connected:'Verbonden',connecting:'Verbinden…',disconnected:'Verbinding verbroken'} as Record<string,string>)[connectionState]??connectionState;
  header.append(element('strong','brand','DiMaT'),element('span',`connection-indicator state-${roomId?connectionState:'disconnected'}`,roomId?connectionLabel:'Offline'));
  const theme=element('button','','Licht/donker');theme.onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;localStorage.setItem('dimat-theme',next);};
  const debug=element('button',debugEnabled?'selected':'','Debug');debug.setAttribute('aria-pressed',String(debugEnabled));debug.onclick=()=>{debugEnabled=!debugEnabled;const url=new URL(location.href);if(debugEnabled)url.searchParams.set('debug','1');else url.searchParams.delete('debug');history.replaceState({},'',url);render();void refreshDebugData();};
  header.append(theme,debug);root.append(header);const main=element('main');root.append(main);return main;
}
function showMapPreview(host:HTMLElement,map:MapDefinition){
  const svg=svgElement('svg');
  const point=(q:number,r:number,corner:number):[number,number]=>{const [x,y]=cornerPoint(q,r,corner);return [x*Math.sqrt(3),y];};
  const vertices=map.tiles.flatMap(tile=>Array.from({length:6},(_,corner)=>point(tile.q,tile.r,corner)));
  const xs=vertices.map(([x])=>x),ys=vertices.map(([,y])=>y),left=Math.min(...xs)-.5,top=Math.min(...ys)-.5,width=Math.max(...xs)-Math.min(...xs)+1,height=Math.max(...ys)-Math.min(...ys)+1;
  svg.setAttribute('viewBox',`${left} ${top} ${width} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`Voorbeeld van map ${map.name}`);svg.classList.add('map-preview-board');
  for(const tile of map.tiles){
    const [x,y]=mapTileCenter(tile.q,tile.r);svg.append(createTerrainTileVisual(tile.kind,x,y,tile.number,{showNumber:true,outline:true}));
  }
  for(const river of map.rivers){
    const a=point(river.tile.q,river.tile.r,river.side),b=point(river.tile.q,river.tile.r,(river.side+1)%6),line=svgElement('line');
    line.setAttribute('x1',String(a[0]));line.setAttribute('y1',String(a[1]));line.setAttribute('x2',String(b[0]));line.setAttribute('y2',String(b[1]));line.setAttribute('stroke',themeColor('--dimat-river'));line.setAttribute('stroke-width','.18');line.setAttribute('stroke-linecap','round');svg.append(line);
  }
  for(const harbor of map.harbors){const [x,y]=mapHarborCenter(harbor.tile.q,harbor.tile.r,harbor.side),marker=svgElement('g');marker.setAttribute('class','map-preview-harbor');const circle=svgElement('circle');circle.setAttribute('cx',String(x));circle.setAttribute('cy',String(y));circle.setAttribute('r','.3');circle.setAttribute('class','map-harbor-marker');const label=svgElement('text');label.setAttribute('x',String(x));label.setAttribute('y',String(y+.1));label.setAttribute('text-anchor','middle');label.textContent=harbor.kind==='generic'?'3:1':`2:1 ${harbor.kind[0]?.toUpperCase()??''}`;marker.append(circle,label);svg.append(marker);}
  host.replaceChildren(svg);
}
function lobby(message='Maak een kamer of gebruik een uitnodigingslink.'){
  const main=shell(),card=element('section','card lobby');
  card.append(element('h1','','Speel alleen of samen'),element('p','muted',message));
  const name=element('input');name.placeholder='Je naam';name.maxLength=32;name.value=localStorage.getItem('dimat-name')??'';
  const mapCodeInput=element('input');mapCodeInput.placeholder='Mapcode (optioneel)';mapCodeInput.maxLength=6;mapCodeInput.autocomplete='off';mapCodeInput.setAttribute('aria-label','Mapcode');
  const mapRow=element('div','map-picker-row'),mapStatus=element('p','muted map-picker-status','Zonder mapcode wordt het standaardbord gebruikt.');
  const mapPreview=element('div','map-preview');
  let selectedMapCode='';
  const previewButton=element('button','gx-btn','Map bekijken');previewButton.type='button';
  const beginnerButton=element('button','gx-btn','Beginnerskaart bekijken');beginnerButton.type='button';beginnerButton.title='Vaste, handgemaakte kaart met een toegankelijke startverdeling.';
  mapRow.append(mapCodeInput,previewButton,beginnerButton);card.append(mapRow,mapStatus,mapPreview);
  mapCodeInput.addEventListener('input',()=>{selectedMapCode='';mapPreview.replaceChildren();mapStatus.textContent=mapCodeInput.value?'Klik op Map bekijken om de kaart op te halen.':'Zonder mapcode wordt het standaardbord gebruikt.';});
  previewButton.onclick=async()=>{
    const code=mapCodeInput.value.trim().toUpperCase();await previewCode(code,previewButton);
  };
  beginnerButton.onclick=async()=>{mapCodeInput.value=BEGINNER_MAP_CODE;await previewCode(BEGINNER_MAP_CODE,beginnerButton);};
  async function previewCode(code:string,button:HTMLButtonElement){mapStatus.textContent='Map ophalen…';button.disabled=true;
    try{
      const response=await fetch(`/api/maps/${encodeURIComponent(code)}`),data=await readApiJson<{map:MapDefinition;message?:string}>(response,'Kaartvoorbeeld laden');
      if(!response.ok)throw new Error(data.message??'Map kon niet worden geladen.');
      selectedMapCode=code;showMapPreview(mapPreview,data.map as MapDefinition);
      const map=data.map as MapDefinition,landCount=map.tiles.filter(tile=>tile.kind!=='water').length;
      mapStatus.textContent=`${map.name} · ${map.style} · ${landCount} landtegels · ${map.players.min}–${map.players.max} spelers`;
    }catch(error){selectedMapCode='';mapPreview.replaceChildren();mapStatus.textContent=error instanceof Error?error.message:'Map kon niet worden geladen.';}
    finally{button.disabled=false;}
  }
  const humanCountSelect=element('select'),botCountSelect=element('select'),options=element('div','create-options'),summary=element('p','muted create-summary');
  humanCountSelect.setAttribute('aria-label','Aantal menselijke spelers');
  botCountSelect.setAttribute('aria-label','Aantal bots');
  for(let count=1;count<=8;count++)humanCountSelect.append(new Option(String(count),String(count)));
  for(let count=0;count<=7;count++)botCountSelect.append(new Option(String(count),String(count)));
  humanCountSelect.value='2';
  botCountSelect.value='1';
  const stepper=(label:string,select:HTMLSelectElement)=>{
    const field=element('div','create-stepper'),caption=element('span','create-stepper-label',label),controls=element('div','create-stepper-controls');
    const minus=element('button','create-stepper-button','−'),plus=element('button','create-stepper-button','+');
    minus.type='button';plus.type='button';minus.setAttribute('aria-label',`Minder ${label.toLowerCase()}`);plus.setAttribute('aria-label',`Meer ${label.toLowerCase()}`);
    select.classList.add('create-stepper-native');select.setAttribute('aria-label',select.getAttribute('aria-label')??label);
    const refresh=()=>{minus.disabled=select.selectedIndex<=0;plus.disabled=select.selectedIndex>=select.options.length-1;};
    minus.onclick=()=>{if(select.selectedIndex>0){select.selectedIndex--;select.dispatchEvent(new Event('change'));refresh();}};
    plus.onclick=()=>{if(select.selectedIndex<select.options.length-1){select.selectedIndex++;select.dispatchEvent(new Event('change'));refresh();}};
    controls.append(minus,select,plus);field.append(caption,controls);return{field,refresh};
  };
  const humanStepper=stepper('Menselijke spelers',humanCountSelect),botStepper=stepper('Bots',botCountSelect);
  options.append(humanStepper.field,botStepper.field);
  const create=element('button','primary','Nieuwe kamer'),status=element('p','muted');
  const editorLink=element('a','map-editor-link','Map genereren of bewerken');editorLink.href='/maps/new';
  const row=element('div','row');row.append(name,create);card.append(options,summary,row,status);main.append(card);
  card.append(editorLink);
  function updateBotOptions(){
    const humans=Number(humanCountSelect.value),previous=Number(botCountSelect.value),validCounts=Array.from({length:8},(_,count)=>count).filter(count=>humans+count>=2&&humans+count<=8);
    botCountSelect.replaceChildren(...validCounts.map(count=>new Option(String(count),String(count))));
    botCountSelect.value=String(validCounts.includes(previous)?previous:validCounts[0]);
    for(const option of Array.from(humanCountSelect.options))option.disabled=Number(option.value)+Number(botCountSelect.value)<2||Number(option.value)+Number(botCountSelect.value)>8;
    humanStepper.refresh();botStepper.refresh();
    const total=humans+Number(botCountSelect.value);
    summary.textContent=`${humans} menselijke speler${humans===1?'':'s'} en ${botCountSelect.value} bot${botCountSelect.value==='1'?'':'s'} · ${total} / 8 spelers${total===8?' · maximum bereikt':''}`;
  }
  humanCountSelect.onchange=updateBotOptions;
  botCountSelect.onchange=updateBotOptions;
  updateBotOptions();
  async function make(){
    if(!name.value.trim()){status.textContent='Vul eerst je naam in.';name.focus();return;}
    localStorage.setItem('dimat-name',name.value.trim());status.textContent='Kamer maken…';
    create.disabled=true;
    try{    const response=await fetch('/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:name.value.trim(),humanCount:Number(humanCountSelect.value),botCount:Number(botCountSelect.value),...(selectedMapCode?{mapCode:selectedMapCode}:{})})});const data=await response.json();if(!response.ok)throw new Error(data.message??'Kamer maken mislukt');
      roomId=data.roomId;seatToken=data.seatToken;playerId=data.playerId;history.replaceState({},'',`/play/${roomId}`);connect(name.value.trim());
    }catch(error){status.textContent=error instanceof Error?error.message:'Verbinding mislukt';create.disabled=false;}
  }
  create.onclick=()=>void make();
  const path=location.pathname.split('/');
  if(path[1]==='play'&&path[2]){roomId=path[2]!;const join=element('button','','Deelnemen aan kamer');join.onclick=()=>{if(!name.value.trim()){status.textContent='Vul je naam in.';return;}localStorage.setItem('dimat-name',name.value.trim());connect(name.value.trim());};row.append(join);}
}
function connect(displayName:string){
  socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`);
  (window as Window&{dimatSend?:WebSocket}).dimatSend=socket;
  socket.onopen=()=>{connectionState='connected';socket?.send(JSON.stringify({type:'join',roomId,seatToken:seatToken||undefined,displayName}));void measureLatency();};
  socket.onmessage=event=>{
    const message=JSON.parse(event.data) as ServerMessage;
    if(message.type==='error'){pending=null;bankQueue=null;robberChoices=null;lastServerError={code:message.code,message:message.message,details:message.details};pushNotice('error',errorText(message.code,message.message));if(tradeOpen)tradeFeedback=errorText(message.code,message.message);render();}
    else if(message.type==='joined'){seatToken=message.seatToken;playerId=message.playerId;lifecycle=message.lifecycle;gameStartedReceived=false;localStorage.setItem(`dimat-seat-${roomId}`,seatToken);render();}
    else if(message.type==='gameStarted'||message.type==='gameFinished'){view=message.view;lifecycle=message.type==='gameFinished'?'finished':'started';gameStartedReceived=message.type==='gameStarted';render();void refreshDebugData();}
    else if(message.type==='update'){
      if(view)view={...view,...message.patch};if(view?.tradeOffer?.proposerId!==view?.playerId&&view?.tradeOffer?.targets.includes(view?.playerId??'')){tradeOpen=true;tradeTab='players';}events=[...message.events.map(eventText),...events].slice(0,50);
      let continueBankQueue=false;
      for(const tradeEvent of message.events){
        if(tradeEvent.type==='domesticTradeCompleted')tradeFeedback=`${playerName(String(tradeEvent.partnerId))} heeft het ruilvoorstel geaccepteerd.`;
        else if(tradeEvent.type==='tradeDeclined')tradeFeedback=`${playerName(String(tradeEvent.playerId))} heeft het ruilvoorstel afgewezen.`;
        else if(tradeEvent.type==='maritimeTradeCompleted')tradeFeedback=`Bankruil uitgevoerd: ${tradeEvent.ratio} ${RESOURCE_NAMES[String(tradeEvent.give) as Resource]} voor 1 ${RESOURCE_NAMES[String(tradeEvent.receive) as Resource]}.`;
      }
      if(pending&&message.clientSequence===pending.sequence){pending=null;robberChoices=null;placementMode=null;if(bankQueue){if(bankQueue.remaining<=0){bankQueue=null;}else continueBankQueue=true;}}
      if(view?.winnerId){lifecycle='finished';gameStartedReceived=false;}render();if(continueBankQueue)sendNextBankTrade();void refreshDebugData();
    }else if(message.type==='chat'){chatMessages=[...chatMessages,{playerId:message.playerId,text:message.text,createdAt:message.createdAt}].slice(-100);render();}
    else if(message.type==='room'){seats=message.seats;botStatuses=message.botStatuses;lifecycle=message.lifecycle;if(lifecycle!=='started')gameStartedReceived=false;render();void refreshDebugData();}
  };
  socket.onclose=()=>{gameStartedReceived=false;connectionState='disconnected';pushNotice('warning','Verbinding verbroken. Vernieuw of gebruik dezelfde uitnodigingslink om opnieuw te verbinden.');render();};
}
async function measureLatency(){try{const start=performance.now();const response=await fetch(`/api/rooms/${roomId}`);if(response.ok)latencyMs=Math.round(performance.now()-start);}catch{latencyMs=null;}if(debugEnabled)render();}
async function refreshDebugData(){if(!debugEnabled||!roomId)return;try{const response=await fetch(`/api/debug/rooms/${roomId}?playerId=${encodeURIComponent(playerId)}`);debugData=response.ok?await response.json() as Record<string,unknown>:null;if(debugData&&view){const serverHash=debugData.viewHash;debugData.clientViewHash=clientHash(view);debugData.viewHashMatches=serverHash===debugData.clientViewHash;}render();}catch{debugData=null;}}
function sendAction(action:GameAction,targetKey?:string){
  const listed=view?.legalActions.some(legal=>JSON.stringify(legal)===JSON.stringify(action));
  const customTrade=action.type==='proposeTrade'||action.type==='counterTrade';
  if(!gameStartedReceived||lifecycle!=='started'||pending||(!listed&&!customTrade)||action.type==='domesticTrade')return;
  if(socket?.readyState!==WebSocket.OPEN){pushNotice('warning','Verbinding is nog niet klaar.');render();return;}
  const sequence=Date.now();pending={sequence,...(targetKey?{targetKey}:{})};render();
  socket.send(JSON.stringify({type:'action',sequence,action}));
}
function sendNextBankTrade(){
  if(!bankQueue||!view||pending)return;
  if(bankQueue.remaining<=0){bankQueue=null;render();return;}
  const action=view.legalActions.find((candidate):candidate is Extract<GameAction,{type:'maritimeTrade'}>=>candidate.type==='maritimeTrade'&&candidate.give===bankQueue!.give&&candidate.receive===bankQueue!.receive);
  if(!action){bankQueue=null;tradeFeedback='De bankruil kan met de huidige voorraad niet verder.';render();return;}
  bankQueue.remaining--;sendAction(action);
}
function createLine(parent:SVGElement,a:readonly[number,number],b:readonly[number,number],className:string){
  const line=svgElement('line');line.setAttribute('x1',String(a[0]));line.setAttribute('y1',String(a[1]));line.setAttribute('x2',String(b[0]));line.setAttribute('y2',String(b[1]));line.setAttribute('class',className);parent.append(line);return line;
}
function pointForVertex(v:PlayerView,id:number):[number,number]{const vertex=v.board.vertices[id]!;return [vertex.x*Math.sqrt(3),vertex.y];}
function tileCenter(q:number,r:number):[number,number]{return mapTileCenter(q,r);}
function pointList(v:PlayerView,ids:number[]){return ids.map(id=>pointForVertex(v,id));}
function harborPositions(v:PlayerView){
  const harbors=new Map<number,{vertices:number[];kind:string;ratio:number}>();
  for(const vertex of v.board.vertices)if(vertex.harbor){const harbor=harbors.get(vertex.harbor.id)??{vertices:[],kind:vertex.harbor.kind,ratio:vertex.harbor.ratio};harbor.vertices.push(vertex.id);harbors.set(vertex.harbor.id,harbor);}
  return [...harbors.entries()].flatMap(([id,harbor])=>{
    if(harbor.vertices.length!==2)throw new Error(`Harbor ${id} must have exactly two coastline vertices`);
    const [first,second]=harbor.vertices as [number,number];
    const edge=v.board.edges.find(candidate=>candidate.vertices.includes(first)&&candidate.vertices.includes(second));
    if(!edge||edge.tiles.length!==1)throw new Error(`Harbor ${id} must lie on a coastline edge`);
    const [a,b]=pointList(v,harbor.vertices) as [[number,number],[number,number]],coast:[number,number]=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    const tile=v.board.tiles[edge.tiles[0]!]!,inside=tileCenter(tile.q,tile.r),dx=coast[0]-inside[0],dy=coast[1]-inside[1],length=Math.hypot(dx,dy);
    if(length===0)throw new Error(`Harbor ${id} has no outward coastline direction`);
    const center:[number,number]=[coast[0]+dx/length*HARBOR_OFFSET,coast[1]+dy/length*HARBOR_OFFSET];
    const radius=HARBOR_MARKER_SIZE/2,endpoint=(point:[number,number]):[number,number]=>{const x=point[0]-center[0],y=point[1]-center[1],distance=Math.hypot(x,y);if(distance<=radius)throw new Error(`Harbor ${id} overlaps its coastline`);return [center[0]+x/distance*radius,center[1]+y/distance*radius];};
    return [{id,...harbor,edgeId:edge.id,coastline:[[harbor.vertices[0]!,a],[harbor.vertices[1]!,b]] as [[number,[number,number]],[number,[number,number]]],center,connectors:[[harbor.vertices[0]!,endpoint(a)],[harbor.vertices[1]!,endpoint(b)]] as [[number,[number,number]],[number,[number,number]]]}];
  });
}
function boardViewBox(v:PlayerView):[number,number,number,number]{
  const points=v.board.vertices.map(vertex=>pointForVertex(v,vertex.id));
  for(const harbor of harborPositions(v))points.push([harbor.center[0]-HARBOR_MARKER_SIZE/2,harbor.center[1]-HARBOR_MARKER_SIZE/2],[harbor.center[0]+HARBOR_MARKER_SIZE/2,harbor.center[1]+HARBOR_MARKER_SIZE/2]);
  const padding=.8,topPadding=1.1,bottomPadding=2.3,xs=points.map(point=>point[0]),ys=points.map(point=>point[1]),left=Math.min(...xs)-padding,top=Math.min(...ys)-topPadding,right=Math.max(...xs)+padding,bottom=Math.max(...ys)+bottomPadding;
  return [left,top,right-left,bottom-top];
}
function activePlacementMode(v:PlayerView):PlacementMode{
  if(v.phase==='setupSettlement')return 'settlement';if(v.phase==='setupRoad')return 'road';if(v.phase==='robber')return 'robber';return placementMode;
}
function drawTerrainIcon(group:SVGElement,kind:string,x:number,y:number){
  const icon=svgElement('text');icon.setAttribute('x',String(x));icon.setAttribute('y',String(y));icon.setAttribute('text-anchor','middle');icon.setAttribute('class','terrain-icon');
  const glyph:Record<string,string>={brick:'▰',lumber:'♣',wool:'❖',grain:'✳',ore:'⬡',desert:'≈'};icon.textContent=glyph[kind]??'◆';group.append(icon);
}
function drawBoard(host:HTMLElement,v:PlayerView){
  const initialViewBox=boardViewBox(v);const svg=svgElement('svg') as SVGSVGElement;svg.setAttribute('viewBox',initialViewBox.join(' '));svg.setAttribute('preserveAspectRatio','xMidYMid meet');svg.setAttribute('role','img');svg.setAttribute('aria-label','Game board');svg.classList.add('board');
  const defs=svgElement('defs'),mode=activePlacementMode(v);const terrainLayer=svgElement('g'),tileLayer=svgElement('g'),roadLayer=svgElement('g'),harborLayer=svgElement('g'),pieceLayer=svgElement('g'),targetLayer=svgElement('g'),previewLayer=svgElement('g');
  terrainLayer.setAttribute('class','terrain-layer');tileLayer.setAttribute('class','tile-layer');roadLayer.setAttribute('class','road-layer');harborLayer.setAttribute('class','harbor-layer');pieceLayer.setAttribute('class','piece-layer');targetLayer.setAttribute('class','target-layer');previewLayer.setAttribute('class','preview-layer');
  const buildOverlay=buildModeOpen&&v.phase==='build'&&v.activePlayerId===v.playerId;
  const vertexTargets=new Map<number,GameAction>();
  if(mode==='settlement'||buildOverlay)for(const action of v.legalActions)if(action.type==='placeSettlement'||action.type==='buildSettlement')vertexTargets.set(action.vertex,action);
  if(mode==='city'||buildOverlay)for(const action of v.legalActions)if(action.type==='buildCity')vertexTargets.set(action.vertex,action);
  const edgeTargets=new Map<number,GameAction>();
  if(mode==='road'||buildOverlay)for(const action of v.legalActions)if(action.type==='placeRoad'||action.type==='buildRoad'||action.type==='buildBridge')edgeTargets.set(action.edge,action);
  const tileTargets=new Map<number,GameAction[]>();
  if(mode==='robber')for(const action of v.legalActions)if(action.type==='moveRobber'||action.type==='playKnight'){const tile='tile'in action?action.tile:-1;const list=tileTargets.get(tile)??[];list.push(action);tileTargets.set(tile,list);}

  const terrainTiles:{group:SVGElement;x:number;y:number}[]=[];
  for(const tile of v.board.tiles){
    const rolled=v.lastRoll?v.lastRoll[0]+v.lastRoll[1]:null;const produces=tile.number!==null&&tile.number===rolled;const polygon=svgElement('polygon'),points=pointList(v,tile.vertices),[x,y]=tileCenter(tile.q,tile.r);
    const terrainTile=createTerrainTileVisual(tile.kind as MapTileKind,x,y,null,{outline:false});terrainTile.setAttribute('class','terrain-tile');terrainTile.dataset.tile=String(tile.id);
    const art=terrainTile.querySelector('image');if(art){art.setAttribute('class',`terrain-art${produces?' producing':''}`);art.dataset.kind=tile.kind;art.dataset.tile=String(tile.id);}
    terrainTiles.push({group:terrainTile,x,y});
    polygon.setAttribute('points',points.map(p=>p.join(',')).join(' '));polygon.setAttribute('class',`hex terrain-${tile.kind}${tile.id===v.robberTile?' robber-tile':''}${produces?' producing':''}`);polygon.dataset.tile=String(tile.id);
    const title=svgElement('title');title.textContent=tile.number?`${tile.kind}: ${tile.number}, ${PIPS[tile.number]} pip(s)`:`${tile.kind}`;polygon.append(title);tileLayer.append(polygon);
    drawTerrainIcon(tileLayer,tile.kind,x,y+.58);
    if(tile.number){
      const token=svgElement('circle');token.setAttribute('cx',String(x));token.setAttribute('cy',String(y));token.setAttribute('r','.6');token.setAttribute('class',`number-token${tile.number===6||tile.number===8?' hot':''}`);const probability=svgElement('title');probability.textContent=`Kans: ${PIPS[tile.number]}/36 (${((PIPS[tile.number]??0)/36*100).toFixed(1)}%)`;token.append(probability);tileLayer.append(token);
      const number=svgElement('text');number.setAttribute('x',String(x));number.setAttribute('y',String(y+.16));number.setAttribute('text-anchor','middle');number.setAttribute('class','number-label');number.textContent=String(tile.number);tileLayer.append(number);
      const count=PIPS[tile.number]??0;for(let pip=0;pip<count;pip++){const dot=svgElement('circle');dot.setAttribute('cx',String(x+(pip-(count-1)/2)*.16));dot.setAttribute('cy',String(y+.43));dot.setAttribute('r','.045');dot.setAttribute('class','pip-dot');tileLayer.append(dot);}
    }
    if(tile.id===v.robberTile){const pawn=svgElement('g');pawn.setAttribute('class','robber-pawn');pawn.setAttribute('transform',`translate(${x-.78},${y-.38})`);const head=svgElement('circle');head.setAttribute('cx','0');head.setAttribute('cy','-.2');head.setAttribute('r','.18');const body=svgElement('path');body.setAttribute('d','M-.29 .26 Q-.24 -.08 0 -.08 Q.24 -.08 .29 .26 Z');pawn.append(head,body);tileLayer.append(pawn);}
    const actions=tileTargets.get(tile.id);if(actions?.length){const hit=svgElement('polygon');hit.setAttribute('points',points.map(p=>p.join(',')).join(' '));hit.setAttribute('class',`board-target legal-tile${pending?.targetKey===`tile-${tile.id}`?' pending':''}`);hit.dataset.targetKey=`tile-${tile.id}`;hit.dataset.victimCount=String(new Set(actions.flatMap(action=>action.type==='moveRobber'||action.type==='playKnight'?action.victimId?[action.victimId]:[]:[])).size);hit.addEventListener('click',()=>chooseRobberAction(actions,tile.id));targetLayer.append(hit);}
  }
  // Tiles are inset by half a road width and no longer overlap; keep a stable top-to-bottom DOM order anyway.
  terrainTiles.sort((a,b)=>Math.abs(a.y-b.y)>1e-6?a.y-b.y:a.x-b.x);for(const entry of terrainTiles)terrainLayer.append(entry.group);
  for(const edge of v.board.edges){
    const [a,b]=edge.vertices.map(id=>pointForVertex(v,id)) as [[number,number],[number,number]];
    if(edge.kind==='river'){const water=createLine(roadLayer,a,b,'river-edge');water.setAttribute('stroke-width','.1');}
    const road=v.roads[edge.id];if(road){const piece=createLine(roadLayer,a,b,`road-piece player-${road.owner}${edge.kind==='river'?' bridge-piece':''}`);piece.setAttribute('stroke-width',ROAD_STROKE);}
    const action=edgeTargets.get(edge.id);if(action){const highlight=createLine(targetLayer,a,b,'legal-road-highlight');highlight.setAttribute('stroke',themeColor('--dimat-legal-highlight'));highlight.setAttribute('stroke-width','.2');highlight.setAttribute('stroke-dasharray','.1 .09');highlight.setAttribute('pointer-events','none');const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),halfWidth=.36,nx=-dy/length*halfWidth,ny=dx/length*halfWidth;const hit=svgElement('polygon');hit.setAttribute('points',[[a[0]+nx,a[1]+ny],[b[0]+nx,b[1]+ny],[b[0]-nx,b[1]-ny],[a[0]-nx,a[1]-ny]].map(point=>point.join(',')).join(' '));hit.setAttribute('class',`board-target road-edge legal${pending?.targetKey===`edge-${edge.id}`?' pending':''}`);hit.setAttribute('fill',themeColor('--dimat-hit-area'));hit.setAttribute('fill-opacity','.001');hit.setAttribute('pointer-events','all');hit.dataset.targetKey=`edge-${edge.id}`;targetLayer.append(hit);
      hit.addEventListener('click',()=>sendAction(action,`edge-${edge.id}`));hit.addEventListener('pointerenter',()=>showPiecePreview(previewLayer,'road',[(a[0]+b[0])/2,(a[1]+b[1])/2],playerColor(playerId),[a,b]));hit.addEventListener('pointerleave',()=>previewLayer.replaceChildren());}
  }
  for(const harbor of harborPositions(v)){
    const active=harbor.vertices.some(id=>v.buildings[id]?.owner===Number(playerId.slice(1)));
    const group=svgElement('g');group.setAttribute('class',`harbor${active?' harbor-active':''}`);group.dataset.harbor=String(harbor.id);group.dataset.edge=String(harbor.edgeId);for(let index=0;index<harbor.connectors.length;index++){const [vertex,start]=harbor.coastline[index]!,[,end]=harbor.connectors[index]!,connector=createLine(group,start,end,'harbor-connector');connector.dataset.harbor=String(harbor.id);connector.dataset.vertex=String(vertex);}const marker=svgElement('circle');marker.setAttribute('cx',String(harbor.center[0]));marker.setAttribute('cy',String(harbor.center[1]));marker.setAttribute('r',String(HARBOR_MARKER_SIZE/2));marker.setAttribute('class','harbor-marker');group.append(marker);const label=svgElement('text');label.setAttribute('x',String(harbor.center[0]));label.setAttribute('y',String(harbor.center[1]+.14));label.setAttribute('text-anchor','middle');label.setAttribute('class','harbor-label');label.textContent=harbor.kind==='generic'?`${harbor.ratio}:1`:`${harbor.ratio}:1 ${RESOURCE_ICON[harbor.kind as keyof typeof RESOURCE_ICON]??'◆'}`;group.append(label);harborLayer.append(group);
  }
  for(const vertex of v.board.vertices){
    const [x,y]=pointForVertex(v,vertex.id),building=v.buildings[vertex.id];
    if(building){const group=svgElement('g');group.setAttribute('class',`building-piece player-${building.owner}`);group.setAttribute('transform',`translate(${x},${y})`);if(building.kind==='settlement'){const house=svgElement('path');house.setAttribute('d','M-.48 .02 L0 -.5 L.48 .02 V.47 H-.48 Z');group.append(house);}else{const house=svgElement('path');house.setAttribute('d','M-.55 -.25 L-.22 -.55 L.12 -.25 L.4 -.48 L.55 -.28 V.48 H-.55 Z');group.append(house);const door=svgElement('rect');door.setAttribute('x','-.12');door.setAttribute('y','.12');door.setAttribute('width','.24');door.setAttribute('height','.36');door.setAttribute('class','building-door');group.append(door);}pieceLayer.append(group);}
    const action=vertexTargets.get(vertex.id);if(action){const glow=svgElement('circle');glow.setAttribute('cx',String(x));glow.setAttribute('cy',String(y));glow.setAttribute('r','.43');glow.setAttribute('class',`legal-vertex-glow${pending?.targetKey===`vertex-${vertex.id}`?' pending':''}`);targetLayer.append(glow);const hit=svgElement('circle');hit.setAttribute('cx',String(x));hit.setAttribute('cy',String(y));hit.setAttribute('r','1.05');hit.setAttribute('fill','transparent');hit.setAttribute('pointer-events','all');hit.setAttribute('class',`board-target spot legal legal-vertex${pending?.targetKey===`vertex-${vertex.id}`?' pending':''}`);hit.dataset.targetKey=`vertex-${vertex.id}`;hit.addEventListener('click',()=>sendAction(action,`vertex-${vertex.id}`));hit.addEventListener('pointerenter',()=>showPiecePreview(previewLayer,action.type==='buildCity'?'city':'settlement',[x,y],playerColor(playerId)));hit.addEventListener('pointerleave',()=>previewLayer.replaceChildren());targetLayer.append(hit);}
  }
  svg.append(defs,terrainLayer,tileLayer,roadLayer,harborLayer,pieceLayer,targetLayer,previewLayer);let box=[...initialViewBox],drag:{x:number;y:number;box:number[];moved:boolean}|null=null;const pointers=new Map<number,{x:number;y:number}>();let pinchStart:{distance:number;box:number[]}|null=null;
  const controls=element('div','board-controls'),zoomOut=element('button','','−'),zoomLabel=element('span','muted','100%'),zoomIn=element('button','','+'),center=element('button','','Hercentreer');zoomOut.setAttribute('aria-label','Uitzoomen');zoomIn.setAttribute('aria-label','Inzoomen');
  const constrainViewBox=(next:number[])=>{
    const [baseX,baseY,baseWidth,baseHeight]=initialViewBox,[width,height]=next.slice(2);
    const limitCenter=(center:number,size:number,baseCenter:number,baseSize:number)=>Math.max(baseCenter-Math.max(0,(size-baseSize)/2)-baseSize*.25,Math.min(baseCenter+Math.max(0,(size-baseSize)/2)+baseSize*.25,center));
    const x=limitCenter(next[0]!+width/2,width,baseX+baseWidth/2,baseWidth)-width/2;
    const y=limitCenter(next[1]!+height/2,height,baseY+baseHeight/2,baseHeight)-height/2;
    return [x,y,width,height];
  };
  const updateViewBox=()=>svg.setAttribute('viewBox',box.join(' '));
  const setZoom=(factor:number)=>{const width=Math.max(initialViewBox[2]*.65,Math.min(initialViewBox[2]*1.5,box[2]!*factor)),height=width*initialViewBox[3]/initialViewBox[2],cx=box[0]!+box[2]!/2,cy=box[1]!+box[3]!/2;box=constrainViewBox([cx-width/2,cy-height/2,width,height]);updateViewBox();zoomLabel.textContent=`${Math.round(initialViewBox[2]/width*100)}%`;};
  zoomOut.onclick=()=>setZoom(1.15);zoomIn.onclick=()=>setZoom(.87);center.onclick=()=>{box=[...initialViewBox];updateViewBox();zoomLabel.textContent='100%';};controls.append(zoomOut,zoomLabel,zoomIn,center);
  svg.addEventListener('wheel',event=>{event.preventDefault();setZoom(event.deltaY>0?1.08:.92);},{passive:false});
  svg.addEventListener('pointerdown',event=>{if(event.button!==0||event.target instanceof Element&&event.target.closest('.board-target'))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});svg.setPointerCapture(event.pointerId);if(pointers.size===2){const [a,b]=[...pointers.values()];pinchStart={distance:Math.hypot(a!.x-b!.x,a!.y-b!.y),box:[...box]};drag=null;return;}drag={x:event.clientX,y:event.clientY,box:[...box],moved:false};});
  svg.addEventListener('pointermove',event=>{if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pinchStart&&pointers.size>=2){const [a,b]=[...pointers.values()],distance=Math.max(1,Math.hypot(a!.x-b!.x,a!.y-b!.y)),start=pinchStart.box,width=Math.max(initialViewBox[2]*.65,Math.min(initialViewBox[2]*1.5,start[2]!*pinchStart.distance/distance)),height=width*initialViewBox[3]/initialViewBox[2];box=constrainViewBox([start[0]!+(start[2]!-width)/2,start[1]!+(start[3]!-height)/2,width,height]);updateViewBox();zoomLabel.textContent=`${Math.round(initialViewBox[2]/width*100)}%`;return;}if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.hypot(dx,dy)>4)drag.moved=true;if(!drag.moved)return;const rect=svg.getBoundingClientRect(),start=drag.box;box=constrainViewBox([start[0]!-dx*start[2]!/rect.width,start[1]!-dy*start[3]!/rect.height,start[2]!,start[3]!]);updateViewBox();});
  svg.addEventListener('pointerup',event=>{pointers.delete(event.pointerId);if(pointers.size<2)pinchStart=null;if(svg.hasPointerCapture(event.pointerId))svg.releasePointerCapture(event.pointerId);drag=null;});svg.addEventListener('pointercancel',event=>{pointers.delete(event.pointerId);pinchStart=null;drag=null;});
  host.replaceChildren(controls,svg);
}
function showPiecePreview(layer:SVGElement,kind:'road'|'settlement'|'city',point:[number,number],color:string,edge?:[[number,number],[number,number]]){
  layer.replaceChildren();if(kind==='road'&&edge){const preview=createLine(layer,edge[0],edge[1],'piece-preview');preview.setAttribute('stroke',color);preview.setAttribute('stroke-width','.24');return;}
  const preview=svgElement('circle');preview.setAttribute('cx',String(point[0]));preview.setAttribute('cy',String(point[1]));preview.setAttribute('r',kind==='city'?'.68':'.5');preview.setAttribute('fill',color);preview.setAttribute('class','piece-preview');layer.append(preview);
}
function chooseRobberAction(actions:GameAction[],tileId:number){
  if(actions.length===1){sendAction(actions[0]!,`tile-${tileId}`);return;}
  robberChoices=actions;render();
}
function submitBuildMode(mode:PlacementMode){placementMode=mode;robberChoices=null;render();}
function actionButton(label:string,action:GameAction,cls=''){
  const button=element('button',`gx-btn ${cls}`.trim(),label);button.type='button';button.disabled=!!pending;button.onclick=()=>sendAction(action);return button;
}
function renderActionBar(viewState:PlayerView){
  const bar=element('div','gx-actions');bar.setAttribute('role','group');bar.setAttribute('aria-label','Bouwen en acties');
  const mode=activePlacementMode(viewState),builds=element('div','gx-act-group');
  const canBuild=viewState.phase==='build'&&viewState.activePlayerId===viewState.playerId&&viewState.legalActions.some(a=>['buildRoad','buildBridge','buildSettlement','buildCity'].includes(a.type));
  const buildButton=element('button',`gx-btn gx-build-toggle${buildModeOpen?' selected':''}`,'⚒  Bouwen');
  buildButton.type='button';buildButton.disabled=!canBuild||!!pending;buildButton.setAttribute('aria-pressed',String(buildModeOpen));
  buildButton.title='Toon alle mogelijke bouwlocaties op de kaart: wegen, bruggen, nederzettingen en steden.';
  buildButton.onclick=()=>{buildModeOpen=!buildModeOpen;placementMode=null;robberChoices=null;render();};
  builds.append(buildButton);
  if(buildModeOpen){const hint=element('span','gx-build-hint','Kies een gemarkeerde plek op de kaart');builds.append(hint);const cancel=element('button','gx-btn gx-build-cancel','Sluiten');cancel.type='button';cancel.onclick=()=>{buildModeOpen=false;render();};builds.append(cancel);}
  bar.append(builds);
  const other=element('div','gx-act-group');
  const tradeButton=element('button',`gx-btn gx-trade-launch${tradeOpen?' selected':''}`);tradeButton.type='button';tradeButton.setAttribute('aria-pressed',String(tradeOpen));tradeButton.append(svgIcon('<path d="M7 10h3l2-2h3l2 2h2a2 2 0 0 1 1.6 3.2l-2.2 3a2 2 0 0 1-1.6.8h-3.1l-2-2H10l-2 2H5a2 2 0 0 1-1.6-3.2l2-3A2 2 0 0 1 7 10Z"/><path d="m9 10 2.4 2.3a1 1 0 0 0 1.4 0l2.2-2.1M9 14l1.3-1.3m2.9 1.3 1.3-1.3" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/>'),element('span','','Ruilen'));tradeButton.onclick=()=>{tradeOpen=!tradeOpen;if(tradeOpen){tradeFeedback='';window.setTimeout(()=>document.querySelector<HTMLButtonElement>('.trade-modal-close')?.focus(),0);}else bankQueue=null;render();};other.append(tradeButton);
  const purchase=viewState.legalActions.find(a=>a.type==='buyDevelopmentCard');if(purchase)other.append(actionButton('Ontwikkelingskaart',purchase));
  const knight=viewState.legalActions.find(a=>a.type==='playKnight');if(knight){const button=element('button',`gx-btn${mode==='robber'?' selected':''}`,'Ridder spelen');button.type='button';button.title='Verplaats de rover en kies eventueel een speler om te beroven.';button.onclick=()=>submitBuildMode('robber');other.append(button);}
  if(placementMode&&viewState.phase!=='setupSettlement'&&viewState.phase!=='setupRoad'&&viewState.phase!=='robber'){const cancel=element('button','gx-btn','Annuleer plaatsing');cancel.type='button';cancel.onclick=()=>{placementMode=null;render();};other.append(cancel);}
  const roll=viewState.legalActions.find(a=>a.type==='roll');if(roll)other.append(actionButton('Gooi de dobbelstenen',roll,'primary'));
  const end=viewState.legalActions.find(a=>a.type==='endTurn');if(end)other.append(actionButton('Beurt beëindigen',end));
  if(other.childElementCount)bar.append(other);
  return bar;
}
function renderDevStack(viewState:PlayerView){
  const count=viewState.ownDevelopmentCards.length;
  const playable=viewState.legalActions.some(a=>['playKnight','playRoadBuilding','playYearOfPlenty','playMonopoly','revealVictoryPoint'].includes(a.type));
  const button=element('button',`gx-btn gx-devstack${devCardsOpen?' selected':''}`);button.type='button';
  button.title='Ontwikkelingskaarten worden altijd getoond';button.setAttribute('aria-pressed','true');
  button.append(svgIcon('<rect x="6" y="3" width="12" height="18" rx="2"/>'),element('span','gx-devstack-count',String(count)),element('span','gx-devstack-label','ontwikkelings­kaarten'));
  if(playable)button.append(element('span','gx-dot'));
  button.disabled=true;
  return button;
}
function renderPlayerList(viewState:PlayerView){
  const list=element('ul','gx-players');
  for(const [index,player] of viewState.players.entries()){
    const active=player.id===viewState.activePlayerId,status=botStatuses.find(item=>item.playerId===player.id),isBot=!!seats.find(seat=>seat.playerId===player.id)?.bot;
    const roads=viewState.roads.filter(road=>road?.owner===index).length;
    const settlements=viewState.buildings.filter(building=>building?.owner===index&&building.kind==='settlement').length;
    const cities=viewState.buildings.filter(building=>building?.owner===index&&building.kind==='city').length;
    const displayName=playerName(player.id),initial=displayName.trim().charAt(0).toLocaleUpperCase()||'?';
    const row=element('li',`gx-player${active?' active':''}`);row.style.setProperty('--pc',playerColor(player.id));row.dataset.playerId=player.id;
    row.dataset.roads=String(roads);row.dataset.settlements=String(settlements);row.dataset.cities=String(cities);
    const identity=element('div','gx-player-identity'),avatar=element('span','gx-player-avatar',initial),main=element('div','gx-player-main'),name=element('span','gx-player-name',`${displayName}${player.id===playerId?' (jij)':''}`),tags=element('div','gx-player-tags');
    avatar.setAttribute('aria-hidden','true');name.title=displayName;
    tags.append(element('span',`gx-player-turn${active?' is-active':''}`,active?'Aan zet':'Wacht'));
    if(isBot)tags.append(element('span','gx-player-kind',status?.status==='thinking'?'Bot · denkt…':status?.status==='recovering'?'Bot · herstelt':status?.status==='stalled'?'Bot · vastgelopen':'Bot'));
    main.append(name,tags);identity.append(avatar,main);
    const stats=element('div','gx-player-stats');
    const addStat=(label:string,value:number,icon:string,kind:string)=>{
      const stat=element('span',`gx-stat gx-stat-${kind}`);stat.title=label;stat.setAttribute('aria-label',`${label}: ${value}`);stat.append(svgIcon(icon),element('b','',String(value)));stats.append(stat);
    };
    addStat('Overwinningspunten',player.visibleVictoryPoints,'<path d="m12 2.5 2.8 5.7 6.3.9-4.5 4.4 1.1 6.3-5.7-3-5.7 3 1.1-6.3-4.5-4.4 6.3-.9z"/>','points');
    addStat('Grondstofkaarten',player.resourceCount,'<rect x="5" y="3" width="14" height="18" rx="2"/>','resources');
    addStat('Ontwikkelingskaarten',player.developmentCardCount,'<path d="M7 3h10v18H7zM4 6v14h10"/>','development');
    addStat('Wegen op bord',roads,'<path d="m5 19 14-14" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/>','roads');
    addStat('Nederzettingen op bord',settlements,'<path d="M3 11 12 3l9 8v10H3z"/>','settlements');
    addStat('Steden op bord',cities,'<path d="M3 21V10l4-3 4 3V6l5-4 5 4v15z"/>','cities');
    addStat('Gespeelde ridders',player.knightsPlayed,'<path d="M4 20 20 4M8 4h12v12"/>','knights');
    if(player.hasLargestArmy)row.append(element('span','gx-award-badge','♞ Grootste riddermacht'));
    row.append(identity,stats);list.append(row);
  }
  return list;
}
function renderDevelopmentHand(viewState:PlayerView){
  const section=element('section','development-hand');
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
    else if(card.kind==='knight'){const play=element('button','gx-btn','Ridder spelen');play.type='button';play.onclick=()=>submitBuildMode('robber');cardBox.append(play);}
    else for(const action of playable.slice(0,5)){const label=action.type==='playMonopoly'?`Kies ${action.resource}`:action.type==='playYearOfPlenty'?`Kies ${action.resources.join(' + ')}`:action.type==='playRoadBuilding'?`Plaats ${action.edges.length} weg(en)`:'Spelen';cardBox.append(actionButton(label,action));}
    section.append(cardBox);
  }
  return section;
}
function renderEventLog(){
  const section=element('section','gx-section gx-events');section.append(element('h3','gx-title','Gebeurtenissen'));
  const list=element('ol','gx-event-list'),items=events.filter(item=>!item.startsWith('Fout ')).slice(0,12);
  if(!items.length)list.append(element('li','gx-empty','Nog geen gebeurtenissen.'));
  for(const line of items)list.append(element('li','',line));
  section.append(list);return section;
}
function roomHeader(){
  const header=element('header','gx-header'),left=element('div','gx-header-left'),center=element('div','gx-header-center'),right=element('div','gx-header-right');
  left.append(element('strong','brand','DiMaT'),element('span','gx-chip',`Kamer ${roomId}`));
  const connection=({connected:'Verbonden',connecting:'Verbinden…',disconnected:'Verbinding verbroken'} as Record<string,string>)[connectionState]??connectionState;
  center.append(element('span',`connection-indicator state-${connectionState}`,connection));
  if(view&&lifecycle!=='lobby'){const turn=element('span','gx-turn');turn.style.setProperty('--pc',playerColor(view.activePlayerId));turn.append(element('i'),document.createTextNode(`${playerName(view.activePlayerId)} · ${phaseLabel(view.phase)}`));center.append(element('span','gx-sep'),turn);}
  const invite=element('button','gx-btn','Kopieer uitnodiging');invite.type='button';
  invite.onclick=async()=>{
    const url=`${location.origin}/play/${roomId}`;
    try{
      if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(url);
      else{const temp=element('textarea');temp.value=url;temp.readOnly=true;temp.className='copy-fallback';document.body.append(temp);temp.select();const copied=document.execCommand('copy');temp.remove();if(!copied)throw new Error('Clipboard unavailable');}
      pushNotice('success','Uitnodiging gekopieerd.');
    }catch{pushNotice('warning','Kopiëren geblokkeerd. Selecteer en kopieer de link:',{field:url,ttl:0});}
  };
  const theme=element('button','gx-btn','Licht/donker');theme.type='button';theme.onclick=()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;localStorage.setItem('dimat-theme',next);};
  const debug=element('button',`gx-btn${debugEnabled?' selected':''}`,'Debug');debug.type='button';debug.setAttribute('aria-pressed',String(debugEnabled));
  debug.onclick=()=>{debugEnabled=!debugEnabled;const url=new URL(location.href);if(debugEnabled)url.searchParams.set('debug','1');else url.searchParams.delete('debug');history.replaceState({},'',url);render();void refreshDebugData();};
  right.append(invite,theme,debug);header.append(left,center,right);return header;
}
function roomShell(){
  root.replaceChildren();root.append(roomHeader());
  const main=element('main','gx-main');main.dataset.gameLifecycle=lifecycle;root.append(main);return main;
}
function renderLobbyRoster(){
  const roster=element('section','card roster');roster.append(element('h2','','Spelers'));const list=element('div','row');
  for(const seat of seats){const status=botStatuses.find(item=>item.playerId===seat.playerId);const label=`${seat.displayName||'wacht op speler'}${seat.bot?` · bot${status?.status==='thinking'?' · denkt…':status?.status==='recovering'?' · herstelt':status?.status==='stalled'?' · vastgelopen':''}`:''}`;const badge=element('span','pill',label);badge.style.borderColor=playerColor(seat.playerId);badge.dataset.playerId=seat.playerId;if(status?.reason)badge.title=status.reason;list.append(badge);}
  roster.append(list);if(seats.length){const start=element('button','primary','Start spel');start.disabled=lifecycle!=='lobby'||playerId!=='p0'||seats.some(seat=>!seat.bot&&!seat.displayName);start.onclick=()=>socket?.send(JSON.stringify({type:'start'}));roster.append(start);}
  return roster;
}
function render(){
  if(!roomId){lobby();renderNotices();return;}
  renderRoom();renderNotices();
}
function renderRoom(){
  const main=roomShell();
  if(lifecycle==='lobby'){
    const wrap=element('div','gx-waiting-wrap');
    wrap.append(renderLobbyRoster(),element('section','card waiting','Wacht tot de gekozen menselijke spelers aansluiten. Daarna kan de host het spel starten.'));
    main.append(wrap);return;
  }
  if(!view){main.append(element('section','card waiting','Spel wordt geladen…'));return;}
  main.classList.add('gx-game');
  main.dataset.gamePhase=view.phase;main.dataset.activePlayer=view.activePlayerId;

  const left=element('aside','gx-side gx-side-left');left.setAttribute('aria-label','Spelers');
  left.append(element('h3','gx-title','Spelers'),renderPlayerList(view));

  const board=element('section','boardcard gx-board');drawBoard(board,view);

  const right=element('aside','gx-side gx-side-right');right.setAttribute('aria-label','Spelinformatie');
  right.append(renderStatus(view));
  const picker=renderRobberPicker();if(picker)right.append(picker);
  const discard=renderDiscardPrompt(view);if(discard)right.append(discard);
  right.append(renderBank(view),renderDevSummary(view),renderEventLog(),renderChat());
  const debug=renderDebugActions(view);if(debug)right.append(debug);

  const hud=element('footer','gx-hud');hud.setAttribute('aria-label','Jouw hand en acties');
  const resources=element('div','gx-hud-resources');resources.setAttribute('role','group');resources.setAttribute('aria-label','Jouw grondstoffen');
  for(const resource of RESOURCE_ORDER)resources.append(resourceSlot(resource,view.ownResources[resource]));
  hud.append(resources,element('span','gx-hud-sep'),renderDevStack(view),element('span','gx-hud-sep'),renderActionBar(view));

  main.append(left,board,right,hud);
  const trade=renderTradePanel(view);if(trade)main.append(trade);
}
function renderStatus(viewState:PlayerView){
  const section=element('section','gx-section');
  section.append(element('h3','gx-title','Status'));
  const phase=element('div','gx-status-row');phase.append(element('strong','',phaseLabel(viewState.phase)),element('span','gx-label',`Beurt: ${playerName(viewState.activePlayerId)}`));
  section.append(phase);
  if(viewState.lastRoll){const total=viewState.lastRoll[0]+viewState.lastRoll[1];const dice=element('div','dice');dice.append(element('span','die',String(viewState.lastRoll[0])),element('span','die',String(viewState.lastRoll[1])),element('strong','dice-total',`= ${total}`));section.append(dice);}
  return section;
}
function renderBank(viewState:PlayerView){
  const section=element('section','gx-section');section.append(element('h3','gx-title','Bank'));
  const bank=element('div','gx-bank');for(const resource of RESOURCE_ORDER)bank.append(resourceSlot(resource,viewState.bank[resource],true));
  section.append(bank,element('p','gx-empty',`${viewState.developmentCardsRemaining} ontwikkelingskaarten over`));
  return section;
}
function renderDevSummary(viewState:PlayerView){
  const section=element('section','gx-section gx-dev'),head=element('div','gx-dev-head'),text=element('div');
  text.append(element('h3','gx-title','Ontwikkelingskaarten'),element('p','',`${viewState.developmentCardsRemaining} in de stapel · `${viewState.ownDevelopmentCards.length} in je hand`));
  head.append(text);section.append(head,renderDevelopmentHand(viewState));return section;
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
function renderDiscardPrompt(viewState:PlayerView){
  if(viewState.phase!=='discard')return null;const legal=viewState.legalActions.filter((action):action is Extract<GameAction,{type:'discard'}>=>action.type==='discard');if(!legal.length)return null;
  const required=Object.values(legal[0]!.resources).reduce<number>((total,count)=>total+(count??0),0),card=element('section','card discard-prompt');card.append(element('h2','','Weggooien na een 7'),element('p','muted',`Kies precies ${required} kaarten om af te leggen.`));
  const form=element('form','discard-form');form.noValidate=true;const fields=new Map<Resource,ResourceCounter>();const total=element('output','discard-total',`0 / ${required} gekozen`);const submit=element('button','primary','Kaarten afleggen');submit.type='submit';submit.disabled=true;const feedback=element('p','discard-error');feedback.setAttribute('aria-live','polite');
  function update(){const selected=[...fields.values()].reduce((n,count)=>n+count.value,0);const withinLimits=[...fields.values()].every(count=>Number.isInteger(count.value)&&count.value>=0&&count.value<=count.max);for(const count of fields.values()){count.output.value=String(count.value);count.minus.disabled=count.value<=0||!!pending;count.plus.disabled=count.value>=count.max||!!pending;}total.textContent=`${selected} / ${required} gekozen`;total.classList.toggle('valid',selected===required&&withinLimits);submit.disabled=selected!==required||!withinLimits||!!pending;}
  for(const resource of ['brick','lumber','wool','grain','ore'] as Resource[]){const {row,counter}=resourceCounter(`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${RESOURCE_NAMES[resource]}`,viewState.ownResources[resource],`Minder ${RESOURCE_NAMES[resource]} afleggen`,`Meer ${RESOURCE_NAMES[resource]} afleggen`,update,`${viewState.ownResources[resource]} beschikbaar`);fields.set(resource,counter);form.append(row);}
  form.append(total,submit,feedback);form.onsubmit=event=>{event.preventDefault();update();if(submit.disabled)return;const resources=Object.fromEntries([...fields].map(([resource,count])=>[resource,count.value])) as Partial<Record<Resource,number>>;const action=findLegalDiscardAction(viewState.legalActions,resources);if(!action){feedback.textContent='Deze combinatie is geen beschikbare aflegactie. Controleer je selectie.';return;}feedback.textContent='';sendAction(action);};card.append(form);return card;
}
function renderTradePanel(viewState:PlayerView){
  if(!tradeOpen)return null;
  const bankTrades=viewState.legalActions.filter((action):action is Extract<GameAction,{type:'maritimeTrade'}>=>action.type==='maritimeTrade');
  const offer=viewState.tradeOffer,isActive=viewState.phase==='build'&&viewState.activePlayerId===viewState.playerId;
  const resources=['brick','lumber','wool','grain','ore'] as Resource[];
  const panel=element('div','trade-overlay');panel.addEventListener('click',event=>{if(event.target===panel){tradeOpen=false;bankQueue=null;render();}});
  const modal=element('section','trade-modal');modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','trade-modal-title');
  const header=element('header','trade-modal-header'),title=element('h2','','Ruilen');title.id='trade-modal-title';
  const close=element('button','gx-btn trade-modal-close','×');close.type='button';close.setAttribute('aria-label','Ruilvenster sluiten');close.onclick=()=>{tradeOpen=false;bankQueue=null;render();};header.append(svgIcon('<path d="M7 10h3l2-2h3l2 2h2a2 2 0 0 1 1.6 3.2l-2.2 3a2 2 0 0 1-1.6.8h-3.1l-2-2H10l-2 2H5a2 2 0 0 1-1.6-3.2l2-3A2 2 0 0 1 7 10Z"/>'),title,close);modal.append(header);
  const tabs=element('div','trade-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Ruiltype');
  for(const [key,label] of [['players','Spelers'],['bank','Bank']] as const){const button=element('button',`gx-btn${tradeTab===key?' selected':''}`,label);button.type='button';button.setAttribute('role','tab');button.setAttribute('aria-selected',String(tradeTab===key));button.id=`trade-tab-${key}`;button.setAttribute('aria-controls','trade-tab-panel');button.onclick=()=>{tradeTab=key;render();};tabs.append(button);}modal.append(tabs);
  const content=element('div','trade-modal-content');content.id='trade-tab-panel';content.setAttribute('role','tabpanel');content.setAttribute('aria-labelledby',`trade-tab-${tradeTab}`);
  const bundleCards=(bundle:Partial<Record<Resource,number>>)=>{const row=element('div','trade-bundle');for(const resource of resources){const count=bundle[resource]??0;if(count){const chip=element('span','trade-bundle-chip');chip.append(resourceIcon(resource),document.createTextNode(`${count} ${RESOURCE_NAMES[resource]}`));row.append(chip);}}if(!row.childElementCount)row.append(element('span','muted','Geen kaarten'));return row;};
  function editor(counter?:{offerId:number;partnerId:string}){
    const form=element('form','trade-editor');form.noValidate=true;const giveCounts=new Map<Resource,ResourceCounter>(),wantCounts=new Map<Resource,ResourceCounter>();
    for(const [side,label,fields,maxFor,draft] of [['give','Jij biedt',giveCounts,(resource:Resource)=>viewState.ownResources[resource],tradeDraftGive],['want','Je vraagt',wantCounts,()=>19,tradeDraftWant]] as const){
      const group=element('fieldset',`trade-resource-group trade-${side}`);group.append(element('legend','',label));
      for(const resource of resources){const {row,counter:count}=resourceCounter(`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${RESOURCE_NAMES[resource]}`,maxFor(resource),`Minder ${RESOURCE_NAMES[resource]} ${side==='give'?'geven':'vragen'}`,`Meer ${RESOURCE_NAMES[resource]} ${side==='give'?'geven':'vragen'}`,update,undefined,counter?0:draft[resource]??0);fields.set(resource,count);group.append(row);}
      form.append(group);
    }
    const targetInputs=new Map<string,HTMLInputElement>();
    if(!counter){const targets=element('fieldset','trade-targets');targets.append(element('legend','','Aanbieden aan'));for(const player of viewState.players.filter(item=>item.id!==viewState.playerId)){const label=element('label','trade-target'),input=element('input');label.style.setProperty('--trade-player-color',playerColor(player.id));input.type='checkbox';input.setAttribute('aria-label',`Aanbieden aan ${playerName(player.id)}`);if(!tradeTargetsInitialized&&!seats.find(seat=>seat.playerId===player.id)?.bot)tradeDraftTargets.add(player.id);input.checked=tradeDraftTargets.has(player.id);input.addEventListener('change',()=>{if(input.checked)tradeDraftTargets.add(player.id);else tradeDraftTargets.delete(player.id);update();});targetInputs.set(player.id,input);const badge=element('small','trade-target-kind',seats.find(seat=>seat.playerId===player.id)?.bot?'Bot':'Speler');label.append(input,element('span','',playerName(player.id)),badge);targets.append(label);}tradeTargetsInitialized=true;form.append(targets);}
    const summary=element('div','trade-summary'),giveSummary=element('div','trade-summary-side'),wantSummary=element('div','trade-summary-side');giveSummary.append(element('strong','','Jij biedt'));wantSummary.append(element('strong','','Je vraagt'));summary.append(giveSummary,wantSummary);form.append(summary);
    const footer=element('div','trade-form-footer'),clear=element('button','gx-btn','Wissen');clear.type='button';clear.onclick=()=>{for(const count of [...giveCounts.values(),...wantCounts.values()])count.value=0;if(!counter){tradeDraftGive={};tradeDraftWant={};}update();};
    const feedback=element('p','trade-validation');feedback.setAttribute('aria-live','polite');const submit=element('button','gx-btn primary',counter?'Tegenbod versturen':'Bied ruil aan');submit.type='submit';footer.append(clear,submit);form.append(footer,feedback);
    function bundle(fields:Map<Resource,ResourceCounter>):Partial<Record<Resource,number>>{return Object.fromEntries([...fields].filter(([,count])=>count.value>0).map(([resource,count])=>[resource,count.value]));}
    function update(){const give=bundle(giveCounts),want=bundle(wantCounts),selectedTargets=[...targetInputs].filter(([,input])=>input.checked).map(([id])=>id);for(const count of [...giveCounts.values(),...wantCounts.values()])count.refresh();
      if(!counter){tradeDraftGive=give;tradeDraftWant=want;tradeDraftTargets=new Set(selectedTargets);}
      giveSummary.replaceChildren(element('strong','','Jij biedt'),bundleCards(give));wantSummary.replaceChildren(element('strong','','Je vraagt'),bundleCards(want));
      const overlap=Object.keys(give).some(resource=>(want[resource as Resource]??0)>0),limits=[...giveCounts.values(),...wantCounts.values()].every(count=>Number.isInteger(count.value)&&count.value>=0&&count.value<=count.max),valid=Object.keys(give).length>0&&Object.keys(want).length>0&&!overlap&&limits&&(counter!==undefined||selectedTargets.length>0);
      submit.disabled=!valid||!!pending;clear.disabled=!!pending;feedback.textContent=overlap?'Een grondstof kan niet aan beide kanten staan.':!limits?'Je geeft meer kaarten dan je hebt, of de aantallen zijn ongeldig.':'';
    }
    update();form.onsubmit=event=>{event.preventDefault();update();if(submit.disabled)return;const give=bundle(giveCounts),want=bundle(wantCounts);if(counter)sendAction({type:'counterTrade',playerId:viewState.playerId,offerId:counter.offerId,partnerId:counter.partnerId,give,want});else sendAction({type:'proposeTrade',playerId:viewState.playerId,give,want,targets:[...targetInputs].filter(([,input])=>input.checked).map(([id])=>id)});};return form;
  }
  if(tradeTab==='players'){
    if(offer?.proposerId===viewState.playerId){const status=element('section','open-trade-offer');status.append(element('h3','','Jouw ruilvoorstel'),bundleCards(offer.give),element('p','muted',offer.declinedBy.length?`Afgewezen door: ${offer.declinedBy.map(playerName).join(', ')}`:'Wacht op antwoord.'));const cancel=viewState.legalActions.find((action):action is Extract<GameAction,{type:'cancelTrade'}>=>action.type==='cancelTrade');if(cancel)status.append(actionButton('Aanbod intrekken',cancel));content.append(status);}
    else if(offer?.targets.includes(viewState.playerId)&&!offer.declinedBy.includes(viewState.playerId)){const incoming=element('section','incoming-trade');incoming.append(element('h3','','Ruilvoorstel'),element('p','muted',`Van ${playerName(offer.proposerId)}`));const terms=element('div','trade-highlight'),giveTerm=element('div','trade-term'),wantTerm=element('div','trade-term');giveTerm.append(element('strong','','Jij geeft'),bundleCards(offer.want));wantTerm.append(element('strong','','Jij ontvangt'),bundleCards(offer.give));terms.append(giveTerm,wantTerm);incoming.append(terms);const accept=viewState.legalActions.find((action):action is Extract<GameAction,{type:'acceptTrade'}>=>action.type==='acceptTrade'),decline=viewState.legalActions.find((action):action is Extract<GameAction,{type:'declineTrade'}>=>action.type==='declineTrade'),counter=viewState.legalActions.find((action):action is Extract<GameAction,{type:'counterTrade'}>=>action.type==='counterTrade');const actions=element('div','trade-response-actions');if(accept)actions.append(actionButton('Accepteren',accept,'primary'));else actions.append(element('p','muted','Je hebt niet genoeg kaarten om dit aanbod te accepteren.'));if(decline)actions.append(actionButton('Afwijzen',decline));incoming.append(actions);if(counter){const counterButton=element('button','gx-btn','Tegenbod');counterButton.type='button';counterButton.setAttribute('aria-expanded',String(tradeCounterVisible));counterButton.onclick=()=>{tradeCounterVisible=!tradeCounterVisible;render();};if(tradeCounterVisible){const counterForm=editor({offerId:counter.offerId,partnerId:counter.partnerId}),cancelCounter=element('button','gx-btn','Annuleer tegenbod');cancelCounter.type='button';cancelCounter.onclick=()=>{tradeCounterVisible=false;render();};counterForm.prepend(cancelCounter);incoming.append(counterForm);}else incoming.append(counterButton);}content.append(incoming);}
    if(isActive&&!offer)content.append(editor());
    if(!offer&&!isActive)content.append(element('p','trade-empty','Spelerstrades zijn beschikbaar tijdens je bouwfase.'));
  }else{
    const bankPanel=element('section','bank-trades');bankPanel.append(element('p','muted','Ruil met de bank tegen de verhouding van je beste haven.'));
    const giveSelect=element('select','trade-select'),receiveSelect=element('select','trade-select');giveSelect.setAttribute('aria-label','Grondstof die je inlevert');receiveSelect.setAttribute('aria-label','Grondstof die je ontvangt');
    const ownedHarbors=viewState.board.vertices.filter(vertex=>vertex.harbor&&viewState.buildings[vertex.id]?.owner===Number(viewState.playerId.slice(1))).map(vertex=>vertex.harbor!);
    const ratioFor=(resource:Resource)=>ownedHarbors.some(harbor=>harbor.kind===resource)?2:ownedHarbors.some(harbor=>harbor.kind==='generic')?3:4;
    const giveResources=[...new Set(bankTrades.map(action=>action.give))],currentGive=giveResources.includes(bankGive)?bankGive:giveResources[0];
    for(const resource of giveResources){const option=element('option','',`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${RESOURCE_NAMES[resource]}`);option.value=resource;option.selected=resource===currentGive;giveSelect.append(option);}bankGive=currentGive??bankGive;
    const receiveResources=[...new Set(bankTrades.filter(action=>action.give===bankGive).map(action=>action.receive))],currentReceive=receiveResources.includes(bankReceive)?bankReceive:receiveResources[0];
    for(const resource of receiveResources){const option=element('option','',`${RESOURCE_ICON[resource as keyof typeof RESOURCE_ICON]} ${RESOURCE_NAMES[resource]}`);option.value=resource;option.selected=resource===currentReceive;receiveSelect.append(option);}bankReceive=currentReceive??bankReceive;
    const ratio=ratioFor(bankGive),available=Math.max(0,Math.min(Math.floor(viewState.ownResources[bankGive]/ratio),viewState.bank[bankReceive]??0));bankQuantity=Math.max(1,Math.min(bankQuantity,available||1));
    const qtySelect=element('select','trade-select');qtySelect.setAttribute('aria-label','Aantal bankruilen');for(let count=1;count<=available;count++){const option=element('option','',`${count}×`);option.value=String(count);option.selected=count===bankQuantity;qtySelect.append(option);}qtySelect.disabled=available===0;
    const summary=element('div','bank-trade-summary');summary.append(element('strong','',`${ratio} ${RESOURCE_NAMES[bankGive]} → 1 ${RESOURCE_NAMES[bankReceive]}`),element('span','muted',`Je hebt ${viewState.ownResources[bankGive]} ${RESOURCE_NAMES[bankGive]} · bank heeft ${viewState.bank[bankReceive]??0} ${RESOURCE_NAMES[bankReceive]}`));
    const controls=element('div','bank-trade-controls');controls.append(giveSelect,receiveSelect,qtySelect);const feedback=element('p','trade-validation');feedback.setAttribute('aria-live','polite');
    const tradeButton=element('button','gx-btn primary bank-trade-submit','Ruil met de bank');tradeButton.type='button';tradeButton.disabled=!available||!!pending||!!bankQueue;tradeButton.onclick=()=>{const selected=viewState.legalActions.find((action):action is Extract<GameAction,{type:'maritimeTrade'}>=>action.type==='maritimeTrade'&&action.give===bankGive&&action.receive===bankReceive);if(!selected)return;bankQueue={give:bankGive,receive:bankReceive,remaining:bankQuantity};tradeFeedback='';sendNextBankTrade();};
    giveSelect.onchange=()=>{bankGive=giveSelect.value as Resource;bankQuantity=1;render();};receiveSelect.onchange=()=>{bankReceive=receiveSelect.value as Resource;render();};qtySelect.onchange=()=>{bankQuantity=Number(qtySelect.value);render();};bankPanel.append(controls,summary,tradeButton,feedback);
    if(!bankTrades.length)bankPanel.append(element('p','trade-empty','Je hebt nu geen beschikbare bankruil.'));content.append(bankPanel);
  }
  if(tradeFeedback){const message=element('p','trade-feedback');message.setAttribute('role','status');message.textContent=tradeFeedback;content.append(message);}
  modal.append(content);panel.append(modal);return panel;
}
function renderChat(){
  const panel=element('section','gx-section');panel.append(element('h3','gx-title','Chat'));
  const transcript=element('div','chat-transcript');transcript.setAttribute('aria-live','polite');for(const message of chatMessages){const line=element('p',`chat-line player-${Number(message.playerId.slice(1))}`);line.append(element('strong','',playerName(message.playerId)),document.createTextNode(`: ${message.text}`));transcript.append(line);}panel.append(transcript);
  const form=element('form','chat-form'),input=element('input');input.maxLength=240;input.placeholder='Typ een bericht…';input.setAttribute('aria-label','Chatbericht');const send=element('button','primary','Verstuur');send.type='submit';form.append(input,send);form.onsubmit=event=>{event.preventDefault();const text=input.value.trim();if(!text||socket?.readyState!==WebSocket.OPEN)return;socket.send(JSON.stringify({type:'chat',text}));input.value='';input.focus();};panel.append(form);return panel;
}
document.documentElement.dataset.theme=localStorage.getItem('dimat-theme')??'dark';
const savedRoom=location.pathname.split('/')[2];roomId=savedRoom??'';
async function startGeneratedGame(map:MapDefinition,humanCount:number,botCount:number):Promise<void>{
  const displayName=localStorage.getItem('dimat-name')?.trim()||'Speler';
  const response=await fetch('/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName,humanCount,botCount,mapDefinition:map,startImmediately:true})});
  const data=await readApiJson<{roomId:string;seatToken:string;playerId:string;message?:string}>(response,'Spel starten');
  if(!response.ok)throw new Error(data.message??'Spel starten is mislukt.');
  localStorage.setItem('dimat-name',displayName);roomId=data.roomId;seatToken=data.seatToken;playerId=data.playerId;
  history.replaceState({},'',`/play/${roomId}`);connect(displayName);
}
if(location.pathname==='/maps/new')mountMapEditor(root,()=>location.assign('/'),startGeneratedGame);
else if(roomId){seatToken=localStorage.getItem(`dimat-seat-${roomId}`)??'';const name=localStorage.getItem('dimat-name')??'';if(name)connect(name);else lobby('Vul je naam in om aan te sluiten.');}else lobby();
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&tradeOpen){tradeOpen=false;bankQueue=null;render();return;}if(event.key!=='`'||event.ctrlKey||event.metaKey||event.altKey)return;const target=event.target;if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target instanceof HTMLSelectElement)return;debugEnabled=!debugEnabled;const url=new URL(location.href);if(debugEnabled)url.searchParams.set('debug','1');else url.searchParams.delete('debug');history.replaceState({},'',url);render();void refreshDebugData();});
window.addEventListener('error',event=>{const message=event.error instanceof Error?event.error.message:event.message;root.replaceChildren();const card=element('section','card fatal-error');card.append(element('h1','','DiMaT liep vast'),element('p','',message));const copy=element('button','','Kopieer foutinformatie');copy.onclick=async()=>{const bundle=JSON.stringify({message,stack:event.error instanceof Error?event.error.stack:undefined,roomId,playerId,view,userAgent:navigator.userAgent},null,2);try{await navigator.clipboard.writeText(bundle);copy.textContent='Gekopieerd ✓';}catch{copy.textContent='Kopiëren niet beschikbaar';}};root.append(card);});
window.addEventListener('unhandledrejection',event=>{lastServerError={code:'CLIENT_UNHANDLED_REJECTION',message:String(event.reason)};pushNotice('error',`Onverwachte fout: ${String(event.reason)}`);if(roomId)render();});
