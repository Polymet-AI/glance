# The request guard

Glance fetches whatever address it is handed. That is the product, and it is
also the most dangerous thing about it.

A server that fetches arbitrary URLs is a request forgery hole. The attacker's
target is not the public internet, which they can already reach, but everything
the server can reach and they cannot. Running locally that means your own
development services. Running in a cloud it means the metadata endpoint that
hands out credentials.

## What is blocked

Before anything is fetched, `lib/url-guard.ts`:

- requires `http` or `https`, so `file:`, `gopher:` and friends never start
- refuses credentials embedded in the URL
- resolves the hostname, then rejects every private, loopback, link-local,
  carrier-grade NAT, multicast and reserved range, in both address families,
  including IPv4 addresses wearing an IPv6 costume
- checks a literal address directly, skipping the lookup it does not need

## Why it runs more than once

A single check at the front door is not enough, for two reasons that have
nothing to do with each other.

**A redirect can land somewhere the first check never saw.** So the final URL
after navigation is checked again.

**A host can answer differently the second time it is asked.** DNS is not a
promise. So every subresource request the page makes is checked as it goes,
rather than trusting the answer the first lookup gave.

36 cases cover this in `lib/url-guard.test.ts`.

```bash
pnpm test
```

## The extractor injection

The extractor is installed with Playwright's `addInitScript` before navigation,
rather than injected afterwards. This is a correctness requirement, not a
preference: sites with a strict Content Security Policy refuse an inline script
tag, and the sites most worth reviewing are exactly the ones that set one.
Stripe rejects the injected form outright.

## What is still open

**There is no rate limit.** The app spends a paid API call per review and runs
a browser per request. That is fine on your own machine and is the first thing
to add before it is reachable by anyone else.

**The key is server-side, but the server is shared.** Anyone who can reach a
deployed instance spends your credits.
