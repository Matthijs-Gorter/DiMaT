import { describe, expect, it } from 'vitest';
import { createGame, viewFor } from '@dimat/engine';
import { chooseRandomAction } from '../src/index.js';

describe('random bot',()=>{
  it('returns an action from the player legal list',()=>{const view=viewFor(createGame(5),'p0');const action=chooseRandomAction(view,23);expect(view.legalActions).toContainEqual(action);});
  it('is deterministic for the same view and decision seed',()=>{const view=viewFor(createGame(17),'p0');expect(chooseRandomAction(view,91)).toEqual(chooseRandomAction(view,91));});
});
