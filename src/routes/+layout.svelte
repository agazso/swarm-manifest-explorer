<script lang="ts">
  import '../app.css'
  import { Badge } from '$lib/components/ui/badge'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { setBeeUrl, settings } from '$lib/settings.svelte'
  import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'

  let { children } = $props()

  let beeInput = $state(settings.beeUrl)

  function onBeeBlur() {
    if (beeInput.trim() !== settings.beeUrl) setBeeUrl(beeInput)
  }
</script>

<div class="min-h-screen bg-background text-foreground">
  <header
    class="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
  >
    <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-3">
      <a href="/" class="flex items-center gap-2 text-sm font-semibold">
        <span
          class="inline-flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground"
        >
          <FolderTreeIcon class="size-4" />
        </span>
        <span>Swarm Manifest Explorer</span>
      </a>

      <div class="flex flex-1 items-center justify-end gap-2">
        <Label for="bee-url" class="text-xs text-muted-foreground">Bee gateway</Label>
        <Input
          id="bee-url"
          type="url"
          class="max-w-xs font-mono text-xs"
          bind:value={beeInput}
          onblur={onBeeBlur}
          placeholder="http://localhost:1633"
          spellcheck="false"
        />
      </div>
    </div>

    <div class="border-t">
      <div
        class="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-5 py-1.5 text-xs text-muted-foreground"
      >
        <Badge variant="outline" class="font-mono">
          bee · {settings.beeUrl.replace(/^https?:\/\//, '')}
        </Badge>
      </div>
    </div>
  </header>

  {@render children()}

  <footer class="mt-10 border-t">
    <div
      class="mx-auto flex max-w-6xl flex-col items-center gap-2 px-5 py-6 text-sm text-muted-foreground"
    >
      <p class="text-center text-xs">Swarm Mantaray manifest browser · Don't trust, verify!</p>
    </div>
  </footer>
</div>
