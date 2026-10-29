import { describe, expect, it } from 'vitest';
import type { GameAction } from '@dimat/engine';
import { findLegalDiscardAction } from '../src/discard-action.js';

describe('findLegalDiscardAction',()=>{
  it('matches selected resources to a legal action regardless of action property order',()=>{
    const legalAction:GameAction={playerId:'p1',type:'discard',resources:{brick:2,lumber:1,wool:1,grain:0,ore:0}};
    const selected={brick:2,lumber:1,wool:1,grain:0,ore:0};
    expect(findLegalDiscardAction([legalAction],selected)).toBe(legalAction);
  });

  it('does not match a resource selection the server has not declared legal',()=>{
    const legalAction:GameAction={playerId:'p1',type:'discard',resources:{brick:2,lumber:1,wool:1,grain:0,ore:0}};
    expect(findLegalDiscardAction([legalAction],{brick:1,lumber:2,wool:1,grain:0,ore:0})).toBeUndefined();
  });
});
