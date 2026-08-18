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
import { transformNamespacedCloudProfile } from '../lib/cache/transforms.js'

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
})
