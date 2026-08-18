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
  beforeAll,
  afterAll,
  afterEach,
} from 'vitest'
import request from '@gardener-dashboard/request'
import cache from '../../lib/cache/index.js'
import logger from '../../lib/logger/index.js'

const { mockRequest } = request

function getResourceAttributes () {
  return mockRequest.mock.calls.map(([, body]) => body.spec.resourceAttributes)
}

describe('api', function () {
  let agent

  beforeAll(async () => {
    agent = await createAgent()
  })

  afterAll(() => {
    return agent.close()
  })

  afterEach(() => {
    mockRequest.mockReset()
    vi.restoreAllMocks()
  })

  describe('namespaced cloudprofiles', function () {
    const clusterUser = fixtures.user.create({ id: 'john.doe@example.org' })
    const projectUser = fixtures.user.create({ id: 'foo@example.org' })

    it('returns all shallow descriptors to a cluster-authorized user', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())

      const res = await agent
        .get('/api/namespacedcloudprofiles')
        .query({ diff: true })
        .set('cookie', await clusterUser.cookie)
        .expect('content-type', /json/)
        .expect(200)

      const cachedItems = cache.getNamespacedCloudProfiles()
      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(getResourceAttributes()).toEqual([{
        verb: 'list',
        group: 'core.gardener.cloud',
        resource: 'namespacedcloudprofiles',
      }])
      expect(res.body).toEqual(cachedItems)
      expect(res.body.every(item => !Object.hasOwn(item, 'status'))).toBe(true)
      expect(res.body.map(({ metadata, spec }) => ({ metadata, spec })))
        .toEqual(cachedItems.map(({ metadata, spec }) => ({ metadata, spec })))

      const duplicates = res.body.filter(item => item.metadata.name === 'shared-profile')
      expect(duplicates.map(item => item.metadata.namespace).sort())
        .toEqual(['garden-bar', 'garden-foo'])
    })

    it('returns only the requested namespace to a namespace-authorized user', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())

      const res = await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles')
        .set('cookie', await clusterUser.cookie)
        .expect('content-type', /json/)
        .expect(200)

      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(getResourceAttributes()).toEqual([{
        verb: 'list',
        group: 'core.gardener.cloud',
        resource: 'namespacedcloudprofiles',
        namespace: 'garden-foo',
      }])
      expect(res.body).toEqual(cache.getNamespacedCloudProfiles('garden-foo'))
      expect(res.body.every(item => item.metadata.namespace === 'garden-foo')).toBe(true)
      expect(res.body.every(item => !Object.hasOwn(item, 'status'))).toBe(true)
    })

    it('returns only authorized project namespaces to a non-cluster user', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess({ allowed: false }))
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess({ allowed: false }))

      const res = await agent
        .get('/api/namespacedcloudprofiles')
        .set('cookie', await projectUser.cookie)
        .expect('content-type', /json/)
        .expect(200)

      expect(mockRequest).toHaveBeenCalledTimes(3)
      expect(getResourceAttributes()).toEqual([
        {
          verb: 'list',
          group: 'core.gardener.cloud',
          resource: 'namespacedcloudprofiles',
        },
        {
          verb: 'list',
          group: 'core.gardener.cloud',
          resource: 'namespacedcloudprofiles',
          namespace: 'garden-foo',
        },
        {
          verb: 'list',
          group: 'core.gardener.cloud',
          resource: 'namespacedcloudprofiles',
          namespace: 'garden-bar',
        },
      ])
      expect(res.body).toEqual(cache.getNamespacedCloudProfiles('garden-foo'))
      expect(res.body.every(item => item.metadata.namespace === 'garden-foo')).toBe(true)
    })

    it('returns 403 when the requested namespace is unauthorized', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess({
        allowed: false,
      }))

      const res = await agent
        .get('/api/namespaces/garden-secret/namespacedcloudprofiles')
        .set('cookie', await clusterUser.cookie)
        .expect('content-type', /json/)
        .expect(403)

      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(res.body).toEqual(expect.objectContaining({
        code: 403,
        message: 'You are not allowed to list namespaced cloudprofiles in namespace garden-secret',
      }))
    })

    it('retains API gzip compression for sufficiently large responses', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      const [profile] = cache.getNamespacedCloudProfiles('garden-foo')
      profile.spec.compressionFixture = 'x'.repeat(8192)

      try {
        const res = await agent
          .get('/api/namespaces/garden-foo/namespacedcloudprofiles')
          .set('accept-encoding', 'gzip')
          .set('cookie', await clusterUser.cookie)
          .expect('content-encoding', 'gzip')
          .expect(200)

        expect(res.body[0].spec.compressionFixture).toHaveLength(8192)
        expect(res.body[0]).not.toHaveProperty('status')
      } finally {
        delete profile.spec.compressionFixture
      }
    })

    it('traces authorization, cache, serialization, streaming, count, and total time', async function () {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())

      await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles')
        .set('x-request-id', 'namespaced-profile-trace')
        .set('cookie', await clusterUser.cookie)
        .expect(200)

      const traceCall = infoSpy.mock.calls.find(([message]) =>
        message === 'NamespacedCloudProfile list request trace %s for namespace %s: %s')
      expect(traceCall).toBeDefined()
      expect(traceCall[1]).toBe('namespaced-profile-trace')
      expect(traceCall[2]).toBe('garden-foo')
      expect(JSON.parse(traceCall[3])).toEqual({
        authorizationMilliseconds: expect.any(Number),
        cacheMilliseconds: expect.any(Number),
        itemCount: 1,
        serviceMilliseconds: expect.any(Number),
        serializationMilliseconds: expect.any(Number),
        streamingMilliseconds: expect.any(Number),
        totalMilliseconds: expect.any(Number),
        statusCode: 200,
        outcome: 'finished',
      })
    })
  })
})
