import { createApiHandler } from '../../framework-integration-runtime.mjs';
export const integration = Object.freeze({"name":"mission-canary","kind":"api","operations":["status","ci"]});
export function createHandler({ signingKey,githubGet,now }={}) {
  return createApiHandler(integration,{key:signingKey,githubGet,now});
}
