//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeEach,
} from 'vitest'
import { Store } from '@gardener-dashboard/kube-client'
import cacheModule from '../lib/cache/index.js'

const cache = cacheModule
const { cache: internalCache } = cacheModule

describe('cache', function () {
  afterEach(() => {
    internalCache.clear()
  })

  it('should dispatch "synchronize" to internal cache', function () {
    const stub = vi.spyOn(internalCache, 'set')
    const a = { store: { id: 1 } }
    const b = { store: { id: 2 } }
    cache.initialize({ a, b })
    expect(stub).toHaveBeenCalledTimes(2)
    expect(stub.mock.calls).toEqual([
      ['a', { id: 1 }],
      ['b', { id: 2 }],
    ])
  })

  it('should dispatch "getCloudProfiles" to internal cache', function () {
    const list = []
    const stub = vi.spyOn(internalCache, 'getCloudProfiles').mockReturnValue(list)
    expect(cache.getCloudProfiles()).toBe(list)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('should return all NamespacedCloudProfiles or filter them by namespace without cloning', function () {
    const resources = [
      {
        apiVersion: 'core.gardener.cloud/v1beta1',
        kind: 'NamespacedCloudProfile',
        metadata: { uid: '1', namespace: 'garden-a', name: 'shared' },
        spec: { parent: { name: 'parent-a' } },
      },
      {
        apiVersion: 'core.gardener.cloud/v1beta1',
        kind: 'NamespacedCloudProfile',
        metadata: { uid: '2', namespace: 'garden-b', name: 'shared' },
        spec: { parent: { name: 'parent-b' } },
      },
      {
        apiVersion: 'core.gardener.cloud/v1beta1',
        kind: 'NamespacedCloudProfile',
        metadata: { uid: '3', namespace: 'garden-a', name: 'other' },
        spec: { parent: { name: 'parent-a' } },
      },
    ]
    const store = new Store()
    store.replace(resources)
    internalCache.set('namespacedcloudprofiles', store)

    expect(cache.getNamespacedCloudProfiles()).toEqual(resources)
    expect(cache.getNamespacedCloudProfiles('garden-a')).toEqual([resources[0], resources[2]])
    expect(cache.getNamespacedCloudProfiles('garden-b')).toEqual([resources[1]])
    expect(cache.getNamespacedCloudProfiles('missing')).toEqual([])
    expect(cache.getNamespacedCloudProfiles()[0]).toBe(resources[0])
    expect(cache.getNamespacedCloudProfiles('garden-a')[1]).toBe(resources[2])
  })

  it('should look up NamespacedCloudProfiles by namespace and name', function () {
    const resources = [
      { metadata: { uid: '1', namespace: 'garden-a', name: 'shared' } },
      { metadata: { uid: '2', namespace: 'garden-b', name: 'shared' } },
    ]
    const store = new Store()
    store.replace(resources)
    internalCache.set('namespacedcloudprofiles', store)

    expect(cache.getNamespacedCloudProfile('garden-a', 'shared')).toBe(resources[0])
    expect(cache.getNamespacedCloudProfile('garden-b', 'shared')).toBe(resources[1])
    expect(cache.getNamespacedCloudProfile('garden-a', 'missing')).toBeUndefined()
  })

  it('should dispatch "getQuotas" to internal cache', function () {
    const list = []
    const stub = vi.spyOn(internalCache, 'getQuotas').mockReturnValue(list)
    expect(cache.getQuotas()).toBe(list)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('should dispatch "getSeeds" to internal cache', function () {
    const list = []
    const stub = vi.spyOn(internalCache, 'getSeeds').mockReturnValue(list)
    expect(cache.getSeeds()).toBe(list)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('should dispatch "getProjects" to internal cache', function () {
    const list = []
    const stub = vi.spyOn(internalCache, 'getProjects').mockReturnValue(list)
    expect(cache.getProjects()).toBe(list)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('should dispatch "getShoots" to internal cache', function () {
    const list = [
      { metadata: { uid: 1, namespace: 'foo' } },
      { metadata: { uid: 2, namespace: 'bar' } },
    ]
    const store = new Store()
    store.replace(list)
    internalCache.set('shoots', store)
    expect(cache.getShoots('_all')).toEqual(list)
    expect(cache.getShoots('foo')).toEqual(list.slice(0, 1))
    expect(cache.getShoots('bar')).toEqual(list.slice(1, 2))
    expect(() => cache.getShoots()).toThrow(TypeError)
  })

  it('should dispatch "getShoot" to internal cache', function () {
    const store = new Store()
    store.replace(fixtures.shoots.list())
    internalCache.set('shoots', store)
    expect(cache.getShoot('garden-foo', 'fooShoot')).toBe(store.getByKey(1))
  })

  it('should dispatch "getShootByUid" to internal cache', function () {
    const store = new Store()
    store.replace(fixtures.shoots.list())
    internalCache.set('shoots', store)
    const object = store.getByKey(1)
    expect(cache.getShootByUid(object.metadata.uid)).toBe(object)
  })

  it('should dispatch "getControllerRegistrations" to internal cache', function () {
    const list = []
    const stub = vi.spyOn(internalCache, 'getControllerRegistrations').mockReturnValue(list)
    expect(cache.getControllerRegistrations()).toBe(list)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  it('should dispatch "getResourceQuotas" to internal cache', function () {
    const list = []
    const stub = vi.spyOn(internalCache, 'getResourceQuotas').mockReturnValue(list)
    expect(cache.getResourceQuotas()).toBe(list)
    expect(stub).toHaveBeenCalledTimes(1)
  })

  describe('Cache', function () {
    const Cache = internalCache.constructor
    let cache

    beforeEach(function () {
      cache = new Cache()
    })

    describe('#getTicketCache', function () {
      it('should return the ticket cache', function () {
        expect(cache.size).toBe(0)
        expect(cache.getTicketCache()).toBe(cache.ticketCache)
      })
    })

    describe('#getShootsBySeedName', function () {
      it('should return an empty iterable when no shoots are indexed for the seed', function () {
        expect(Array.from(cache.getShootsBySeedName('missing-seed'))).toEqual([])
      })

      it('should return indexed shoots for the given seed name', function () {
        const handlers = new Map()
        cache.indexShootsBySeedName({
          on (event, handler) {
            handlers.set(event, handler)
          },
        })

        const add = handlers.get('add')
        for (const shoot of fixtures.shoots.list()) {
          add(shoot)
        }

        expect(Array.from(cache.getShootsBySeedName('infra1-seed'))).toHaveLength(3)
        expect(Array.from(cache.getShootsBySeedName('soil-infra1'))).toHaveLength(1)
      })
    })
  })
})
