"use client"

import { useEffect, useState } from "react"

/**
 * Chart pieces, as inline SVG and CSS. No charting dependency: every form here
 * is a rectangle or an arc, and a library would cost more than it saves.
 *
 * Forms follow the job. Comparing magnitude across named dimensions is a bar,
 * not a radar: a radar asks a reader to judge area and angle where a bar asks
 * them to compare length, which people do accurately. A single ratio against a
 * limit is a meter. A distribution over named options is a stacked track.
 *
 * Colour: one accent hue carries every data mark, and length does the
 * encoding. Status colours are reserved, and always ship beside a word rather
 * than standing alone.
 */

/** Grows a value from zero once mounted, so marks settle in rather than appear. */
const useGrown = ({ target, delay }: { target: number; delay: number }): number => {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => setValue(target), delay)
    return () => clearTimeout(timer)
  }, [target, delay])
  return value
}

export const ScoreBar = ({
  label,
  value,
  levels,
  summary,
  confidence,
  distribution,
  delay,
}: {
  label: string
  value: number
  levels: number
  summary: string
  confidence: number
  distribution: readonly { label: string; probability: number }[]
  delay: number
}) => {
  const top = Math.max(1, levels - 1)
  const width = useGrown({ target: (value / top) * 100, delay })
  const [open, setOpen] = useState(false)

  return (
    <div className="score">
      <button
        type="button"
        className="score-head"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
      >
        <span className="score-name">{label}</span>
        <span className="score-value">
          {value.toFixed(1)}
          <span className="score-of">/{top}</span>
          <span className="score-conf">conf {confidence.toFixed(2)}</span>
          <span className="score-chevron" aria-hidden>
            {open ? "−" : "+"}
          </span>
        </span>
      </button>

      <div className="track" role="img" aria-label={`${label}: ${value.toFixed(1)} of ${top}`}>
        <div className="fill" style={{ width: `${width}%` }} />
      </div>

      <p className="score-summary">{summary}</p>

      {open ? (
        <div className="levels">
          {distribution.map((level, index) => (
            <div className="level" key={level.label}>
              <span className="level-index">{index}</span>
              <span className="level-label">{level.label}</span>
              <span className="level-track">
                <span className="level-fill" style={{ width: `${level.probability * 100}%` }} />
              </span>
              <span className="level-value">{Math.round(level.probability * 100)}%</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const RING_SIZE = 46
const RING_RADIUS = 19
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** A single probability against its limit. One ratio, so a meter, not a pie. */
export const ProbabilityRing = ({
  label,
  probability,
  delay,
}: {
  label: string
  probability: number
  delay: number
}) => {
  const shown = useGrown({ target: probability, delay })
  const percent = Math.round(probability * 100)

  return (
    <div className="flag">
      <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden>
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          className="ring-track"
          fill="none"
          strokeWidth="3"
        />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          className="ring-fill"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - shown)}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </svg>
      <div className="flag-text">
        <div className="flag-value">{percent}%</div>
        <div className="flag-name">{label}</div>
      </div>
    </div>
  )
}

/** A pick with its runners-up. The spread is what tells 0.94 from 0.34. */
export const ChoiceCard = ({
  label,
  choice,
  confidence,
  distribution,
  note,
  delay,
}: {
  label: string
  choice: string
  confidence: number
  distribution: readonly { option: string; probability: number }[]
  note?: string
  delay: number
}) => {
  const shown = useGrown({ target: 1, delay })
  const top = distribution.slice(0, 4).filter((entry) => entry.probability > 0.004)

  return (
    <div className="choice">
      <div className="choice-head">
        <span className="choice-label">{label}</span>
        <span className="choice-conf">conf {confidence.toFixed(2)}</span>
      </div>
      <div className="choice-pick">{choice.replace(/_/g, " ")}</div>
      <div className="choice-bars">
        {top.map((entry) => (
          <div className="choice-row" key={entry.option}>
            <span className="choice-option">{entry.option.replace(/_/g, " ")}</span>
            <span className="choice-track">
              <span
                className={entry.option === choice ? "choice-fill is-pick" : "choice-fill"}
                style={{ width: `${entry.probability * 100 * shown}%` }}
              />
            </span>
            <span className="choice-percent">{Math.round(entry.probability * 100)}%</span>
          </div>
        ))}
      </div>
      {note ? <p className="choice-note">{note}</p> : null}
    </div>
  )
}
