import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { apply, createGame, legalActions, replayGame, validateTradeAction, viewFor, type GameAction, type GameEvent, type GameSettings, type GameState, type PlayerView } from '@dimat/engine';
import { chooseRandomAction } from '@dimat/bots';
import { clientMessageSchema, createRoomSchema, type BotStatus, type RoomLifecycle, type ServerMessage } from '@dimat/protocol';

type Seat={playerId:string;displayName:string;token:string;bot:boolean;level:0|1|2;lastSequence:number;lastChatAt?:number;botStatus?:BotStatus['status'];botReason?:string;decisionMs?:number;socket?:WebSocket};
type Room={id:string;state:GameState;settings:GameSettings;actions:GameAction[];recentEvents:GameEvent[];seats:Seat[];lifecycle:RoomLifecycle;seed:number};
type StructuredError={code:string;message:string;details?:Record<string,unknown>};

class RoomError extends Error {
  constructor(readonly code:string,message:string,readonly details?:Record<string,unknown>){super(message);}
}

const db=new DatabaseSync(process.env.DIMAT_DB??'dimat.sqlite');
db.exec("CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, seed INTEGER NOT NULL, settings TEXT NOT NULL, actions TEXT NOT NULL, seats TEXT NOT NULL DEFAULT '[]', lifecycle TEXT NOT NULL DEFAULT 'lobby', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
try{db.exec("ALTER TABLE games ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'lobby'");}catch(error){if(!String(error).includes('duplicate column name'))throw error;}
const rooms=new Map<string,Room>();
const activeBotRooms=new Set<string>();
const token=()=>randomBytes(24).toString('base64url');
const app=Fastify({logger:true});

app.get('/health',async()=>({ok:true}));
app.post('/api/rooms',async(req,reply)=>{
  const parsed=createRoomSchema.safeParse(req.body);
  if(!parsed.success)return reply.code(400).send({code:'INVALID_ROOM_OPTIONS',message:'Room settings are invalid.',details:parsed.error.flatten()});
  const {displayName,humanCount,botCount}=parsed.data;
  const seed=parsed.data.seed??randomBytes(4).readUInt32LE();
  const id=randomUUID().slice(0,8);
  const playerCount=humanCount+botCount;
  if(playerCount!==3&&playerCount!==4)throw new Error('Room validation returned an unsupported player count.');
  const settings:GameSettings={playerCount,victoryTarget:10};
  const seats:Seat[]=[];
  for(let i=0;i<humanCount;i++)seats.push({playerId:`p${i}`,displayName:i===0?displayName:'',token:token(),bot:false,level:0,lastSequence:-1});
  for(let i=0;i<botCount;i++){
    const playerIndex=humanCount+i;
    seats.push({playerId:`p${playerIndex}`,displayName:`Bot ${i+1}`,token:token(),bot:true,level:i===0?1:2,lastSequence:-1});
  }
  const room:Room={id,state:createGame(seed,settings),settings,actions:[],recentEvents:[],seats,lifecycle:'lobby',seed};
  rooms.set(id,room);persist(room);
  app.log.info({roomId:id,seatId:'p0',actionType:'createRoom',humanCount,botCount,outcome:'accepted'},'room created');
  return {roomId:id,seatToken:seats[0]!.token,playerId:'p0',invite:`/play/${id}`};
});
app.get('/api/rooms/:id',async(req,reply)=>{
  const {id}=req.params as {id:string};const room=rooms.get(id);
  if(!room)return reply.code(404).send({code:'ROOM_NOT_FOUND',message:'Room not found.'});
  return publicRoom(room);
});

function publicRoom(room:Room):ServerMessage{
  return {type:'room',roomId:room.id,lifecycle:room.lifecycle,seats:room.seats.map(({playerId,displayName,bot})=>({playerId,displayName,bot})),botStatuses:room.seats.filter(seat=>seat.bot).map(seat=>({playerId:seat.playerId,status:seat.botStatus??'idle',...(seat.botReason?{reason:seat.botReason}:{}),...(seat.decisionMs!==undefined?{decisionMs:seat.decisionMs}:{})}))};
}
function persist(room:Room){
  db.prepare('INSERT INTO games(id,seed,settings,actions,seats,lifecycle,updated_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET seed=excluded.seed,settings=excluded.settings,actions=excluded.actions,seats=excluded.seats,lifecycle=excluded.lifecycle,updated_at=CURRENT_TIMESTAMP')
    .run(room.id,room.seed,JSON.stringify(room.settings),JSON.stringify(room.actions),JSON.stringify(room.seats.map(({playerId,displayName,token,bot,level,lastSequence})=>({playerId,displayName,token,bot,level,lastSequence}))),room.lifecycle);
}
function send(ws:WebSocket|undefined,msg:ServerMessage){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(msg));}
function broadcastRoom(room:Room){const msg=publicRoom(room);for(const seat of room.seats)send(seat.socket,msg);}
function sendPrivateView(room:Room,seat:Seat){
  if(seat.bot)return;
  const msg:ServerMessage=room.lifecycle==='finished'?{type:'gameFinished',roomId:room.id,view:viewFor(room.state,seat.playerId)}:{type:'gameStarted',roomId:room.id,view:viewFor(room.state,seat.playerId)};
  send(seat.socket,msg);
}
function broadcastUpdate(room:Room,events:GameEvent[],sequence:number,previous:Map<string,PlayerView>,clientSequence?:number,clientPlayerId?:string){
  for(const seat of room.seats)if(!seat.bot){
    const next=viewFor(room.state,seat.playerId),old=previous.get(seat.playerId);const patch:Partial<PlayerView>={};
    if(old)for(const key of Object.keys(next) as Array<keyof PlayerView>)if(JSON.stringify(old[key])!==JSON.stringify(next[key]))Object.assign(patch,{[key]:next[key]});
    send(seat.socket,{type:'update',patch,events:events.filter(e=>!e.privateTo||e.privateTo===seat.playerId),sequence,...(clientSequence!==undefined&&seat.playerId===clientPlayerId?{clientSequence}:{})});
  }
}
function canonical(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
function stateHash(value:unknown){let hash=2166136261;for(const char of canonical(value))hash=Math.imul(hash^char.charCodeAt(0),16777619);return(hash>>>0).toString(16).padStart(8,'0');}
const debugRoom=async(req:FastifyRequest,reply:FastifyReply)=>{
  const {id}=req.params as {id:string},query=req.query as {playerId?:string},room=rooms.get(id);if(!room)return reply.code(404).send({code:'ROOM_NOT_FOUND',message:'Room not found.'});
  const playerId=query.playerId??room.state.players[room.state.activePlayer]!.id,view=room.state.players.some(player=>player.id===playerId)?viewFor(room.state,playerId):null;
  const actionCounts=view?.legalActions.reduce<Record<string,number>>((counts,action)=>{counts[action.type]=(counts[action.type]??0)+1;return counts;},{});
  return {roomId:id,lifecycle:room.lifecycle,seed:room.seed,settings:room.settings,phase:room.state.phase,activePlayerId:room.state.players[room.state.activePlayer]?.id??null,pendingDiscards:room.state.pendingDiscards.map(index=>room.state.players[index]?.id),robberTile:room.state.robberTile,lastRoll:room.state.lastRoll,stateHash:stateHash(room.state),playerId,viewHash:view?stateHash(view):null,actionCounts,players:room.seats.map(seat=>({playerId:seat.playerId,displayName:seat.displayName,bot:seat.bot,status:seat.bot?seat.botStatus??'idle':undefined,reason:seat.botReason,decisionMs:seat.decisionMs})),actions:room.actions,lastActions:room.actions.slice(-50),lastEvents:room.recentEvents.slice(-50)};
};
if(process.env.DEBUG==='1'){app.get('/debug/rooms/:id',debugRoom);app.get('/api/debug/rooms/:id',debugRoom);}
function transition(room:Room,action:GameAction,outcome:'human'|'bot'='human',clientSequence?:number){
  if(room.lifecycle!=='started')throw new RoomError('GAME_NOT_STARTED','The game has not started.',{lifecycle:room.lifecycle});
  const legal=legalActions(room.state,action.playerId);
  if(action.type==='domesticTrade'||(!legal.some(candidate=>canonical(candidate)===canonical(action))&&!validateTradeAction(room.state,action))){
    const expected=room.state.players[room.state.activePlayer]?.id;
    const isExpectedSeat=action.playerId===expected||room.state.pendingDiscards[0]!==undefined&&action.playerId===room.state.players[room.state.pendingDiscards[0]]?.id;
    const code=isExpectedSeat?'ILLEGAL_ACTION':'NOT_YOUR_TURN';
    throw new RoomError(code,isExpectedSeat?'That action is not legal in the current state.':'It is not this player’s turn.',{phase:room.state.phase,activePlayerId:expected,actionType:action.type});
  }
  const previous=new Map(room.seats.filter(s=>!s.bot).map(s=>[s.playerId,viewFor(room.state,s.playerId)]));
  const result=apply(room.state,action);room.state=result.state;room.actions.push(action);room.recentEvents.push(...result.events);room.recentEvents=room.recentEvents.slice(-50);
  if(room.state.phase==='finished')room.lifecycle='finished';
  persist(room);broadcastUpdate(room,result.events,room.actions.length-1,previous,clientSequence,action.playerId);
  if(room.lifecycle==='finished'){broadcastRoom(room);for(const seat of room.seats)sendPrivateView(room,seat);}
  app.log.info({roomId:room.id,seatId:action.playerId,actionType:action.type,outcome:'accepted',actor:outcome,actionIndex:room.actions.length-1},'game action accepted');
}
function botAction(view:PlayerView,level:1|2,seed:number):Promise<GameAction>{
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('../../../packages/bots/src/worker.ts',import.meta.url),{execArgv:['--import','tsx'],workerData:{view,level,seed}});
    const timer=setTimeout(()=>{void worker.terminate();reject(new Error('Bot exceeded its 500 ms decision budget'));},500);
    worker.once('message',(result:{action?:GameAction;error?:string})=>{clearTimeout(timer);void worker.terminate();if(result.error)reject(new Error(result.error));else if(result.action)resolve(result.action);else reject(new Error('Bot returned no action'));});
    worker.once('error',error=>{clearTimeout(timer);void worker.terminate();reject(error);});
  });
}
async function driveBots(room:Room){
  if(activeBotRooms.has(room.id))return;activeBotRooms.add(room.id);
  try{
    let guard=0;
    while(room.lifecycle==='started'&&room.state.phase!=='finished'&&guard++<256){
      const offer=room.state.phase==='build'?room.state.tradeOffer:null;
      const responder=offer?.targets.find(id=>!offer.declinedBy.includes(id)&&room.seats.find(candidate=>candidate.playerId===id)?.bot);
      const seat=responder?room.seats.find(candidate=>candidate.playerId===responder):room.seats[room.state.activePlayer];if(!seat?.bot)break;
      const view=viewFor(room.state,seat.playerId),seed=(room.state.rngState^room.actions.length)>>>0;let action:GameAction;const startedAt=performance.now();seat.botStatus='thinking';seat.botReason=undefined;broadcastRoom(room);
      try{action=await botAction(view,seat.level as 1|2,seed);}
      catch(error){
        seat.botStatus='recovering';seat.botReason=error instanceof Error?error.message:String(error);app.log.warn({roomId:room.id,seatId:seat.playerId,actionType:'botDecision',outcome:'fallback',reason:seat.botReason},'bot failed; using random legal action');broadcastRoom(room);
        if(!view.legalActions.length){seat.botStatus='stalled';seat.botReason='No legal actions were available.';app.log.error({roomId:room.id,seatId:seat.playerId,phase:view.phase},'bot stalled: no legal actions');broadcastRoom(room);break;}
        try{action=chooseRandomAction(view,seed);}catch(fallbackError){seat.botStatus='stalled';seat.botReason=fallbackError instanceof Error?fallbackError.message:String(fallbackError);app.log.error({roomId:room.id,seatId:seat.playerId,reason:seat.botReason},'random bot fallback failed');broadcastRoom(room);break;}
      }
      transition(room,action,'bot');seat.decisionMs=Math.round(performance.now()-startedAt);seat.botStatus='idle';seat.botReason=undefined;broadcastRoom(room);
    }
    if(guard>=256){const seat=room.seats[room.state.activePlayer];if(seat?.bot){seat.botStatus='stalled';seat.botReason='Bot scheduler exceeded the action guard.';}broadcastRoom(room);app.log.error({roomId:room.id,actionCount:room.actions.length},'bot runner action guard reached');}
  }catch(error){const seat=room.seats[room.state.activePlayer];if(seat?.bot){seat.botStatus='stalled';seat.botReason=error instanceof Error?error.message:String(error);}broadcastRoom(room);app.log.error({roomId:room.id,seatId:seat?.playerId,error:error instanceof Error?error.message:String(error)},'bot runner stopped');
  }finally{activeBotRooms.delete(room.id);}
}
function asStructuredError(error:unknown):StructuredError{
  if(error instanceof RoomError)return {code:error.code,message:error.message,...(error.details?{details:error.details}:{})};
  if(error instanceof SyntaxError)return {code:'INVALID_JSON',message:'The message is not valid JSON.'};
  return {code:'BAD_MESSAGE',message:error instanceof Error?error.message:'The request could not be processed.'};
}
function reject(ws:WebSocket,error:unknown,room:Room|undefined,seat:Seat|undefined,input:unknown){
  const structured=asStructuredError(error);const raw=input as {type?:string;action?:{type?:string};sequence?:number}|null;
  if(raw?.type==='action')app.log.warn({roomId:room?.id,seatId:seat?.playerId,actionType:raw.action?.type,outcome:'rejected',reason:structured.code,details:structured.details,message:structured.message,sequence:raw.sequence},'game action rejected');
  else app.log.warn({roomId:room?.id,seatId:seat?.playerId,outcome:'rejected',reason:structured.code,message:structured.message},'client message rejected');
  send(ws,{type:'error',...structured});
}
function startRoom(room:Room){
  if(room.lifecycle!=='lobby')throw new RoomError('GAME_ALREADY_STARTED','This game is already in progress.',{lifecycle:room.lifecycle});
  const humans=room.seats.filter(seat=>!seat.bot);
  if(!humans.every(seat=>seat.displayName))throw new RoomError('WAITING_FOR_PLAYERS','All human seats must join before starting.',{connectedHumanSeats:humans.filter(seat=>seat.displayName).length,requiredHumanSeats:humans.length});
  room.lifecycle='started';persist(room);broadcastRoom(room);
  for(const seat of room.seats)sendPrivateView(room,seat);
  app.log.info({roomId:room.id,outcome:'started',seed:room.seed,settings:room.settings},'game started');
  void driveBots(room);
}
async function handleMessage(ws:WebSocket,raw:string,connection:{room?:Room;seat?:Seat}){
  let input:unknown;
  try{
    input=JSON.parse(raw);
    if((input as {type?:string}|null)?.type==='join'){
      const parsed=clientMessageSchema.safeParse(input);if(!parsed.success)throw new RoomError('INVALID_JOIN','The join message is invalid.');const message=parsed.data;if(message.type!=='join')throw new RoomError('INVALID_JOIN','The join message is invalid.');
      const candidate=rooms.get(message.roomId);if(!candidate)throw new RoomError('ROOM_NOT_FOUND','Room not found.',{roomId:message.roomId});
      const seat=message.seatToken?candidate.seats.find(s=>s.token===message.seatToken):candidate.seats.find(s=>!s.bot&&!s.socket&&!s.displayName);
      if(!seat)throw new RoomError(message.seatToken?'INVALID_SEAT_TOKEN':'ROOM_FULL',message.seatToken?'Seat token is invalid.':'No open human seat is available.');
      seat.displayName=message.displayName;seat.socket=ws;connection.room=candidate;connection.seat=seat;persist(candidate);
      send(ws,{type:'joined',roomId:candidate.id,seatToken:seat.token,playerId:seat.playerId,lifecycle:candidate.lifecycle});broadcastRoom(candidate);
      if(candidate.lifecycle!=='lobby')sendPrivateView(candidate,seat);
      return;
    }
    const parsed=clientMessageSchema.safeParse(input);if(!parsed.success)throw new RoomError('INVALID_MESSAGE','The message does not match the protocol.');
    if(parsed.data.type==='start'){
      if(!connection.room||!connection.seat)throw new RoomError('NOT_IN_ROOM','Join a room before starting.');
      if(connection.seat.playerId!=='p0')throw new RoomError('NOT_ROOM_HOST','Only the room host can start the game.');
      startRoom(connection.room);return;
    }
    if(parsed.data.type==='chat'){
      const {room,seat}=connection;if(!room||!seat)throw new RoomError('NOT_IN_ROOM','Join a room before chatting.');
      const now=Date.now();if(now-(seat.lastChatAt??0)<500)throw new RoomError('CHAT_RATE_LIMIT','Please wait before sending another message.');seat.lastChatAt=now;
      const chat:ServerMessage={type:'chat',playerId:seat.playerId,text:parsed.data.text,createdAt:now};for(const recipient of room.seats)if(recipient.socket)send(recipient.socket,chat);return;
    }
    if(parsed.data.type==='action'){
      const {room,seat}=connection;
      if(!room||!seat)throw new RoomError('NOT_IN_ROOM','Join a room before sending game actions.');
      if(room.lifecycle==='lobby')throw new RoomError('GAME_NOT_STARTED','The game has not started.',{lifecycle:room.lifecycle});
      if(room.lifecycle==='finished')throw new RoomError('GAME_FINISHED','The game is finished.',{lifecycle:room.lifecycle});
      if(seat.bot)throw new RoomError('BOT_SEAT','Bot seats cannot send client actions.');
      if(parsed.data.sequence<=seat.lastSequence)throw new RoomError('DUPLICATE_ACTION','This action sequence was already handled.',{lastSequence:seat.lastSequence,receivedSequence:parsed.data.sequence});
      if(parsed.data.action.playerId!==seat.playerId)throw new RoomError('SEAT_MISMATCH','Action player does not match the connected seat.',{seatPlayerId:seat.playerId,actionPlayerId:parsed.data.action.playerId});
      seat.lastSequence=parsed.data.sequence;
      transition(room,parsed.data.action,'human',parsed.data.sequence);void driveBots(room);return;
    }
  }catch(error){reject(ws,error,connection.room,connection.seat,input);}
}

