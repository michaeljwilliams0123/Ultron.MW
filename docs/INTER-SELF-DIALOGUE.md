# Inter-self dialogue transcripts

The seven GrokBot selves produce a **deterministic multi-turn transcript** on every active deliberation and every always-on standby tick.

## Module

`src/inter-self-dialogue.mjs`

- `buildInterSelfDialogue({ mode, objective, decision, dissent, observedAt })`
- `formatDialogueMarkdown(dialogue)` for PR/issue comments

## Modes

| Mode | When | Turns |
|------|------|-------|
| `active` | Owner objective / council debate | Companion opens → Builder/Generator/Predictor/Skeptic/Sentinel/Steward → Companion closes |
| `standby` | `standbyTick` / always-on | Idle cross-talk while waiting for the owner |

## Properties

- `modelInvocations: 0` · `creditCost: 0` · `authority: advisory-only`
- Same inputs → same fingerprint (deterministic)
- Wired into `src/always-on.mjs` (`crossTalk` + `dialogue`) and `scripts/council-debate.mjs` (report section)

## Not claimed

This is structured role script synthesis, not independent LLM agents with private chat memory.
