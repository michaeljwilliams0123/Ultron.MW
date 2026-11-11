/** Consolidated GitHub Actions lane identities (26 -> 8 workflow consolidation).
 * Transition release: Hatchable trusts BOTH the legacy workflow paths and the
 * consolidated lane paths below. A later release removes the legacy paths only
 * after new-path receipts have been independently verified in production.
 * A lane file runs several legacy jobs, so the lane run identity is the exact
 * (path, workflow name, run title) triple, never the path alone.
 */
export const LAB_LANE_FILE='lane-lab-evidence.yml';
export const LAB_LANE_PATH='.github/workflows/'+LAB_LANE_FILE;
export const LAB_LANE_NAME='Ultron lab evidence';
export const GOVERNED_LANE_FILE='lane-governed-task.yml';
// Owner-dispatched lab task -> receipt workflow key. The run title is fixed by
// the lane's run-name expression from the dispatch input `lab_task`.
const LAB_TASK_KEYS=Object.freeze({
 'hf-heldout-cpu':'heldout',
 'hf-free-cpu-tournament':'tournament',
 'c06-owner-model-release':'c06'
});
export const LAB_TASK_BY_KEY=Object.freeze(Object.fromEntries(
 Object.entries(LAB_TASK_KEYS).map(([task,key])=>[key,task])));
export function labRunTitle(task){
 if(!Object.hasOwn(LAB_TASK_KEYS,task))throw Error('unknown-lab-task');
 return LAB_LANE_NAME+': '+task;
}
/** Exact lane-run key, or null. Requires the lane path AND the lane workflow
 * name AND an exact allowlisted run title; anything else is untrusted. */
export function labLaneRunKey(run){
 if(run?.path!==LAB_LANE_PATH||run?.name!==LAB_LANE_NAME||
    typeof run?.display_title!=='string')return null;
 const prefix=LAB_LANE_NAME+': ';
 if(!run.display_title.startsWith(prefix))return null;
 const task=run.display_title.slice(prefix.length);
 return Object.hasOwn(LAB_TASK_KEYS,task)?LAB_TASK_KEYS[task]:null;
}
