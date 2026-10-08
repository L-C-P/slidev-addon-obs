<script setup lang="ts">
import type { ObsOptions } from './obs'
import { configs, useNav } from '@slidev/client'
import { computed, onUnmounted, watch } from 'vue'
import { ObsConnection, parseDelay, resolveObsConfig } from './obs'

const options = (configs as { obs?: ObsOptions }).obs
const { slides, currentSlideNo, isPresenter, isPlaying, isPrintMode, isEmbedded } = useNav()

const active = computed(() => {
  if (!options || options.enabled === false || isPrintMode.value || isEmbedded.value)
    return false
  const trigger = options.trigger ?? 'all'
  if (trigger === 'presenter')
    return isPresenter.value
  if (trigger === 'play')
    return isPlaying.value
  return isPresenter.value || isPlaying.value
})

const scene = computed(() => {
  const first = options?.inherit === false ? currentSlideNo.value - 1 : 0
  for (let i = currentSlideNo.value - 1; i >= first; i--) {
    const name = slides.value[i]?.meta?.slide?.frontmatter?.obsScene
    if (name != null && name !== '')
      return String(name)
  }
  return undefined
})

let connection: ObsConnection | undefined
let delayTimer: ReturnType<typeof setTimeout> | undefined
let delayedScene: string | undefined

function cancelDelayedScene() {
  clearTimeout(delayTimer)
  delayedScene = undefined
}

// Leaving a slide before its delay has elapsed switches right away
function flushDelayedScene() {
  const sceneName = delayedScene
  cancelDelayedScene()
  if (sceneName)
    connection?.setScene(sceneName)
}

watch([active, scene, currentSlideNo], ([isActive, sceneName, slideNo], previous) => {
  const [wasActive, previousScene, previousSlideNo] = previous ?? []
  if (!isActive) {
    cancelDelayedScene()
    connection?.dispose()
    connection = undefined
    return
  }
  connection ??= new ObsConnection(resolveObsConfig(options!, window.location))
  if (slideNo !== previousSlideNo)
    flushDelayedScene()
  if (wasActive && sceneName === previousScene)
    return

  if (!sceneName) {
    connection.connect()
    return
  }

  // The delay only applies when navigating forward
  const forward = wasActive && previousSlideNo != null && slideNo > previousSlideNo
  const delay = forward ? parseDelay(slides.value[slideNo - 1]?.meta?.slide?.frontmatter?.obsSceneDelay) : 0
  if (delay > 0) {
    connection.connect()
    delayedScene = sceneName
    delayTimer = setTimeout(flushDelayedScene, delay)
  }
  else {
    connection.setScene(sceneName)
  }
}, { immediate: true })

onUnmounted(() => {
  cancelDelayedScene()
  connection?.dispose()
})
</script>

<template>
  <span v-if="false" />
</template>