async function main(){
  restoreSavedGames();
  const wss=new WebSocketServer({server:app.server,path:'/ws'});
  wss.on('connection',ws=>{
    const connection:{room?:Room;seat?:Seat}={};
    ws.on('message',raw=>{void handleMessage(ws,raw.toString(),connection);});
    ws.on('close',()=>{if(connection.seat){connection.seat.socket=undefined;if(connection.room)persist(connection.room);}});
  });
  const debug=process.env.DEBUG==='1',host=process.env.HOST??(debug?'127.0.0.1':'0.0.0.0');
  const tailnet=/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)||/^fd7a:/i.test(host);if(debug&&!['127.0.0.1','::1','localhost'].includes(host)&&!tailnet)throw new Error('DEBUG=1 requires HOST to be localhost or a Tailscale address.');
  const port=Number(process.env.PORT??3000);await app.listen({port,host});
  for(const room of rooms.values())if(room.lifecycle==='started')void driveBots(room);
}
void main();

export function restoreSavedGames(){
  const rows=db.prepare('SELECT id,seed,settings,actions,seats,lifecycle FROM games').all() as Array<{id:string;seed:number;settings:string;actions:string;seats:string;lifecycle:RoomLifecycle}>;
  for(const row of rows){
    const settings=JSON.parse(row.settings) as GameSettings,actions=JSON.parse(row.actions) as GameAction[];
    const state=replayGame({seed:row.seed,settings,actions});
    const saved=JSON.parse(row.seats) as Array<Omit<Seat,'socket'>>;
    const seats=saved.map(s=>({...s,lastSequence:s.lastSequence??-1,...(s.bot?{botStatus:'idle' as const}:{})}));
    const lifecycle:RoomLifecycle=state.phase==='finished'?'finished':row.lifecycle==='lobby'&&actions.length>0?'started':row.lifecycle;
    rooms.set(row.id,{id:row.id,state,settings,actions,recentEvents:[],seats,lifecycle,seed:row.seed});
  }
}
