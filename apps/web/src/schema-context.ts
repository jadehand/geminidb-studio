export type SchemaRequestContext = {
  connectionId: string
  database: string
  sessionGeneration: number
  requestId: number
}

export async function waitForCurrentSchema<T>(load: () => Promise<T>, context: SchemaRequestContext, isCurrent: (context: SchemaRequestContext) => boolean): Promise<T | null> {
  const schema = await load()
  return isCurrent(context) ? schema : null
}
