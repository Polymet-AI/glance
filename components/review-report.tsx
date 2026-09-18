"use client"

import { ChoiceCard, ProbabilityRing, ScoreBar } from "./charts"
import { ComponentsPanel } from "./components-panel"
import type { DesignChoice, DesignReview, DesignScore, DesignSection } from "@/lib/review"
import type { BoardEntry } from "@/lib/leaderboard"

export type ReviewResult = {
  url: string
  title: string
  image: string
  elementCount: number
  truncated: boolean
  elapsedMs: number
  pageImage: string
  pageWidth: number
  pageHeight: number
  flattened: boolean
  sections: DesignSection[]
  review: DesignReview
  /** The page's standing after this review. Absent when the board is off. */
  board?: BoardEntry
}

const bySection = <T extends { section: string }>({
  items,
  section,
}: {
  items: readonly T[]
  section: string
}): T[] => items.filter((item) => item.section === section)

/** The one number the report leads with, then the two directions. */
const Verdict = ({ review }: { review: DesignReview }) => (
  <div className="verdict">
    {review.overall ? (
      <div className="verdict-cell is-hero">
        <p className="verdict-label">Overall</p>
        <strong className="hero-figure">{review.overall.value.toFixed(0)}</strong>
        <p className="hero-band">{review.overall.band}</p>
        <p className="hero-basis">
          mean of {review.overall.dimensions} judged dimensions · mean confidence{" "}
          {review.overall.confidence.toFixed(2)}
        </p>
      </div>
    ) : null}
    <div className="verdict-cell">
      <p className="verdict-label">Fix first</p>
      <strong className="verdict-value is-accent">{review.fixFirst.replace(/_/g, " ")}</strong>
    </div>
    <div className="verdict-cell">
      <p className="verdict-label">Already strongest</p>
      <strong className="verdict-value">{review.strongest.replace(/_/g, " ")}</strong>
    </div>
    <div className="verdict-cell">
      <p className="verdict-label">Reads as</p>
      <strong className="verdict-value">{review.screenKind.replace(/_/g, " ")}</strong>
    </div>
  </div>
)

const Section = ({
  title,
  caption,
  wide,
  children,
}: {
  title: string
  caption?: string
  wide?: boolean
  children: React.ReactNode
}) => (
  <section className={wide ? "section is-wide" : "section"}>
    <div className="section-head">
      <h2>{title}</h2>
      {caption ? <p className="section-caption">{caption}</p> : null}
    </div>
    {children}
  </section>
)

export const ReviewReport = ({ result }: { result: ReviewResult }) => {
  const { review } = result
  const craft: DesignScore[] = bySection({ items: review.scores, section: "craft" })
  const reading: DesignChoice[] = bySection({ items: review.choices, section: "reading" })
  const direction: DesignChoice[] = bySection({ items: review.choices, section: "direction" })
  return (
    <div className="report">
      <header className="report-head">
        <img src={result.image} alt={`Screenshot of ${result.title || result.url}`} className="thumb" />
        <div>
          <h2 className="report-title">{result.title || result.url}</h2>
          <p className="report-meta">
            <a href={result.url} target="_blank" rel="noreferrer noopener">
              {result.url}
            </a>
          </p>
          <p className="report-stats">
            <span>
              <strong>{result.elementCount}</strong> elements{result.truncated ? " (capped)" : ""}
            </span>
            <span>
              <strong>{result.review.usage.inputTokens.toLocaleString()}</strong> input tokens
            </span>
            <span>
              <strong>{result.elapsedMs}</strong> ms for{" "}
              {review.scores.length + review.flags.length + review.choices.length} answers
            </span>
          </p>
        </div>
      </header>

      <Verdict review={review} />

      {result.sections.length > 0 ? (
        <Section
          title="Components"
          caption="The page as captured, with every component outlined. Reviewing them is a separate ask."
          wide
        >
          <ComponentsPanel
            image={result.pageImage}
            pageWidth={result.pageWidth}
            pageHeight={result.pageHeight}
            sections={result.sections}
          />
        </Section>
      ) : null}

      <Section title="Craft" caption="Judged. Open a row for the full spread across its levels.">
        <div className="scores">
          {craft.map((score, index) => (
            <ScoreBar
              key={score.id}
              label={score.label}
              value={score.value}
              levels={score.levels}
              summary={score.summary}
              confidence={score.confidence}
              distribution={score.distribution}
              delay={60 * index}
            />
          ))}
        </div>
      </Section>

      <Section title="Signals" caption="Yes or no, as a probability rather than a verdict.">
        <div className="flags">
          {review.flags.map((flag, index) => (
            <ProbabilityRing
              key={flag.id}
              label={flag.label}
              probability={flag.probability}
              delay={40 * index}
            />
          ))}
        </div>
      </Section>

      <Section title="What it reads as" caption="Each pick with the options it beat. Screen kind is the canary: if that one is wrong, the snapshot lost too much and the rest is noise.">
        <div className="choices">
          {reading.map((item, index) => (
            <ChoiceCard
              key={item.id}
              label={item.label}
              choice={item.choice}
              confidence={item.confidence}
              distribution={item.distribution}
              {...(item.note ? { note: item.note } : {})}
              delay={50 * index}
            />
          ))}
        </div>
      </Section>

      <Section title="Direction" caption="The nearest thing to a reason, since none is returned.">
        <div className="choices">
          {direction.map((item, index) => (
            <ChoiceCard
              key={item.id}
              label={item.label}
              choice={item.choice}
              confidence={item.confidence}
              distribution={item.distribution}
              {...(item.note ? { note: item.note } : {})}
              delay={50 * index}
            />
          ))}
        </div>
      </Section>

      <p className="note">
        Every number here came from a single request, answered in parallel. Confidence measures
        how concentrated an answer was, not whether it is correct, and no rationale is ever
        returned. The overall figure is the mean of the craft dimensions, each normalised to its own
        scale first, with the yes/no signals left out because some are good to be true and some are
        bad.
      </p>
    </div>
  )
}
