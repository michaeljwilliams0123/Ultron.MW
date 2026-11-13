/**
 * Composio GitHub read-only discovery adapter. No API key, credential or
 * GitHub App token is handled here. A caller supplies an authenticated SDK.
 *
 * This is NOT a write transport. All GitHub mutations remain on Ultron's
 * capability broker / signed-approval / GitHub App path.
 */
export const COMPOSIO_GITHUB_REPOSITORY = Object.freeze({
  fullName: 'michaeljwilliams0123/Ultron.MW',
  id: 1424939667,
  owner: 'michaeljwilliams0123',
  ownerId: 308995719,
});
export const COMPOSIO_GITHUB_ACTORS = Object.freeze({
  owner: Object.freeze({ login: 'michaeljwilliams0123', id: 308995719 }),
  ultron: Object.freeze({ login: 'michaeljwilliams0123ultron', id: 354634860 }),
});
export const COMPOSIO_GITHUB_READ_TOOLS = Object.freeze([
  'GITHUB_GET_THE_AUTHENTICATED_USER',
  'GITHUB_GET_A_REPOSITORY',
]);

function validAccountId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/.test(value);
}
function assertAccountIds(accounts) {
  if (!accounts || !validAccountId(accounts.owner) ||
      !validAccountId(accounts.ultron) || accounts.owner === accounts.ultron) {
    throw Error('Distinct explicit Composio GitHub account IDs required');
  }
}
function dataFrom(result) {
  if (!result || result.resultType !== 'completed' ||
      !result.data || typeof result.data !== 'object' ||
      result.data.successful === false) {
    throw Error('Composio GitHub read failed; no identity proof');
  }
  const data = result.data.successful === true ? result.data.data : result.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw Error('Composio GitHub response has no usable data');
  }
  return data;
}

/**
 * A narrow Composio Platform session, scoped to the two verified actors.
 * Account IDs must come from the deployment's own Composio project: IDs from
 * an unrelated ChatGPT connector connection must NOT be assumed portable.
 */
export function composioGitHubReadSessionConfig(accounts) {
  assertAccountIds(accounts);
  return {
    toolkits: ['github'],
    tools: { github: { enable: [...COMPOSIO_GITHUB_READ_TOOLS] } },
    connectedAccounts: { github: [accounts.owner, accounts.ultron] },
    multiAccount: {
      enable: true,
      maxAccountsPerToolkit: 2,
      requireExplicitSelection: true,
    },
    manageConnections: { enable: false },
    sandbox: { enable: false },
    proxyExecute: { enable: false },
  };
}

export async function startComposioGitHubReadSession({
  composio, userId, accounts,
} = {}) {
  if (!composio || typeof composio.create !== 'function' ||
      typeof userId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/.test(userId)) {
    throw Error('Authenticated Composio client and stable application user ID required');
  }
  return composio.create(userId, composioGitHubReadSessionConfig(accounts));
}

/**
 * Executes exactly two non-mutating GitHub API reads; verifies the immutable
 * GitHub IDs and repository ownership independently of OAuth account aliases.
 */
export function createComposioGitHubReadGateway({ session, accounts } = {}) {
  assertAccountIds(accounts);
  if (!session || typeof session.execute !== 'function') {
    throw Error('Composio session required');
  }

  async function inspect(actor) {
    if (!Object.hasOwn(COMPOSIO_GITHUB_ACTORS, actor)) {
      throw Error('Unrecognized Composio GitHub actor');
    }
    const account = accounts[actor];
    const expected = COMPOSIO_GITHUB_ACTORS[actor];
    const profile = dataFrom(await session.execute(
      COMPOSIO_GITHUB_READ_TOOLS[0], {}, { account },
    ));
    if (profile.login !== expected.login || Number(profile.id) !== expected.id) {
      throw Error('Composio GitHub identity mismatch');
    }
    const repository = dataFrom(await session.execute(
      COMPOSIO_GITHUB_READ_TOOLS[1],
      { owner: COMPOSIO_GITHUB_REPOSITORY.owner, repo: 'Ultron.MW' },
      { account },
    ));
    if (repository.full_name !== COMPOSIO_GITHUB_REPOSITORY.fullName ||
        Number(repository.id) !== COMPOSIO_GITHUB_REPOSITORY.id ||
        repository.owner?.login !== COMPOSIO_GITHUB_REPOSITORY.owner ||
        Number(repository.owner?.id) !== COMPOSIO_GITHUB_REPOSITORY.ownerId) {
      throw Error('Composio GitHub canonical repository mismatch');
    }
    if (!repository.permissions?.pull ||
        (actor === 'owner' && !repository.permissions.admin)) {
      throw Error('Composio GitHub repository permissions do not satisfy expected identity');
    }
    return Object.freeze({
      schema: 'ultron.composio-github-read.v1',
      verified: true,
      actor,
      login: expected.login,
      githubUserId: expected.id,
      repository: COMPOSIO_GITHUB_REPOSITORY.fullName,
      repositoryId: COMPOSIO_GITHUB_REPOSITORY.id,
      canRead: true,
      // Not App authentication, write authorization, or production acceptance.
      proofScope: 'oauth-user-and-repository-readback-only',
    });
  }
  return Object.freeze({ inspect });
}
