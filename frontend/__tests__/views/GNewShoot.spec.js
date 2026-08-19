//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  nextTick,
  ref,
} from 'vue'
import {
  createPinia,
  setActivePinia,
} from 'pinia'
import { shallowMount } from '@vue/test-utils'

import { useCloudProfileStore } from '@/store/cloudProfile'
import { useConfigStore } from '@/store/config'

import GNewShoot from '@/views/GNewShoot.vue'

describe('views', () => {
  describe('g-new-shoot', () => {
    let api
    let context
    let pinia
    let wrapper

    function createShootContext () {
      return {
        shootNamespace: ref('garden-test'),
        shootName: ref('new-shoot'),
        shootManifest: ref({ metadata: { name: 'new-shoot', namespace: 'garden-test' } }),
        isShootDirty: ref(false),
        workerless: ref(false),
        maintenanceAutoUpdateKubernetesVersion: ref(true),
        maintenanceAutoUpdateMachineImageVersion: ref(true),
        cloudProfile: ref(global.fixtures.cloudprofiles[0]),
        isCloudProfileLoading: ref(false),
        cloudProfileError: ref(null),
        reloadCloudProfile: vi.fn(),
      }
    }

    function mountComponent () {
      wrapper = shallowMount(GNewShoot, {
        global: {
          plugins: [pinia],
          provide: {
            'shoot-context': context,
            api,
            logger: {
              error: vi.fn(),
            },
          },
          stubs: {
            VOverlay: {
              props: ['modelValue'],
              template: '<div data-test="cloud-profile-loading" :data-active="modelValue"><slot /></div>',
            },
            VContainer: {
              template: '<div><slot /></div>',
            },
            VAlert: {
              template: '<div data-test="cloud-profile-error"><slot /></div>',
            },
            VBtn: {
              emits: ['click'],
              template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
            },
          },
        },
      })
    }

    beforeEach(() => {
      pinia = createPinia()
      setActivePinia(pinia)
      useConfigStore().setConfiguration(global.fixtures.config)
      useCloudProfileStore().setCloudProfiles(global.fixtures.cloudprofiles)
      api = {
        createShoot: vi.fn(),
      }
      context = createShootContext()
    })

    afterEach(() => {
      wrapper?.unmount()
    })

    it('blocks the creation UI while the selected full profile is loading', () => {
      context.isCloudProfileLoading.value = true

      mountComponent()

      expect(wrapper.get('[data-test="cloud-profile-loading"]').attributes('data-active')).toBe('true')
      expect(wrapper.text()).toContain('Loading selected cloud profile')
    })

    it('shows a retryable error and prevents creation without a full profile', async () => {
      context.cloudProfile.value = null
      context.cloudProfileError.value = new Error('status unavailable')

      mountComponent()

      expect(wrapper.get('[data-test="cloud-profile-error"]').text()).toContain('status unavailable')
      await wrapper.get('[data-test="cloud-profile-retry"]').trigger('click')
      expect(context.reloadCloudProfile).toHaveBeenCalledTimes(1)

      await wrapper.vm.createClicked()

      expect(api.createShoot).not.toHaveBeenCalled()
      expect(wrapper.vm.errorMessage).toBe('The selected cloud profile is not available.')
    })

    it('returns to the creation form after a retry starts', async () => {
      context.cloudProfile.value = null
      context.cloudProfileError.value = new Error('status unavailable')
      mountComponent()

      context.cloudProfileError.value = null
      context.isCloudProfileLoading.value = true
      await nextTick()

      expect(wrapper.find('[data-test="cloud-profile-error"]').exists()).toBe(false)
      expect(wrapper.get('[data-test="cloud-profile-loading"]').attributes('data-active')).toBe('true')
      expect(wrapper.find('[data-test="shoot-creation-form"]').exists()).toBe(true)
    })
  })
})
