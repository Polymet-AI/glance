import { describe, expect, it, vi } from "vitest"

import { createGlanceClient, GlanceError } from "./client"
import { noul } from "./questions"
import type { SystemOneResponse } from "./types"

const ANSWER: SystemOneResponse = {
  model: "jev-1.13.0",
  answers: { urgent: { type: "noul", noul: 0.94 } },
  usage: { input_tokens: 210, output_tokens: 31 },
}

const okResponse = (): Response =>
  new Response(JSON.stringify(ANSWER), { status: 200, headers: { "Content-Type": "application/json" } })

const errorResponse = ({ status }: { status: number }): Response =>
  new Response(JSON.stringify({ error: "nope" }), { status })

const QUESTIONS = { urgent: noul({ instructions: "The message conveys urgency." }) }

describe("createGlanceClient", () => {
  it("posts the model, state and questions to the endpoint", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse())
    const client = createGlanceClient({ apiKey: "sk-test", fetchImpl })

    const result = await client.ask({ state: "Deploy failed twice.", questions: QUESTIONS })

    expect(result).toEqual(ANSWER)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const [url, init] = fetchImpl.mock.calls[0] ?? []
    expect(url).toBe("https://api.typesafe.ai/v1/systemone")
    expect(init?.method).toBe("POST")
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "jev-latest",
      state: "Deploy failed twice.",
      questions: QUESTIONS,
    })
  })

  it("sends the key as a bearer token", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse())
    await createGlanceClient({ apiKey: "sk-test", fetchImpl }).ask({ state: "x", questions: QUESTIONS })

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string>
    expect(headers["Authorization"]).toBe("Bearer sk-test")
  })

  const retryable = [429, 529]

  retryable.forEach((status) => {
    it(`retries a ${status} and returns the later success`, async () => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(errorResponse({ status }))
        .mockResolvedValueOnce(okResponse())

      const client = createGlanceClient({ apiKey: "sk-test", fetchImpl, maxRetries: 1 })
      const result = await client.ask({ state: "x", questions: QUESTIONS })

      expect(result).toEqual(ANSWER)
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })
  })

  const fatal = [401, 422]

  fatal.forEach((status) => {
    it(`gives up immediately on a ${status}`, async () => {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(errorResponse({ status }))
      const client = createGlanceClient({ apiKey: "sk-test", fetchImpl, maxRetries: 3 })

      await expect(client.ask({ state: "x", questions: QUESTIONS })).rejects.toMatchObject({
        name: "GlanceError",
        status,
        retryable: false,
      })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })
  })

  it("stops after the retry budget and throws the last error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(errorResponse({ status: 429 }))
    const client = createGlanceClient({ apiKey: "sk-test", fetchImpl, maxRetries: 2 })

    await expect(client.ask({ state: "x", questions: QUESTIONS })).rejects.toBeInstanceOf(GlanceError)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it("names the environment variable when no key is present", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const original = process.env["TYPESAFE_API_KEY"]
    delete process.env["TYPESAFE_API_KEY"]

    try {
      const client = createGlanceClient({ fetchImpl })
      await expect(client.ask({ state: "x", questions: QUESTIONS })).rejects.toThrow(
        /TYPESAFE_API_KEY/,
      )
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      if (original !== undefined) process.env["TYPESAFE_API_KEY"] = original
    }
  })

  it("refuses a request with no questions", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const client = createGlanceClient({ apiKey: "sk-test", fetchImpl })

    await expect(client.ask({ state: "x", questions: {} })).rejects.toThrow(
      "Ask at least one question.",
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("reports the deadline when the request outlives it", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
          })
        }),
    )

    const client = createGlanceClient({ apiKey: "sk-test", fetchImpl, timeoutMs: 10, maxRetries: 0 })

    await expect(client.ask({ state: "x", questions: QUESTIONS })).rejects.toThrow(
      "TypeSafe did not answer within 10ms.",
    )
  })
})
