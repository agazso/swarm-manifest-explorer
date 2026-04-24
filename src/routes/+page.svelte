<script lang="ts">
  import { goto } from '$app/navigation'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { isHex64, normHex, setLastRef, settings } from '$lib/settings.svelte'

  let refInput = $state(settings.lastRef)
  let error = $state('')

  function submit(e: SubmitEvent) {
    e.preventDefault()
    const ref = normHex(refInput)
    if (!isHex64(ref)) {
      error = 'Enter a 64-character hex Swarm reference.'
      return
    }
    error = ''
    setLastRef(ref)
    goto(`/m/${ref}/`)
  }
</script>

<main class="mx-auto max-w-3xl px-5 py-10">
  <Card.Root>
    <Card.Header>
      <Card.Title>Open a Swarm manifest</Card.Title>
      <Card.Description>
        Paste a Mantaray manifest reference to list its files and folders. The manifest is loaded
        from the Bee gateway configured in the header.
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <form class="flex flex-col gap-3" onsubmit={submit}>
        <div class="flex flex-col gap-2">
          <Label for="ref">Manifest reference</Label>
          <Input
            id="ref"
            type="text"
            bind:value={refInput}
            placeholder="64-character hex"
            spellcheck="false"
            autocomplete="off"
            class="font-mono"
          />
        </div>
        {#if error}
          <p class="text-sm text-destructive">{error}</p>
        {/if}
        <div class="flex items-center gap-3">
          <Button type="submit">Open</Button>
          <span class="text-xs text-muted-foreground">
            Gateway: <code class="font-mono">{settings.beeUrl}</code>
          </span>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
</main>
