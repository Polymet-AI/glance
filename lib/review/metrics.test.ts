import { describe, expect, it } from "vitest"

import { computeFindings, contrastRatio, parseColor, parseFont } from "./metrics"
import type { DesignSnapshot } from "./types"

const snapshotOf = ({ elements, viewport }: Partial<DesignSnapshot>): DesignSnapshot => ({
  viewport: viewport ?? { w: 1440, h: 900 },
  elements: elements ?? [],
})

describe("parseColor", () => {
  const cases = [
    { input: "#fff", output: { r: 255, g: 255, b: 255, a: 1 } },
    { input: "#000000", output: { r: 0, g: 0, b: 0, a: 1 } },
    { input: "#6E56CF", output: { r: 110, g: 86, b: 207, a: 1 } },
    { input: "#6E56CF80", output: { r: 110, g: 86, b: 207, a: 128 / 255 } },
    { input: "rgb(12, 34, 56)", output: { r: 12, g: 34, b: 56, a: 1 } },
    { input: "rgba(12, 34, 56, 0.5)", output: { r: 12, g: 34, b: 56, a: 0.5 } },
    { input: "transparent", output: { r: 0, g: 0, b: 0, a: 0 } },
    { input: "hsl(200 50% 50%)", output: null },
    { input: "radial-gradient(circle, #241B4D 0%, #0A0711 60%)", output: null },
  ]

  cases.forEach(({ input, output }) => {
    it(`parses ${input}`, () => {
      expect(parseColor({ value: input })).toEqual(output)
    })
  })
})

describe("contrastRatio", () => {
  it("returns 21 for black on white", () => {
    const ratio = contrastRatio({
      foreground: { r: 0, g: 0, b: 0 },
      background: { r: 255, g: 255, b: 255 },
    })
    expect(Number(ratio.toFixed(2))).toBe(21)
  })

  it("returns 1 for a colour against itself", () => {
    const ratio = contrastRatio({
      foreground: { r: 110, g: 86, b: 207 },
      background: { r: 110, g: 86, b: 207 },
    })
    expect(Number(ratio.toFixed(2))).toBe(1)
  })
})

describe("parseFont", () => {
  it("reads size and weight from a compact summary", () => {
    expect(parseFont({ font: "Inter 16/600" })).toEqual({ size: 16, weight: 600 })
  })

  it("defaults the weight when none is given", () => {
    expect(parseFont({ font: "Geist 14" })).toEqual({ size: 14, weight: 400 })
  })
})

