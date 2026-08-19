//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  defineComponent,
  effectScope,
  h,
  ref,
} from 'vue'
import {
  createPinia,
  setActivePinia,
} from 'pinia'
import {
  flushPromises,
  mount,
} from '@vue/test-utils'

import { useCloudProfileStore } from '@/store/cloudProfile'

import { useApi } from '@/composables/useApi'
import {
  useCloudProfile,
  useProvidedCloudProfile,
  useProvideCloudProfile,
} from '@/composables/useCloudProfile/useCloudProfile'

import { getCloudProfileSpec } from '@/utils'

function createCloudProfile (name = 'parent') {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name },
    spec: {
      type: 'aws',
      machineTypes: [{ name: 'parent-machine' }],
    },
  }
}

function createNamespacedCloudProfileDescriptor (namespace, name = 'custom') {
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
        name: 'parent',
      },
      machineTypes: [{ name: 'override-machine' }],
    },
  }
}

function createFullNamespacedCloudProfile (namespace, name = 'custom') {
  return {
    ...createNamespacedCloudProfileDescriptor(namespace, name),
    status: {
      cloudProfileSpec: {
        type: 'aws',
        machineTypes: [
          { name: 'override-machine' },
          { name: 'parent-machine' },
        ],
      },
    },
  }
}

function deferred () {
  let resolvePromise
  let rejectPromise
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  }
}

