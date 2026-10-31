import { describe, expect, it } from 'vitest';
import { createRoomSchema } from '../src/index.js';

describe('create room settings', () => {
  it('defaults to two human seats and one bot', () => {
    expect(createRoomSchema.parse({displayName:'Host'})).toMatchObject({humanCount:2,botCount:1});
  });

  it.each([
    [1,2],[1,3],[2,1],[2,2],[3,0],[3,1],[4,0]
  ])('accepts %i human players and %i bots', (humanCount,botCount) => {
    expect(createRoomSchema.safeParse({displayName:'Host',humanCount,botCount}).success).toBe(true);
  });

  it.each([
    [1,0],[1,1],[2,0],[2,3],[3,2],[4,1],[1,4]
  ])('rejects %i human players and %i bots', (humanCount,botCount) => {
    expect(createRoomSchema.safeParse({displayName:'Host',humanCount,botCount}).success).toBe(false);
  });
});
