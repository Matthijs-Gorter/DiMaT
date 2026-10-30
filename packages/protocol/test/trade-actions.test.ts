import { describe, expect, it } from 'vitest';
import { clientMessageSchema } from '../src/index.js';

const message=(action:unknown)=>({type:'action',sequence:1,action});

describe('trade action protocol schemas',()=>{
  it('accepts bundled offers and counter-offers with positive resource counts',()=>{
    expect(clientMessageSchema.safeParse(message({type:'proposeTrade',playerId:'p0',give:{brick:2,lumber:1},want:{wool:1},targets:['p1','p2']})).success).toBe(true);
    expect(clientMessageSchema.safeParse(message({type:'counterTrade',playerId:'p1',offerId:1,partnerId:'p0',give:{wool:1},want:{ore:2}})).success).toBe(true);
  });

  it('rejects empty or malformed bundles, duplicate recipients and unknown action shapes',()=>{
    expect(clientMessageSchema.safeParse(message({type:'proposeTrade',playerId:'p0',give:{},want:{wool:1},targets:['p1']})).success).toBe(false);
    expect(clientMessageSchema.safeParse(message({type:'proposeTrade',playerId:'p0',give:{brick:1},want:{wool:0},targets:['p1']})).success).toBe(false);
    expect(clientMessageSchema.safeParse(message({type:'proposeTrade',playerId:'p0',give:{brick:1},want:{wool:1},targets:['p1','p1']})).success).toBe(false);
    expect(clientMessageSchema.safeParse(message({type:'acceptTrade',playerId:'p1',offerId:-1})).success).toBe(false);
    expect(clientMessageSchema.safeParse(message({type:'unknownTrade',playerId:'p0'})).success).toBe(false);
  });

  it('keeps the previous immediate trade action shape decodable for old logs',()=>{
    expect(clientMessageSchema.safeParse(message({type:'domesticTrade',playerId:'p0',partnerId:'p1',give:'brick',receive:'wool',giveCount:1,receiveCount:1})).success).toBe(true);
  });
});
