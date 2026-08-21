//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { shallowMount } from '@vue/test-utils'
import {
  createPinia,
  setActivePinia,
} from 'pinia'

import { useCloudProfileStore } from '@/store/cloudProfile'

import GShootListRow from '@/components/GShootListRow.vue'

import api from '@/composables/useApi/api.js'

vi.mock('@/composables/useShootAction', () => ({
  useShootAction: () => ({
    setShootAction: vi.fn(),
  }),
}))

function createCloudProfile () {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name: 'parent' },
    spec: {
      type: 'aws',
      kubernetes: {
        versions: [{ version: '1.32.1', classification: 'supported' }],
      },
      machineImages: [{
        name: 'gardenlinux',
        versions: [{
          version: '1877.0.0',
          architectures: ['amd64'],
          classification: 'deprecated',
        }],
      }],
    },
  }
}

function createDescriptor (namespace, classification, name = 'shared') {
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
      ...(classification && {
        machineImages: [{
          name: 'gardenlinux',
          versions: [{
            version: '1877.0.0',
            architectures: ['amd64'],
            classification,
          }],
        }],
      }),
    },
  }
}

function createSparseDescriptor (namespace, name = 'sparse') {
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
      machineImages: [{
        name: 'gardenlinux',
        versions: [{
          version: '1877.0.0',
          expirationDate: '2026-12-31T23:59:59Z',
        }],
      }],
    },
  }
}

function createShoot (namespace, cloudProfileRef) {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'Shoot',
    metadata: {
      name: `shoot-${namespace}`,
      namespace,
      uid: `uid-${namespace}-${cloudProfileRef.kind}-${cloudProfileRef.name}`,
    },
    spec: {
      cloudProfile: cloudProfileRef,
      kubernetes: { version: '1.32.1' },
      provider: {
        type: 'aws',
        workers: [{
          name: 'worker',
          machine: {
            type: 'm5.large',
            image: {
              name: 'gardenlinux',
              version: '1877.0.0',
            },
          },
        }],
      },
    },
    status: {},
  }
}

describe('components', () => {
  describe('g-shoot-list-row', () => {
    let pinia
    let cloudProfileStore
    let statusSpy

    beforeEach(() => {
      pinia = createPinia()
      setActivePinia(pinia)
      cloudProfileStore = useCloudProfileStore()
      cloudProfileStore.setCloudProfiles([createCloudProfile()])
      cloudProfileStore.setNamespacedCloudProfileDescriptors([
        createDescriptor('garden-a', 'supported'),
        createDescriptor('garden-b', 'deprecated'),
        createDescriptor('garden-c', undefined, 'fallback'),
        createSparseDescriptor('garden-d'),
      ])
      statusSpy = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
    })

    afterEach(() => {
      statusSpy.mockRestore()
    })

    function renderRow (namespace, cloudProfileRef) {
      return shallowMount(GShootListRow, {
        props: {
          modelValue: createShoot(namespace, cloudProfileRef),
          visibleHeaders: [],
        },
        global: {
          plugins: [pinia],
        },
      })
    }

    it.each([
      ['regular CloudProfile', 'garden-a', { kind: 'CloudProfile', name: 'parent' }, true],
      ['NamespacedCloudProfile override', 'garden-a', { kind: 'NamespacedCloudProfile', name: 'shared' }, false],
      ['NamespacedCloudProfile parent fallback', 'garden-c', { kind: 'NamespacedCloudProfile', name: 'fallback' }, true],
      ['namespace-qualified duplicate', 'garden-b', { kind: 'NamespacedCloudProfile', name: 'shared' }, true],
      ['sparse NamespacedCloudProfile override', 'garden-d', { kind: 'NamespacedCloudProfile', name: 'sparse' }, true],
    ])('renders a %s row from lightweight data', (label, namespace, cloudProfileRef, expectedWarning) => {
      const wrapper = renderRow(namespace, cloudProfileRef)

      expect(wrapper.element.tagName).toBe('TR')
      expect(wrapper.vm.hasShootWorkerGroupWarning).toBe(expectedWarning)
      expect(statusSpy).not.toHaveBeenCalled()
    })

    it('keeps missing lightweight image data neutral', () => {
      const wrapper = renderRow('garden-a', {
        kind: 'NamespacedCloudProfile',
        name: 'missing',
      })

      expect(wrapper.vm.hasShootWorkerGroupWarning).toBe(false)
      expect(statusSpy).not.toHaveBeenCalled()
    })
  })
})
