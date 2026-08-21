//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { ref } from 'vue'
import {
  createPinia,
  setActivePinia,
} from 'pinia'

import { useCloudProfileStore } from '@/store/cloudProfile'

import { useLightweightCloudProfile } from '@/composables/useCloudProfile/useLightweightCloudProfile.js'
import { useShootMessages } from '@/composables/useShootMessages.js'

const currentKubernetesVersion = {
  version: '1.32.1',
  classification: 'deprecated',
  expirationDate: '2026-08-25T23:59:59Z',
}
const currentMachineImageVersion = {
  version: '1877.0.0',
  architectures: ['amd64', 'arm64'],
  classification: 'deprecated',
  expirationDate: '2026-08-25T23:59:59Z',
}

function createCloudProfile () {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name: 'parent' },
    spec: {
      type: 'aws',
      kubernetes: {
        versions: [
          currentKubernetesVersion,
          { version: '1.32.2', classification: 'supported' },
        ],
      },
      machineImages: [{
        name: 'gardenlinux',
        updateStrategy: 'patch',
        versions: [
          currentMachineImageVersion,
          {
            version: '1877.0.1',
            architectures: ['amd64'],
            classification: 'supported',
          },
        ],
      }],
    },
  }
}

function createDescriptor (spec = {}, name = 'custom') {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: {
      name,
      namespace: 'garden-a',
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
  describe('useShootMessages with lightweight profiles', () => {
    let cloudProfileStore

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-08-19T12:00:00Z'))
      setActivePinia(createPinia())
      cloudProfileStore = useCloudProfileStore()
      cloudProfileStore.setCloudProfiles([createCloudProfile()])
      cloudProfileStore.setNamespacedCloudProfileDescriptors([])
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function createWarnings (cloudProfileRef, architecture = 'amd64', imageAutoPatch = false) {
      const lookups = useLightweightCloudProfile(
        ref(cloudProfileRef),
        ref('garden-a'),
        { cloudProfileStore },
      )
      const {
        useKubernetesVersionExpiration,
        useExpiringWorkerGroups,
      } = useShootMessages(lookups)
      const kubernetesWarning = useKubernetesVersionExpiration(ref('1.32.1'), ref(false))
      const imageWarnings = useExpiringWorkerGroups(ref([{
        name: 'worker',
        machine: {
          architecture,
          image: {
            name: 'gardenlinux',
            version: '1877.0.0',
          },
        },
      }]), ref(imageAutoPatch))
      return {
        kubernetesWarning,
        imageWarnings,
      }
    }

    function expectCurrentVersionWarnings (warnings) {
      expect(warnings.kubernetesWarning.value).toMatchObject({
        version: currentKubernetesVersion.version,
        expirationDate: currentKubernetesVersion.expirationDate,
        severity: 'warning',
        forcedUpdate: true,
      })
      expect(warnings.imageWarnings.value).toEqual([
        expect.objectContaining({
          name: 'gardenlinux',
          version: currentMachineImageVersion.version,
          expirationDate: currentMachineImageVersion.expirationDate,
          workerName: 'worker',
          severity: 'warning',
          forcedUpdate: true,
          supportedVersionAvailable: true,
        }),
      ])
    }

    it('keeps Kubernetes and machine-image warnings correct for regular profiles', () => {
      const warnings = createWarnings({ kind: 'CloudProfile', name: 'parent' })

      expect(warnings.kubernetesWarning.value).toBeDefined()
      expectCurrentVersionWarnings(warnings)
    })

    it('uses exact NamespacedCloudProfile overrides before parent values', () => {
      cloudProfileStore.setNamespacedCloudProfileDescriptors([
        createDescriptor({
          kubernetes: {
            versions: [{
              ...currentKubernetesVersion,
              classification: 'supported',
              expirationDate: '2027-08-25T23:59:59Z',
            }],
          },
          machineImages: [{
            name: 'gardenlinux',
            updateStrategy: 'patch',
            versions: [{
              ...currentMachineImageVersion,
              classification: 'supported',
              expirationDate: '2027-08-25T23:59:59Z',
            }],
          }],
        }),
      ])
      const warnings = createWarnings({ kind: 'NamespacedCloudProfile', name: 'custom' })

      expect(warnings.kubernetesWarning.value).toBeUndefined()
      expect(warnings.imageWarnings.value).toEqual([])
    })

    it('uses local expirations and inherited classifications for sparse version overrides', () => {
      const expirationDate = '2026-08-24T23:59:59Z'
      const kubernetesExpirationDate = '2026-08-23T23:59:59Z'
      cloudProfileStore.setNamespacedCloudProfileDescriptors([
        createDescriptor({
          kubernetes: {
            versions: [{
              version: currentKubernetesVersion.version,
              expirationDate: kubernetesExpirationDate,
            }],
          },
          machineImages: [{
            name: 'gardenlinux',
            versions: [{
              version: currentMachineImageVersion.version,
              expirationDate,
            }],
          }],
        }),
      ])

      for (const architecture of ['amd64', 'arm64']) {
        const warnings = createWarnings(
          { kind: 'NamespacedCloudProfile', name: 'custom' },
          architecture,
        )

        expect(warnings.imageWarnings.value).toEqual([
          expect.objectContaining({
            version: currentMachineImageVersion.version,
            classification: currentMachineImageVersion.classification,
            expirationDate,
            isDeprecated: true,
          }),
        ])
        expect(warnings.kubernetesWarning.value).toMatchObject({
          version: currentKubernetesVersion.version,
          expirationDate: kubernetesExpirationDate,
        })
      }
    })

    it('does not inherit cleared expirations into lightweight warnings', () => {
      cloudProfileStore.setNamespacedCloudProfileDescriptors([
        createDescriptor({
          kubernetes: {
            versions: [{
              version: currentKubernetesVersion.version,
            }],
          },
          machineImages: [{
            name: 'gardenlinux',
            versions: [{
              version: currentMachineImageVersion.version,
              architectures: ['amd64', 'arm64'],
              classification: 'supported',
            }],
          }],
        }),
      ])

      for (const architecture of ['amd64', 'arm64']) {
        const warnings = createWarnings(
          { kind: 'NamespacedCloudProfile', name: 'custom' },
          architecture,
        )

        expect(warnings.kubernetesWarning.value).toBeUndefined()
        expect(warnings.imageWarnings.value).toEqual([])
      }
    })

    it('uses a local image update strategy for parent-only version candidates', () => {
      const cloudProfile = createCloudProfile()
      cloudProfile.spec.machineImages = [{
        name: 'gardenlinux',
        updateStrategy: 'major',
        versions: [{
          ...currentMachineImageVersion,
          expirationDate: '2027-08-25T23:59:59Z',
        }, {
          version: '1877.1.0',
          architectures: ['amd64'],
          classification: 'supported',
        }],
      }]
      cloudProfileStore.setCloudProfiles([cloudProfile])
      cloudProfileStore.setNamespacedCloudProfileDescriptors([
        createDescriptor({
          machineImages: [{
            name: 'gardenlinux',
            updateStrategy: 'patch',
            versions: [{ version: currentMachineImageVersion.version }],
          }],
        }),
      ])

      const warnings = createWarnings(
        { kind: 'NamespacedCloudProfile', name: 'custom' },
        'amd64',
        true,
      )

      expect(warnings.imageWarnings.value).toEqual([])
    })

    it('falls through to parent warnings when NamespacedCloudProfile values are absent', () => {
      cloudProfileStore.setNamespacedCloudProfileDescriptors([createDescriptor()])
      const warnings = createWarnings({ kind: 'NamespacedCloudProfile', name: 'custom' })

      expect(warnings.kubernetesWarning.value).toBeDefined()
      expectCurrentVersionWarnings(warnings)
    })

    it('does not create warnings when lightweight values cannot be resolved', () => {
      const warnings = createWarnings({ kind: 'NamespacedCloudProfile', name: 'missing' })

      expect(warnings.kubernetesWarning.value).toBeUndefined()
      expect(warnings.imageWarnings.value).toEqual([])
    })
  })
})
