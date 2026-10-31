# C — Scale, heterogeneous extensions and preserved customization

**Hypothesis:** Ultron can add specialized, individually useful capabilities without sacrificing the baseline merely to reduce source size.

## Executed contract in PR #202

- The initial scale check preserves 256 separately named capabilities.
- The next scale check preserves 1,024 separately named capabilities after reverse-ordering the candidate observations; expected classification is `PRESERVED` with no missing or regressed feature.
- Verify deterministic and sorted output, immutable returned arrays and no mutation of frozen input observations.
- Native regression smoke checks exercise the existing API/MCP integration generator, owner workbench and outer-loop session rather than merely verifying exported function names.

## Next expansion

- Partition by domain (GitHub, Hatchable, Mahoraga, council, browser, local opt-in adapters), then test contract compatibility per domain.
- Compare old and new adapter behaviors through identical request fixtures while keeping distinct extensions as separate capabilities.
- Add throughput benchmarks only when real execution metrics justify them. Do not claim an arbitrary feature count proves production scale.

**Boundary:** Synthetic 1,024-feature classification is a CPU-only correctness stress test. It does not measure concurrency, model quality, durable state, network latency, or 24/7 availability.
