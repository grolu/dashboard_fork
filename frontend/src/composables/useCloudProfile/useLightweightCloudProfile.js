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
 * CloudProfile. Top-level lookups fall through independently. Targeted version
 * properties follow the controller's override rules while every matching
 * object is still returned as-is; profiles and collection entries are never
 * merged.
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

  function createVersionIndex (versions) {
    const versionsByVersion = new Map()
    for (const version of versions ?? []) {
      if (!versionsByVersion.has(version.version)) {
        versionsByVersion.set(version.version, version)
      }
    }
    return versionsByVersion
  }

  function createKubernetesVersionSources (specs) {
    return specs.map(spec => {
      const versions = get(spec, ['kubernetes', 'versions']) ?? []
      return {
        versions,
        versionsByVersion: createVersionIndex(versions),
      }
    })
  }

  function resolveVersionChain (sources, version) {
    return sources.map(source => source.versionsByVersion.get(version))
  }

  function resolveVersionOverride (versionChain) {
    const sourceIndex = versionChain.findIndex(Boolean)
    if (sourceIndex === -1) {
      return {}
    }
    return {
      version: versionChain.at(sourceIndex),
      parentVersion: find(versionChain.slice(sourceIndex + 1), Boolean),
    }
  }

  function isExpirationDatePath (path) {
    return path === 'expirationDate' ||
      (Array.isArray(path) && path.length === 1 && path[0] === 'expirationDate')
  }

  function getKubernetesVersionPropertyFromChain (versionChain, path) {
    const { version, parentVersion } = resolveVersionOverride(versionChain)
    if (!version) {
      return undefined
    }
    if (!parentVersion || isExpirationDatePath(path)) {
      return get(version, path)
    }
    return get(parentVersion, path)
  }

  function findKubernetesVersion (version) {
    const sources = createKubernetesVersionSources(resolveSpecs())
    return find(resolveVersionChain(sources, version), Boolean)
  }

  // The controller overlays only the local expiration date on a matching
  // parent Kubernetes version. An omitted local date therefore clears it.
  function getKubernetesVersionProperty (version, path) {
    const sources = createKubernetesVersionSources(resolveSpecs())
    return getKubernetesVersionPropertyFromChain(resolveVersionChain(sources, version), path)
  }

  function someKubernetesVersion (predicate) {
    const sources = createKubernetesVersionSources(resolveSpecs())
    const seen = new Set()
    for (const { versions } of sources) {
      for (const version of versions) {
        if (seen.has(version.version)) {
          continue
        }
        seen.add(version.version)
        const versionChain = resolveVersionChain(sources, version.version)
        // Keep the predicate item exact; callers request effective properties
        // explicitly through the second argument.
        const getProperty = path => getKubernetesVersionPropertyFromChain(versionChain, path)
        if (predicate(version, getProperty)) {
          return true
        }
      }
    }
    return false
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

  // A NamespacedCloudProfile may override only selected properties of a
  // parent image version. Keep the returned version object exact, but resolve
  // individual properties through the matching version identity.
  function createMachineImageVersionSources (specs, imageName) {
    return specs.map(spec => {
      const image = find(get(spec, ['machineImages']), { name: imageName })
      const versionsByVersion = createVersionIndex(image?.versions)
      return { image, versionsByVersion }
    })
  }

  function resolveMachineImageVersionChain (sources, version) {
    return resolveVersionChain(sources, version)
  }

  function replacesParentMachineImageVersion (version) {
    return version.architectures?.length > 0 ||
      version.cri?.length > 0 ||
      version.kubeletVersionConstraint?.length > 0 ||
      version.classification?.length > 0
  }

  function getEffectiveMachineImageVersionProperty (versionChain, path) {
    const { version, parentVersion } = resolveVersionOverride(versionChain)
    if (!version) {
      return undefined
    }
    if (!parentVersion || replacesParentMachineImageVersion(version)) {
      return get(version, path)
    }
    if (isExpirationDatePath(path)) {
      return get(version, path)
    }
    return get(parentVersion, path)
  }

  function supportsArchitecture (versionChain, architecture) {
    let architectures = getEffectiveMachineImageVersionProperty(versionChain, 'architectures')
    architectures = architectures?.length ? architectures : ['amd64']
    return architectures.includes(architecture)
  }

  function getMachineImageVersionPropertyFromChain (versionChain, architecture, path) {
    if (!supportsArchitecture(versionChain, architecture)) {
      return undefined
    }
    return getEffectiveMachineImageVersionProperty(versionChain, path)
  }

  function findMachineImageVersion (imageName, version, architecture) {
    const sources = createMachineImageVersionSources(resolveSpecs(), imageName)
    const versionChain = resolveMachineImageVersionChain(sources, version)
    if (!supportsArchitecture(versionChain, architecture)) {
      return undefined
    }
    return find(versionChain, Boolean)
  }

  function getMachineImageVersionProperty (imageName, version, architecture, path) {
    const sources = createMachineImageVersionSources(resolveSpecs(), imageName)
    const versionChain = resolveMachineImageVersionChain(sources, version)
    return getMachineImageVersionPropertyFromChain(versionChain, architecture, path)
  }

  function someMachineImageVersion (imageName, architecture, predicate) {
    const sources = createMachineImageVersionSources(resolveSpecs(), imageName)
    const seen = new Set()
    for (const { image } of sources) {
      for (const version of image?.versions ?? []) {
        if (seen.has(version.version)) {
          continue
        }
        seen.add(version.version)
        const versionChain = resolveMachineImageVersionChain(sources, version.version)
        if (!supportsArchitecture(versionChain, architecture)) {
          continue
        }
        // The predicate receives the exact item and a targeted property
        // resolver as its third argument; no effective item is synthesized.
        const getProperty = path => {
          return getMachineImageVersionPropertyFromChain(versionChain, architecture, path)
        }
        if (predicate(version, image, getProperty)) {
          return true
        }
      }
    }
    return false
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
    getKubernetesVersionProperty,
    someKubernetesVersion,
    findMachineType,
    findVolumeType,
    findMachineImage,
    findMachineImageVersion,
    getMachineImageVersionProperty,
    someMachineImageVersion,
    getMachineImageUpdateStrategy,
    findRegion,
    findZone,
    getProviderType,
    getSeedSelector,
    findOpenStackFloatingPool,
  }
}
