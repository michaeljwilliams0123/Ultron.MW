# Ultron native read canary extension

This is a bounded owner-initiated integration for PR #565. It is not a general browser automation extension or a production device enrollment.

Build into a new directory with:
node scripts/package-native-browser-extension.mjs <new absolute directory>

The package contains a Manifest V3 popup, the exact native client, the pairing helper and the single-exchange port adapter. The sole requested browser permission is nativeMessaging. There are no content scripts, host permissions, external messaging, or background execution.

Pair using the independently verified Ed25519 host SPKI public key and its SHA-256 fingerprint. The device creates a nonextractable private CryptoKey in extension-local IndexedDB and displays only the public enrollment. A trusted host administrator must independently register the exact extension origin and device public key. The host retains its own authorization policy.

The popup authorizes one fixed $0 page.inspect/page.read task for the Ultron-owned acceptance page. Repeated clicks use the same persisted idempotency key. No automatic retry occurs. Disconnect before dispatch is held; disconnect after dispatch without a verified receipt requires reconciliation. A complete signed receipt can finish verification after the host closes.

The package does not install a native host, register a browser extension, change browser permissions, connect production PostgreSQL, or establish production acceptance. Test coverage uses a simulated browser port connected to the real cryptographic host/client contract and the existing subprocess-based native transport tests. Actual Chromium registration, persistent CryptoKey behavior in the browser, trusted local executable provisioning, and live host readback remain separate acceptance steps.

Tests:
node --test test/native-extension-port.test.mjs test/native-extension-pairing.test.mjs test/native-browser-transport.test.mjs