describe('useCloudProfile', () => {
  let api
  let cloudProfileStore
  let scopes

  function createComposable (cloudProfileRef, namespace = ref('garden-a')) {
    const scope = effectScope()
    const composable = scope.run(() => useCloudProfile(cloudProfileRef, namespace))
    scopes.push(scope)
    return { composable, scope }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    api = useApi()
    cloudProfileStore = useCloudProfileStore()
    cloudProfileStore.setCloudProfiles([createCloudProfile()])
    cloudProfileStore.setNamespacedCloudProfileDescriptors([
      createNamespacedCloudProfileDescriptor('garden-a'),
      createNamespacedCloudProfileDescriptor('garden-a', 'other'),
    ])
    scopes = []
  })

  afterEach(() => {
    for (const scope of scopes) {
      scope.stop()
    }
    vi.restoreAllMocks()
  })

  it('resolves a regular CloudProfile synchronously without API access', () => {
    const getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
    const cloudProfileRef = ref({ kind: 'CloudProfile', name: 'parent' })

    const { composable } = createComposable(cloudProfileRef)

    expect(composable.cloudProfile.value).toBe(cloudProfileStore.list[0])
    expect(composable.isLoading.value).toBe(false)
    expect(composable.error.value).toBeNull()
    expect(getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
  })

  it('loads one full NamespacedCloudProfile from status and exposes its effective spec', async () => {
    const fullCloudProfile = createFullNamespacedCloudProfile('garden-a')
    const response = deferred()
    const getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
      .mockReturnValue(response.promise)
    const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'custom' })

    const { composable } = createComposable(cloudProfileRef)

    expect(composable.cloudProfile.value).toBeNull()
    expect(composable.isLoading.value).toBe(true)
    expect(composable.error.value).toBeNull()
    expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(1)
    expect(getNamespacedCloudProfileStatus).toHaveBeenCalledWith({
      namespace: 'garden-a',
      name: 'custom',
      signal: expect.any(AbortSignal),
    })

    response.resolve({ data: fullCloudProfile })
    await flushPromises()

    expect(composable.cloudProfile.value).toBe(fullCloudProfile)
    expect(getCloudProfileSpec(composable.cloudProfile.value)).toBe(fullCloudProfile.status.cloudProfileSpec)
    expect(composable.isLoading.value).toBe(false)
    expect(composable.error.value).toBeNull()
  })

  it('exposes request errors, never returns the parent, and retries cleanly', async () => {
    const requestError = new Error('status unavailable')
    const fullCloudProfile = createFullNamespacedCloudProfile('garden-a')
    const getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
      .mockRejectedValueOnce(requestError)
      .mockResolvedValueOnce({ data: fullCloudProfile })
    const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'custom' })
    const { composable } = createComposable(cloudProfileRef)

    await flushPromises()

    expect(composable.cloudProfile.value).toBeNull()
    expect(composable.isLoading.value).toBe(false)
    expect(composable.error.value).toBe(requestError)
    expect(composable.cloudProfile.value).not.toBe(cloudProfileStore.list[0])

    const reloadedCloudProfile = await composable.reload()

    expect(reloadedCloudProfile).toBe(fullCloudProfile)
    expect(composable.cloudProfile.value).toBe(fullCloudProfile)
    expect(composable.error.value).toBeNull()
    expect(composable.isLoading.value).toBe(false)
    expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(2)
  })

  it('aborts and invalidates the old request when the reference changes', async () => {
    const firstResponse = deferred()
    const secondResponse = deferred()
    const getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
      .mockReturnValueOnce(firstResponse.promise)
      .mockReturnValueOnce(secondResponse.promise)
    const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'custom' })
    const { composable } = createComposable(cloudProfileRef)
    const firstSignal = getNamespacedCloudProfileStatus.mock.calls[0][0].signal

    cloudProfileRef.value = { kind: 'NamespacedCloudProfile', name: 'other' }

    expect(firstSignal.aborted).toBe(true)
    expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(2)
    expect(getNamespacedCloudProfileStatus.mock.calls[1][0]).toMatchObject({
      namespace: 'garden-a',
      name: 'other',
    })

    const currentCloudProfile = createFullNamespacedCloudProfile('garden-a', 'other')
    secondResponse.resolve({ data: currentCloudProfile })
    await flushPromises()
    firstResponse.resolve({ data: createFullNamespacedCloudProfile('garden-a') })
    await flushPromises()

    expect(composable.cloudProfile.value).toBe(currentCloudProfile)
    expect(composable.error.value).toBeNull()
    expect(composable.isLoading.value).toBe(false)
  })

  it('aborts the request on scope disposal and ignores its late response', async () => {
    const response = deferred()
    const getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
      .mockReturnValue(response.promise)
    const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'custom' })
    const { composable, scope } = createComposable(cloudProfileRef)
    const signal = getNamespacedCloudProfileStatus.mock.calls[0][0].signal

    scope.stop()

    expect(signal.aborted).toBe(true)
    expect(composable.isLoading.value).toBe(false)
    expect(composable.cloudProfile.value).toBeNull()

    response.resolve({ data: createFullNamespacedCloudProfile('garden-a') })
    await flushPromises()

    expect(composable.cloudProfile.value).toBeNull()
  })

  it('releases a loaded full NamespacedCloudProfile on scope disposal', async () => {
    const fullCloudProfile = createFullNamespacedCloudProfile('garden-a')
    vi.spyOn(api, 'getNamespacedCloudProfileStatus').mockResolvedValue({ data: fullCloudProfile })
    const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'custom' })
    const { composable, scope } = createComposable(cloudProfileRef)
    await flushPromises()

    expect(composable.cloudProfile.value).toBe(fullCloudProfile)

    scope.stop()

    expect(composable.cloudProfile.value).toBeNull()
    expect(composable.error.value).toBeNull()
  })

  it('does not write a loaded full NamespacedCloudProfile to Pinia state', async () => {
    const fullCloudProfile = createFullNamespacedCloudProfile('garden-a')
    vi.spyOn(api, 'getNamespacedCloudProfileStatus').mockResolvedValue({ data: fullCloudProfile })
    const descriptorsBeforeLoading = cloudProfileStore.namespacedCloudProfileDescriptors
    const cloudProfilesBeforeLoading = cloudProfileStore.list
    const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'custom' })
    const { composable } = createComposable(cloudProfileRef)

    await flushPromises()

    expect(composable.cloudProfile.value).toBe(fullCloudProfile)
    expect(cloudProfileStore.namespacedCloudProfileDescriptors).toBe(descriptorsBeforeLoading)
    expect(cloudProfileStore.namespacedCloudProfileDescriptors[0]).not.toHaveProperty('status')
    expect(cloudProfileStore.list).toBe(cloudProfilesBeforeLoading)
    expect(cloudProfileStore.list).not.toContain(fullCloudProfile)
  })

  it('shares one provided result with child consumers', async () => {
    const fullCloudProfile = createFullNamespacedCloudProfile('garden-a')
    const getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
      .mockResolvedValue({ data: fullCloudProfile })
    const cloudProfileRef = ref({ kind: 'NamespacedCloudProfile', name: 'custom' })
    let providedComposable
    let injectedComposable

    const ChildComponent = defineComponent({
      setup () {
        injectedComposable = useProvidedCloudProfile()
        return () => null
      },
    })
    const OwnerComponent = defineComponent({
      setup () {
        providedComposable = useProvideCloudProfile(cloudProfileRef, ref('garden-a'))
        return () => h(ChildComponent)
      },
    })

    const wrapper = mount(OwnerComponent)
    await flushPromises()

    expect(injectedComposable).toBe(providedComposable)
    expect(injectedComposable.cloudProfile.value).toBe(fullCloudProfile)
    expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })
})
