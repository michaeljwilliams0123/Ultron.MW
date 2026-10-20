# Ultron closed-loop corrective acceptance

Repair target: OPEN

This file is a controlled, read-only acceptance canary. The PR brain should accept an owner-authored exact-context patch, commit its change without force pushing, independently read back the new bytes despite eventual consistency, dispatch the exact-head full verification suite, and reply with the committed SHA and real result.
