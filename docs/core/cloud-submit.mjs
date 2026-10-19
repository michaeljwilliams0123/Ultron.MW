// GitHub Pages can prefill a cloud task. It never receives a GitHub token.
export const CLOUD_TASKS='https://github.com/michaeljwilliams0123/Ultron.MW/issues';
export function createCloudTaskUrl(objective){
  if(typeof objective!=='string'||!objective.trim()||
     objective.length>1000||/[\r\n\u0000-\u001f]/.test(objective))
    throw Error('Cloud task must contain one nonempty line (maximum 1000 characters)');
  const params=new URLSearchParams({
    title:'[Ultron Cloud] Objective',
    body:'ULTRON_CLOUD_V1\n'+objective.trim(),
  });
  return CLOUD_TASKS+'/new?'+params.toString();
}
