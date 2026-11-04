// Narrow, credential-free seam: public operational state from Hatchable.
export const CLOUD_STATUS_URL = 'https://ultron-mw-cloud.hatchable.site/api/brain/status-public';
export const CLOUD_STATUS_SCHEMA = 'ultron.cloud-status.v1';
export function parseCloudStatus(value) {
  if (!value || value.schema !== CLOUD_STATUS_SCHEMA || value.ok !== true ||
      !['active','paused'].includes(value.status) ||
      typeof value.observedAt !== 'string' || !Number.isFinite(Date.parse(value.observedAt)) ||
      !['hourly-configured'].includes(value.scheduler) ||
      value.ownerOperations !== 'protected' ||
      !(value.lastEventAt === null ||
        (typeof value.lastEventAt === 'string' && Number.isFinite(Date.parse(value.lastEventAt))))) {
    throw Error('Cloud status response failed validation');
  }
  return Object.freeze({
    status: value.status,
    observedAt: value.observedAt,
    lastEventAt: value.lastEventAt,
    scheduler: value.scheduler
  });
}
export async function fetchCloudStatus(fetcher = fetch) {
  const reply = await fetcher(CLOUD_STATUS_URL, {
    method: 'GET', mode: 'cors', cache: 'no-store', credentials: 'omit'
  });
  if (!reply.ok) throw Error('Cloud status temporarily unavailable');
  return parseCloudStatus(await reply.json());
}
