# D — Owner autonomy without lost authorization guarantees

**Hypothesis:** Ultron's increasingly powerful customization must remain executable while independently authorized operations retain the correct boundaries.

## Executed contract in PR #202

- An enabled owner workbench can dispatch the injected `github.issue.read` adapter and generate a bounded `internet.search_plan` result without changing production.
- The outer-loop executes an injected plan with the expected ordered step results.
- A disabled workbench cannot call the GitHub adapter.
- An approval-required plan lacking the owner's approval cannot call the GitHub adapter.
- A new candidate `admin.capability` can classify as a functional addition while `releaseEligible` stays **false** and `independentSecurityApprovalRequired` stays **true**.
- API/MCP extension generation remains available without minting secrets or creating a paid service.

## Next expansion

1. Verify specific operation-by-operation grants on the unified identity model in PR #199.
2. Exercise permanent owner stop, one-use step-up tokens, expired grants and durable execution receipts.
3. Confirm that an approval-gate failure means zero external writes, including after retries.
4. Tie any permission expansion to independent identity and authorization readback—not to a high mutation score.

**Boundary:** A unit test of injected adapters cannot establish live GitHub App authority, independent reviewer approval, browser MFA acceptance or permission safety in production.
