export function parseParentPid(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--parent-pid')
  if (index < 0) return null
  const pid = Number(argv[index + 1])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

export function startParentWatchdog(parentPid, onOrphan, options = {}) {
  if (!parentPid) return null
  const probe = options.probe || (pid => process.kill(pid, 0))
  const schedule = options.schedule || ((callback, milliseconds) => setInterval(callback, milliseconds))
  const timer = schedule(() => {
    try { probe(parentPid) } catch { onOrphan() }
  }, options.intervalMs || 2000)
  timer?.unref?.()
  return timer
}