describe("computeFindings", () => {
  it("flags body text under the 4.5:1 floor", () => {
    const findings = computeFindings({
      snapshot: snapshotOf({
        elements: [
          { tag: "div", box: [0, 0, 400, 200], bg: "#12151E", container: true },
          {
            tag: "p",
            text: "Simple pricing. No hidden fees.",
            box: [10, 10, 300, 20],
            fg: "#6B7080",
            font: "Inter 16/400",
          },
        ],
      }),
    })

    const contrast = findings.filter((finding) => finding.kind === "contrast")
    expect(contrast).toHaveLength(1)
    expect(contrast[0]?.severity).toBe("fail")
    expect(contrast[0]?.count).toBe(1)
    expect(contrast[0]?.elementIndexes).toEqual([1])
  })

  it("accepts large bold text at the lower 3:1 floor", () => {
    const findings = computeFindings({
      snapshot: snapshotOf({
        elements: [
          { tag: "div", box: [0, 0, 400, 200], bg: "#12151E", container: true },
          {
            tag: "h1",
            text: "Pricing",
            box: [10, 10, 300, 40],
            fg: "#7E8596",
            font: "Inter 32/700",
          },
        ],
      }),
    })

    expect(findings.filter((finding) => finding.kind === "contrast")).toHaveLength(0)
  })

  it("resolves a transparent background from the containing element", () => {
    const findings = computeFindings({
      snapshot: snapshotOf({
        elements: [
          { tag: "div", box: [0, 0, 400, 200], bg: "#FFFFFF", container: true },
          {
            tag: "span",
            text: "Nearly invisible",
            box: [10, 10, 200, 20],
            fg: "#F2F2F2",
            bg: "transparent",
            font: "Inter 14/400",
          },
        ],
      }),
    })

    expect(findings.filter((finding) => finding.kind === "contrast")).toHaveLength(1)
  })

  it("warns on an interactive element under the tap-target minimum", () => {
    const findings = computeFindings({
      snapshot: snapshotOf({
        elements: [{ tag: "button", text: "Sign in", box: [0, 0, 88, 32], interactive: true }],
      }),
    })

    const tapTargets = findings.filter((finding) => finding.kind === "tap-target")
    expect(tapTargets).toHaveLength(1)
    expect(tapTargets[0]?.severity).toBe("warn")
  })

  it("leaves a large enough target alone", () => {
    const findings = computeFindings({
      snapshot: snapshotOf({
        elements: [{ tag: "button", text: "Sign in", box: [0, 0, 120, 48], interactive: true }],
      }),
    })

    expect(findings.filter((finding) => finding.kind === "tap-target")).toHaveLength(0)
  })

  it("flags an element extending past the viewport", () => {
    const findings = computeFindings({
      snapshot: snapshotOf({
        viewport: { w: 400, h: 800 },
        elements: [{ tag: "div", box: [100, 0, 420, 40], container: true }],
      }),
    })

    const overflow = findings.filter((finding) => finding.kind === "overflow")
    expect(overflow).toHaveLength(1)
    expect(overflow[0]?.message).toContain("120 pixels past")
  })

  it("warns once the type scale runs past eight distinct sizes", () => {
    const elements = [11, 12, 13, 14, 15, 16, 18, 20, 24].map((size, index) => ({
      tag: "p",
      text: `Line ${index}`,
      box: [0, index * 24, 200, 20] as [number, number, number, number],
      fg: "#000000",
      font: `Inter ${size}/400`,
    }))

    const findings = computeFindings({ snapshot: snapshotOf({ elements }) })
    expect(findings.filter((finding) => finding.kind === "type-scale")).toHaveLength(1)
  })

  it("returns nothing for a snapshot with no elements", () => {
    expect(computeFindings({ snapshot: snapshotOf({}) })).toEqual([])
  })
})

describe("translucent and undeterminable backgrounds", () => {
  it("composites a translucent card over the page colour instead of treating it as solid", () => {
    // 3% white over a near-black page is still near-black, so pale text passes.
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "#0A0711" },
      elements: [
        { tag: "div", box: [0, 0, 400, 300], bg: "rgba(244, 241, 234, 0.03)", container: true },
        {
          tag: "span",
          text: "$49",
          box: [20, 20, 120, 60],
          fg: "#F4F1EA",
          font: "Instrument Serif 56/400",
        },
      ],
    }

    expect(computeFindings({ snapshot }).filter((finding) => finding.kind === "contrast")).toEqual([])
  })

  it("skips the check when the background is a gradient it cannot resolve", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "radial-gradient(circle, #241B4D 0%, #0A0711 60%)" },
      elements: [
        { tag: "p", text: "Over a gradient", box: [0, 0, 300, 20], fg: "#8E8779", font: "Geist 14/400" },
      ],
    }

    expect(computeFindings({ snapshot }).filter((finding) => finding.kind === "contrast")).toEqual([])
  })

  it("skips the check when nothing opaque is ever reached", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      elements: [
        { tag: "p", text: "Floating", box: [0, 0, 300, 20], fg: "#EEEEEE", font: "Geist 14/400" },
      ],
    }

    expect(computeFindings({ snapshot }).filter((finding) => finding.kind === "contrast")).toEqual([])
  })

  it("still catches pale text on an opaque dark card", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "#0B0D12" },
      elements: [
        { tag: "div", box: [0, 0, 400, 300], bg: "#12151E", container: true },
        { tag: "p", text: "Muted body copy", box: [20, 20, 300, 20], fg: "#6B7080", font: "Inter 14/400" },
      ],
    }

    const contrast = computeFindings({ snapshot }).filter((finding) => finding.kind === "contrast")
    expect(contrast).toHaveLength(1)
    expect(contrast[0]?.severity).toBe("fail")
  })
})

