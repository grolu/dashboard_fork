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
import createError from 'http-errors'
import cache from '../../lib/cache/index.js'
import logger from '../../lib/logger/index.js'

const { mockRequest } = request

function getResourceAttributes () {
  return mockRequest.mock.calls.map(([, body]) => body?.spec?.resourceAttributes)
}

function getRequestPaths () {
  return mockRequest.mock.calls.map(([headers]) => headers[':path'])
}

function createFullProfile ({ compressionFixture } = {}) {
  const cachedProfile = cache.getNamespacedCloudProfiles('garden-foo')
    .find(item => item.metadata.name === 'shared-profile')
  const profile = structuredClone(cachedProfile)
  profile.status = {
    cloudProfileSpec: {
      type: 'infra1',
      kubernetes: {
        versions: [{ version: '1.31.1' }],
      },
      machineTypes: profile.spec.machineTypes,
    },
  }
  if (compressionFixture) {
    profile.status.cloudProfileSpec.compressionFixture = compressionFixture
  }
  return { cachedProfile, profile }
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

    it('fetches one complete status resource directly without consulting the shallow cache', async function () {
      const { cachedProfile, profile } = createFullProfile()
      const listCachedProfilesSpy = vi.spyOn(cache, 'getNamespacedCloudProfiles')
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      mockRequest.mockResolvedValueOnce(profile)

      const res = await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles/shared-profile/status')
        .set('cookie', await clusterUser.cookie)
        .expect('cache-control', 'no-store')
        .expect('content-type', /json/)
        .expect(200)

      expect(cachedProfile).not.toHaveProperty('status')
      expect(res.body).toEqual(profile)
      expect(res.body.status.cloudProfileSpec).toEqual(profile.status.cloudProfileSpec)
      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(getResourceAttributes()).toEqual([{
        verb: 'get',
        group: 'core.gardener.cloud',
        resource: 'namespacedcloudprofiles',
        subresource: 'status',
        namespace: 'garden-foo',
        name: 'shared-profile',
      }, undefined])
      expect(getRequestPaths().filter(path => path.endsWith('/status'))).toEqual([
        '/apis/core.gardener.cloud/v1beta1/namespaces/garden-foo/namespacedcloudprofiles/shared-profile/status',
      ])
      expect(listCachedProfilesSpy).not.toHaveBeenCalled()
    })

    it('does not expose the status handler outside a namespace', async function () {
      await agent
        .get('/api/namespacedcloudprofiles/shared-profile/status')
        .set('cookie', await clusterUser.cookie)
        .expect(404)

      expect(mockRequest).not.toHaveBeenCalled()
    })

    it('returns 403 without fetching a status resource when get access is denied', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess({
        allowed: false,
      }))

      const res = await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles/shared-profile/status')
        .set('cookie', await clusterUser.cookie)
        .expect('cache-control', 'no-store')
        .expect(403)

      expect(mockRequest).toHaveBeenCalledTimes(1)
      expect(getResourceAttributes()).toEqual([{
        verb: 'get',
        group: 'core.gardener.cloud',
        resource: 'namespacedcloudprofiles',
        subresource: 'status',
        namespace: 'garden-foo',
        name: 'shared-profile',
      }])
      expect(getRequestPaths().some(path => path.endsWith('/status'))).toBe(false)
      expect(res.body.message).toBe(
        'You are not allowed to get namespaced cloudprofile shared-profile in namespace garden-foo',
      )
    })

    it('preserves a 404 returned by the Kubernetes status endpoint', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      mockRequest.mockRejectedValueOnce(createError(404, 'NamespacedCloudProfile not found'))

      const res = await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles/missing/status')
        .set('cookie', await clusterUser.cookie)
        .expect(404)

      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(getRequestPaths()[1]).toBe(
        '/apis/core.gardener.cloud/v1beta1/namespaces/garden-foo/namespacedcloudprofiles/missing/status',
      )
      expect(res.body).toEqual(expect.objectContaining({
        code: 404,
        message: 'NamespacedCloudProfile not found',
      }))
    })

    it('preserves upstream Kubernetes errors', async function () {
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      mockRequest.mockRejectedValueOnce(createError(503, 'Kubernetes API unavailable'))

      const res = await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles/shared-profile/status')
        .set('cookie', await clusterUser.cookie)
        .expect(503)

      expect(mockRequest).toHaveBeenCalledTimes(2)
      expect(res.body).toEqual(expect.objectContaining({
        code: 503,
        message: 'Kubernetes API unavailable',
      }))
    })

    it('gzip-compresses a large status response', async function () {
      const { profile } = createFullProfile({
        compressionFixture: 'x'.repeat(8192),
      })
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      mockRequest.mockResolvedValueOnce(profile)

      const res = await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles/shared-profile/status')
        .set('accept-encoding', 'gzip')
        .set('cookie', await clusterUser.cookie)
        .expect('content-encoding', 'gzip')
        .expect('cache-control', 'no-store')
        .expect(200)

      expect(res.body.status.cloudProfileSpec.compressionFixture).toHaveLength(8192)
    })

    it('cancels the Kubernetes request when the client disconnects', async function () {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
      let resolveStatusStarted
      const statusStarted = new Promise(resolve => {
        resolveStatusStarted = resolve
      })
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      mockRequest.mockImplementationOnce((headers, { signal }) => {
        resolveStatusStarted(signal)
        return new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      })

      const pendingRequest = agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles/shared-profile/status')
        .set('cookie', await clusterUser.cookie)
      pendingRequest.end(() => {})
      const signal = await statusStarted

      pendingRequest.abort()
      let traceCall
      await vi.waitFor(() => {
        expect(signal.aborted).toBe(true)
        traceCall = infoSpy.mock.calls.find(([message]) =>
          message === 'NamespacedCloudProfile status request trace %s for namespace %s and name %s: %s')
        expect(traceCall).toBeDefined()
      })

      expect(traceCall).toBeDefined()
      expect(JSON.parse(traceCall[4])).toEqual(expect.objectContaining({
        upstreamMilliseconds: expect.any(Number),
        statusCode: 499,
        outcome: 'cancelled',
      }))
    })

    it('traces authorization, Kubernetes fetch, serialization, streaming, and total time', async function () {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {})
      const { profile } = createFullProfile()
      mockRequest.mockImplementationOnce(fixtures.auth.mocks.reviewSelfSubjectAccess())
      mockRequest.mockResolvedValueOnce(profile)

      await agent
        .get('/api/namespaces/garden-foo/namespacedcloudprofiles/shared-profile/status')
        .set('x-request-id', 'namespaced-profile-status-trace')
        .set('cookie', await clusterUser.cookie)
        .expect(200)

      const traceCall = infoSpy.mock.calls.find(([message]) =>
        message === 'NamespacedCloudProfile status request trace %s for namespace %s and name %s: %s')
      expect(traceCall).toBeDefined()
      expect(traceCall[1]).toBe('namespaced-profile-status-trace')
      expect(traceCall[2]).toBe('garden-foo')
      expect(traceCall[3]).toBe('shared-profile')
      expect(JSON.parse(traceCall[4])).toEqual({
        authorizationMilliseconds: expect.any(Number),
        upstreamMilliseconds: expect.any(Number),
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
