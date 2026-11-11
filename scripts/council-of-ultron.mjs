// Local, read-only view of the Council of Ultron (Phase 1). Prints JSON; never
// calls GitHub, a model or any network service.
//   node scripts/council-of-ultron.mjs roster
//   node scripts/council-of-ultron.mjs skills
//   node scripts/council-of-ultron.mjs route "Fix the flaky CI workflow" [op ...]
//   node scripts/council-of-ultron.mjs ask "Is Ultron up?"
import { fileURLToPath } from 'node:url';
import { COUNCIL_ROSTER, CAPABILITY_LANES, loadCouncilSkills, routeCouncilTask, companionReply, mapOwnerMessage }
  from '../src/council-of-ultron.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [command = 'roster', text = '', ...operations] = process.argv.slice(2);
const print = value => console.log(JSON.stringify(value, null, 2));
if (command === 'roster') print({ lanes: CAPABILITY_LANES, roster: COUNCIL_ROSTER });
else if (command === 'skills') print(await loadCouncilSkills(root));
else if (command === 'route') {
  const routing = routeCouncilTask({ id: 'local-' + Date.now(), objective: text, operations });
  print({ routing, reply: companionReply(routing) });
} else if (command === 'ask') {
  const mapped = mapOwnerMessage(text);
  if (mapped.intent !== 'task') print(mapped);
  else { const routing = routeCouncilTask({ id: 'local-' + Date.now(), objective: text }); print({ mapped, reply: companionReply(routing) }); }
} else { console.error('usage: council-of-ultron.mjs roster|skills|route|ask'); process.exit(2); }
