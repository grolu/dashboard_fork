//
// SPDX-FileCopyrightText: 2024 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { computed } from 'vue'
import semver from 'semver'

import { useCloudProfileStore } from '@/store/cloudProfile'
import { useCredentialStore } from '@/store/credential'

import { useLightweightCloudProfile } from '@/composables/useCloudProfile/useLightweightCloudProfile.js'
import { addClassificationHelpers } from '@/composables/helper.js'

import get from 'lodash/get'
import uniq from 'lodash/uniq'
import flatMap from 'lodash/flatMap'
import cloneDeep from 'lodash/cloneDeep'
import find from 'lodash/find'
import compact from 'lodash/compact'

export function useShootSpec (shootItem, options = {}) {
  const {
    cloudProfileStore = useCloudProfileStore(),
    credentialStore = useCredentialStore(),
  } = options

  const shootSpec = computed(() => {
    return get(shootItem.value, ['spec'], {})
  })

  const shootPurpose = computed(() => {
    return get(shootSpec.value, ['purpose'])
  })

  const isTestingCluster = computed(() => {
    return shootPurpose.value === 'testing'
  })

  const isShootActionsDisabledForPurpose = computed(() => {
    return shootPurpose.value === 'infrastructure'
  })

  const isShootSettingHibernated = computed(() => {
    return get(shootSpec.value, ['hibernation', 'enabled'], false)
  })

  const shootSecretBindingName = computed(() => {
    return shootSpec.value.secretBindingName
  })

  const shootCredentialsBindingName = computed(() => {
    return shootSpec.value.credentialsBindingName
  })

  const shootCloudProviderBinding = computed(() => {
    if (shootSecretBindingName.value) {
      return find(credentialStore.secretBindingList, {
        metadata: {
          name: shootSecretBindingName.value,
          namespace: get(shootItem.value, ['metadata', 'namespace']),
        },
      })
    }
    if (shootCredentialsBindingName.value) {
      return find(credentialStore.credentialsBindingList, {
        metadata: {
          name: shootCredentialsBindingName.value,
          namespace: get(shootItem.value, ['metadata', 'namespace']),
        },
      })
    }
    return undefined
  })

  const shootK8sVersion = computed(() => {
    return get(shootSpec.value, ['kubernetes', 'version'])
  })

  const shootCloudProfileRef = computed(() => {
    return shootSpec.value.cloudProfile
  })

  const shootNamespace = computed(() => {
    return get(shootItem.value, ['metadata', 'namespace'])
  })

  const {
    findKubernetesVersion,
    getKubernetesVersionProperty,
    someKubernetesVersion,
  } = useLightweightCloudProfile(shootCloudProfileRef, shootNamespace, {
    cloudProfileStore,
  })

  function decorateLightweightKubernetesVersion (version, propertyLookup) {
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

  function hasLightweightKubernetesUpdate (predicate = () => true) {
    if (!semver.valid(shootK8sVersion.value)) {
      return false
    }
    return someKubernetesVersion((version, getProperty) => {
      if (!semver.valid(version.version) || !semver.gt(version.version, shootK8sVersion.value)) {
        return false
      }
      const decoratedVersion = decorateLightweightKubernetesVersion(version, getProperty)
      return !decoratedVersion.isExpired && predicate(decoratedVersion)
    })
  }

  const shootKubernetesUpdateAvailable = computed(() => {
    return hasLightweightKubernetesUpdate()
  })

  const shootSupportedPatchAvailable = computed(() => {
    return hasLightweightKubernetesUpdate(version => {
      return version.isSupported && semver.diff(version.version, shootK8sVersion.value) === 'patch'
    })
  })

  const shootSupportedUpgradeAvailable = computed(() => {
    return hasLightweightKubernetesUpdate(version => {
      return version.isSupported && semver.diff(version.version, shootK8sVersion.value) === 'minor'
    })
  })

  const shootKubernetesVersionObject = computed(() => {
    const version = findKubernetesVersion(shootK8sVersion.value)
    return version
      ? decorateLightweightKubernetesVersion(version)
      : {}
  })

  const shootProviderType = computed(() => {
    return get(shootSpec.value, ['provider', 'type'])
  })

  const shootWorkerGroups = computed(() => {
    return get(shootSpec.value, ['provider', 'workers'], [])
  })

  const hasShootWorkerGroups = computed(() => {
    return !!shootWorkerGroups.value.length
  })

  const sshAccessEnabled = computed(() => {
    return get(shootSpec.value, ['provider', 'workersSettings', 'sshAccess', 'enabled'], false)
  })

  const shootAddons = computed(() => {
    return cloneDeep(get(shootSpec.value, ['addons'], {}))
  })

  const shootRegion = computed(() => {
    return shootSpec.value.region
  })

  const shootZones = computed(() => {
    return compact(uniq(flatMap(get(shootSpec.value, ['provider', 'workers']), 'zones')))
  })

  const podsCidr = computed(() => {
    return get(shootSpec.value, ['networking', 'pods'])
  })

  const nodesCidr = computed(() => {
    return get(shootSpec.value, ['networking', 'nodes'])
  })

  const servicesCidr = computed(() => {
    return get(shootSpec.value, ['networking', 'services'])
  })

  const shootDomain = computed(() => {
    return get(shootSpec.value, ['dns', 'domain'])
  })

  const isCustomShootDomain = computed(() => {
    return !!shootDnsPrimaryProvider.value
  })

  const shootDnsPrimaryProvider = computed(() => {
    return find(shootSpec.value.dns?.providers, 'primary')
  })

  const shootDnsServiceExtensionProviders = computed(() => {
    const extensionDns = find(shootSpec.value.extensions, ['type', 'shoot-dns-service'])
    return get(extensionDns, ['providerConfig', 'providers'])
  })

  const shootHibernationSchedules = computed(() => {
    return get(shootSpec.value, ['hibernation', 'schedules'], [])
  })

  const shootMaintenance = computed(() => {
    return get(shootSpec.value, ['maintenance'], {})
  })

  const shootControlPlaneHighAvailabilityFailureTolerance = computed(() => {
    return get(shootSpec.value, ['controlPlane', 'highAvailability', 'failureTolerance', 'type'])
  })

  const shootSeedName = computed(() => {
    return get(shootSpec.value, ['seedName'])
  })

  const shootResources = computed(() => {
    return get(shootSpec.value, ['resources'])
  })

  return {
    shootSpec,
    shootPurpose,
    isTestingCluster,
    isShootActionsDisabledForPurpose,
    isShootSettingHibernated,
    shootSecretBindingName,
    shootCredentialsBindingName,
    shootCloudProviderBinding,
    shootK8sVersion,
    shootKubernetesUpdateAvailable,
    shootKubernetesVersionObject,
    shootSupportedPatchAvailable,
    shootSupportedUpgradeAvailable,
    shootCloudProfileRef,
    shootProviderType,
    shootWorkerGroups,
    hasShootWorkerGroups,
    sshAccessEnabled,
    shootAddons,
    shootRegion,
    shootZones,
    podsCidr,
    nodesCidr,
    servicesCidr,
    shootDomain,
    isCustomShootDomain,
    shootDnsPrimaryProvider,
    shootDnsServiceExtensionProviders,
    shootHibernationSchedules,
    shootMaintenance,
    shootControlPlaneHighAvailabilityFailureTolerance,
    shootSeedName,
    shootResources,
  }
}
