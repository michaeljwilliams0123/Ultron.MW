# Ultron velocity mode (~85%)

Env: `ULTRON_VELOCITY=1` (default off).

## On
- Multifile: up to 12 paths, larger byte budgets
- Governor: softer evidence floors (still advisory-only)
- Observer: passive telemetry
- Verify policy helper: advisory mode flag for callers

## Never (by design)
- Fail-open required CI / security workflows
- Skip model source syntax preflight
- Write `.github/workflows/**` from model patches
- Council gains execution authority

## Verification
`node --test test/velocity.test.mjs`
`node scripts/verify.mjs`
