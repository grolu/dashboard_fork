//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  ref,
  toRaw,
} from 'vue'
import {
  createPinia,
  setActivePinia,
} from 'pinia'

import { useCloudProfileStore } from '@/store/cloudProfile'

import { useLightweightCloudProfile } from '@/composables/useCloudProfile/useLightweightCloudProfile'

const parentKubernetesVersion = { version: '1.31.4', classification: 'supported' }
const parentMachineType = { name: 'parent-large', cpu: '4', memory: '16Gi' }
const parentVolumeType = { name: 'parent-fast', minSize: '20Gi' }
const parentMachineImageVersion = {
  version: '1592.0.0',
  architectures: ['amd64'],
  classification: 'supported',
}
const parentMachineImage = {
  name: 'gardenlinux',
  updateStrategy: 'major',
  versions: [parentMachineImageVersion],
}
const parentZone = { name: 'eu-west-1a', unavailableMachineTypes: [] }
const parentRegion = { name: 'eu-west-1', zones: [parentZone] }

const parentSpec = {
  type: 'aws',
  kubernetes: { versions: [parentKubernetesVersion] },
  machineTypes: [parentMachineType],
  volumeTypes: [parentVolumeType],
  machineImages: [parentMachineImage],
  regions: [parentRegion],
}

function createCloudProfile (name = 'parent', spec = parentSpec) {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name },
    spec,
  }
}

function createNamespacedCloudProfile (namespace, spec = {}, name = 'custom') {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: {
      name,
      namespace,
    },
    spec: {
      parent: {
        kind: 'CloudProfile',
        name: 'parent',
      },
      ...spec,
    },
  }
}

