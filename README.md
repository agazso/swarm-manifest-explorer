# Swarm Manifest Explorer

A small web app for browsing the files and folders stored in a
[Swarm](https://www.ethswarm.org) Mantaray manifest. Paste a manifest reference,
point at a Bee gateway, and navigate the directory tree like a file browser.

Also handles **feed manifests** — the reference can be a feed root, in which
case the app resolves the feed, displays owner / topic / current index, and
lets you step through prior updates of a sequential feed.

## Quick start

```bash
pnpm install
pnpm dev          # http://localhost:5319
pnpm check        # svelte-check (type check)
pnpm build        # static build via @sveltejs/adapter-static
```

Default Bee gateway is `https://api.gateway.ethswarm.org`. Change it from the
input in the page header — it persists in `localStorage`.

## Usage

- **`/`** — paste a 64-character hex manifest reference and press Open.
- **`/m/<ref>/`** — root listing for the manifest.
- **`/m/<ref>/<path>`** — drill into subfolders.
- **`/m/<ref>/?i=<n>`** — when the reference is a feed manifest, pin to a
  specific sequential update instead of latest.

Folder rows navigate; file rows open `/bzz/<ref>/<path>` in a new tab via the
configured gateway.

## How it works

- **Lazy manifest walk.** Only the root Mantaray chunk is unmarshalled up
  front. Child chunks are fetched on demand as the listing descends. Forks
  whose prefix already contains `/` emit a folder name without any extra
  network round-trip.
- **Streaming cursor.** `session.openListing(path)` returns an `EntriesCursor`
  that yields a batch of entries per call. The UI paginates with `PAGE_SIZE =
  200` and uses an IntersectionObserver sentinel for auto-load on scroll, so
  folders with millions of entries stay responsive.
- **Per-session chunk cache.** Pending-promise cache keyed by chunk address —
  prefetches at each level coalesce with later awaits and navigation within
  the same manifest reuses chunks for free.
- **Feed manifest detection.** `MantarayNode.getRootMetadata()` is consulted
  for `swarm-feed-owner` / `swarm-feed-topic` / `swarm-feed-type`. If present,
  the feed is resolved via `bee.makeFeedReader(...).downloadReference(...)`
  and the returned reference becomes the effective root.
- **Lazy file-size probes.** File sizes aren't in manifest metadata; they come
  from `bee.probeData(ref)` (a HEAD on `/bytes/<ref>`). Probes fire after each
  batch commits, update the table reactively as they resolve, and cache
  per-session so navigation doesn't re-probe.
- **Chunk-fetch timeout.** Every `MantarayNode.unmarshal` and `probeData`
  request carries a 20 s timeout so a stalled gateway surfaces as an actionable
  error instead of a silent hang.

## Project layout

```
src/
├── app.css                              # Tailwind v4 + OKLCh theme tokens
├── app.html
├── app.d.ts
├── lib/
│   ├── manifest.ts                      # MantarayNode wrapper: session, cursor,
│   │                                    #   feed detection, probeSize
│   ├── settings.svelte.ts               # beeUrl + lastRef (localStorage)
│   ├── format.ts                        # shortHash, formatBytes
│   ├── utils.ts                         # cn()
│   └── components/ui/                   # shadcn-svelte: button, card, input,
│                                        #   label, badge, separator
└── routes/
    ├── +layout.svelte                   # header + gateway input
    ├── +page.svelte                     # home: paste a ref
    └── m/[ref]/[...path]/+page.svelte   # listing + feed panel + breadcrumb
```

## Stack

SvelteKit 5 + Vite, TypeScript strict, Tailwind CSS 4
(`@tailwindcss/vite`), [shadcn-svelte](https://shadcn-svelte.com) via
`bits-ui`, `@lucide/svelte` icons, and
[`@ethersphere/bee-js`](https://github.com/ethersphere/bee-js) ^11.2 for all
Swarm interaction.

UI theme and TypeScript patterns adapted from the FullCircle explorer at
`../fullcircle-research/packages/explorer`.
