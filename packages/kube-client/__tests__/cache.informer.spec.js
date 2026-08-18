//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { vi } from 'vitest'
import { Informer, ListWatcher, Store, Reflector } from '../lib/cache/index.js'
import { Foo } from './fixtures/resources.js'

describe('kube-client', () => {
  describe('cache', () => {
    const a = { uid: 1, value: 'a' }
    const b = { uid: 2, value: 'b' }
    const c = { uid: 3, value: 'c' }
    const x = { uid: 1, value: 'x' }
    const y = { uid: 2, value: 'y' }
    const z = { uid: 3, value: 'z' }

    describe('Informer', () => {
      let listFunc
      let watchFunc
      let externalAbortController
      let listWatcher
      let informer
      let internalAbortController
      let store
      let reflector

      beforeEach(() => {
        externalAbortController = new AbortController()
        listFunc = vi.fn()
        watchFunc = vi.fn()
        listWatcher = new ListWatcher(listFunc, watchFunc, Foo)
        informer = Informer.createTestingInformer(listWatcher, { keyPath: 'uid' })
        informer.emit = vi.fn()
        internalAbortController = informer.abortController
        internalAbortController.abort = vi.fn()
        store = informer.store
        reflector = informer.reflector
        reflector.run = vi.fn()
      })

      it('should create, run and abort an informer', async () => {
        expect(store).toBeInstanceOf(Store)
        expect(reflector).toBeInstanceOf(Reflector)
        expect(internalAbortController).toBeInstanceOf(AbortController)
        expect(informer.names).toEqual(Foo.names)
        expect(informer.store).toBe(store)
        expect(informer.hasSynced).toBe(store.hasSynced)
        expect(informer.lastSyncResourceVersion).toBe(reflector.lastSyncResourceVersion)
        informer.run(externalAbortController.signal)
        expect(reflector.run).toHaveBeenCalledTimes(1)
        expect(reflector.run.mock.calls[0]).toHaveLength(1)
        expect(reflector.run.mock.calls[0][0]).toBe(internalAbortController.signal)
        externalAbortController.abort()
        expect(internalAbortController.abort).toHaveBeenCalledTimes(1)
      })

      it('should reject an invalid transform option', function () {
        expect(() => Informer.createTestingInformer(listWatcher, { transform: true }))
          .toThrow('The transform option must be a function')
      })

      it('should transform listed and watched resources before storing and emitting them', async function () {
        const transform = vi.fn(object => ({
          ...object,
          transformed: true,
        }))
        const transformedInformer = Informer.createTestingInformer(listWatcher, {
          keyPath: 'uid',
          transform,
        })
        transformedInformer.emit = vi.fn()
        const transformedStore = transformedInformer.store
        const transformedReflector = transformedInformer.reflector

        transformedReflector.store.replace([a, b])
        await transformedStore.untilHasSynced

        expect(transformedStore.list()).toEqual([
          { ...a, transformed: true },
          { ...b, transformed: true },
        ])
        expect(transformedInformer.emit.mock.calls).toEqual([
          ['add', { ...a, transformed: true }],
          ['add', { ...b, transformed: true }],
        ])

        transformedReflector.store.add(c)
        transformedReflector.store.update(x)
        transformedReflector.store.delete(b)

        expect(transformedStore.list()).toEqual([
          { ...x, transformed: true },
          { ...c, transformed: true },
        ])
        expect(transform).toHaveBeenCalledTimes(5)
        expect(transformedInformer.emit.mock.calls.slice(2)).toEqual([
          ['add', { ...c, transformed: true }],
          ['update', { ...x, transformed: true }, { ...a, transformed: true }],
          ['delete', { ...b, transformed: true }],
        ])
      })

      it('should replace store data', async () => {
        reflector.store.replace([a, b, c])
        expect(store.list()).toEqual([a, b, c])
        expect(informer.emit).toHaveBeenCalledTimes(3)
        expect(informer.emit.mock.calls).toEqual([
          ['add', a],
          ['add', b],
          ['add', c],
        ])
        informer.emit.mockClear()

        reflector.store.delete(c)
        expect(store.list()).toEqual([a, b])
        expect(informer.emit).toHaveBeenCalledTimes(1)
        expect(informer.emit.mock.calls).toEqual([
          ['delete', c],
        ])
        informer.emit.mockClear()

        reflector.store.add(x)
        expect(store.list()).toEqual([x, b])
        expect(informer.emit).toHaveBeenCalledTimes(1)
        expect(informer.emit.mock.calls).toEqual([
          ['update', x, a],
        ])
        informer.emit.mockClear()

        reflector.store.update(y)
        expect(store.list()).toEqual([x, y])
        expect(informer.emit).toHaveBeenCalledTimes(1)
        expect(informer.emit.mock.calls).toEqual([
          ['update', y, b],
        ])
        informer.emit.mockClear()

        reflector.store.update(z)
        expect(store.list()).toEqual([x, y, z])
        expect(informer.emit).toHaveBeenCalledTimes(1)
        expect(informer.emit.mock.calls).toEqual([
          ['add', z],
        ])
        informer.emit.mockClear()

        reflector.store.replace([a, b])
        expect(store.list()).toEqual([a, b])
        expect(informer.emit).toHaveBeenCalledTimes(3)
        expect(informer.emit.mock.calls).toEqual([
          ['update', a, x],
          ['update', b, y],
          ['delete', z],
        ])
        informer.emit.mockClear()
      })
    })
  })
})
