import type { GameAction, Resource } from '@dimat/engine';

const RESOURCES: Resource[] = ['brick','lumber','wool','grain','ore'];

export function findLegalDiscardAction(legalActions: readonly GameAction[],resources:Partial<Record<Resource,number>>){
  return legalActions.find((action):action is Extract<GameAction,{type:'discard'}>=>action.type==='discard'
    &&RESOURCES.every(resource=>(action.resources[resource]??0)===(resources[resource]??0)));
}
