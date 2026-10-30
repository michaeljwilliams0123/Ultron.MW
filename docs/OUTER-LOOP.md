# Ultron outer-loop (cleaned Grok-bot script architecture)

Cleaned mapping of common “Grok bot script logic” articles onto **Ultron**:

| Generic article concept | Ultron implementation |
|-------------------------|------------------------|
| Persistent bot / outer loop | `OuterLoopSession` — isolated per `sessionId` |
| Message history | Sliding window (`maxHistory`, default 24) |
| Multi-agent | GrokBot council via `councilAdvise()` |
| Tools / skills | Owner workbench verbs (`github.*`, `internet.*`) |
| Structured output | `normalizeExecutionPlan()` JSON plan schema |
| Human-in-the-loop | `requires_human_approval` + `adapters.ownerApproved` |
| Live model | Optional `adapters.infer` — **keys from env only** |
| Retries | Exponential backoff on 429/502/503 in `inferTurn` |

## Not claimed

- Not the consumer xAI “Grok Bot” cloud VM product
- Not unbounded autonomous deploy without owner gates

## Usage

```js
import { OuterLoopSession, planFromWorkbenchVerb } from '../src/outer-loop.mjs';

const bot = new OuterLoopSession({ sessionId: 'owner-1' });
bot.councilAdvise('triage open issues');

const plan = planFromWorkbenchVerb('github.issue.read', { number: 42 });
const result = await bot.executePlan(plan, {
  github: { request: async (verb, args) => { /* octokit */ } },
}, { OWNER_MODE: '1' });
```

## Optional inference (env only)

```js
// const key = process.env.XAI_API_KEY; // never hardcode
// adapters.infer = async ({ messages }) => ({ content: '…' });
await bot.inferTurn({ infer });
```

## Files

- `src/outer-loop.mjs`
- `test/outer-loop.test.mjs`
