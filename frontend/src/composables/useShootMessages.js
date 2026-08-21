//
// SPDX-FileCopyrightText: 2025 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  computed,
  isRef,
} from 'vue'
import semver from 'semver'

import { addClassificationHelpers } from '@/composables/helper.js'

import {
  isValidTerminationDate,
  machineImageHasUpdateForAutoUpdateStrategy,
  machineImageHasUpdate,
  machineVendorHasSupportedVersion,
  getVersionExpirationWarning,
  normalizeVersion,
} from '@/utils'

import map from 'lodash/map'
import compact from 'lodash/compact'
import get from 'lodash/get'

/**
 * Composable for shoot message validation and warnings
 * @param {object} lightweightCloudProfile - Targeted lightweight CloudProfile lookups
 * @returns {Object} Object containing functions for shoot validation
 */
export function useShootMessages (lightweightCloudProfile) {
  const {
    findKubernetesVersion,
    getKubernetesVersionProperty,
    someKubernetesVersion,
    findMachineImageVersion,
    getMachineImageVersionProperty,
    someMachineImageVersion,
    getMachineImageUpdateStrategy,
  } = lightweightCloudProfile

  function decorateKubernetesVersion (version, propertyLookup) {
    if (!version) {
      return undefined
    }
    const getProperty = propertyLookup ?? (path => {
      return getKubernetesVersionProperty(version.version, path)
    })
    return addClassificationHelpers({
      ...version,
      classification: getProperty('classification'),
      expirationDate: getProperty('expirationDate'),
    })
  }

  function decorateMachineImageVersion (name, architecture, imageVersion, propertyLookup, updateStrategy) {
    if (!imageVersion?.version) {
      return undefined
    }
    const version = semver.valid(imageVersion?.version)
      ? imageVersion.version
      : normalizeVersion(imageVersion?.version)
    if (!version) {
      return undefined
    }
    const getProperty = propertyLookup ?? (path => {
      return getMachineImageVersionProperty(name, imageVersion.version, architecture, path)
    })
    return addClassificationHelpers({
      ...imageVersion,
      name,
      vendorName: name,
      version,
      classification: getProperty('classification'),
      expirationDate: getProperty('expirationDate'),
      updateStrategy: updateStrategy ?? getMachineImageUpdateStrategy(name) ?? 'major',
    })
  }

  function useKubernetesVersionExpiration (k8sVersion, k8sAutoPatch) {
    if (!isRef(k8sVersion) || !isRef(k8sAutoPatch)) {
      throw Error('k8sVersion and k8sAutoPatch must be a ref!')
    }

    return computed(() => {
      const plainVersion = findKubernetesVersion(k8sVersion.value)
      if (!plainVersion || !semver.valid(plainVersion.version)) {
        return undefined
      }

      const version = decorateKubernetesVersion(plainVersion)
      const patchAvailable = someKubernetesVersion((candidate, getProperty) => {
        const decoratedCandidate = decorateKubernetesVersion(candidate, getProperty)
        return semver.valid(candidate.version) &&
          decoratedCandidate.isSupported &&
          semver.diff(candidate.version, version.version) === 'patch' &&
          semver.gt(candidate.version, version.version)
      })

      const nextMinorVersion = semver.minor(version.version) + 1
      let hasNextMinorVersion = false
      let hasNewerSupportedMinorVersion = false
      someKubernetesVersion((candidate, getProperty) => {
        if (!semver.valid(candidate.version)) {
          return false
        }
        const minorVersion = semver.minor(candidate.version)
        if (minorVersion === nextMinorVersion) {
          hasNextMinorVersion = true
        }
        if (minorVersion >= nextMinorVersion && decorateKubernetesVersion(candidate, getProperty).isSupported) {
          hasNewerSupportedMinorVersion = true
        }
        return hasNextMinorVersion && hasNewerSupportedMinorVersion
      })

      const expirationWarning = getVersionExpirationWarning({
        isExpirationWarning: version.isExpirationWarning,
        autoPatchEnabled: k8sAutoPatch.value,
        updateAvailable: patchAvailable || (hasNextMinorVersion && hasNewerSupportedMinorVersion),
        autoUpdatePossible: patchAvailable,
      })
      if (!expirationWarning) {
        return undefined
      }

      return {
        version: version.version,
        expirationDate: version.expirationDate,
        isValidTerminationDate: isValidTerminationDate(version.expirationDate),
        isExpired: version.isExpired,
        ...expirationWarning,
      }
    })
  }

  /**
   * Get expiring worker groups for shoot
   * @param {Ref<Array>} shootWorkerGroups - Vue ref containing worker groups
   * @param {Ref<Boolean>} imageAutoPatch - Vue ref indicating if auto-patch is enabled
   * @returns {ComputedRef<Array>} Computed ref of expiring worker groups
   */
  function useExpiringWorkerGroups (shootWorkerGroups, imageAutoPatch) {
    if (!isRef(shootWorkerGroups)) {
      throw new Error('shootWorkerGroups must be a ref!')
    }
    if (!isRef(imageAutoPatch)) {
      throw new Error('imageAutoPatch must be a ref!')
    }
    return computed(() => {
      const workerGroups = map(shootWorkerGroups.value, worker => {
        const workerImage = get(worker, ['machine', 'image'], {})
        const { name, version } = workerImage
        const architecture = get(worker, ['machine', 'architecture'], 'amd64')
        const plainWorkerImageVersion = findMachineImageVersion(name, version, architecture)
        const updateStrategy = getMachineImageUpdateStrategy(name) ?? 'major'
        const workerImageDetails = decorateMachineImageVersion(
          name,
          architecture,
          plainWorkerImageVersion,
          undefined,
          updateStrategy,
        )
        if (!workerImageDetails) {
          return undefined
        }

        const updateAvailableForUpdateStrategy = someMachineImageVersion(name, architecture, (candidate, image, getProperty) => {
          const candidateDetails = decorateMachineImageVersion(
            image.name,
            architecture,
            candidate,
            getProperty,
            updateStrategy,
          )
          return candidateDetails && machineImageHasUpdateForAutoUpdateStrategy(workerImageDetails, [candidateDetails])
        })
        const updateAvailable = someMachineImageVersion(name, architecture, (candidate, image, getProperty) => {
          const candidateDetails = decorateMachineImageVersion(
            image.name,
            architecture,
            candidate,
            getProperty,
            updateStrategy,
          )
          return candidateDetails && machineImageHasUpdate(workerImageDetails, [candidateDetails])
        })
        const supportedVersionAvailable = someMachineImageVersion(name, architecture, (candidate, image, getProperty) => {
          const candidateDetails = decorateMachineImageVersion(
            image.name,
            architecture,
            candidate,
            getProperty,
            updateStrategy,
          )
          return candidateDetails && machineVendorHasSupportedVersion(workerImageDetails, [candidateDetails])
        })
        const expirationWarning = getVersionExpirationWarning({
          isExpirationWarning: workerImageDetails.isExpirationWarning,
          autoPatchEnabled: imageAutoPatch.value,
          updateAvailable,
          autoUpdatePossible: updateAvailableForUpdateStrategy,
        })

        if (!expirationWarning) {
          return undefined
        }

        return {
          ...workerImageDetails,
          isValidTerminationDate: isValidTerminationDate(workerImageDetails.expirationDate),
          workerName: worker.name,
          supportedVersionAvailable,
          ...expirationWarning,
        }
      })

      return compact(workerGroups)
    })
  }

  return {
    useKubernetesVersionExpiration,
    useExpiringWorkerGroups,
  }
}
