<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { formatBytes, shortHash } from '$lib/format'
  import {
    openManifest,
    type DirEntry,
    type EntriesCursor,
    type ListingOptions,
    type ManifestSession,
  } from '$lib/manifest'
  import { isHex64, settings, shortRef } from '$lib/settings.svelte'
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import FileIcon from '@lucide/svelte/icons/file'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import HomeIcon from '@lucide/svelte/icons/home'
  import RadioTowerIcon from '@lucide/svelte/icons/radio-tower'
  import { onMount } from 'svelte'

  const PAGE_SIZE = 200

  let ref = $derived(page.params.ref ?? '')
  let path = $derived((page.params.path ?? '').replace(/^\/+|\/+$/g, ''))
  let feedIndexParam = $derived(page.url.searchParams.get('i'))
  let feedIndex = $derived.by(() => {
    if (!feedIndexParam) return undefined
    try {
      return BigInt(feedIndexParam)
    } catch {
      return undefined
    }
  })

  let session = $state<ManifestSession | null>(null)
  let sessionError = $state('')
  let loadingSession = $state(false)

  let cursor: EntriesCursor | null = null
  let cursorToken = 0
  let entries = $state<DirEntry[]>([])
  let options = $state<ListingOptions | null>(null)
  let done = $state(false)
  let loadingBatch = $state(false)
  let listError = $state('')

  let sentinel: HTMLDivElement | undefined = $state()
  let observer: IntersectionObserver | null = null

  $effect(() => {
    const currentRef = ref
    const currentBee = settings.beeUrl
    const idx = feedIndex
    if (!isHex64(currentRef)) {
      sessionError = 'Invalid manifest reference.'
      session = null
      return
    }
    loadingSession = true
    sessionError = ''
    session = null
    openManifest(currentBee, currentRef, idx !== undefined ? { feedIndex: idx } : undefined)
      .then((s) => {
        session = s
        loadingSession = false
      })
      .catch((err: unknown) => {
        sessionError = err instanceof Error ? err.message : String(err)
        loadingSession = false
      })
  })

  $effect(() => {
    const s = session
    const p = path
    if (!s) return
    cursorToken++
    const token = cursorToken
    cursor = s.openListing(p)
    options = cursor.options
    entries = []
    done = false
    listError = ''
    loadBatch(token)
  })

  async function loadBatch(token: number) {
    if (!cursor || loadingBatch || done) return
    loadingBatch = true
    try {
      const batch = await cursor.next(PAGE_SIZE)
      if (token !== cursorToken) return
      entries = entries.concat(batch)
      done = cursor.done
    } catch (err) {
      if (token !== cursorToken) return
      listError = err instanceof Error ? err.message : String(err)
      done = true
    } finally {
      if (token === cursorToken) loadingBatch = false
    }
  }

  onMount(() => {
    observer = new IntersectionObserver(
      (entriesIO) => {
        for (const e of entriesIO) {
          if (e.isIntersecting) loadBatch(cursorToken)
        }
      },
      { rootMargin: '400px 0px' },
    )
    return () => {
      observer?.disconnect()
      observer = null
    }
  })

  $effect(() => {
    if (!observer) return
    if (sentinel) observer.observe(sentinel)
    return () => {
      if (sentinel) observer?.unobserve(sentinel)
    }
  })

  let crumbs = $derived.by(() => {
    if (!path) return [] as { label: string; href: string }[]
    const segs = path.split('/')
    const acc: { label: string; href: string }[] = []
    let joined = ''
    const suffix = feedIndexParam ? `?i=${feedIndexParam}` : ''
    for (const s of segs) {
      joined = joined ? `${joined}/${s}` : s
      acc.push({ label: s, href: `/m/${ref}/${joined}${suffix}` })
    }
    return acc
  })

  let rootHref = $derived(`/m/${ref}/${feedIndexParam ? `?i=${feedIndexParam}` : ''}`)

  function entryHref(entry: DirEntry): string {
    if (entry.isFolder) {
      const suffix = feedIndexParam ? `?i=${feedIndexParam}` : ''
      return `/m/${ref}/${entry.fullPath}${suffix}`
    }
    return session?.fileUrl(entry.fullPath) ?? '#'
  }

  function gotoIndex(n: bigint | undefined) {
    if (n === undefined) return
    const url = n < 0n ? `/m/${ref}/${path}` : `/m/${ref}/${path}?i=${n.toString()}`
    goto(url)
  }

  let feed = $derived(session?.feed ?? null)
  let canPrev = $derived.by(() => {
    if (!feed || feed.currentIndex === undefined) return false
    return feed.currentIndex > 0n
  })
  let canNext = $derived.by(() => {
    if (!feed) return false
    if (feedIndex === undefined) return false
    if (feed.currentIndex === undefined) return false
    return true
  })
</script>

