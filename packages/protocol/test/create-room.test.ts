import { describe, expect, it } from 'vitest';
import { createRoomSchema } from '../src/index.js';

describe('create room settings', () => {
  it('defaults to two human seats and one bot', () => {
    expect(createRoomSchema.parse({displayName:'Host'})).toMatchObject({humanCount:2,botCount:1});
  });

  it.each([
    [1,1],[1,2],[1,7],[2,0],[2,2],[3,1],[4,4],[8,0]
  ])('accepts %i human players and %i bots', (humanCount,botCount) => {
    expect(createRoomSchema.safeParse({displayName:'Host',humanCount,botCount}).success).toBe(true);
  });

  it.each([
    [1,0],[2,7],[3,6],[4,5],[8,1],[0,2],[9,0],[1,8]
  ])('rejects %i human players and %i bots', (humanCount,botCount) => {
    expect(createRoomSchema.safeParse({displayName:'Host',humanCount,botCount}).success).toBe(false);
  });
});
