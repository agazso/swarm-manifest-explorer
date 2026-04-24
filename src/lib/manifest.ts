// Lazy streaming Mantaray browsing. Only the root chunk is unmarshalled
// up front; child chunks are fetched on demand as the directory walk
// descends. Forks whose prefix already contains `/` emit a folder name
// without fetching the child chunk at all.
//
// `openListing(path)` returns an async cursor that yields entries in
// Mantaray byte order (roughly lexicographic) one batch at a time, so
// folders with millions of entries render and scroll progressively.
// The per-session chunk cache stores *pending promises*, so concurrent
// prefetches at each level coalesce and parallelise the next batch.
//
// Feed manifests are detected via root metadata (swarm-feed-owner /
// swarm-feed-topic / swarm-feed-type) and resolved with a FeedReader;
// the resolved reference becomes the effective root and a FeedInfo is
// exposed so the UI can offer sequential prev/next navigation.

import {
  Bee,
  EthAddress,
  FeedIndex,
  MantarayNode,
  Topic,
  type BeeRequestOptions,
} from '@ethersphere/bee-js'

const CHUNK_TIMEOUT_MS = 20_000

function chunkRequestOptions(): BeeRequestOptions {
  return { timeout: CHUNK_TIMEOUT_MS }
}

export interface DirEntry {
  name: string
  isFolder: boolean
  fullPath: string
  reference?: string
  contentType?: string
  size?: number
}

export interface ListingOptions {
  indexDocument: string | null
  errorDocument: string | null
}

export interface EntriesCursor {
  readonly options: ListingOptions
  readonly done: boolean
  next(limit: number): Promise<DirEntry[]>
}

export type FeedType = 'Sequence' | 'Epoch' | string

export interface FeedInfo {
  owner: string
  topic: string
  type: FeedType
  currentIndex?: bigint
  nextIndex?: bigint
  resolvedRef: string
}

export interface ManifestSession {
  readonly beeUrl: string
  readonly inputRef: string
  readonly rootRef: string
  readonly feed: FeedInfo | null
  openListing(path: string): EntriesCursor
  fileUrl(fullPath: string): string
  /**
   * Returns the byte length of the content referenced by the given 64-char hex
   * Swarm reference. Resolved via a HEAD on `/bytes/{reference}` — cheap, but
   * one network round-trip per call unless cached. Cached per-session.
   */
  probeSize(reference: string): Promise<number>
}

interface SessionState extends ManifestSession {
  bee: Bee
  root: MantarayNode
  cache: Map<string, Promise<MantarayNode>>
}

const decoder = new TextDecoder()
const sessions = new Map<string, Promise<SessionState>>()

function sessionKey(beeUrl: string, ref: string, feedIndex: bigint | undefined): string {
  return `${beeUrl}|${ref}|${feedIndex === undefined ? 'latest' : feedIndex.toString()}`
}

export async function openManifest(
  beeUrl: string,
  inputRef: string,
  opts?: { feedIndex?: bigint },
): Promise<ManifestSession> {
  const key = sessionKey(beeUrl, inputRef, opts?.feedIndex)
  const hit = sessions.get(key)
  if (hit) return hit
  const pending = createSession(beeUrl, inputRef, opts?.feedIndex)
  sessions.set(key, pending)
  try {
    return await pending
  } catch (err) {
    sessions.delete(key)
    throw err
  }
}

