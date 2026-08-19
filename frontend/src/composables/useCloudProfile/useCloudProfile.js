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

/**
 * Resolves a complete/effective CloudProfile for the supplied reference.
 *
 * Regular CloudProfiles are returned synchronously from the Pinia store.
 * NamespacedCloudProfiles are loaded from their status subresource and remain
 * local to the composable's scope.
 *
 * @param {object} cloudProfileRef - Maybe-ref CloudProfile reference
 * @param {string} namespace - Maybe-ref namespace used to resolve a NamespacedCloudProfile
 * @param {object} options - Optional dependencies
 * @returns {object} Full CloudProfile state and reload function
 */
export function useCloudProfile (cloudProfileRef, namespace, options = {}) {
  const {
    api = useApi(),
    cloudProfileStore = useCloudProfileStore(),
  } = options

  const cloudProfile = shallowRef(null)
  const isLoading = ref(false)
  const error = shallowRef(null)

  let abortController
  let generation = 0
  let disposed = false

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
      const descriptor = cloudProfileStore.namespacedCloudProfileDescriptorByRef(
        resolvedCloudProfileRef,
        resolvedNamespace,
      )
      return {
        kind: resolvedCloudProfileRef.kind,
        name: resolvedCloudProfileRef.name,
        namespace: resolvedNamespace,
        resource: descriptor,
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
    const requestGeneration = ++generation
    abortController?.abort()
    abortController = undefined

    error.value = null
    isLoading.value = false

    if (disposed) {
      return Promise.resolve(null)
    }

    if (target.kind === 'CloudProfile') {
      cloudProfile.value = target.resource ?? null
      return Promise.resolve(cloudProfile.value)
    }

    cloudProfile.value = null
    if (target.kind !== 'NamespacedCloudProfile' || !target.resource) {
      return Promise.resolve(null)
    }

    const name = target.resource.metadata?.name
    const namespace = target.resource.metadata?.namespace
    if (!name || !namespace) {
      return Promise.resolve(null)
    }

    const controller = new AbortController()
    abortController = controller
    isLoading.value = true

    return api.getNamespacedCloudProfileStatus({
      name,
      namespace,
      signal: controller.signal,
    })
      .then(response => {
        if (requestGeneration === generation && !controller.signal.aborted) {
          cloudProfile.value = response.data
          return response.data
        }
        return null
      }, err => {
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
  }

  watch(resolveTarget, target => {
    load(target)
  }, {
    flush: 'sync',
    immediate: true,
  })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      generation++
      abortController?.abort()
      abortController = undefined
      isLoading.value = false
    })
  }

  return {
    cloudProfile,
    isLoading,
    error,
    reload: load,
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
