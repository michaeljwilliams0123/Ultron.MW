# Plugin interoperability

The provider registry covers GitHub, Remote Desktop Commander, Descope, Hugging Face, Browser Use, Compound Engineering, and Caveman.

The runtime module is src/plugin-interoperability.mjs and tests are in test/plugin-interoperability.test.mjs.

This is an adapter for the existing authenticated capability broker. No catalogue entry grants execution authority.

Only broker bindings with matching provider, operation, effect, cost allowance, unexpired status, and a recent health probe can be routed. Skills are metadata only, not independent execution engines. Provider writes still require broker authorization, idempotency, and independently verified postconditions.

Existing cloud parity, browser acceptance, and separate executor identity requirements remain independently gated.
