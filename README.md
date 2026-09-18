# Glance

Design review for any URL. Renders the page in a real browser, scores it, and
tells you what to fix first.

Paste an address. The page is loaded in headless Chromium, its design is read
out as structure, and twenty-one questions about it are answered in a single
request in about a tenth of a second. Every answer carries the probability
behind it, so you can see which judgments were confident and which were close.

```text
url ──► guard ──► headless chromium ──► extractor ──► snapshot
                                                          │
                            computed findings ◄───────────┤
                            judged scores    ◄─── model ──┘
```

## What comes back

- **One overall score**, nought to a hundred, with a word for the band it falls
  in: Wireframe, Draft, Competent, Designed, Distinctive.
- **What to fix first**, what is already strongest, and what the screen reads
  as. That last one is the canary: if the page is called a pricing page and it
  comes back a blog post, the snapshot lost too much and the rest is noise.
- **Craft dimensions** scored individually, each with its own confidence and
  the full spread across its levels.
- **Yes or no signals** as probabilities rather than verdicts, including
  whether the page looks like it was generated.
- **Components**, outlined on the capture and reviewed on demand. The page
  review lands first; asking about a component fans out separately, because
  reviewing every one of them costs more than the page itself.
- **A leaderboard**, if you want one. Optional, opt-in per review, and off
  entirely with no database configured. See [`docs/leaderboard.md`](docs/leaderboard.md).

## Running it

```bash
pnpm install
pnpm exec playwright install chromium
```

That second line is easy to forget and not optional. Playwright pins an exact
Chromium build, so a copy already on your machine will not satisfy it.

Copy `.env.example` to `.env.local` and add a key, then start it:

```bash
pnpm dev
```

Keys come from [console.typesafe.ai](https://console.typesafe.ai/settings/keys).
The model is in early access behind a waitlist as of September 2026. Only
`TYPESAFE_API_KEY` is required; the two database variables are optional and
only switch the leaderboard on.

Local only for now. The key lives on the server, so anyone who can reach the
app spends your credits, at roughly four hundredths of a cent a review.

## Why it is built this way

**Split the work into the half that has a right answer and the half that does
not.**

Contrast ratios, tap target sizes and how many distinct spacing values are in
play are arithmetic. They have exactly one correct answer, they can be computed
offline in under a millisecond, and arithmetic is a documented weak spot of the
model. Asking for those is how a review ends up confidently wrong about
something checkable.

What the model is genuinely good at is the judgment no formula gives you:
whether attention lands where it should, whether a screen reads as finished,
whether one designer's hand is visible.

So the computed half is computed in `lib/review/metrics.ts` and only the second
half is asked. That split has a second payoff. The model returns a value and a
probability but **never a reason**, so the computed findings are the only part
of a report that can explain why.

A browser is not optional either. Fetching the HTML gives you markup with no
styles applied, and a design review is made almost entirely of resolved
colours, fonts and boxes, none of which exist until something lays the page
out.

## What the model cannot do

Worth knowing before you build on it. These come from the vendor's docs and
from a skeptical read of the launch.

- **No images.** Text and JSON only. Anything visual arrives already described
  as structure, which is why a real browser does the looking.
- **No arithmetic.** Counting, totals and date comparison are weak. Compute
  them in code.
- **Negations read literally.** Phrase every question positively.
- **No rationale.** A number and a distribution, never an explanation.
- **Accuracy falls as irrelevant context grows.** Filter the state first.
  Bigger is not better.
- **Confidence measures distribution concentration**, not the probability that
  the answer is correct. The vendor's own notes say so. Never render it as
  certainty.
- **Roughly 32k tokens** for state plus the longest question. Fan every
  question out in one request: a tenth question costs tokens but almost no
  time, where ten requests cost ten round trips.

Independent evidence that the confidence numbers track accuracy has not been
published. Treat calibration as a claim to verify on your own data.

## Layout

```text
app/          routes and the page itself
  api/review      render, extract, ask, stream progress back
  api/component   re-review one component on demand
  api/leaderboard read the board
components/   the report, charts, page map and progress modal
lib/
  client/         the model client: one request, many typed answers
  review/         extractor, rubric, computed metrics, report assembly
  render.ts       headless Chromium, capture and extraction
  url-guard.ts    the request forgery guard
  leaderboard.ts  the board
scripts/      the console snippet
docs/         security and leaderboard notes
```

The `@/` prefix resolves from the repo root. The alias is declared twice, in
`tsconfig.json` and `vitest.config.ts`, because Vitest does not read the
TypeScript mapping. Both have to agree or a test resolves a module the type
checker never saw.

## Trying the extractor without a server

Build the console snippet, paste it into devtools on any site, and the snapshot
lands on your clipboard. It uses the same extractor the app does, so what you
test with is what a review would see.

```bash
pnpm snippet          # writes generated/snippet.js
```

```js
glanceSnapshot({ brief: "what this page is meant to be" })
```

## Development

```bash
pnpm install
pnpm type-check
pnpm test
pnpm build
```

Node 20 or newer. Next.js, React, Playwright, Vitest. 129 tests, no network
calls in any of them.

## Known limits

- **Pages behind a sign-in** return whatever a signed-out visitor sees.
- **A gradient background** means contrast cannot be resolved to one colour, so
  those checks are skipped rather than guessed. No contrast findings means
  unknown, not clean.
- **400 elements** is the cap. Past it the report says so rather than quietly
  reviewing part of a page.
- **No rate limit yet.** Fine on your own machine, and the first thing to add
  before this is reachable by anyone else.

## Licence

MIT.
