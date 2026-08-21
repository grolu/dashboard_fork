//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { ref } from 'vue'
import {
  createPinia,
  setActivePinia,
} from 'pinia'
import {
  flushPromises,
  shallowMount,
} from '@vue/test-utils'

import { useCloudProfileStore } from '@/store/cloudProfile'

import GNewShootEditor from '@/views/GNewShootEditor.vue'

const testState = vi.hoisted(() => ({
  editorValue: null,
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
  useRouter: () => ({
    push: testState.push,
  }),
}))

vi.mock('@/composables/useShootEditor', () => ({
  useShootEditor: () => ({
    clean: { value: true },
    focusEditor: vi.fn(),
    getEditorValue: vi.fn(() => testState.editorValue),
  }),
}))

function createCloudProfile (name = 'parent') {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name },
    spec: { type: 'aws' },
  }
}

function createFullNamespacedCloudProfile (namespace, name) {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: { namespace, name },
    spec: {
      parent: {
        kind: 'CloudProfile',
        name: 'parent',
      },
    },
    status: {
      cloudProfileSpec: { type: 'aws' },
    },
  }
}

const GYamlEditorStub = {
  template: '<div><slot name="errorMessage" /><slot name="toolbarItemsRight" /></div>',
}

const VBtnStub = {
  props: ['text'],
  emits: ['click'],
  template: '<button @click="$emit(\'click\', $event)">{{ text }}</button>',
}

describe('views', () => {
  describe('g-new-shoot-editor', () => {
    let api
    let cloudProfileStore
    let context
    let wrapper

    function mountComponent () {
      wrapper = shallowMount(GNewShootEditor, {
        global: {
          provide: {
            api,
            logger: { error: vi.fn() },
            'shoot-context': context,
          },
          stubs: {
            GConfirmDialog: true,
            GMessage: true,
            GYamlEditor: GYamlEditorStub,
            VBtn: VBtnStub,
          },
        },
      })
    }

    beforeEach(() => {
      const pinia = createPinia()
      setActivePinia(pinia)
      cloudProfileStore = useCloudProfileStore()
      cloudProfileStore.setCloudProfiles([createCloudProfile()])
      cloudProfileStore.setNamespacedCloudProfileDescriptors([])
      api = {
        createShoot: vi.fn().mockResolvedValue(),
        getNamespacedCloudProfileStatus: vi.fn(),
      }
      context = {
        shootNamespace: ref('garden-test'),
        shootManifest: ref({}),
        setShootManifest: vi.fn(),
        isShootDirty: ref(false),
        cloudProfileRef: ref({
          kind: 'CloudProfile',
          name: 'parent',
        }),
        ensureCloudProfileLoaded: vi.fn().mockResolvedValue(cloudProfileStore.list[0]),
      }
      testState.editorValue = null
      testState.push.mockReset()
    })

    afterEach(() => {
      wrapper?.unmount()
      vi.restoreAllMocks()
    })

    it('switches the workflow context to a changed NamespacedCloudProfile before creating from YAML', async () => {
      testState.editorValue = {
        metadata: { name: 'new-shoot' },
        spec: {
          cloudProfile: {
            kind: 'NamespacedCloudProfile',
            name: 'selected-profile',
          },
        },
      }
      const fullCloudProfile = createFullNamespacedCloudProfile('garden-test', 'selected-profile')
      context.ensureCloudProfileLoaded.mockResolvedValue(fullCloudProfile)
      mountComponent()

      await wrapper.get('button').trigger('click')
      await flushPromises()

      expect(context.cloudProfileRef.value).toEqual({
        kind: 'NamespacedCloudProfile',
        name: 'selected-profile',
      })
      expect(context.ensureCloudProfileLoaded).toHaveBeenCalledTimes(1)
      expect(api.getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
      expect(api.createShoot).toHaveBeenCalledExactlyOnceWith({
        namespace: 'garden-test',
        data: testState.editorValue,
      })
      expect(context.ensureCloudProfileLoaded.mock.invocationCallOrder[0])
        .toBeLessThan(api.createShoot.mock.invocationCallOrder[0])
    })

    it('reuses the creation context when the NamespacedCloudProfile selection is unchanged', async () => {
      const fullCloudProfile = createFullNamespacedCloudProfile('garden-test', 'selected-profile')
      context.cloudProfileRef.value = {
        kind: 'NamespacedCloudProfile',
        name: 'selected-profile',
      }
      context.ensureCloudProfileLoaded.mockResolvedValue(fullCloudProfile)
      testState.editorValue = {
        metadata: { name: 'new-shoot' },
        spec: {
          cloudProfile: {
            kind: 'NamespacedCloudProfile',
            name: 'selected-profile',
          },
        },
      }
      mountComponent()

      await wrapper.get('button').trigger('click')
      await flushPromises()

      expect(context.ensureCloudProfileLoaded).toHaveBeenCalledTimes(1)
      expect(api.getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
      expect(api.createShoot).toHaveBeenCalledTimes(1)
    })

    it('uses a cached regular CloudProfile without a status request', async () => {
      testState.editorValue = {
        metadata: { name: 'new-shoot' },
        spec: {
          cloudProfile: {
            kind: 'CloudProfile',
            name: 'parent',
          },
        },
      }
      mountComponent()

      await wrapper.get('button').trigger('click')
      await flushPromises()

      expect(api.getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
      expect(api.createShoot).toHaveBeenCalledTimes(1)
      expect(context.ensureCloudProfileLoaded).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['a failed status request', () => Promise.reject(new Error('status unavailable'))],
      ['no effective status result', () => Promise.resolve(null)],
    ])('does not create when the selected profile has %s', async (_description, response) => {
      testState.editorValue = {
        metadata: { name: 'new-shoot' },
        spec: {
          cloudProfile: {
            kind: 'NamespacedCloudProfile',
            name: 'selected-profile',
          },
        },
      }
      context.ensureCloudProfileLoaded.mockImplementation(response)
      mountComponent()

      await wrapper.get('button').trigger('click')
      await flushPromises()

      expect(context.ensureCloudProfileLoaded).toHaveBeenCalledTimes(1)
      expect(api.getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
      expect(api.createShoot).not.toHaveBeenCalled()
    })
  })
})
