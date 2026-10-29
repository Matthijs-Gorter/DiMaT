import { parentPort, workerData } from 'node:worker_threads';
import type { GameAction, PlayerView } from '@dimat/engine';
import { chooseHeuristicAction } from './heuristic.js';
import { chooseRandomAction } from './random.js';

const input=workerData as {view:PlayerView;level:1|2;seed:number};
try{const action:GameAction=input.level===1?chooseRandomAction(input.view,input.seed):chooseHeuristicAction(input.view);parentPort?.postMessage({action});}
catch(error){parentPort?.postMessage({error:error instanceof Error?error.message:'Bot failed'});}