describe('composables', () => {
  describe('useLightweightCloudProfile', () => {
    let cloudProfileStore

    beforeEach(() => {
      setActivePinia(createPinia())
      cloudProfileStore = useCloudProfileStore()
      cloudProfileStore.setCloudProfiles([createCloudProfile()])
      cloudProfileStore.setNamespacedCloudProfileDescriptors([])
    })

    function createNamespacedLookups (descriptor, namespace = descriptor.metadata.namespace) {
      cloudProfileStore.setNamespacedCloudProfileDescriptors([descriptor])
      return useLightweightCloudProfile(
        ref({
          kind: 'NamespacedCloudProfile',
          name: descriptor.metadata.name,
        }),
        ref(namespace),
        { cloudProfileStore },
      )
    }

    it('returns exact NamespacedCloudProfile items as-is for every supported lookup', () => {
      const kubernetesVersion = { version: '1.32.1', classification: 'preview' }
      const machineType = { name: 'custom-large', cpu: '8' }
      const volumeType = { name: 'custom-fast', minSize: '40Gi' }
      const machineImageVersion = {
        version: '1877.0.0',
        architectures: ['arm64'],
        classification: 'preview',
      }
      const machineImage = {
        name: 'custom-linux',
        versions: [machineImageVersion],
      }
      const zone = { name: 'custom-1a', unavailableVolumeTypes: [] }
      const region = { name: 'custom-1', zones: [zone] }
      const descriptor = createNamespacedCloudProfile('garden-a', {
        type: 'custom-provider',
        kubernetes: { versions: [kubernetesVersion] },
        machineTypes: [machineType],
        volumeTypes: [volumeType],
        machineImages: [machineImage],
        regions: [region],
      })
      const lookups = createNamespacedLookups(descriptor)

      expect(toRaw(lookups.findKubernetesVersion(kubernetesVersion.version))).toBe(kubernetesVersion)
      expect(toRaw(lookups.findMachineType(machineType.name))).toBe(machineType)
      expect(toRaw(lookups.findVolumeType(volumeType.name))).toBe(volumeType)
      expect(toRaw(lookups.findMachineImage(machineImage.name))).toBe(machineImage)
      expect(toRaw(lookups.findMachineImageVersion(
        machineImage.name,
        machineImageVersion.version,
        'arm64',
      ))).toBe(machineImageVersion)
      expect(toRaw(lookups.findRegion(region.name))).toBe(region)
      expect(toRaw(lookups.findZone(region.name, zone.name))).toBe(zone)
      expect(lookups.getProviderType()).toBe('custom-provider')
    })

    it('falls through independently to the parent for every supported lookup', () => {
      const descriptor = createNamespacedCloudProfile('garden-a')
      const lookups = createNamespacedLookups(descriptor)

      expect(toRaw(lookups.findKubernetesVersion(parentKubernetesVersion.version))).toBe(parentKubernetesVersion)
      expect(toRaw(lookups.findMachineType(parentMachineType.name))).toBe(parentMachineType)
      expect(toRaw(lookups.findVolumeType(parentVolumeType.name))).toBe(parentVolumeType)
      expect(toRaw(lookups.findMachineImage(parentMachineImage.name))).toBe(parentMachineImage)
      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        parentMachineImageVersion.version,
        'amd64',
      ))).toBe(parentMachineImageVersion)
      expect(toRaw(lookups.findRegion(parentRegion.name))).toBe(parentRegion)
      expect(toRaw(lookups.findZone(parentRegion.name, parentZone.name))).toBe(parentZone)
      expect(lookups.getProviderType()).toBe('aws')
    })

    it('does not merge a partial NamespacedCloudProfile item with its parent item', () => {
      const parentItem = { name: 'shared-large', cpu: '8', memory: '32Gi' }
      const namespacedItem = { name: 'shared-large', cpu: '2' }
      cloudProfileStore.setCloudProfiles([
        createCloudProfile('parent', {
          ...parentSpec,
          machineTypes: [parentItem],
        }),
      ])
      const descriptor = createNamespacedCloudProfile('garden-a', {
        machineTypes: [namespacedItem],
      })
      const lookups = createNamespacedLookups(descriptor)

      expect(toRaw(lookups.findMachineType('shared-large'))).toBe(namespacedItem)
      expect(lookups.findMachineType('shared-large')).toEqual({
        name: 'shared-large',
        cpu: '2',
      })
    })

    it('falls through to an exact parent machine image version without merging image arrays', () => {
      const namespacedVersion = {
        version: '1877.0.0',
        architectures: ['amd64'],
      }
      const namespacedImage = {
        name: parentMachineImage.name,
        versions: [namespacedVersion],
      }
      const descriptor = createNamespacedCloudProfile('garden-a', {
        machineImages: [namespacedImage],
      })
      const lookups = createNamespacedLookups(descriptor)

      expect(toRaw(lookups.findMachineImage(parentMachineImage.name))).toBe(namespacedImage)
      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
      ))).toBe(namespacedVersion)
      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        parentMachineImageVersion.version,
        'amd64',
      ))).toBe(parentMachineImageVersion)
    })

    it('evaluates effective version candidates without allowing parent duplicates to override local values', () => {
      const namespacedKubernetesVersion = {
        ...parentKubernetesVersion,
        classification: 'deprecated',
      }
      const namespacedMachineImageVersion = {
        ...parentMachineImageVersion,
        classification: 'deprecated',
      }
      const descriptor = createNamespacedCloudProfile('garden-a', {
        kubernetes: { versions: [namespacedKubernetesVersion] },
        machineImages: [{
          name: parentMachineImage.name,
          versions: [namespacedMachineImageVersion],
        }],
      })
      const lookups = createNamespacedLookups(descriptor)

      expect(lookups.someKubernetesVersion(version => {
        return version.version === parentKubernetesVersion.version && version.classification === 'supported'
      })).toBe(false)
      expect(lookups.someMachineImageVersion(parentMachineImage.name, 'amd64', version => {
        return version.version === parentMachineImageVersion.version && version.classification === 'supported'
      })).toBe(false)
    })

    it('uses targeted local values and parent fallback for seed and OpenStack lookups', () => {
      const parentSeedSelector = { providerTypes: ['aws'] }
      const localSeedSelector = { matchLabels: { environment: 'testing' } }
      const parentFloatingPool = {
        name: 'public-*',
        loadBalancerClasses: [{ name: 'parent' }],
      }
      const localFloatingPool = {
        name: 'custom-*',
        loadBalancerClasses: [{ name: 'local' }],
      }
      cloudProfileStore.setCloudProfiles([
        createCloudProfile('parent', {
          ...parentSpec,
          seedSelector: parentSeedSelector,
          providerConfig: {
            constraints: {
              floatingPools: [parentFloatingPool],
            },
          },
        }),
      ])
      const descriptor = createNamespacedCloudProfile('garden-a', {
        seedSelector: localSeedSelector,
        providerConfig: {
          constraints: {
            floatingPools: [localFloatingPool],
          },
        },
      })
      const lookups = createNamespacedLookups(descriptor)

      expect(toRaw(lookups.getSeedSelector())).toBe(localSeedSelector)
      expect(toRaw(lookups.findOpenStackFloatingPool('custom-net'))).toBe(localFloatingPool)
      expect(toRaw(lookups.findOpenStackFloatingPool('public-net'))).toBe(parentFloatingPool)

      descriptor.spec.seedSelector = undefined
      expect(toRaw(lookups.getSeedSelector())).toBe(parentSeedSelector)
    })

    it('keeps duplicate NamespacedCloudProfile names isolated by namespace', () => {
      const gardenAMachineType = { name: 'shared-large', source: 'garden-a' }
      const gardenBMachineType = { name: 'shared-large', source: 'garden-b' }
      cloudProfileStore.setNamespacedCloudProfileDescriptors([
        createNamespacedCloudProfile('garden-a', { machineTypes: [gardenAMachineType] }, 'shared'),
        createNamespacedCloudProfile('garden-b', { machineTypes: [gardenBMachineType] }, 'shared'),
      ])
      const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'shared' })
      const namespace = ref('garden-a')
      const lookups = useLightweightCloudProfile(cloudProfileRef, namespace, { cloudProfileStore })

      expect(toRaw(lookups.findMachineType('shared-large'))).toBe(gardenAMachineType)

      namespace.value = 'garden-b'
      expect(toRaw(lookups.findMachineType('shared-large'))).toBe(gardenBMachineType)

      namespace.value = undefined
      expect(lookups.findMachineType('shared-large')).toBeUndefined()
    })

    it('returns local items but no fallback when the parent is missing', () => {
      const namespacedMachineType = { name: 'custom-large' }
      cloudProfileStore.setCloudProfiles([])
      const descriptor = createNamespacedCloudProfile('garden-a', {
        machineTypes: [namespacedMachineType],
      })
      const lookups = createNamespacedLookups(descriptor)

      expect(toRaw(lookups.findMachineType(namespacedMachineType.name))).toBe(namespacedMachineType)
      expect(lookups.findVolumeType('missing')).toBeUndefined()
      expect(lookups.getProviderType()).toBeUndefined()
    })

    it('returns undefined when an item is absent from both sources', () => {
      const lookups = createNamespacedLookups(createNamespacedCloudProfile('garden-a'))

      expect(lookups.findKubernetesVersion('0.0.0')).toBeUndefined()
      expect(lookups.findMachineType('missing')).toBeUndefined()
      expect(lookups.findVolumeType('missing')).toBeUndefined()
      expect(lookups.findMachineImage('missing')).toBeUndefined()
      expect(lookups.findMachineImageVersion('gardenlinux', '0.0.0', 'amd64')).toBeUndefined()
      expect(lookups.findRegion('missing')).toBeUndefined()
      expect(lookups.findZone('eu-west-1', 'missing')).toBeUndefined()
    })

    it('uses the regular CloudProfile spec directly', () => {
      const lookups = useLightweightCloudProfile(
        ref({ kind: 'CloudProfile', name: 'parent' }),
        undefined,
        { cloudProfileStore },
      )

      expect(toRaw(lookups.findKubernetesVersion(parentKubernetesVersion.version))).toBe(parentKubernetesVersion)
      expect(toRaw(lookups.findMachineType(parentMachineType.name))).toBe(parentMachineType)
      expect(toRaw(lookups.findVolumeType(parentVolumeType.name))).toBe(parentVolumeType)
      expect(toRaw(lookups.findMachineImage(parentMachineImage.name))).toBe(parentMachineImage)
      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        parentMachineImageVersion.version,
        'amd64',
      ))).toBe(parentMachineImageVersion)
      expect(toRaw(lookups.findRegion(parentRegion.name))).toBe(parentRegion)
      expect(toRaw(lookups.findZone(parentRegion.name, parentZone.name))).toBe(parentZone)
      expect(lookups.getProviderType()).toBe('aws')
    })
  })
})
