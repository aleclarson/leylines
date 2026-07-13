/** Whether the current runtime was started by a recognized test runner. */
export function isTestEnvironment(): boolean {
  const importMetaEnv = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>
    }
  ).env
  const env = (
    globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env

  return (
    importMetaEnv?.MODE === 'test' ||
    importMetaEnv?.VITEST === 'true' ||
    env?.NODE_ENV === 'test' ||
    env?.VITEST === 'true' ||
    env?.JEST_WORKER_ID !== undefined ||
    env?.NODE_TEST_CONTEXT !== undefined
  )
}
