import type { BulkJobStatus } from './types.ts'

const UNFINISHED = new Set<BulkJobStatus['status']>(['queued','running','retrying','paused','cancelling'])

export type AppCloseStep = 'measurement' | 'bulk' | 'close'

export function isUnfinishedBulkJob(status?:BulkJobStatus['status']) {
  return status ? UNFINISHED.has(status) : false
}

export function appCloseStep({ hasMeasurementDrafts, bulkStatus }: { hasMeasurementDrafts: boolean; bulkStatus?: BulkJobStatus['status'] }): AppCloseStep {
  if (hasMeasurementDrafts) return 'measurement'
  return isUnfinishedBulkJob(bulkStatus) ? 'bulk' : 'close'
}

export function nextPollDelay(status:BulkJobStatus['status']) {
  return isUnfinishedBulkJob(status) ? 1000 : null
}

export async function waitForBulkJobTerminal(
  load:() => Promise<BulkJobStatus>,
  timeoutMs = 3000,
  delay:(milliseconds:number) => Promise<void> = milliseconds => new Promise(resolve => window.setTimeout(resolve, milliseconds)),
) {
  const deadline = Date.now() + timeoutMs
  let job = await load()
  while (isUnfinishedBulkJob(job.status) && Date.now() < deadline) {
    await delay(Math.min(250, Math.max(0, deadline - Date.now())))
    job = await load()
  }
  return job
}
