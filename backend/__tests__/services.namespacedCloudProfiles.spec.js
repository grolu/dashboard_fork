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
  beforeEach,
} from 'vitest'

vi.mock('../lib/cache/index.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    default: {
      ...original.default,
      getNamespacedCloudProfiles: vi.fn(),
      getProjects: vi.fn(),
    },
  }
})

vi.mock('../lib/services/authorization.js', () => ({
  canGetNamespacedCloudProfileStatus: vi.fn(),
  canListNamespacedCloudProfiles: vi.fn(),
}))

const { default: cache } = await import('../lib/cache/index.js')
const authorization = await import('../lib/services/authorization.js')
const namespacedCloudProfiles = await import('../lib/services/namespacedCloudProfiles.js')

function createProfile (namespace, name = 'shared-profile') {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: {
      name,
      namespace,
      uid: `${namespace}/${name}`,
    },
    spec: {
      parent: {
        kind: 'CloudProfile',
        name: 'parent-profile',
      },
    },
  }
}

function createProject (namespace, member, phase = 'Ready') {
  return {
    spec: {
      namespace,
      members: [{ kind: 'User', name: member }],
    },
    status: { phase },
  }
}

describe('services/namespacedCloudProfiles', () => {
  const getNamespacedCloudProfile = vi.fn()
  const user = {
    id: 'foo@example.org',
    groups: [],
    client: {
      'core.gardener.cloud': {
        namespacedcloudprofiles: {
          get: getNamespacedCloudProfile,
        },
      },
    },
  }
  const profiles = [
    createProfile('garden-foo'),
    createProfile('garden-bar'),
    createProfile('garden-private', 'private-profile'),
  ]

  beforeEach(() => {
    vi.resetAllMocks()
    cache.getNamespacedCloudProfiles.mockImplementation(namespace => {
      if (namespace === undefined) {
        return profiles
      }
      return profiles.filter(profile => profile.metadata.namespace === namespace)
    })
    cache.getProjects.mockReturnValue([
      createProject('garden-foo', user.id),
      createProject('garden-bar', user.id),
      createProject('garden-pending', user.id, 'Pending'),
      createProject('garden-private', 'other@example.org'),
    ])
  })

  it('returns the exact cached namespace descriptors when authorized', async () => {
    authorization.canListNamespacedCloudProfiles.mockResolvedValue(true)
    const namespaceItems = profiles.filter(profile => profile.metadata.namespace === 'garden-foo')
    cache.getNamespacedCloudProfiles.mockReturnValueOnce(namespaceItems)

    const result = await namespacedCloudProfiles.listForNamespace({
      user,
      namespace: 'garden-foo',
    })

    expect(authorization.canListNamespacedCloudProfiles).toHaveBeenCalledExactlyOnceWith(user, 'garden-foo')
    expect(cache.getNamespacedCloudProfiles).toHaveBeenCalledExactlyOnceWith('garden-foo')
    expect(result).toBe(namespaceItems)
    expect(result[0]).toBe(namespaceItems[0])
    expect(result[0]).not.toHaveProperty('status')
  })

  it('rejects unauthorized namespace requests without reading the profile cache', async () => {
    authorization.canListNamespacedCloudProfiles.mockResolvedValue(false)

    await expect(namespacedCloudProfiles.listForNamespace({
      user,
      namespace: 'garden-foo',
    })).rejects.toEqual(expect.objectContaining({
      statusCode: 403,
      message: 'You are not allowed to list namespaced cloudprofiles in namespace garden-foo',
    }))

    expect(cache.getNamespacedCloudProfiles).not.toHaveBeenCalled()
  })

  it('returns the exact complete cache list for cluster-authorized users', async () => {
    authorization.canListNamespacedCloudProfiles.mockResolvedValue(true)

    const result = await namespacedCloudProfiles.listAll({ user })

    expect(authorization.canListNamespacedCloudProfiles).toHaveBeenCalledExactlyOnceWith(user)
    expect(cache.getProjects).not.toHaveBeenCalled()
    expect(cache.getNamespacedCloudProfiles).toHaveBeenCalledExactlyOnceWith()
    expect(result).toBe(profiles)
  })

  it('returns only individually authorized project namespaces for non-cluster users', async () => {
    authorization.canListNamespacedCloudProfiles
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)

    const result = await namespacedCloudProfiles.listAll({ user })

    expect(authorization.canListNamespacedCloudProfiles).toHaveBeenCalledTimes(3)
    expect(authorization.canListNamespacedCloudProfiles).toHaveBeenNthCalledWith(1, user)
    expect(authorization.canListNamespacedCloudProfiles).toHaveBeenNthCalledWith(2, user, 'garden-foo')
    expect(authorization.canListNamespacedCloudProfiles).toHaveBeenNthCalledWith(3, user, 'garden-bar')
    expect(cache.getProjects).toHaveBeenCalledTimes(1)
    expect(cache.getNamespacedCloudProfiles).toHaveBeenCalledExactlyOnceWith()
    expect(result).toEqual([profiles[0]])
    expect(result[0]).toBe(profiles[0])
    expect(result).not.toContain(profiles[1])
    expect(result).not.toContain(profiles[2])
  })

  it('does not leak a namespace when its access review fails', async () => {
    authorization.canListNamespacedCloudProfiles
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('access review failed'))

    const result = await namespacedCloudProfiles.listAll({ user })

    expect(result).toEqual([profiles[0]])
  })

  it('records authorization, cache, item count, and service timings', async () => {
    authorization.canListNamespacedCloudProfiles.mockResolvedValue(true)
    const trace = {}

    await namespacedCloudProfiles.listAll({ user, trace })

    expect(trace).toEqual({
      authorizationMilliseconds: expect.any(Number),
      cacheMilliseconds: expect.any(Number),
      itemCount: profiles.length,
      serviceMilliseconds: expect.any(Number),
    })
  })

  it('fetches one complete profile from the status subresource without using the cache', async () => {
    const signal = new AbortController().signal
    const trace = {}
    const profile = {
      ...createProfile('garden-foo'),
      status: {
        cloudProfileSpec: {
          type: 'infra1',
        },
      },
    }
    authorization.canGetNamespacedCloudProfileStatus.mockResolvedValue(true)
    getNamespacedCloudProfile.mockResolvedValue(profile)

    const result = await namespacedCloudProfiles.getStatus({
      user,
      namespace: 'garden-foo',
      name: 'shared-profile',
      signal,
      trace,
    })

    expect(result).toBe(profile)
    expect(authorization.canGetNamespacedCloudProfileStatus).toHaveBeenCalledExactlyOnceWith(
      user,
      'garden-foo',
      'shared-profile',
      { signal },
    )
    expect(getNamespacedCloudProfile).toHaveBeenCalledExactlyOnceWith(
      'garden-foo',
      ['shared-profile', 'status'],
      { signal },
    )
    expect(cache.getNamespacedCloudProfiles).not.toHaveBeenCalled()
    expect(trace).toEqual({
      authorizationMilliseconds: expect.any(Number),
      upstreamMilliseconds: expect.any(Number),
      serviceMilliseconds: expect.any(Number),
    })
  })

  it('rejects unauthorized status requests without calling Kubernetes or the cache', async () => {
    authorization.canGetNamespacedCloudProfileStatus.mockResolvedValue(false)

    await expect(namespacedCloudProfiles.getStatus({
      user,
      namespace: 'garden-foo',
      name: 'shared-profile',
    })).rejects.toEqual(expect.objectContaining({
      statusCode: 403,
      message: 'You are not allowed to get namespaced cloudprofile shared-profile in namespace garden-foo',
    }))

    expect(getNamespacedCloudProfile).not.toHaveBeenCalled()
    expect(cache.getNamespacedCloudProfiles).not.toHaveBeenCalled()
  })

  it('forwards cancellation to the Kubernetes status request', async () => {
    const abortController = new AbortController()
    let resolveRequestStarted
    const requestStarted = new Promise(resolve => {
      resolveRequestStarted = resolve
    })
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
      code: 'ABORT_ERR',
    })
    authorization.canGetNamespacedCloudProfileStatus.mockResolvedValue(true)
    getNamespacedCloudProfile.mockImplementation((namespace, name, { signal }) => {
      return new Promise((resolve, reject) => {
        resolveRequestStarted()
        signal.addEventListener('abort', () => reject(abortError), { once: true })
      })
    })

    const promise = namespacedCloudProfiles.getStatus({
      user,
      namespace: 'garden-foo',
      name: 'shared-profile',
      signal: abortController.signal,
    })
    await requestStarted
    abortController.abort()

    await expect(promise).rejects.toBe(abortError)
    expect(getNamespacedCloudProfile).toHaveBeenCalledTimes(1)
  })
})
