"use client"

import { useEffect, useRef } from "react"
import type { DesignSection, SectionReview } from "@/lib/review"

/**
 * The rendered page, with each component outlined on it.
 *
 * An image rather than the live site, because the sites most worth reviewing
 * refuse to be framed: Stripe, Linear and most serious products set headers
 * that forbid it, and a cross-origin frame could not be measured or overlaid
 * even where it loads. So the page is captured at half raster scale, which
 * leaves every CSS measurement intact, and the component boxes are drawn over
 * it at their real proportions.
 *
 * It has two sizes. Full width while the components are still unreviewed, so
 * the page itself is the thing on screen; a rail once the results arrive, so
 * the cards have room beside it.
 */

const bandClass = ({ value }: { value: number }): string => {
  if (value >= 70) return "is-high"
  if (value >= 45) return "is-mid"
  return "is-low"
}

export const PageMap = ({
  image,
  pageWidth,
  pageHeight,
  sections,
  reviews,
  activeId,
  variant,
  onHover,
  onPick,
}: {
  image: string
  pageWidth: number
  pageHeight: number
  sections: readonly DesignSection[]
  reviews: readonly SectionReview[]
  activeId: string | null
  variant: "full" | "rail"
  onHover: (id: string | null) => void
  onPick: (id: string) => void
}) => {
  const frameRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // A component can sit below what the capture reached, on a page that scrolls
  // inside a container the browser refused to unpin. Drawing its box anyway
  // puts an outline over empty space, so those are counted and named instead.
  const drawn = sections.filter((section) => section.box[1] < pageHeight)
  const missed = sections.length - drawn.length
  const reviewById = new Map(reviews.map((review) => [review.id, review]))

  // Follow the selection: hovering a row far down the list should bring its
  // region into view rather than leaving the reader to find it.
  useEffect(() => {
    if (!activeId || !activeRef.current || !frameRef.current) return
    const frame = frameRef.current
    const target = activeRef.current
    const wanted = target.offsetTop - frame.clientHeight / 2 + target.clientHeight / 2
    frame.scrollTo({ top: Math.max(0, wanted), behavior: "smooth" })
  }, [activeId])

  return (
    <div className={variant === "full" ? "map is-full" : "map is-rail"}>
      <div className="map-frame" ref={frameRef}>
        <div className="map-inner" style={{ aspectRatio: `${pageWidth} / ${pageHeight}` }}>
          <img src={image} alt="The whole page" className="map-shot" />

          {drawn.map((section) => {
            const [x, y, width, height] = section.box
            const isActive = section.id === activeId
            const review = reviewById.get(section.id)
            return (
              <button
                key={section.id}
                type="button"
                ref={isActive ? activeRef : null}
                className={isActive ? "map-box is-active" : "map-box"}
                style={{
                  left: `${(x / pageWidth) * 100}%`,
                  top: `${(y / pageHeight) * 100}%`,
                  width: `${(width / pageWidth) * 100}%`,
                  height: `${(Math.min(height, pageHeight - y) / pageHeight) * 100}%`,
                }}
                onMouseEnter={() => onHover(section.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(section.id)}
                onBlur={() => onHover(null)}
                onClick={() => onPick(section.id)}
                aria-label={
                  review
                    ? `${review.kind.replace(/_/g, " ")}: ${section.label}`
                    : `Review ${section.label}`
                }
              >
                <span className="map-tag">
                  <span className="map-tag-kind">
                    {review ? review.kind.replace(/_/g, " ") : section.tag}
                  </span>
                  {review?.overall ? (
                    <span className={`map-tag-score ${bandClass({ value: review.overall.value })}`}>
                      {review.overall.value.toFixed(0)}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <p className="map-note">
        {drawn.length} of {sections.length} components · {pageWidth}×{pageHeight} captured
        {missed > 0 ? (
          <>
            <br />
            {missed} sit below what could be captured. This page scrolls inside a container, so only
            the first screen renders.
          </>
        ) : null}
      </p>
    </div>
  )
}
