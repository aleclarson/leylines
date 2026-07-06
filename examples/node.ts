import { openScopedLogs } from 'leylines'

const logs = openScopedLogs({ path: '.leylines/logs.sqlite' })
const logger = logs.logger({
  scope: 'worker.queue',
  properties: { worker: 'email' },
})

logger.info('job started', {
  properties: { jobId: 'job-1', request: { id: 'req-1' } },
})

logger.warn('job retry scheduled', {
  properties: { jobId: 'job-1', attempt: 2 },
})

console.log(
  logs.query({
    scopePrefix: 'worker',
    properties: [{ path: 'jobId', equals: 'job-1' }],
  }).entries,
)

logs.close()
