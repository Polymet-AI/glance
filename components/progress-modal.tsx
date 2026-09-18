"use client"

import { useEffect } from "react"

/**
 * What the server is doing, while it does it.
 *
 * Every line here is reported by the server as that step begins, so the modal
 * never claims progress it has not been told about.
 *
 * It opens the moment a review starts, before there is anything to show. The
 * two renderers differ here and the modal has to suit the slower one: a local
 * browser pushes a capture seconds in, a hosted one returns nothing until the
 * whole render is done. Waiting for an image before opening left the reader
 * looking at an unchanged page for half a minute, which reads as a dead button.
 *
 * So the frame starts empty and says what it is waiting for. Once a capture
 * arrives it takes over, and once the whole-page capture arrives the frame pans
 * down it, which is both the honest picture of what the server is doing and the
 * most interesting thing to look at while it does it.
 */

/**
 * Every step either renderer can report, with the words for it. Which of these
 * a given run shows is decided by the server, since only it knows which browser
 * ran and therefore what can honestly be claimed.
 */
const STEP_LABELS: Record<string, string> = {
  checking: "Checking the address",
  launching: "Starting a browser",
  loading: "Loading the page",
  rendering: "Rendering it in a remote browser",
  glimpse: "First look",
  settling: "Waiting for fonts and late paint",
  captured: "Capturing the viewport",
  mapping: "Capturing the whole page",
  extracting: "Reading the design as structure",
  asking: "Asking the model",
}

const StepRow = ({
  step,
  state,
}: {
  step: { id: string; label: string }
  state: "done" | "active" | "waiting"
}) => (
  <li className={`step is-${state}`}>
    <span className="step-mark" aria-hidden>
      {state === "done" ? "✓" : ""}
    </span>
    <span className="step-label">{step.label}</span>
  </li>
)

export const ProgressModal = ({
  steps,
  currentStep,
  detail,
  image,
  pageImage,
  pageWidth,
  pageHeight,
  error,
  onClose,
}: {
  /** The step ids this run will report, in order, as the server named them. */
  steps: string[]
  currentStep: string | null
  detail: string | null
  image: string | null
  pageImage: string | null
  pageWidth: number | null
  pageHeight: number | null
  error: string | null
  onClose: () => void
}) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const activeIndex = steps.indexOf(currentStep ?? "")

  // How far the capture has to travel for its foot to reach the frame's foot,
  // as a share of its own height. The frame is 16:10, so its height is
  // width × 0.625, and the capture's is width × (pageHeight / pageWidth).
  const panPercent =
    pageImage && pageWidth && pageHeight
      ? Math.max(0, (1 - 0.625 / (pageHeight / pageWidth)) * 100)
      : 0
  const panSeconds = Math.min(30, Math.max(6, (pageHeight ?? 0) / 600))

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="Reviewing">
      <div className="modal">
        <div className="modal-stage">
          {pageImage ? (
            <img
              src={pageImage}
              alt="The page being reviewed"
              className="shot is-panning"
              style={{
                ["--pan" as string]: `-${panPercent}%`,
                ["--pan-time" as string]: `${panSeconds}s`,
              }}
            />
          ) : image ? (
            <img src={image} alt="The page being reviewed" className="shot" />
          ) : (
            <div className="shot-waiting">
              <span className="shot-waiting-line">Waiting for the page</span>
            </div>
          )}
          <span className="scan" aria-hidden />
        </div>

        <div className="modal-side">
          <p className="eyebrow">{error ? "Stopped" : "Reviewing"}</p>
          <ol className="steps">
            {steps.map((id, index) => (
              <StepRow
                key={id}
                step={{ id, label: STEP_LABELS[id] ?? id }}
                state={
                  error
                    ? index < activeIndex
                      ? "done"
                      : "waiting"
                    : activeIndex === -1
                      ? "waiting"
                      : index < activeIndex
                        ? "done"
                        : index === activeIndex
                          ? "active"
                          : "waiting"
                }
              />
            ))}
          </ol>

          {detail ? <p className="step-detail">{detail}</p> : null}
          {error ? <p className="error modal-error">{error}</p> : null}

          {error ? (
            <button type="button" className="chip modal-close" onClick={onClose}>
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
