//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  getCurrentScope,
  inject,
  onScopeDispose,
  provide,
  ref,
  shallowRef,
  toValue,
  watch,
} from 'vue'

import { useCloudProfileStore } from '@/store/cloudProfile'

import { useApi } from '@/composables/useApi'

const cloudProfileInjectionKey = Symbol('cloud-profile')

function assertFullNamespacedCloudProfile (cloudProfile, namespace, name) {
  if (cloudProfile?.kind !== 'NamespacedCloudProfile' || !cloudProfile.status?.cloudProfileSpec) {
    throw new Error(
      `NamespacedCloudProfile ${namespace}/${name} status did not contain an effective cloudProfileSpec`,
    )
  }
  return cloudProfile
}

/**
 * Loads one complete/effective NamespacedCloudProfile without retaining it globally.
 *
 * @param {object} cloudProfileRef - NamespacedCloudProfile reference
 * @param {string} namespace - NamespacedCloudProfile namespace
 * @param {object} options - API dependency and abort signal
 * @returns {Promise<object|null>} Full NamespacedCloudProfile or null for an invalid reference
 */
function loadFullNamespacedCloudProfile (cloudProfileRef, namespace, options) {
  const {
    api,
    signal,
  } = options

  if (cloudProfileRef?.kind !== 'NamespacedCloudProfile' || !cloudProfileRef.name || !namespace) {
    return Promise.resolve(null)
  }

  const { name } = cloudProfileRef
  return api.getNamespacedCloudProfileStatus({
    name,
    namespace,
    ...(signal && { signal }),
  }).then(response => assertFullNamespacedCloudProfile(response.data, namespace, name))
}

/**
 * Resolves a complete/effective CloudProfile for the supplied reference.
 *
 * Regular CloudProfiles are returned synchronously from the Pinia store.
 * NamespacedCloudProfiles are loaded from their status subresource and remain
 * local to the composable's scope.
 *
 * @param {object} cloudProfileRef - Maybe-ref CloudProfile reference
 * @param {string} namespace - Maybe-ref namespace used to resolve a NamespacedCloudProfile
 * @param {object} options - Optional dependencies and activation state
 * @returns {object} Full CloudProfile state and reload function
 */
export function useCloudProfile (cloudProfileRef, namespace, options = {}) {
  const {
    api = useApi(),
    cloudProfileStore = useCloudProfileStore(),
    enabled = true,
  } = options

  const cloudProfile = shallowRef(null)
  const isLoading = ref(false)
  const error = shallowRef(null)

  let abortController
  let currentLoadPromise = Promise.resolve(null)
  let generation = 0
  let disposed = false

  function release () {
    generation++
    abortController?.abort()
    abortController = undefined
    cloudProfile.value = null
    error.value = null
    isLoading.value = false
    currentLoadPromise = Promise.resolve(null)
  }

  function resolveTarget () {
    const resolvedCloudProfileRef = toValue(cloudProfileRef)
    const resolvedNamespace = toValue(namespace)

    if (resolvedCloudProfileRef?.kind === 'CloudProfile') {
      return {
        kind: resolvedCloudProfileRef.kind,
        name: resolvedCloudProfileRef.name,
        resource: cloudProfileStore.cloudProfileByRef(resolvedCloudProfileRef),
      }
    }

    if (resolvedCloudProfileRef?.kind === 'NamespacedCloudProfile') {
      return {
        kind: resolvedCloudProfileRef.kind,
        name: resolvedCloudProfileRef.name,
        namespace: resolvedNamespace,
      }
    }

    return {
      kind: resolvedCloudProfileRef?.kind,
      name: resolvedCloudProfileRef?.name,
      namespace: resolvedNamespace,
      resource: null,
    }
  }

  function load (target = resolveTarget()) {
    if (!toValue(enabled)) {
      release()
      return currentLoadPromise
    }

    const requestGeneration = ++generation
    abortController?.abort()
    abortController = undefined

    error.value = null
    isLoading.value = false

    if (disposed) {
      currentLoadPromise = Promise.resolve(null)
      return currentLoadPromise
    }

    if (target.kind === 'CloudProfile') {
      cloudProfile.value = target.resource ?? null
      currentLoadPromise = Promise.resolve(cloudProfile.value)
      return currentLoadPromise
    }

    cloudProfile.value = null
    if (target.kind !== 'NamespacedCloudProfile') {
      currentLoadPromise = Promise.resolve(null)
      return currentLoadPromise
    }

    const { name, namespace } = target
    if (!name || !namespace) {
      currentLoadPromise = Promise.resolve(null)
      return currentLoadPromise
    }

    const controller = new AbortController()
    abortController = controller
    isLoading.value = true

    currentLoadPromise = loadFullNamespacedCloudProfile(target, namespace, {
      api,
      signal: controller.signal,
    })
      .then(fullCloudProfile => {
        if (requestGeneration === generation && !controller.signal.aborted) {
          cloudProfile.value = fullCloudProfile
          return fullCloudProfile
        }
        return null
      })
      .catch(err => {
        if (requestGeneration === generation && !controller.signal.aborted) {
          error.value = err
        }
        return null
      })
      .finally(() => {
        if (requestGeneration === generation) {
          abortController = undefined
          isLoading.value = false
        }
      })
    return currentLoadPromise
  }

  function ensureLoaded () {
    if (isLoading.value) {
      return currentLoadPromise
    }
    if (cloudProfile.value) {
      return Promise.resolve(cloudProfile.value)
    }
    return load()
  }

  watch([
    () => toValue(enabled),
    () => toValue(cloudProfileRef)?.kind,
    () => toValue(cloudProfileRef)?.name,
    () => toValue(cloudProfileRef)?.kind === 'NamespacedCloudProfile'
      ? toValue(namespace)
      : undefined,
    () => {
      const resolvedCloudProfileRef = toValue(cloudProfileRef)
      return resolvedCloudProfileRef?.kind === 'CloudProfile'
        ? cloudProfileStore.cloudProfileByRef(resolvedCloudProfileRef)
        : null
    },
  ], ([isEnabled]) => {
    if (isEnabled) {
      load()
    } else {
      release()
    }
  }, {
    flush: 'sync',
    immediate: true,
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      release()
    })
  }

  return {
    cloudProfile,
    isLoading,
    error,
    reload: () => load(),
    ensureLoaded,
  }
}

/**
 * Returns the full CloudProfile state provided by a route or dialog owner.
 *
 * @returns {object} Provided full CloudProfile state
 */
export function useProvidedCloudProfile () {
  const composable = inject(cloudProfileInjectionKey, null)
  if (!composable) {
    throw new Error('Cloud profile composable has not been provided')
  }
  return composable
}

/**
 * Loads and provides one full CloudProfile state for descendant consumers.
 *
 * @param {object} cloudProfileRef - Maybe-ref CloudProfile reference
 * @param {string} namespace - Maybe-ref namespace used to resolve a NamespacedCloudProfile
 * @param {object} options - Optional dependencies
 * @returns {object} Provided full CloudProfile state
 */
export function useProvideCloudProfile (cloudProfileRef, namespace, options = {}) {
  const composable = useCloudProfile(cloudProfileRef, namespace, options)
  provide(cloudProfileInjectionKey, composable)
  return composable
}
