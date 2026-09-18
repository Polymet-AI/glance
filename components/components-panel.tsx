"use client"

import { useCallback, useState } from "react"
import type { DesignSection, SectionReview } from "@/lib/review"

import { PageMap } from "./page-map"
import { SectionList } from "./section-list"
import type { SectionState } from "./section-list"

/**
 * Components, analysed on demand.
 *
 * The overview does not pay for them. Reviewing every component of a real page
 * costs more tokens than the page review itself, measured at 50,448 against
 * 28,973 on one marketing site, and most readers want the overall answer
 * first. So the page is shown whole with its components outlined, and the
 * fan-out waits for someone to ask.
 *
 * When they do, every component goes out at once rather than in turn. Each is
 * its own state, so they cannot share a request, but nothing makes them queue
 * either: eight land in about the time the slowest one takes.
 */

type Phase = "overview" | "analysing" | "done"

const reviewOne = async ({
  section,
}: {
  section: DesignSection
}): Promise<{ review?: SectionReview; modelMs?: number; error?: string }> => {
  try {
    const response = await fetch("/api/component", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section }),
    })
    const body = (await response.json()) as {
      review?: SectionReview
      modelMs?: number
      error?: string
    }
    if (!response.ok || !body.review) {
      return { error: body.error ?? "This component could not be reviewed." }
    }
    return {
      review: body.review,
      ...(body.modelMs === undefined ? {} : { modelMs: body.modelMs }),
    }
  } catch {
    return { error: "The request failed." }
  }
}

export const ComponentsPanel = ({
  image,
  pageWidth,
  pageHeight,
  sections,
}: {
  image: string
  pageWidth: number
  pageHeight: number
  sections: readonly DesignSection[]
}) => {
  const [phase, setPhase] = useState<Phase>("overview")
  const [states, setStates] = useState<SectionState[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)

  const analyse = useCallback(
    async ({ pickedId }: { pickedId: string }) => {
      if (phase !== "overview") {
        setActiveId(pickedId)
        return
      }

      // The panel splits first and the cards come up as skeletons, so the
      // layout settles before any answer lands rather than jumping twice.
      setPhase("analysing")
      setActiveId(pickedId)
      setStates(sections.map((section) => ({ section })))

      const started = performance.now()
      await Promise.all(
        sections.map(async (section) => {
          const outcome = await reviewOne({ section })
          setStates((previous) =>
            previous.map((state) =>
              state.section.id === section.id ? { ...state, ...outcome } : state,
            ),
          )
        }),
      )
      setElapsedMs(Math.round(performance.now() - started))
      setPhase("done")
    },
    [phase, sections],
  )

  const reviews = states
    .map((state) => state.review)
    .filter((review): review is SectionReview => review !== undefined)

  return (
    <div className={phase === "overview" ? "components" : "components is-split"}>
      <PageMap
        image={image}
        pageWidth={pageWidth}
        pageHeight={pageHeight}
        sections={sections}
        reviews={reviews}
        activeId={activeId}
        variant={phase === "overview" ? "full" : "rail"}
        onHover={setActiveId}
        onPick={(id) => void analyse({ pickedId: id })}
      />

      {phase === "overview" ? (
        <p className="components-hint">
          {sections.length} components found. Click any one to review them all, each in its own
          request, all at once.
        </p>
      ) : (
        <div className="components-results">
          <p className="components-status">
            {phase === "analysing" ? (
              <>
                {sections.length} requests in flight, {reviews.length} back
              </>
            ) : (
              <>
                {reviews.length} of {sections.length} components ·{" "}
                <strong>{elapsedMs} ms</strong> for {reviews.length * 6} decisions
              </>
            )}
          </p>
          <SectionList states={states} activeId={activeId} onHover={setActiveId} />
        </div>
      )}
    </div>
  )
}
