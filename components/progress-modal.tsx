"use client"

import { useEffect } from "react"

/**
 * What the server is doing, while it does it.
 *
 * Every line here is reported by the server as that step begins, so the modal
 * never claims progress it has not been told about.
 *
 * It does not open until there is a page to show. The first capture is taken
 * the moment navigation resolves rather than after the settle, so the page is
 * on screen about as soon as the browser has it, and the modal never holds an
 * empty frame while the page is already loaded behind it.
 *
 * Once the whole-page capture arrives the frame pans down it, which is both
 * the honest picture of what the server is doing and the most interesting
 * thing to look at while it does it.
 */

export const STEP_ORDER: readonly { id: string; label: string }[] = [
  { id: "checking", label: "Checking the address" },
  { id: "launching", label: "Starting a browser" },
  { id: "loading", label: "Loading the page" },
  { id: "glimpse", label: "First look" },
  { id: "settling", label: "Waiting for fonts and late paint" },
  { id: "captured", label: "Capturing the viewport" },
  { id: "mapping", label: "Capturing the whole page" },
  { id: "extracting", label: "Reading the design as structure" },
  { id: "asking", label: "Asking the model" },
]

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
  currentStep,
  detail,
  image,
  pageImage,
  pageWidth,
  pageHeight,
  error,
  onClose,
}: {
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

  const activeIndex = STEP_ORDER.findIndex((step) => step.id === currentStep)

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
          ) : (
            <img src={image ?? ""} alt="The page being reviewed" className="shot" />
          )}
          <span className="scan" aria-hidden />
        </div>

        <div className="modal-side">
          <p className="eyebrow">{error ? "Stopped" : "Reviewing"}</p>
          <ol className="steps">
            {STEP_ORDER.map((step, index) => (
              <StepRow
                key={step.id}
                step={step}
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
