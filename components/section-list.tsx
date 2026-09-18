"use client"

import type { DesignSection, SectionReview } from "@/lib/review"

/**
 * One card per component, in page order.
 *
 * Each card's numbers came from its own request against its own snapshot, so a
 * weak footer does not drag the hero down and a strong hero does not cover for
 * a weak footer, which is exactly what a whole-page average does.
 *
 * A card still waiting shows the shape of its answer rather than a spinner, so
 * the list holds its height and nothing reflows as results land one by one.
 */

export type SectionState = {
  section: DesignSection
  review?: SectionReview
  modelMs?: number
  error?: string
}

const bandClass = ({ value }: { value: number }): string => {
  if (value >= 70) return "pip is-high"
  if (value >= 45) return "pip is-mid"
  return "pip is-low"
}

const BAR_NAMES = ["Hierarchy", "Finish", "Density"]

const SkeletonCard = ({ label, tag }: { label: string; tag: string }) => (
  <div className="srow is-waiting">
    <div className="srow-head">
      <span className="skeleton skeleton-kind" />
      <span className="srow-label">{label || tag}</span>
      <span className="skeleton skeleton-pip" />
    </div>
    <div className="srow-bars">
      {BAR_NAMES.map((name) => (
        <div className="srow-bar" key={name}>
          <span className="srow-bar-name">{name}</span>
          <span className="srow-track">
            <span className="skeleton skeleton-track" />
          </span>
          <span className="skeleton skeleton-value" />
        </div>
      ))}
    </div>
    <p className="srow-foot">
      <span className="skeleton skeleton-foot" />
    </p>
  </div>
)

const ResultCard = ({
  state,
  isActive,
  onHover,
}: {
  state: SectionState
  isActive: boolean
  onHover: (id: string | null) => void
}) => {
  const review = state.review
  if (!review) return null

  return (
    <div
      className={isActive ? "srow is-active" : "srow"}
      onMouseEnter={() => onHover(review.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="srow-head">
        <span className="srow-kind">{review.kind.replace(/_/g, " ")}</span>
        <span className="srow-label">{review.label}</span>
        {review.overall ? (
          <span className={bandClass({ value: review.overall.value })}>
            {review.overall.value.toFixed(0)}
          </span>
        ) : null}
      </div>

      <div className="srow-bars">
        {review.scores.map((score) => {
          const top = Math.max(1, score.levels - 1)
          return (
            <div className="srow-bar" key={score.id}>
              <span className="srow-bar-name">{score.label}</span>
              <span className="srow-track">
                <span className="srow-fill" style={{ width: `${(score.value / top) * 100}%` }} />
              </span>
              <span className="srow-bar-value">{score.value.toFixed(1)}</span>
            </div>
          )
        })}
      </div>

      <p className="srow-foot">
        fix first <strong className="is-term">{review.fixFirst.replace(/_/g, " ")}</strong>
        {review.flags[0] ? (
          <>
            {" · "}
            {review.flags[0].label.toLowerCase()}{" "}
            <strong>{Math.round(review.flags[0].probability * 100)}%</strong>
          </>
        ) : null}
        {" · "}
        {review.elementCount} elements
        {state.modelMs === undefined ? null : (
          <>
            {" · "}
            <strong>{state.modelMs} ms</strong>
          </>
        )}
      </p>
    </div>
  )
}

const FailedCard = ({ state }: { state: SectionState }) => (
  <div className="srow is-failed">
    <div className="srow-head">
      <span className="srow-kind">failed</span>
      <span className="srow-label">{state.section.label || state.section.tag}</span>
    </div>
    <p className="srow-foot">{state.error}</p>
  </div>
)

export const SectionList = ({
  states,
  activeId,
  onHover,
}: {
  states: readonly SectionState[]
  activeId: string | null
  onHover: (id: string | null) => void
}) => (
  <div className="srows">
    {states.map((state) => {
      if (state.error) return <FailedCard key={state.section.id} state={state} />
      if (!state.review) {
        return (
          <SkeletonCard key={state.section.id} label={state.section.label} tag={state.section.tag} />
        )
      }
      return (
        <ResultCard
          key={state.section.id}
          state={state}
          isActive={state.section.id === activeId}
          onHover={onHover}
        />
      )
    })}
  </div>
)
