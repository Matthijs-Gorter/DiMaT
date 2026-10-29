import { z } from 'zod';
import type { GameAction, GameEvent, PlayerView, ReplayInput } from '@dimat/engine';

export const createRoomSchema = z.object({displayName:z.string().trim().min(1).max(32), botCount:z.union([z.literal(1),z.literal(2)]).default(1), seed:z.number().int().optional()});
export const clientMessageSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('join'),roomId:z.string().min(4).max(12),seatToken:z.string().optional(),displayName:z.string().trim().min(1).max(32)}),
  z.object({type:z.literal('action'),sequence:z.number().int().nonnegative(),action:z.custom<GameAction>((v)=>!!v&&typeof v==='object'&&typeof (v as {type?:unknown}).type==='string'&&typeof (v as {playerId?:unknown}).playerId==='string')}),
  z.object({type:z.literal('start')})
]);
export type ClientMessage=z.infer<typeof clientMessageSchema>;
export type RoomLifecycle='lobby'|'started'|'finished';
export type BotStatus={playerId:string;status:'idle'|'thinking'|'recovering'|'stalled';reason?:string;decisionMs?:number};
export type ServerMessage=
 | {type:'joined';roomId:string;seatToken:string;playerId:string;lifecycle:RoomLifecycle}
 | {type:'gameStarted';roomId:string;view:PlayerView}
 | {type:'gameFinished';roomId:string;view:PlayerView}
 | {type:'update';patch:Partial<PlayerView>;events:GameEvent[];sequence:number}
 | {type:'room';roomId:string;seats:Array<{playerId:string;displayName:string;bot:boolean}>;lifecycle:RoomLifecycle;botStatuses:BotStatus[]}
 | {type:'error';code:string;message:string;details?:Record<string,unknown>};
export type SavedGame=ReplayInput;
