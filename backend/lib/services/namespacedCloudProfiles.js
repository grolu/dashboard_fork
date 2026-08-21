//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import httpErrors from 'http-errors'
import * as authorization from './authorization.js'
import cache from '../cache/index.js'
import { projectFilter } from '../utils/index.js'
const { Forbidden } = httpErrors

function measure (trace, key, fn) {
  if (!trace) {
    return fn()
  }
  const startedAt = performance.now()
  try {
    return fn()
  } finally {
    const duration = (Reflect.get(trace, key) ?? 0) + performance.now() - startedAt
    Reflect.set(trace, key, duration)
  }
}

async function measureAsync (trace, key, fn) {
  if (!trace) {
    return fn()
  }
  const startedAt = performance.now()
  try {
    return await fn()
  } finally {
    const duration = (Reflect.get(trace, key) ?? 0) + performance.now() - startedAt
    Reflect.set(trace, key, duration)
  }
}

function getProjectNamespaces (user, trace) {
  return measure(trace, 'cacheMilliseconds', () => {
    const isAccessibleProject = projectFilter(user, false)
    return [...new Set(cache.getProjects()
      .filter(isAccessibleProject)
      .map(project => project.spec.namespace)
      .filter(Boolean))]
  })
}

async function getAuthorizedProjectNamespaces (user, trace) {
  const namespaces = getProjectNamespaces(user, trace)
  const results = await measureAsync(
    trace,
    'authorizationMilliseconds',
    () => Promise.allSettled(namespaces.map(async namespace => ({
      namespace,
      allowed: await authorization.canListNamespacedCloudProfiles(user, namespace),
    }))),
  )

  return new Set(results
    .filter(result => result.status === 'fulfilled' && result.value.allowed)
    .map(result => result.value.namespace))
}

export async function listForNamespace ({ user, namespace, trace }) {
  const startedAt = trace ? performance.now() : undefined
  try {
    const allowed = await measureAsync(
      trace,
      'authorizationMilliseconds',
      () => authorization.canListNamespacedCloudProfiles(user, namespace),
    )
    if (!allowed) {
      throw new Forbidden(`You are not allowed to list namespaced cloudprofiles in namespace ${namespace}`)
    }

    const items = measure(
      trace,
      'cacheMilliseconds',
      () => cache.getNamespacedCloudProfiles(namespace),
    )
    if (trace) {
      trace.itemCount = items.length
    }
    return items
  } finally {
    if (trace) {
      trace.serviceMilliseconds = performance.now() - startedAt
    }
  }
}

export async function listAll ({ user, trace }) {
  const startedAt = trace ? performance.now() : undefined
  try {
    const canListAll = await measureAsync(
      trace,
      'authorizationMilliseconds',
      () => authorization.canListNamespacedCloudProfiles(user),
    )

    let authorizedNamespaces
    if (!canListAll) {
      authorizedNamespaces = await getAuthorizedProjectNamespaces(user, trace)
    }

    let items = measure(
      trace,
      'cacheMilliseconds',
      () => cache.getNamespacedCloudProfiles(),
    )
    if (authorizedNamespaces) {
      items = items.filter(item => authorizedNamespaces.has(item.metadata.namespace))
    }
    if (trace) {
      trace.itemCount = items.length
    }
    return items
  } finally {
    if (trace) {
      trace.serviceMilliseconds = performance.now() - startedAt
    }
  }
}

export async function getStatus ({ user, namespace, name, signal, trace }) {
  const startedAt = trace ? performance.now() : undefined
  try {
    const allowed = await measureAsync(
      trace,
      'authorizationMilliseconds',
      () => authorization.canGetNamespacedCloudProfileStatus(user, namespace, name, { signal }),
    )
    if (!allowed) {
      throw new Forbidden(`You are not allowed to get namespaced cloudprofile ${name} in namespace ${namespace}`)
    }

    return await measureAsync(
      trace,
      'upstreamMilliseconds',
      () => user.client['core.gardener.cloud'].namespacedcloudprofiles.get(
        namespace,
        [name, 'status'],
        { signal },
      ),
    )
  } finally {
    if (trace) {
      trace.serviceMilliseconds = performance.now() - startedAt
    }
  }
}
