import { z } from 'zod';
import { RESOURCES, type GameAction, type GameEvent, type PlayerView, type ReplayInput } from '@dimat/engine';

const resourceSchema=z.enum(RESOURCES);
const sideSchema=z.union([z.literal(0),z.literal(1),z.literal(2),z.literal(3),z.literal(4),z.literal(5)]);
const mapStyleSchema=z.enum(['base','standard','continent','archipelago','river','lakes','atoll','irregular','random','custom']);
export const mapDefinitionSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1).max(80),
  name:z.string().min(1).max(100),
  style:mapStyleSchema,
  seed:z.number().int(),
  players:z.object({min:z.number().int().min(2).max(8),max:z.number().int().min(2).max(8)}).strict(),
  victoryTarget:z.number().int().min(3).max(100),
  tiles:z.array(z.object({
    q:z.number().int(),r:z.number().int(),
    kind:z.enum(['brick','lumber','wool','grain','ore','desert','water','gold','fog']),
    number:z.number().int().nullable(),islandId:z.number().int(),
    fixedNumber:z.boolean().optional(),fixedKind:z.boolean().optional()
  }).strict()).min(1).max(300),
  harbors:z.array(z.object({
    id:z.number().int().nonnegative(),kind:z.union([z.literal('generic'),resourceSchema]),
    ratio:z.union([z.literal(2),z.literal(3)]),tile:z.object({q:z.number().int(),r:z.number().int()}).strict(),side:sideSchema
  }).strict()).max(150),
  rivers:z.array(z.object({
    tile:z.object({q:z.number().int(),r:z.number().int()}).strict(),side:sideSchema
  }).strict()).max(450),
  islands:z.array(z.object({id:z.number().int().nonnegative(),tileCount:z.number().int().positive(),specialVP:z.number().int().nonnegative()}).strict()).max(150),
  startRestrictions:z.array(z.object({islandId:z.number().int().nonnegative(),maxPlayers:z.number().int().positive().optional()}).strict()).optional(),
  features:z.array(z.enum(['gold','fog','seaTiles'])).max(3),
  allowSeparateIslands:z.boolean(),
  meta:z.object({
    generatorVersion:z.number().int().nonnegative(),
    attempts:z.number().int().positive().optional(),
    options:z.record(z.string(),z.unknown()).optional()
  }).strict()
}).strict();
export const mapCodeSchema=z.string().regex(/^[A-Z0-9]{6}$/);
export const createRoomSchema=z.object({
  displayName:z.string().trim().min(1).max(32),
  humanCount:z.number().int().min(1).max(8).default(2),
  botCount:z.number().int().min(0).max(7).default(1),
  seed:z.number().int().optional(),
  mapCode:mapCodeSchema.optional(),
  mapDefinition:mapDefinitionSchema.optional(),
  startImmediately:z.boolean().optional()
}).refine(({humanCount,botCount})=>humanCount+botCount>=2&&humanCount+botCount<=8,{
  path:['botCount'],
  message:'The room must contain two to eight players in total.'
}).refine(({mapCode,mapDefinition})=>!(mapCode&&mapDefinition),{
  path:['mapDefinition'],
  message:'Provide a map code or a map definition, not both.'
});
export type MapDefinitionInput=z.infer<typeof mapDefinitionSchema>;
const partialResources=z.object({
  brick:z.number().int().nonnegative().optional(),
  lumber:z.number().int().nonnegative().optional(),
  wool:z.number().int().nonnegative().optional(),
  grain:z.number().int().nonnegative().optional(),
  ore:z.number().int().nonnegative().optional(),
}).strict();
const tradeBundle=partialResources.refine(bundle=>Object.values(bundle).some(value=>(value??0)>0),'At least one resource is required');
const player=z.string().min(1);
function action<T extends string>(type:T):z.ZodObject<{type:z.ZodLiteral<T>;playerId:typeof player}>;
function action<T extends string,S extends z.ZodRawShape>(type:T,fields:S):z.ZodObject<{type:z.ZodLiteral<T>;playerId:typeof player}&S>;
function action(type:string,fields:z.ZodRawShape={}){return z.object({type:z.literal(type),playerId:player,...fields}).strict();}

export const gameActionSchema=z.discriminatedUnion('type',[
  action('placeSettlement',{vertex:z.number().int().nonnegative()}),
  action('placeRoad',{edge:z.number().int().nonnegative()}),
  action('roll'),
  action('discard',{resources:partialResources}),
  action('moveRobber',{tile:z.number().int().nonnegative(),victimId:player.optional()}),
  action('buildRoad',{edge:z.number().int().nonnegative()}),
  action('buildBridge',{edge:z.number().int().nonnegative()}),
  action('buildSettlement',{vertex:z.number().int().nonnegative()}),
  action('buildCity',{vertex:z.number().int().nonnegative()}),
  action('buyDevelopmentCard'),
  action('playKnight',{tile:z.number().int().nonnegative(),victimId:player.optional()}),
  action('playRoadBuilding',{edges:z.array(z.number().int().nonnegative()).min(1).max(2)}),
  action('playYearOfPlenty',{resources:z.array(resourceSchema).length(2)}),
  action('playMonopoly',{resource:resourceSchema}),
  action('domesticTrade',{partnerId:player,give:resourceSchema,receive:resourceSchema,giveCount:z.number().int().positive(),receiveCount:z.number().int().positive()}),
  action('proposeTrade',{give:tradeBundle,want:tradeBundle,targets:z.array(player).min(1).refine(targets=>new Set(targets).size===targets.length,'Targets must be unique')}),
  action('acceptTrade',{offerId:z.number().int().positive()}),
  action('declineTrade',{offerId:z.number().int().positive()}),
  action('cancelTrade',{offerId:z.number().int().positive()}),
  action('counterTrade',{offerId:z.number().int().positive(),partnerId:player,give:tradeBundle,want:tradeBundle}),
  action('maritimeTrade',{give:resourceSchema,receive:resourceSchema}),
  action('endTurn'),
  action('revealVictoryPoint'),
]);
export const clientMessageSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('join'),roomId:z.string().min(4).max(12),seatToken:z.string().optional(),displayName:z.string().trim().min(1).max(32)}),
  z.object({type:z.literal('action'),sequence:z.number().int().nonnegative(),action:gameActionSchema}),
  z.object({type:z.literal('chat'),text:z.string().trim().min(1).max(240)}),
  z.object({type:z.literal('start')})
]);
export type ClientMessage=
 | {type:'join';roomId:string;seatToken?:string;displayName:string}
 | {type:'action';sequence:number;action:GameAction}
 | {type:'chat';text:string}
 | {type:'start'};
export type RoomLifecycle='lobby'|'started'|'finished';
export type BotStatus={playerId:string;status:'idle'|'thinking'|'recovering'|'stalled';reason?:string;decisionMs?:number};
export type ServerMessage=
 | {type:'joined';roomId:string;seatToken:string;playerId:string;lifecycle:RoomLifecycle}
 | {type:'gameStarted';roomId:string;view:PlayerView}
 | {type:'gameFinished';roomId:string;view:PlayerView}
 | {type:'update';patch:Partial<PlayerView>;events:GameEvent[];sequence:number;clientSequence?:number}
 | {type:'chat';playerId:string;text:string;createdAt:number}
 | {type:'room';roomId:string;seats:Array<{playerId:string;displayName:string;bot:boolean}>;lifecycle:RoomLifecycle;botStatuses:BotStatus[]}
 | {type:'error';code:string;message:string;details?:Record<string,unknown>};
export type SavedGame=ReplayInput;
export type { GameAction };
