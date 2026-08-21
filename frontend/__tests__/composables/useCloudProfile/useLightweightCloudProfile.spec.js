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
      expect(lookups.getKubernetesVersionProperty(
        parentKubernetesVersion.version,
        'classification',
      )).toBe(parentKubernetesVersion.classification)
      expect(toRaw(lookups.findMachineType(parentMachineType.name))).toBe(parentMachineType)
      expect(toRaw(lookups.findVolumeType(parentVolumeType.name))).toBe(parentVolumeType)
      expect(toRaw(lookups.findMachineImage(parentMachineImage.name))).toBe(parentMachineImage)
      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        parentMachineImageVersion.version,
        'amd64',
      ))).toBe(parentMachineImageVersion)
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        parentMachineImageVersion.version,
        'amd64',
        'classification',
      )).toBe(parentMachineImageVersion.classification)
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

    it('resolves properties of a sparse Kubernetes version independently without merging the item', () => {
      const parentVersion = {
        version: '1.32.1',
        classification: 'deprecated',
        expirationDate: '2026-09-30T23:59:59Z',
      }
      const namespacedVersion = {
        version: parentVersion.version,
        expirationDate: '2026-12-31T23:59:59Z',
      }
      cloudProfileStore.setCloudProfiles([
        createCloudProfile('parent', {
          ...parentSpec,
          kubernetes: { versions: [parentVersion] },
        }),
      ])
      const lookups = createNamespacedLookups(createNamespacedCloudProfile('garden-a', {
        kubernetes: { versions: [namespacedVersion] },
      }))

      expect(toRaw(lookups.findKubernetesVersion(namespacedVersion.version))).toBe(namespacedVersion)
      expect(lookups.findKubernetesVersion(namespacedVersion.version)).toEqual(namespacedVersion)
      expect(lookups.getKubernetesVersionProperty(
        namespacedVersion.version,
        'expirationDate',
      )).toBe(namespacedVersion.expirationDate)
      expect(lookups.getKubernetesVersionProperty(
        namespacedVersion.version,
        'classification',
      )).toBe(parentVersion.classification)

      delete namespacedVersion.expirationDate
      expect(lookups.getKubernetesVersionProperty(
        namespacedVersion.version,
        'expirationDate',
      )).toBeUndefined()

      const candidates = []
      expect(lookups.someKubernetesVersion((version, getProperty) => {
        candidates.push({
          version: toRaw(version),
          classification: getProperty('classification'),
        })
        return false
      })).toBe(false)
      expect(candidates).toEqual([{
        version: namespacedVersion,
        classification: parentVersion.classification,
      }])
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

    it('resolves properties of a sparse image version independently without merging the item', () => {
      const parentVersion = {
        version: '2150.7.0',
        architectures: ['amd64', 'arm64'],
        classification: 'deprecated',
        expirationDate: '2026-09-30T23:59:59Z',
        cri: [{ name: 'containerd' }],
      }
      const namespacedVersion = {
        version: parentVersion.version,
        expirationDate: '2026-12-31T23:59:59Z',
      }
      cloudProfileStore.setCloudProfiles([
        createCloudProfile('parent', {
          ...parentSpec,
          machineImages: [{
            name: parentMachineImage.name,
            versions: [parentVersion],
          }],
        }),
      ])
      const descriptor = createNamespacedCloudProfile('garden-a', {
        machineImages: [{
          name: parentMachineImage.name,
          versions: [namespacedVersion],
        }],
      })
      const lookups = createNamespacedLookups(descriptor)

      for (const architecture of ['amd64', 'arm64']) {
        expect(toRaw(lookups.findMachineImageVersion(
          parentMachineImage.name,
          namespacedVersion.version,
          architecture,
        ))).toBe(namespacedVersion)
        expect(lookups.getMachineImageVersionProperty(
          parentMachineImage.name,
          namespacedVersion.version,
          architecture,
          'expirationDate',
        )).toBe(namespacedVersion.expirationDate)
        expect(lookups.getMachineImageVersionProperty(
          parentMachineImage.name,
          namespacedVersion.version,
          architecture,
          'classification',
        )).toBe(parentVersion.classification)
        expect(toRaw(lookups.getMachineImageVersionProperty(
          parentMachineImage.name,
          namespacedVersion.version,
          architecture,
          'cri',
        ))).toEqual(parentVersion.cri)

        const candidates = []
        expect(lookups.someMachineImageVersion(parentMachineImage.name, architecture, (version, image, getProperty) => {
          candidates.push({
            version: toRaw(version),
            image: toRaw(image),
            classification: getProperty('classification'),
          })
          return false
        })).toBe(false)
        expect(candidates).toEqual([{
          version: namespacedVersion,
          image: descriptor.spec.machineImages[0],
          classification: parentVersion.classification,
        }])
      }

      expect(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'ppc64le',
      )).toBeUndefined()
      expect(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
      )).toEqual(namespacedVersion)
    })

    it('does not inherit parent properties for a structural image version override', () => {
      const parentVersion = {
        version: '2150.7.0',
        architectures: ['amd64', 'arm64'],
        classification: 'deprecated',
        expirationDate: '2026-09-30T23:59:59Z',
        cri: [{ name: 'containerd' }],
      }
      const namespacedVersion = {
        version: parentVersion.version,
        architectures: ['amd64'],
      }
      cloudProfileStore.setCloudProfiles([
        createCloudProfile('parent', {
          ...parentSpec,
          machineImages: [{
            name: parentMachineImage.name,
            versions: [parentVersion],
          }],
        }),
      ])
      const lookups = createNamespacedLookups(createNamespacedCloudProfile('garden-a', {
        machineImages: [{
          name: parentMachineImage.name,
          versions: [namespacedVersion],
        }],
      }))

      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
      ))).toBe(namespacedVersion)
      expect(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'arm64',
      )).toBeUndefined()
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'arm64',
        'expirationDate',
      )).toBeUndefined()
      expect(lookups.someMachineImageVersion(parentMachineImage.name, 'arm64', () => true)).toBe(false)
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
        'expirationDate',
      )).toBeUndefined()
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
        'classification',
      )).toBeUndefined()
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
        'cri',
      )).toBeUndefined()

      namespacedVersion.architectures = ['arm64']
      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'arm64',
      ))).toBe(namespacedVersion)
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'arm64',
        'classification',
      )).toBeUndefined()
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'arm64',
        'expirationDate',
      )).toBeUndefined()
      expect(lookups.someMachineImageVersion(parentMachineImage.name, 'arm64', () => true)).toBe(true)

      namespacedVersion.architectures = []
      expect(toRaw(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
      ))).toBe(namespacedVersion)
      expect(lookups.findMachineImageVersion(
        parentMachineImage.name,
        namespacedVersion.version,
        'arm64',
      )).toEqual(namespacedVersion)
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
        'classification',
      )).toBe(parentVersion.classification)
      expect(toRaw(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'arm64',
        'cri',
      ))).toEqual(parentVersion.cri)
      expect(lookups.getMachineImageVersionProperty(
        parentMachineImage.name,
        namespacedVersion.version,
        'amd64',
        'expirationDate',
      )).toBeUndefined()
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
      expect(lookups.getKubernetesVersionProperty('0.0.0', 'classification')).toBeUndefined()
      expect(lookups.findMachineType('missing')).toBeUndefined()
      expect(lookups.findVolumeType('missing')).toBeUndefined()
      expect(lookups.findMachineImage('missing')).toBeUndefined()
      expect(lookups.findMachineImageVersion('gardenlinux', '0.0.0', 'amd64')).toBeUndefined()
      expect(lookups.getMachineImageVersionProperty(
        'gardenlinux',
        '0.0.0',
        'amd64',
        'classification',
      )).toBeUndefined()
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