<main class="mx-auto max-w-6xl px-5 py-6">
  <div class="mb-4 flex flex-wrap items-center gap-2 text-xs">
    <Badge variant="outline" class="font-mono">ref · {shortRef(ref)}</Badge>
    {#if session && session.rootRef !== ref}
      <Badge variant="secondary" class="font-mono">
        resolved · {shortRef(session.rootRef)}
      </Badge>
    {/if}
    {#if options?.indexDocument}
      <Badge variant="secondary" class="font-mono">
        index · {options.indexDocument}
      </Badge>
    {/if}
    {#if options?.errorDocument}
      <Badge variant="secondary" class="font-mono">
        error · {options.errorDocument}
      </Badge>
    {/if}
  </div>

  {#if feed}
    <Card.Root class="mb-4">
      <Card.Header>
        <Card.Title class="flex items-center gap-2 text-base">
          <RadioTowerIcon class="size-4" />
          Feed manifest
        </Card.Title>
        <Card.Description>
          This reference is a feed. {feed.type} feed updates are resolved
          {feedIndex === undefined ? 'to the latest update' : `at index ${feedIndex.toString()}`}.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        <dl class="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-[auto_1fr]">
          <dt class="text-muted-foreground">owner</dt>
          <dd class="font-mono break-all">0x{feed.owner}</dd>
          <dt class="text-muted-foreground">topic</dt>
          <dd class="font-mono break-all">0x{feed.topic}</dd>
          <dt class="text-muted-foreground">type</dt>
          <dd class="font-mono">{feed.type}</dd>
          <dt class="text-muted-foreground">current index</dt>
          <dd class="font-mono">
            {feed.currentIndex?.toString() ?? '—'}
            {#if feed.nextIndex !== undefined}
              <span class="text-muted-foreground">· next: {feed.nextIndex.toString()}</span>
            {/if}
          </dd>
          <dt class="text-muted-foreground">resolved ref</dt>
          <dd class="font-mono break-all">{feed.resolvedRef}</dd>
        </dl>
        {#if feed.type === 'Sequence' || feed.type === 'sequence'}
          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!canPrev}
              onclick={() =>
                gotoIndex(
                  feed!.currentIndex !== undefined ? feed!.currentIndex - 1n : undefined,
                )}
            >
              <ChevronLeftIcon class="size-4" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canNext}
              onclick={() =>
                gotoIndex(
                  feed!.currentIndex !== undefined ? feed!.currentIndex + 1n : undefined,
                )}
            >
              Next
              <ChevronRightIcon class="size-4" />
            </Button>
            {#if feedIndex !== undefined}
              <Button size="sm" variant="ghost" onclick={() => gotoIndex(-1n)}>
                Jump to latest
              </Button>
            {/if}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {/if}

  <nav class="mb-4 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
    <a href={rootHref} class="inline-flex items-center gap-1 hover:text-foreground">
      <HomeIcon class="size-4" />
      root
    </a>
    {#each crumbs as crumb (crumb.href)}
      <ChevronRightIcon class="size-4 opacity-50" />
      <a href={crumb.href} class="hover:text-foreground">{crumb.label}</a>
    {/each}
  </nav>

  <Card.Root>
    <Card.Header>
      <Card.Title class="font-mono text-base">/{path}</Card.Title>
      <Card.Description>
        {#if loadingSession}
          Loading root chunk…
        {:else if sessionError}
          <span class="text-destructive">{sessionError}</span>
        {:else if listError}
          <span class="text-destructive">{listError}</span>
        {:else}
          {entries.length}
          {entries.length === 1 ? 'entry' : 'entries'}{done ? ' (complete)' : ' so far…'}
        {/if}
      </Card.Description>
    </Card.Header>
    <Card.Content>
      {#if entries.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th class="py-2 pr-4 font-medium">Name</th>
                <th class="py-2 pr-4 font-medium">Type</th>
                <th class="py-2 pr-4 font-medium">Size</th>
                <th class="py-2 pr-0 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {#each entries as entry (entry.fullPath)}
                <tr class="border-b last:border-b-0 hover:bg-muted/40">
                  <td class="py-2 pr-4">
                    <a
                      href={entryHref(entry)}
                      target={entry.isFolder ? undefined : '_blank'}
                      rel={entry.isFolder ? undefined : 'noopener noreferrer'}
                      class="inline-flex items-center gap-2 hover:text-foreground"
                    >
                      {#if entry.isFolder}
                        <FolderIcon class="size-4 text-muted-foreground" />
                        <span class="font-mono">{entry.name}/</span>
                      {:else}
                        <FileIcon class="size-4 text-muted-foreground" />
                        <span class="font-mono">{entry.name}</span>
                      {/if}
                    </a>
                  </td>
                  <td class="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {entry.isFolder ? 'folder' : (entry.contentType ?? '—')}
                  </td>
                  <td class="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {entry.isFolder ? '' : formatBytes(entry.size)}
                  </td>
                  <td class="py-2 pr-0 font-mono text-xs text-muted-foreground">
                    {entry.reference ? shortHash(entry.reference) : ''}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else if done && !listError && !loadingBatch}
        <p class="text-sm text-muted-foreground">Empty directory.</p>
      {/if}

      {#if !done}
        <div class="mt-4 flex flex-col items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={loadingBatch}
            onclick={() => loadBatch(cursorToken)}
          >
            {loadingBatch ? 'Loading…' : `Load ${PAGE_SIZE} more`}
          </Button>
          <div bind:this={sentinel} class="h-2 w-full" aria-hidden="true"></div>
        </div>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
