//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  describe,
  it,
  expect,
} from 'vitest'
import {
  Informer,
  ListWatcher,
} from '../../packages/kube-client/lib/cache/index.js'
import { transformNamespacedCloudProfile } from '../lib/cache/transforms.js'

const namespacedCloudProfileResource = {
  group: 'core.gardener.cloud',
  version: 'v1beta1',
  names: {
    kind: 'NamespacedCloudProfile',
    plural: 'namespacedcloudprofiles',
  },
}

function createNamespacedCloudProfileScaleFixture (statusPayloadSize) {
  return Array.from({ length: 1_000 }, (_, index) => ({
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: {
      annotations: {
        'dashboard.gardener.cloud/fixture': `garden-${index % 100}/profile-${index}`,
      },
      creationTimestamp: '2026-08-18T10:00:00Z',
      generation: 2,
      labels: {
        environment: `garden-${index % 100}`,
      },
      managedFields: [{ manager: 'fixture' }],
      name: `profile-${index}`,
      namespace: `garden-${index % 100}`,
      resourceVersion: String(100_000 + index),
      uid: `profile-${index}-uid`,
    },
    spec: {
      parent: {
        kind: 'CloudProfile',
        name: `parent-${index % 4}`,
      },
      machineTypes: [{ name: `machine-${index % 8}` }],
    },
    status: {
      cloudProfileSpec: {
        payload: 'x'.repeat(statusPayloadSize),
      },
    },
  }))
}

function synchronizeNamespacedCloudProfileInformer (resources) {
  const listWatcher = new ListWatcher(
    async () => {},
    async () => {},
    namespacedCloudProfileResource,
  )
  const informer = Informer.createTestingInformer(listWatcher, {
    transform: transformNamespacedCloudProfile,
  })
  informer.reflector.store.replace(resources)
  expect(informer.store.hasSynced).toBe(true)
  return informer.store.list()
}

describe('cache transforms', function () {
  it('should shallowly remove only status from NamespacedCloudProfiles', function () {
    const metadata = {
      name: 'profile',
      namespace: 'garden-project',
      uid: 'profile-uid',
      annotations: {
        'example.test/preserved': 'true',
      },
      managedFields: [{ manager: 'gardener-apiserver', fieldsV1: { large: 'metadata' } }],
    }
    const spec = {
      parent: {
        kind: 'CloudProfile',
        name: 'parent-profile',
      },
    }
    const status = {
      cloudProfileSpec: {
        machineImages: Array.from({ length: 1_000 }, (_, index) => ({
          name: `image-${index}`,
        })),
      },
    }
    const resource = {
      apiVersion: 'core.gardener.cloud/v1beta1',
      kind: 'NamespacedCloudProfile',
      metadata,
      spec,
      status,
    }

    const transformedResource = transformNamespacedCloudProfile(resource)

    expect(transformedResource).toEqual({
      apiVersion: resource.apiVersion,
      kind: resource.kind,
      metadata,
      spec,
    })
    expect(transformedResource).not.toBe(resource)
    expect(transformedResource.metadata).toBe(metadata)
    expect(transformedResource.spec).toBe(spec)
    expect(resource.status).toBe(status)
  })

  it('keeps a 1,000-profile cache payload independent of status size', function () {
    const smallStatusResources = createNamespacedCloudProfileScaleFixture(1)
    const largeStatusResources = createNamespacedCloudProfileScaleFixture(8_192)

    const smallDescriptors = synchronizeNamespacedCloudProfileInformer(smallStatusResources)
    const largeDescriptors = synchronizeNamespacedCloudProfileInformer(largeStatusResources)

    expect(smallDescriptors).toHaveLength(1_000)
    expect(largeDescriptors).toEqual(smallDescriptors)
    expect(Buffer.byteLength(JSON.stringify(largeDescriptors)))
      .toBe(Buffer.byteLength(JSON.stringify(smallDescriptors)))

    for (const [index, descriptor] of largeDescriptors.entries()) {
      const source = largeStatusResources[index]
      expect(descriptor).not.toHaveProperty('status')
      expect(descriptor.apiVersion).toBe(source.apiVersion)
      expect(descriptor.kind).toBe(source.kind)
      expect(descriptor.metadata).toBe(source.metadata)
      expect(descriptor.spec).toBe(source.spec)
      expect(source).toHaveProperty('status.cloudProfileSpec.payload')
    }
  })
})
