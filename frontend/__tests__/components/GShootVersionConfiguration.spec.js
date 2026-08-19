//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  defineComponent,
  h,
  nextTick,
  ref,
} from 'vue'
import {
  createPinia,
  setActivePinia,
} from 'pinia'
import {
  flushPromises,
  shallowMount,
} from '@vue/test-utils'

import { useCloudProfileStore } from '@/store/cloudProfile'

import GShootVersionConfiguration from '@/components/ShootVersion/GShootVersionConfiguration.vue'

import api from '@/composables/useApi/api'

function createCloudProfile () {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name: 'parent' },
    spec: {
      type: 'aws',
      kubernetes: {
        versions: [
          { version: '1.32.1', classification: 'supported' },
          { version: '1.32.2', classification: 'supported' },
        ],
      },
    },
  }
}

function createDescriptor () {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: {
      name: 'custom',
      namespace: 'garden-test',
    },
    spec: {
      parent: {
        kind: 'CloudProfile',
        name: 'parent',
      },
    },
  }
}

function createFullNamespacedCloudProfile () {
  return {
    ...createDescriptor(),
    status: {
      cloudProfileSpec: createCloudProfile().spec,
    },
  }
}

function deferred () {
  let resolvePromise
  const promise = new Promise(resolve => {
    resolvePromise = resolve
  })
  return {
    promise,
    resolve: resolvePromise,
  }
}

describe('components', () => {
  describe('g-shoot-version-configuration', () => {
    let cloudProfileStore
    let getNamespacedCloudProfileStatus
    let updateShootVersion
    let waitForDialogClosed
    let pinia
    let wrapper

    const ActionDialogStub = defineComponent({
      props: {
        valid: {
          type: Boolean,
          default: true,
        },
      },
      setup (props, { expose, slots }) {
        expose({
          waitForDialogClosed: () => waitForDialogClosed(),
          setError: vi.fn(),
        })
        return () => h('div', {
          'data-test': 'action-dialog',
          'data-valid': `${props.valid}`,
        }, slots.content?.())
      },
    })

    function mountComponent (cloudProfileRef) {
      const shootItem = {
        shootNamespace: ref('garden-test'),
        shootName: ref('shoot-test'),
        shootCloudProfileRef: ref(cloudProfileRef),
        shootKubernetesUpdateAvailable: ref(true),
        shootSupportedPatchAvailable: ref(true),
      }
      wrapper = shallowMount(GShootVersionConfiguration, {
        global: {
          plugins: [pinia],
          provide: {
            'shoot-item': shootItem,
            api: {
              updateShootVersion,
            },
            logger: {
              error: vi.fn(),
            },
          },
          stubs: {
            GActionButtonDialog: ActionDialogStub,
            GShootVersionUpdate: true,
            VAlert: {
              template: '<div><slot /></div>',
            },
            VBtn: {
              template: '<button><slot /></button>',
            },
            VCardText: {
              template: '<div><slot /></div>',
            },
            VProgressCircular: true,
          },
        },
      })
      return wrapper
    }

    beforeEach(() => {
      pinia = createPinia()
      setActivePinia(pinia)
      cloudProfileStore = useCloudProfileStore()
      cloudProfileStore.setCloudProfiles([createCloudProfile()])
      cloudProfileStore.setNamespacedCloudProfileDescriptors([createDescriptor()])
      getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
      updateShootVersion = vi.fn()
      waitForDialogClosed = vi.fn().mockResolvedValue(false)
    })

    afterEach(() => {
      wrapper?.unmount()
      vi.restoreAllMocks()
    })

    it('loads one shared full NCP only while the editor is open and reloads it on reopen', async () => {
      const fullCloudProfile = createFullNamespacedCloudProfile()
      getNamespacedCloudProfileStatus.mockResolvedValue({ data: fullCloudProfile })
      mountComponent({ kind: 'NamespacedCloudProfile', name: 'custom' })

      expect(getNamespacedCloudProfileStatus).not.toHaveBeenCalled()

      wrapper.vm.onBeforeConfigurationDialogOpened()
      await flushPromises()

      expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(1)
      expect(getNamespacedCloudProfileStatus).toHaveBeenCalledWith({
        name: 'custom',
        namespace: 'garden-test',
        signal: expect.any(AbortSignal),
      })
      expect(wrapper.vm.cloudProfile).toBe(fullCloudProfile)
      expect(wrapper.get('[data-test="action-dialog"]').attributes('data-valid')).toBe('true')

      wrapper.vm.closeConfigurationDialog()

      expect(wrapper.vm.cloudProfile).toBeNull()

      wrapper.vm.onBeforeConfigurationDialogOpened()
      await flushPromises()

      expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(2)
    })

    it('uses a regular CloudProfile without making a status request', () => {
      mountComponent({ kind: 'CloudProfile', name: 'parent' })

      wrapper.vm.onBeforeConfigurationDialogOpened()

      expect(wrapper.vm.cloudProfile).toBe(cloudProfileStore.list[0])
      expect(getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
    })

    it('shows loading before the full-profile selector becomes interactive', async () => {
      const response = deferred()
      getNamespacedCloudProfileStatus.mockReturnValue(response.promise)
      mountComponent({ kind: 'NamespacedCloudProfile', name: 'custom' })

      wrapper.vm.onBeforeConfigurationDialogOpened()
      await nextTick()

      expect(wrapper.get('[data-test="cloud-profile-loading"]').text()).toContain('Loading cloud profile')
      expect(wrapper.get('[data-test="action-dialog"]').attributes('data-valid')).toBe('false')

      response.resolve({ data: createFullNamespacedCloudProfile() })
      await flushPromises()

      expect(wrapper.find('[data-test="cloud-profile-loading"]').exists()).toBe(false)
      expect(wrapper.get('[data-test="action-dialog"]').attributes('data-valid')).toBe('true')
    })

    it('keeps mutation disabled after a status error and retries the same workflow', async () => {
      const requestError = new Error('status unavailable')
      const fullCloudProfile = createFullNamespacedCloudProfile()
      getNamespacedCloudProfileStatus
        .mockRejectedValueOnce(requestError)
        .mockResolvedValueOnce({ data: fullCloudProfile })
      waitForDialogClosed.mockResolvedValue(true)
      mountComponent({ kind: 'NamespacedCloudProfile', name: 'custom' })

      wrapper.vm.onBeforeConfigurationDialogOpened()
      await flushPromises()

      expect(wrapper.vm.cloudProfileError).toBe(requestError)
      expect(wrapper.get('[data-test="action-dialog"]').attributes('data-valid')).toBe('false')
      expect(wrapper.get('[data-test="cloud-profile-error"]').text()).toContain('status unavailable')
      expect(wrapper.find('[data-test="cloud-profile-retry"]').exists()).toBe(true)

      await wrapper.vm.onConfigurationDialogOpened()

      expect(updateShootVersion).not.toHaveBeenCalled()

      await wrapper.vm.reloadCloudProfile()

      expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(2)
      expect(wrapper.vm.cloudProfile).toBe(fullCloudProfile)
      expect(wrapper.vm.cloudProfileError).toBeNull()
      expect(wrapper.get('[data-test="action-dialog"]').attributes('data-valid')).toBe('true')
    })
  })
})
