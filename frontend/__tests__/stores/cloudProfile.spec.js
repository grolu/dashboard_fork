//
// SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  setActivePinia,
  createPinia,
} from 'pinia'

import { useAuthzStore } from '@/store/authz'
import { useConfigStore } from '@/store/config'
import { useCloudProfileStore } from '@/store/cloudProfile'

import { useApi } from '@/composables/useApi'
import { firstItemMatchingVersionClassification } from '@/composables/helper'

function createCloudProfile (name, type) {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name },
    spec: { type },
  }
}

function createNamespacedCloudProfileDescriptor (namespace, name = 'shared-profile', parentName = 'parent') {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: {
      annotations: {
        'dashboard.gardener.cloud/test': `${namespace}/${name}`,
      },
      managedFields: [{ manager: 'test' }],
      name,
      namespace,
      uid: `${namespace}/${name}`,
    },
    spec: {
      parent: {
        kind: 'CloudProfile',
        name: parentName,
      },
      machineTypes: [{ name: `${namespace}-large` }],
    },
    status: {
      cloudProfileSpec: {
        type: 'must-not-be-stored',
      },
    },
  }
}

function deferred () {
  let resolvePromise
  const promise = new Promise(resolve => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

describe('stores', () => {
  describe('cloudProfile', () => {
    const namespace = 'default'

    let authzStore
    let configStore
    let cloudProfileStore

    afterEach(() => {
      vi.restoreAllMocks()
    })

    beforeAll(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-01-01'))
    })

    afterAll(() => {
      vi.useRealTimers()
    })

    beforeEach(async () => {
      setActivePinia(createPinia())
      authzStore = useAuthzStore()
      authzStore._setNamespace(namespace)
      configStore = useConfigStore()
      configStore.setConfiguration({
        defaultNodesCIDR: '10.10.0.0/16',
        vendorHints: [{
          type: 'warning',
          message: 'test',
          matchNames: ['gardenlinux'],
        }],
      })
      cloudProfileStore = useCloudProfileStore()
      cloudProfileStore.setCloudProfiles([])
    })

    describe('namespaced cloud profile descriptors', () => {
      it('loads all shallow descriptors once and stores no status', async () => {
        const descriptor = createNamespacedCloudProfileDescriptor('garden-a')
        const api = useApi()
        const getNamespacedCloudProfiles = vi.spyOn(api, 'getNamespacedCloudProfiles').mockResolvedValue({
          data: [descriptor],
        })
        cloudProfileStore.$reset()
        cloudProfileStore.setCloudProfiles([])

        await Promise.all([
          cloudProfileStore.fetchNamespacedCloudProfileDescriptors(),
          cloudProfileStore.fetchNamespacedCloudProfileDescriptors(),
        ])
        await cloudProfileStore.fetchNamespacedCloudProfileDescriptors()

        expect(getNamespacedCloudProfiles).toHaveBeenCalledTimes(1)
        expect(cloudProfileStore.namespacedCloudProfileDescriptors).toEqual([{
          apiVersion: descriptor.apiVersion,
          kind: descriptor.kind,
          metadata: descriptor.metadata,
          spec: descriptor.spec,
        }])
        expect(cloudProfileStore.namespacedCloudProfileDescriptors[0]).not.toHaveProperty('status')
      })

      it('filters locally by namespace and resolves duplicate names using the Shoot namespace', () => {
        const gardenA = createNamespacedCloudProfileDescriptor('garden-a')
        const gardenB = createNamespacedCloudProfileDescriptor('garden-b')
        const api = useApi()
        const getNamespacedCloudProfiles = vi.spyOn(api, 'getNamespacedCloudProfiles')
        cloudProfileStore.setNamespacedCloudProfileDescriptors([gardenA, gardenB])
        const ref = {
          kind: 'NamespacedCloudProfile',
          name: 'shared-profile',
        }

        expect(cloudProfileStore.namespacedCloudProfileDescriptorByRef(ref, 'garden-a')?.metadata.uid)
          .toBe('garden-a/shared-profile')
        expect(cloudProfileStore.namespacedCloudProfileDescriptorByRef(ref, 'garden-b')?.metadata.uid)
          .toBe('garden-b/shared-profile')
        expect(cloudProfileStore.namespacedCloudProfileDescriptorByRef(ref)).toBeNull()
        expect(cloudProfileStore.namespacedCloudProfileDescriptorByRef(ref, 'garden-unknown')).toBeNull()
        expect(getNamespacedCloudProfiles).not.toHaveBeenCalled()
      })

      it('resolves the regular parent without exposing the override spec as an effective profile', () => {
        const parent = createCloudProfile('parent', 'aws')
        const descriptor = createNamespacedCloudProfileDescriptor('garden-a')
        cloudProfileStore.setCloudProfiles([parent])
        cloudProfileStore.setNamespacedCloudProfileDescriptors([descriptor])

        const storedDescriptor = cloudProfileStore.namespacedCloudProfileDescriptors[0]
        expect(cloudProfileStore.parentCloudProfileForDescriptor(storedDescriptor)).toEqual(parent)
        expect(cloudProfileStore.parentCloudProfileForDescriptor()).toBeNull()
        expect(cloudProfileStore.cloudProfileList).toEqual([parent])
        expect(cloudProfileStore.cloudProfileByRef({
          kind: 'NamespacedCloudProfile',
          name: descriptor.metadata.name,
        })).toBeNull()
      })

      it('groups namespace-local shallow descriptors by their parent provider type', () => {
        const awsParent = createCloudProfile('parent', 'aws')
        const gcpParent = createCloudProfile('gcp-parent', 'gcp')
        const gardenAws = createNamespacedCloudProfileDescriptor('garden-a', 'aws-custom')
        const gardenGcp = createNamespacedCloudProfileDescriptor('garden-a', 'gcp-custom', 'gcp-parent')
        const otherAws = createNamespacedCloudProfileDescriptor('garden-b', 'aws-other')
        const api = useApi()
        const getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
        cloudProfileStore.setCloudProfiles([awsParent, gcpParent])
        cloudProfileStore.setNamespacedCloudProfileDescriptors([gardenGcp, otherAws, gardenAws])

        expect(cloudProfileStore.namespacedCloudProfilesByProviderType('aws', 'garden-a'))
          .toEqual([expect.objectContaining({ metadata: expect.objectContaining({ name: 'aws-custom' }) })])
        expect(cloudProfileStore.namespacedCloudProfilesByProviderType('gcp', 'garden-a'))
          .toEqual([expect.objectContaining({ metadata: expect.objectContaining({ name: 'gcp-custom' }) })])
        expect(cloudProfileStore.namespacedCloudProfilesByProviderType('aws', 'garden-b'))
          .toEqual([expect.objectContaining({ metadata: expect.objectContaining({ name: 'aws-other' }) })])
        expect(cloudProfileStore.namespacedCloudProfilesByProviderType('aws')).toEqual([])
        expect(getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
      })

      it('clears descriptors on reset', () => {
        cloudProfileStore.setNamespacedCloudProfileDescriptors([
          createNamespacedCloudProfileDescriptor('garden-a'),
        ])

        cloudProfileStore.$reset()

        expect(cloudProfileStore.namespacedCloudProfileDescriptors).toBeNull()
        expect(cloudProfileStore.areNamespacedCloudProfileDescriptorsInitial).toBe(true)
      })

      it('does not allow stale initialization responses to repopulate a reset store', async () => {
        const cloudProfilesResponse = deferred()
        const namespacedCloudProfilesResponse = deferred()
        const api = useApi()
        vi.spyOn(api, 'getCloudProfiles').mockReturnValue(cloudProfilesResponse.promise)
        vi.spyOn(api, 'getNamespacedCloudProfiles').mockReturnValue(namespacedCloudProfilesResponse.promise)
        cloudProfileStore.$reset()

        const initialization = Promise.all([
          cloudProfileStore.fetchCloudProfiles(),
          cloudProfileStore.fetchNamespacedCloudProfileDescriptors(),
        ])
        cloudProfileStore.$reset()
        cloudProfilesResponse.resolve({ data: [createCloudProfile('parent', 'aws')] })
        namespacedCloudProfilesResponse.resolve({
          data: [createNamespacedCloudProfileDescriptor('garden-a')],
        })
        await initialization

        expect(cloudProfileStore.list).toBeNull()
        expect(cloudProfileStore.namespacedCloudProfileDescriptors).toBeNull()
      })
    })

    describe('helper', () => {
      describe('#firstItemMatchingVersionClassification', () => {
        it('should select default item that matches version classification', () => {
          const items = [
            {
              version: '1',
              classification: 'deprecated',
            },
            {
              version: '2',
            },
            {
              version: '3',
              classification: 'supported',
            },
          ]

          let item = firstItemMatchingVersionClassification(items)
          expect(item.version).toBe('3')

          items.pop()
          item = firstItemMatchingVersionClassification(items)
          expect(item.version).toBe('2')

          items.pop()
          item = firstItemMatchingVersionClassification(items)
          expect(item.version).toBe('1')
        })
      })
    })
  })
})