async function createSession(
  beeUrl: string,
  inputRef: string,
  feedIndex: bigint | undefined,
): Promise<SessionState> {
  console.debug('[manifest] open', { beeUrl, inputRef, feedIndex: feedIndex?.toString() })
  const bee = new Bee(beeUrl)
  const cache = new Map<string, Promise<MantarayNode>>()
  const sizeCache = new Map<string, Promise<number>>()
  const initial = await MantarayNode.unmarshal(bee, inputRef, undefined, chunkRequestOptions())
  const detected = detectFeed(initial)

  let root = initial
  let rootRef = inputRef
  let urlRef = inputRef
  let feed: FeedInfo | null = null

  if (detected) {
    console.debug('[manifest] feed detected', detected)
    const resolved = await resolveFeed(bee, detected, feedIndex, inputRef)
    feed = resolved.feed
    root = resolved.root
    rootRef = resolved.rootRef
    // Inline-payload feeds store the root Mantaray chunk as the SOC payload,
    // so rootRef isn't retrievable at /bzz/. The original feed manifest ref
    // is — Bee resolves it transparently — so use it for file URLs.
    urlRef = resolved.inline ? inputRef : rootRef
  }
  cache.set(rootRef, Promise.resolve(root))

  const state: SessionState = {
    beeUrl,
    inputRef,
    rootRef,
    feed,
    bee,
    root,
    cache,
    openListing(path: string) {
      return createCursor(state, path)
    },
    fileUrl(fullPath: string) {
      return buildFileUrl(beeUrl, urlRef, fullPath)
    },
    probeSize(reference: string) {
      const key = reference.toLowerCase()
      const hit = sizeCache.get(key)
      if (hit) return hit
      const pending = bee
        .probeData(key, chunkRequestOptions())
        .then((info) => info.contentLength)
      sizeCache.set(key, pending)
      pending.catch(() => {
        if (sizeCache.get(key) === pending) sizeCache.delete(key)
      })
      return pending
    },
  }
  return state
}

function detectFeed(
  root: MantarayNode,
): { owner: string; topic: string; type: FeedType } | null {
  const md = root.getRootMetadata().value
  if (!md) return null
  const owner = normHex(md['swarm-feed-owner'] ?? '')
  const topic = normHex(md['swarm-feed-topic'] ?? '')
  if (owner.length !== 40 || topic.length !== 64) return null
  const type = md['swarm-feed-type'] ?? 'Sequence'
  return { owner, topic, type }
}

async function resolveFeed(
  bee: Bee,
  info: { owner: string; topic: string; type: FeedType },
  feedIndex: bigint | undefined,
  inputRef: string,
): Promise<{ feed: FeedInfo; root: MantarayNode; rootRef: string; inline: boolean }> {
  const reader = bee.makeFeedReader(new Topic(info.topic), new EthAddress(info.owner))
  const opts = feedIndex === undefined ? undefined : { index: FeedIndex.fromBigInt(feedIndex) }
  const result = await reader.download(opts)
  const raw = result.payload.toUint8Array()

  let root: MantarayNode
  let rootRef: string
  let inline: boolean

  if (raw.length === 32 || raw.length === 64) {
    rootRef = bytesToHex(raw)
    root = await MantarayNode.unmarshal(bee, rootRef, undefined, chunkRequestOptions())
    inline = false
  } else {
    // Inline-payload feed: the SOC payload is the root Mantaray chunk itself,
    // not a reference to one. Parse directly from bytes.
    const selfAddress = hexToBytes(inputRef)
    root = MantarayNode.unmarshalFromData(raw, selfAddress)
    rootRef = inputRef
    inline = true
  }

  return {
    feed: {
      owner: info.owner,
      topic: info.topic,
      type: info.type,
      currentIndex: result.feedIndex.toBigInt(),
      nextIndex: result.feedIndexNext?.toBigInt(),
      resolvedRef: rootRef,
    },
    root,
    rootRef,
    inline,
  }
}

function createCursor(state: SessionState, prefix: string): EntriesCursor {
  const docs = state.root.getDocsMetadata()
  const options: ListingOptions = {
    indexDocument: docs.indexDocument,
    errorDocument: docs.errorDocument,
  }
  const iterator = walkEntries(state, prefix)
  let finished = false

  const cursor: EntriesCursor = {
    options,
    get done() {
      return finished
    },
    async next(limit: number) {
      const out: DirEntry[] = []
      if (finished) return out
      while (out.length < limit) {
        const { value, done } = await iterator.next()
        if (done) {
          finished = true
          break
        }
        out.push(value)
      }
      return out
    },
  }
  return cursor
}

function stripLead(s: string): string {
  return s.replace(/^\/+/, '')
}

