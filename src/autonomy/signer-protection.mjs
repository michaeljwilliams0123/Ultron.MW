export function verifySignerProtection(environment, branchProtection, branchPolicies) {
  const approval = environment?.protection_rules?.find(rule => rule.type === 'required_reviewers');
  const count = branchProtection?.required_pull_request_reviews?.required_approving_review_count;
  if (environment?.name !== 'ultron-independent-signer' ||
      environment?.deployment_branch_policy?.custom_branch_policies !== true ||
      branchPolicies?.total_count !== 1 || branchPolicies?.branch_policies?.length !== 1 ||
      branchPolicies.branch_policies[0]?.name !== 'main' ||
      branchPolicies.branch_policies[0]?.type !== 'branch' ||
      approval?.prevent_self_review !== true || !Array.isArray(approval.reviewers) ||
      approval.reviewers.length === 0 || !approval.reviewers.every(item =>
        item.type === 'User' && typeof item.reviewer?.login === 'string' &&
        item.reviewer.login.length > 0 &&
        item.reviewer.login.toLowerCase() !== 'michaeljwilliams0123') ||
      branchProtection?.enforce_admins?.enabled !== true ||
      !Number.isInteger(count) || count < 1 ||
      branchProtection?.required_pull_request_reviews?.require_code_owner_reviews !== true)
    throw new Error('independent-signer-protection-unverified');
}
