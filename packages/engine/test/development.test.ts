import { describe, expect, it } from 'vitest';
import { apply, cardCounts, createGame, legalActions, RESOURCES, type ResourceSet } from '../src/index.js';
import { stateAt } from './helpers.js';

describe('development cards',()=>{
  it('cannot play a development card on the turn it was bought',()=>{const s=stateAt('roll');s.players[0]!.devCards=[{kind:'knight',boughtTurn:s.turnNumber}];expect(legalActions(s,'p0').some(a=>a.type==='playKnight')).toBe(false);});
  it('allows a knight before rolling and only one development card each turn',()=>{const s=stateAt('roll');s.players[0]!.devCards=[{kind:'knight',boughtTurn:0},{kind:'yearOfPlenty',boughtTurn:0}];const knight=legalActions(s,'p0').find(a=>a.type==='playKnight')!;const n=apply(s,knight).state;expect(n.phase).toBe('roll');expect(n.hasPlayedDevCard).toBe(true);expect(legalActions(n,'p0').some(a=>a.type==='playYearOfPlenty')).toBe(false);});
  it('cannot buy from an empty development deck',()=>{const s=stateAt('build');s.devDeck=[];expect(legalActions(s,'p0').some(a=>a.type==='buyDevelopmentCard')).toBe(false);});
  it('takes every opponent card of the named type with Monopoly',()=>{const s=stateAt('build');s.players[0]!.devCards=[{kind:'monopoly',boughtTurn:0}];s.players[1]!.resources.brick=4;s.players[2]!.resources.brick=2;const action=legalActions(s,'p0').find(a=>a.type==='playMonopoly'&&a.resource==='brick')!;const n=apply(s,action).state;expect(n.players[0]!.resources.brick).toBe(25);expect(n.players[1]!.resources.brick).toBe(0);expect(n.players[2]!.resources.brick).toBe(0);});
  it('takes only available resources from a nearly empty bank with Year of Plenty',()=>{const s=stateAt('build');s.players[0]!.devCards=[{kind:'yearOfPlenty',boughtTurn:0}];s.players[0]!.resources.ore=0;s.bank.ore=1;s.players[0]!.resources.grain=18;s.bank.grain=1;const action=legalActions(s,'p0').find(a=>a.type==='playYearOfPlenty'&&a.resources[0]==='ore'&&a.resources[1]==='grain')!;const n=apply(s,action).state;expect(n.players[0]!.resources.ore).toBe(1);expect(n.players[0]!.resources.grain).toBe(19);expect(n.bank.ore).toBe(0);expect(n.bank.grain).toBe(0);});
  it('reveals a hidden VP card and wins immediately on the player turn',()=>{const s=stateAt('build');for(let i=0;i<9;i++)s.buildings[i]={owner:0,kind:'settlement'};s.players[0]!.devCards=[{kind:'victoryPoint',boughtTurn:s.turnNumber}];const action=legalActions(s,'p0').find(a=>a.type==='revealVictoryPoint')!;const n=apply(s,action).state;expect(n.winner).toBe(0);expect(n.phase).toBe('finished');expect(n.players[0]!.revealedVictoryPoints).toBe(1);});
  it('preserves the development-card inventory after a card is played',()=>{const s=createGame(39);s.phase='roll';s.turnNumber=1;const index=s.devDeck.findIndex(c=>c==='knight');s.devDeck.splice(index,1);s.players[0]!.devCards=[{kind:'knight',boughtTurn:0}];const before=cardCounts(s);const action=legalActions(s,'p0').find(a=>a.type==='playKnight')!;const n=apply(s,action).state;expect(cardCounts(n)).toEqual(before);});
  it('keeps the resource-set type open to expansion resources',()=>{const hand:ResourceSet={brick:0,lumber:0,wool:0,grain:0,ore:0,paper:2};expect(hand.paper).toBe(2);expect(RESOURCES).toEqual(['brick','lumber','wool','grain','ore']);});
});

describe('Road Building card',()=>{
  it('places two connected free roads and consumes the card once',()=>{
    const s=stateAt('build');s.players[0]!.devCards=[{kind:'roadBuilding',boughtTurn:0}];const settlement=4;s.buildings[settlement]={owner:0,kind:'settlement'};s.players[0]!.settlementsLeft--;const first=s.board.vertices[settlement]!.edges[0]!;s.roads[first]={owner:0};s.players[0]!.roadsLeft--;const action=legalActions(s,'p0').find(a=>a.type==='playRoadBuilding'&&a.edges.length===2);expect(action).toBeDefined();const before=s.roads.filter(Boolean).length;const n=apply(s,action!).state;expect(n.roads.filter(Boolean)).toHaveLength(before+2);expect(n.players[0]!.devCards.some(c=>c.kind==='roadBuilding')).toBe(false);expect(n.hasPlayedDevCard).toBe(true);
  });
});

describe('game settings',()=>{it('rejects non-positive victory targets',()=>{expect(()=>createGame(1,{victoryTarget:0})).toThrow(/positive integer/);});});
