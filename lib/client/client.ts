import type { Question, SystemOneResponse } from "./types"

export const SYSTEM_ONE_URL = "https://api.typesafe.ai/v1/systemone"
export const DEFAULT_MODEL = "jev-latest"

/** Only these two are worth retrying. Everything else is a fault in the request. */
const RETRYABLE_STATUS = new Set([429, 529])

const DEFAULT_TIMEOUT_MS = 5_000
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_BACKOFF_MS = 250

/**
 * A failed call, carrying the HTTP status so a caller can branch without
 * matching on message text.
 *
 * The vendor's own error body is deliberately not passed through to callers
 * who render it: put it in your logs, not on someone's screen.
 */
export class GlanceError extends Error {
  readonly status: number | null
  readonly retryable: boolean
  readonly body: string | null

  constructor({
    message,
    status,
    body,
  }: {
    message: string
    status: number | null
    body: string | null
  }) {
    super(message)
    this.name = "GlanceError"
    this.status = status
    this.retryable = status !== null && RETRYABLE_STATUS.has(status)
    this.body = body
  }
}

export type GlanceClientOptions = {
  /** Defaults to `process.env.TYPESAFE_API_KEY`. */
  apiKey?: string
  model?: string
  baseUrl?: string
  /** Per attempt, not for the whole call. Defaults to 5s. */
  timeoutMs?: number
  /** Retries after the first attempt. Defaults to 2. */
  maxRetries?: number
  /** Injected for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch
}

const readApiKey = ({ apiKey }: { apiKey: string | undefined }): string => {
  const resolved = apiKey ?? globalThis.process?.env?.["TYPESAFE_API_KEY"]
  if (!resolved) {
    throw new GlanceError({
      message:
        "No TypeSafe API key. Pass `apiKey` or set TYPESAFE_API_KEY. Keys come from https://console.typesafe.ai/settings/keys",
      status: null,
      body: null,
    })
  }
  return resolved
}

const sleep = ({ ms }: { ms: number }): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Asks a set of questions about one piece of state.
 *
 * Every question is answered in parallel from a single read, so ask everything
 * you might need in one call. A tenth question costs tokens but almost no time,
 * where ten separate calls cost ten round trips.
 *
 * @see https://docs.typesafe.ai/api
 */
export const createGlanceClient = (options: GlanceClientOptions = {}) => {
  const {
    apiKey,
    model = DEFAULT_MODEL,
    baseUrl = SYSTEM_ONE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    fetchImpl = globalThis.fetch,
  } = options

  const attempt = async ({
    state,
    questions,
    key,
  }: {
    state: unknown
    questions: Record<string, Question>
    key: string
  }): Promise<SystemOneResponse> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetchImpl(baseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, state, questions }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const body = await response.text().catch(() => null)
        throw new GlanceError({
          message: `TypeSafe returned ${response.status}.`,
          status: response.status,
          body,
        })
      }

      return (await response.json()) as SystemOneResponse
    } catch (error) {
      if (error instanceof GlanceError) throw error
      if (error instanceof Error && error.name === "AbortError") {
        throw new GlanceError({
          message: `TypeSafe did not answer within ${timeoutMs}ms.`,
          status: null,
          body: null,
        })
      }
      throw new GlanceError({
        message: error instanceof Error ? error.message : "TypeSafe request failed.",
        status: null,
        body: null,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  const ask = async ({
    state,
    questions,
  }: {
    state: unknown
    questions: Record<string, Question>
  }): Promise<SystemOneResponse> => {
    if (Object.keys(questions).length === 0) {
      throw new GlanceError({ message: "Ask at least one question.", status: null, body: null })
    }

    const key = readApiKey({ apiKey })
    let lastError: GlanceError | null = null

    for (let index = 0; index <= maxRetries; index += 1) {
      try {
        return await attempt({ state, questions, key })
      } catch (error) {
        if (!(error instanceof GlanceError) || !error.retryable) throw error
        lastError = error
        if (index < maxRetries) {
          await sleep({ ms: DEFAULT_BACKOFF_MS * 2 ** index })
        }
      }
    }

    throw lastError ?? new GlanceError({ message: "TypeSafe request failed.", status: null, body: null })
  }

  return { ask }
}

export type GlanceClient = ReturnType<typeof createGlanceClient>
