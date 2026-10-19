// GitHub Pages can prefill a cloud task. It never receives a GitHub token.
import { planObjective } from './cycle.mjs';
import { commandsFor } from './capabilities.mjs';
export const CLOUD_TASKS='https://github.com/michaeljwilliams0123/Ultron.MW/issues';
export function createCloudTaskUrl(objective){
  if(typeof objective!=='string'||!objective.trim()||
     objective.length>1000||/[\r\n\u0000-\u001f]/.test(objective))
    throw Error('Cloud task must contain one nonempty line (maximum 1000 characters)');
  const plan=planObjective(objective,{strategy:'routing-v2'});
  const allowed=commandsFor('cloud');
  if(!plan.steps.length||plan.steps.some(step=>!allowed.includes(step.command)))
    throw Error('Use supported read-only cloud commands only. This public handoff cannot accept private task text.');
  // Publish only canonical commands, never the original free-form objective.
  const canonical=plan.steps.map(step=>step.command).join(' and ');
  const params=new URLSearchParams({
    title:'[Ultron Cloud] Objective',
    body:'ULTRON_CLOUD_V1\n'+canonical,
  });
  return CLOUD_TASKS+'/new?'+params.toString();
}