async function* walkEntries(
  state: SessionState,
  prefix: string,
): AsyncGenerator<DirEntry, void, void> {
  const { bee, root, cache } = state
  const normPrefix = prefix.replace(/^\/+|\/+$/g, '')
  const dPrefix = normPrefix ? `${normPrefix}/` : ''
  const seenFolders = new Set<string>()
  console.debug('[manifest] walk start', { prefix, dPrefix })

  async function* walk(node: MantarayNode, pathSoFar: string): AsyncGenerator<DirEntry> {
    // Kick off concurrent prefetches for any fork that will require its
    // child chunk either for navigation or for file-leaf probing. Fetches
    // populate the cache; the sequential walk below will get cache hits.
    for (const [, fork] of node.forks) {
      const forkStr = decoder.decode(fork.prefix)
      const logical = stripLead(pathSoFar + forkStr)
      if (!wouldNeedChildChunk(logical, dPrefix)) continue
      void ensureLoaded(bee, fork.node, cache)
    }

    for (const [, fork] of node.forks) {
      const forkStr = decoder.decode(fork.prefix)
      const combined = pathSoFar + forkStr
      const logical = stripLead(combined)

      // Still navigating down toward the target folder — the accumulated
      // logical path is shorter than dPrefix and a prefix of it.
      if (dPrefix !== '' && logical.length < dPrefix.length) {
        if (!dPrefix.startsWith(logical)) continue
        const child = await ensureLoaded(bee, fork.node, cache)
        yield* walk(child, combined)
        continue
      }

      // Completely outside the target subtree — skip the whole branch.
      if (dPrefix !== '' && !logical.startsWith(dPrefix)) continue

      const rel = logical.slice(dPrefix.length)
      const slashIdx = rel.indexOf('/')
      if (slashIdx !== -1) {
        const folderName = rel.slice(0, slashIdx)
        if (folderName !== '' && !seenFolders.has(folderName)) {
          seenFolders.add(folderName)
          const entry: DirEntry = {
            name: folderName,
            isFolder: true,
            fullPath: `${dPrefix}${folderName}`,
          }
          console.debug('[manifest] yield folder', entry.fullPath)
          yield entry
        }
        continue
      }

      // rel === '' means this fork lands exactly on the subtree root — no
      // entry to emit, but descend into its children to surface them.
      const inlineMetadata = fork.node.metadata ?? undefined
      const child = await ensureLoaded(bee, fork.node, cache)
      if (rel !== '' && isFileLeaf(child)) {
        const md = inlineMetadata ?? child.metadata ?? undefined
        const entry: DirEntry = {
          name: rel,
          isFolder: false,
          fullPath: `${dPrefix}${rel}`,
          reference: bytesToHex(child.targetAddress),
          contentType: md?.['Content-Type'],
          size: parseSize(md?.['Content-Length']),
        }
        console.debug('[manifest] yield file', entry.fullPath)
        yield entry
      }
      if (child.forks.size > 0) {
        yield* walk(child, combined)
      }
    }
  }

  yield* walk(root, '')
  console.debug('[manifest] walk done', { prefix })
}

function wouldNeedChildChunk(logical: string, dPrefix: string): boolean {
  if (dPrefix === '') return !logical.includes('/')
  if (logical.length < dPrefix.length) return dPrefix.startsWith(logical)
  if (!logical.startsWith(dPrefix)) return false
  return !logical.slice(dPrefix.length).includes('/')
}

function ensureLoaded(
  bee: Bee,
  node: MantarayNode,
  cache: Map<string, Promise<MantarayNode>>,
): Promise<MantarayNode> {
  if (node.forks.size > 0) return Promise.resolve(node)
  if (!node.selfAddress) return Promise.resolve(node)
  const key = bytesToHex(node.selfAddress)
  const cached = cache.get(key)
  if (cached) return cached
  console.debug('[manifest] fetch', key)
  const pending = MantarayNode.unmarshal(bee, node.selfAddress, undefined, chunkRequestOptions())
  cache.set(key, pending)
  // Self-heal the cache if the fetch fails so a later retry gets a fresh attempt;
  // the attached no-op handler also prevents unhandled-rejection noise when a
  // prefetch's result is never consumed.
  pending.catch(() => {
    if (cache.get(key) === pending) cache.delete(key)
  })
  return pending
}

function isFileLeaf(node: MantarayNode): boolean {
  for (const b of node.targetAddress) {
    if (b !== 0) return true
  }
  return false
}

function buildFileUrl(beeUrl: string, urlRef: string, fullPath: string): string {
  const base = beeUrl.replace(/\/+$/, '')
  const encoded = fullPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `${base}/bzz/${urlRef}/${encoded}`
}

export function parentPath(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx === -1 ? '' : trimmed.slice(0, idx)
}

function normHex(s: string): string {
  return s.trim().toLowerCase().replace(/^0x/, '')
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function parseSize(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const n = parseInt(raw, 10)
  return Number.isFinite(n) ? n : undefined
}
