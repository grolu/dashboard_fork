//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { toValue } from 'vue'

import { useCloudProfileStore } from '@/store/cloudProfile'

import { matchesPropertyOrEmpty } from '@/composables/helper'

import {
  bestMatchForString,
  wildcardObjectsFromStrings,
} from '@/utils/wildcard'

import find from 'lodash/find'
import filter from 'lodash/filter'
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

  function resolveSpecs () {
    const resolvedCloudProfileRef = toValue(cloudProfileRef)

    if (resolvedCloudProfileRef?.kind === 'NamespacedCloudProfile') {
      const descriptor = cloudProfileStore.namespacedCloudProfileDescriptorByRef(
        resolvedCloudProfileRef,
        toValue(namespace),
      )
      if (!descriptor) {
        return []
      }

      const parentCloudProfile = cloudProfileStore.parentCloudProfileForDescriptor(descriptor)
      return [descriptor.spec, parentCloudProfile?.spec]
    }

    const cloudProfile = cloudProfileStore.cloudProfileByRef(resolvedCloudProfileRef)
    return cloudProfile ? [cloudProfile.spec] : []
  }

  function findWithFallback (lookup) {
    for (const spec of resolveSpecs()) {
      const item = lookup(spec)
      if (item !== undefined) {
        return item
      }
    }
    return undefined
  }

  function someWithFallback (lookup, identity, predicate) {
    // Evaluate local and parent sources in precedence order without building an
    // effective collection. A local identity shadows the same parent identity.
    const seen = new Set()
    for (const spec of resolveSpecs()) {
      for (const item of lookup(spec) ?? []) {
        const key = identity(item)
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        if (predicate(item)) {
          return true
        }
      }
    }
    return false
  }

  function findKubernetesVersion (version) {
    return findWithFallback(spec => find(get(spec, ['kubernetes', 'versions']), { version }))
  }

  function someKubernetesVersion (predicate) {
    return someWithFallback(
      spec => get(spec, ['kubernetes', 'versions']),
      item => item.version,
      predicate,
    )
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
        const architectures = item.architectures?.length
          ? item.architectures
          : ['amd64']
        return item.version === version && architectures.includes(architecture)
      })
    })
  }

  function someMachineImageVersion (imageName, architecture, predicate) {
    return someWithFallback(
      spec => {
        const image = find(get(spec, ['machineImages']), { name: imageName })
        return image?.versions
          ?.filter(version => {
            const architectures = version.architectures?.length
              ? version.architectures
              : ['amd64']
            return architectures.includes(architecture)
          })
          .map(version => ({ image, version }))
      },
      item => item.version.version,
      ({ image, version }) => predicate(version, image),
    )
  }

  function getMachineImageUpdateStrategy (imageName) {
    return findWithFallback(spec => {
      const image = find(get(spec, ['machineImages']), { name: imageName })
      return image?.updateStrategy
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

  function getSeedSelector () {
    return findWithFallback(spec => get(spec, ['seedSelector']))
  }

  function findOpenStackFloatingPool (name, region, domain) {
    return findWithFallback(spec => {
      const floatingPools = get(spec, ['providerConfig', 'constraints', 'floatingPools'])
      let availableFloatingPools = filter(floatingPools, matchesPropertyOrEmpty('region', region))
      availableFloatingPools = filter(availableFloatingPools, matchesPropertyOrEmpty('domain', domain))

      if (find(availableFloatingPools, pool => !!pool.region && !pool.nonConstraining)) {
        availableFloatingPools = filter(availableFloatingPools, { region })
      }
      if (find(availableFloatingPools, pool => !!pool.domain && !pool.nonConstraining)) {
        availableFloatingPools = filter(availableFloatingPools, { domain })
      }

      const wildcardObjects = wildcardObjectsFromStrings(availableFloatingPools.map(pool => pool.name))
      const wildcardName = bestMatchForString(wildcardObjects, name)
      return find(availableFloatingPools, ['name', wildcardName?.originalValue])
    })
  }

  return {
    findKubernetesVersion,
    someKubernetesVersion,
    findMachineType,
    findVolumeType,
    findMachineImage,
    findMachineImageVersion,
    someMachineImageVersion,
    getMachineImageUpdateStrategy,
    findRegion,
    findZone,
    getProviderType,
    getSeedSelector,
    findOpenStackFloatingPool,
  }
}
