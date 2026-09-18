# The leaderboard

Optional. Set both of these and reviews can be recorded and shown, best first,
on the landing page. Leave them unset and the feature reports itself off and
the section never renders, so a fresh clone needs no database.

```
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

## Nothing is published unless the reader asks

A checkbox sits above the Review button, labelled with what it does. It is
asked before the review runs rather than after, because a URL on a public board
cannot be taken back.

The server treats anything other than an explicit `true` as private, so a
request with the field missing or malformed records nothing. Publishing a URL
is not undoable, so it is never the right answer to a field the server could
not read. Unchecked, the review runs and reports in full and the board is not
even re-read.

The box starts checked, on the reasoning that the reviewed pages are public
sites and the board is the point of the demo. The label names the consequence
and calls out staging and preview URLs, which is the case where a default-on
board would otherwise leak something. Flip the initial value in
`components/review-form.tsx` to start it off.

## Three rules hold the store up

All in `lib/leaderboard.ts`.

- **A score is never accepted from the browser.** The server writes an entry
  only after it has run the review itself. A board anyone can post to is a
  board anyone can stuff.
- **A page's score is the mean of every review it has had, not the latest.**
  The model's answers move by a couple of tenths between runs, so keeping the
  latest would let anyone press until they liked the number. The sample count
  is stored and shown beside the score for the same reason.
- **A page is identified by host and path, lowercased, without the query or
  the fragment.** Query strings are where session tokens and tracking ids live,
  and a public board should not hold them. It also gives one page one row
  rather than a row per campaign parameter.

## Shape and failure

Two keys: `glance:board` is a sorted set holding the running mean, and
`glance:entries` is a hash holding each row's detail as JSON. A read is two
round trips regardless of how many rows come back, rather than one per row.

The tail is dropped past 500 entries, lowest scores first, so a busy week
cannot grow the store without limit.

A write that fails is logged and swallowed. A board outage must never cost the
reader their review.

22 cases cover this in `lib/leaderboard.test.ts`, against an in-memory stand-in
for the two keys.

## Why the landing page is dynamic

The rows are read on the server and arrive inside the page's HTML, so the board
is there on the first paint rather than a moment after it. That costs the
landing page its static render.

It could not be cached anyway. The database client sends every command with
`no-store`, correctly, because a cached read would hand a stale total to the
next review and corrupt the running mean. A `revalidate` on the page has no
effect for that reason, which is worth knowing before someone adds one back.

Nothing is fetched on mount, for the same cost reason: one database read per
view rather than two. The board is pulled again only when a review lands and
actually changes it.
