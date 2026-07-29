export function isEnvironmentWritable(environment) {
  return environment === 'test' || environment === 'dev'
}

export function assertEnvironmentWritable(session) {
  if (isEnvironmentWritable(session?.environment)) return
  const error = new Error('生产环境连接为只读，禁止写入')
  error.status = 403
  error.code = 'PRODUCTION_READ_ONLY'
  throw error
}