describe("grouping", () => {
  const manyGreyLinks = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      tag: "a",
      text: `Story ${index}`,
      box: [0, index * 20, 200, 16] as [number, number, number, number],
      fg: "#828282",
      font: "Verdana 13/400",
      interactive: true,
    }))

  it("folds one colour pair failing many times into a single finding", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "#f6f6ef" },
      elements: manyGreyLinks(180),
    }

    const contrast = computeFindings({ snapshot }).filter((finding) => finding.kind === "contrast")

    expect(contrast).toHaveLength(1)
    expect(contrast[0]?.count).toBe(180)
    expect(contrast[0]?.message).toMatch(/#828282 on #f6f6ef/)
    expect(contrast[0]?.message).toMatch(/180 elements/)
  })

  it("names a few examples without listing every element", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "#f6f6ef" },
      elements: manyGreyLinks(180),
    }

    const contrast = computeFindings({ snapshot })[0]
    expect(contrast?.examples).toEqual(['"Story 0"', '"Story 1"', '"Story 2"'])
    expect(contrast?.elementIndexes.length).toBe(50)
  })

  it("keeps two different colour pairs apart", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "#ffffff" },
      elements: [
        { tag: "p", text: "pale grey", box: [0, 0, 200, 16], fg: "#bbbbbb", font: "Inter 14/400" },
        { tag: "p", text: "pale grey too", box: [0, 20, 200, 16], fg: "#bbbbbb", font: "Inter 14/400" },
        { tag: "p", text: "pale yellow", box: [0, 40, 200, 16], fg: "#dddd66", font: "Inter 14/400" },
      ],
    }

    const contrast = computeFindings({ snapshot }).filter((finding) => finding.kind === "contrast")
    expect(contrast).toHaveLength(2)
    // Ordered by how many elements each affects.
    expect(contrast.map((finding) => finding.count)).toEqual([2, 1])
  })

  it("reads naturally when only one element fails", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      theme: { bg: "#ffffff" },
      elements: [
        { tag: "p", text: "Lonely", box: [0, 0, 200, 16], fg: "#bbbbbb", font: "Inter 14/400" },
      ],
    }

    const finding = computeFindings({ snapshot })[0]
    expect(finding?.count).toBe(1)
    expect(finding?.message).toMatch(/^"Lonely" sits at/)
    expect(finding?.message).not.toMatch(/elements, including/)
  })

  it("folds every small tap target into one finding naming the tightest", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 1440, h: 900 },
      elements: [
        { tag: "a", text: "One", box: [0, 0, 64, 16], interactive: true },
        { tag: "a", text: "Two", box: [0, 20, 40, 16], interactive: true },
        { tag: "a", text: "Three", box: [0, 40, 80, 20], interactive: true },
      ],
    }

    const tap = computeFindings({ snapshot }).filter((finding) => finding.kind === "tap-target")
    expect(tap).toHaveLength(1)
    expect(tap[0]?.count).toBe(3)
    expect(tap[0]?.message).toMatch(/tightest 40 by 16/)
  })

  it("folds every overflowing element into one finding naming the furthest", () => {
    const snapshot: DesignSnapshot = {
      viewport: { w: 400, h: 800 },
      elements: [
        { tag: "div", box: [100, 0, 420, 40], bg: "#eee", container: true },
        { tag: "div", box: [100, 40, 380, 40], bg: "#eee", container: true },
      ],
    }

    const overflow = computeFindings({ snapshot }).filter((finding) => finding.kind === "overflow")
    expect(overflow).toHaveLength(1)
    expect(overflow[0]?.count).toBe(2)
    expect(overflow[0]?.message).toMatch(/furthest by 120 pixels/)
  })
})
