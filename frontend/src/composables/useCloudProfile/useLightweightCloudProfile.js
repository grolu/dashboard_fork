//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { toValue } from 'vue'

import { useCloudProfileStore } from '@/store/cloudProfile'

import find from 'lodash/find'
import get from 'lodash/get'

/**
 * Provides synchronous, exact lookups against a lightweight CloudProfile.
 *
 * NamespacedCloudProfile values take precedence over values from their parent
 * CloudProfile. Every lookup falls through independently and returns the
 * matching object as-is; profiles and collection entries are never merged.
 *
 * @param {object} cloudProfileRef - Maybe-ref CloudProfile reference
 * @param {string} namespace - Maybe-ref namespace used to resolve a NamespacedCloudProfile
 * @param {object} options - Optional dependencies
 * @returns {object} Targeted lightweight lookup helpers
 */
export function useLightweightCloudProfile (cloudProfileRef, namespace, options = {}) {
  const {
    cloudProfileStore = useCloudProfileStore(),
  } = options

  function findWithFallback (lookup) {
    const resolvedCloudProfileRef = toValue(cloudProfileRef)

    if (resolvedCloudProfileRef?.kind === 'NamespacedCloudProfile') {
      const descriptor = cloudProfileStore.namespacedCloudProfileDescriptorByRef(
        resolvedCloudProfileRef,
        toValue(namespace),
      )
      const namespacedItem = lookup(descriptor?.spec)
      if (namespacedItem !== undefined) {
        return namespacedItem
      }

      const parentCloudProfile = cloudProfileStore.parentCloudProfileForDescriptor(descriptor)
      return lookup(parentCloudProfile?.spec)
    }

    const cloudProfile = cloudProfileStore.cloudProfileByRef(resolvedCloudProfileRef)
    return lookup(cloudProfile?.spec)
  }

  function findKubernetesVersion (version) {
    return findWithFallback(spec => find(get(spec, ['kubernetes', 'versions']), { version }))
  }

  function findMachineType (name) {
    return findWithFallback(spec => find(get(spec, ['machineTypes']), { name }))
  }

  function findVolumeType (name) {
    return findWithFallback(spec => find(get(spec, ['volumeTypes']), { name }))
  }

  function findMachineImage (name) {
    return findWithFallback(spec => find(get(spec, ['machineImages']), { name }))
  }

  function findMachineImageVersion (imageName, version, architecture) {
    return findWithFallback(spec => {
      const image = find(get(spec, ['machineImages']), { name: imageName })
      return find(image?.versions, item => {
        return item.version === version && item.architectures?.includes(architecture)
      })
    })
  }

  function findRegion (name) {
    return findWithFallback(spec => find(get(spec, ['regions']), { name }))
  }

  function findZone (regionName, zoneName) {
    return findWithFallback(spec => {
      const region = find(get(spec, ['regions']), { name: regionName })
      return find(region?.zones, { name: zoneName })
    })
  }

  function getProviderType () {
    return findWithFallback(spec => get(spec, ['type']))
  }

  return {
    findKubernetesVersion,
    findMachineType,
    findVolumeType,
    findMachineImage,
    findMachineImageVersion,
    findRegion,
    findZone,
    getProviderType,
  }
}
