//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  defineComponent,
  h,
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
import { useConfigStore } from '@/store/config'

import GAccessRestrictionsConfiguration from '@/components/ShootAccessRestrictions/GAccessRestrictionsConfiguration.vue'
import GWorkerConfiguration from '@/components/ShootWorkers/GWorkerConfiguration.vue'

import api from '@/composables/useApi/api'

const { createVuetifyPlugin } = global.fixtures.helper

function createCloudProfile () {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'CloudProfile',
    metadata: { name: 'parent' },
    spec: {
      type: 'aws',
      kubernetes: {
        versions: [{ version: '1.32.1', classification: 'supported' }],
      },
      machineTypes: [{ name: 'm5.large', architecture: 'amd64' }],
      machineImages: [{
        name: 'gardenlinux',
        versions: [{
          version: '1877.0.0',
          architectures: ['amd64'],
          classification: 'supported',
        }],
      }],
      volumeTypes: [{ name: 'gp3' }],
      regions: [{
        name: 'eu-west-1',
        zones: [{ name: 'eu-west-1a' }],
        accessRestrictions: [{ name: 'eu-access-only' }],
      }],
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

function createShoot (cloudProfileRef) {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'Shoot',
    metadata: {
      name: 'shoot-test',
      namespace: 'garden-test',
      uid: 'shoot-test-uid',
    },
    spec: {
      cloudProfile: cloudProfileRef,
      region: 'eu-west-1',
      kubernetes: {
        version: '1.32.1',
      },
      networking: {
        nodes: '10.250.0.0/16',
      },
      provider: {
        type: 'aws',
        infrastructureConfig: {
          networks: {
            zones: [{ name: 'eu-west-1a', workers: '10.250.0.0/24' }],
          },
        },
        workers: [{
          name: 'worker',
          minimum: 1,
          maximum: 2,
          machine: {
            architecture: 'amd64',
            type: 'm5.large',
            image: {
              name: 'gardenlinux',
              version: '1877.0.0',
            },
          },
          volume: {
            type: 'gp3',
            size: '50Gi',
          },
          zones: ['eu-west-1a'],
        }],
      },
    },
  }
}

describe('existing Shoot editing profile owners', () => {
  let pinia
  let cloudProfileStore
  let getNamespacedCloudProfileStatus
  let waitForDialogClosed
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

  function createShootItem (cloudProfileRef) {
    return {
      shootItem: ref(createShoot(cloudProfileRef)),
      shootNamespace: ref('garden-test'),
      shootName: ref('shoot-test'),
      shootCloudProfileRef: ref(cloudProfileRef),
      hasShootWorkerGroups: ref(true),
    }
  }

  function commonMountOptions (cloudProfileRef) {
    return {
      global: {
        plugins: [
          createVuetifyPlugin(),
          pinia,
        ],
        provide: {
          'shoot-item': createShootItem(cloudProfileRef),
          'shoot-helper': {
            accessRestrictionDefinitionList: ref([{ key: 'eu-access-only' }]),
            accessRestrictionNoItemsText: ref('No access restrictions'),
          },
          api: {
            patchShoot: vi.fn(),
            patchShootProvider: vi.fn(),
          },
          logger: {
            error: vi.fn(),
          },
        },
        stubs: {
          GActionButtonDialog: ActionDialogStub,
          GAccessRestrictions: true,
          GCodeBlock: true,
          GManageWorkers: true,
          GYamlEditor: true,
        },
      },
    }
  }

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    cloudProfileStore = useCloudProfileStore()
    cloudProfileStore.setCloudProfiles([createCloudProfile()])
    cloudProfileStore.setNamespacedCloudProfileDescriptors([createDescriptor()])
    useConfigStore().setConfiguration(global.fixtures.config)
    getNamespacedCloudProfileStatus = vi.spyOn(api, 'getNamespacedCloudProfileStatus')
    vi.spyOn(api, 'getShootSchemaDefinition').mockResolvedValue({})
    waitForDialogClosed = vi.fn().mockResolvedValue(false)
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.restoreAllMocks()
  })

  it('loads one workflow-local full NCP for all worker catalog fields', async () => {
    const fullCloudProfile = createFullNamespacedCloudProfile()
    getNamespacedCloudProfileStatus.mockResolvedValue({ data: fullCloudProfile })
    const cloudProfileRef = { kind: 'NamespacedCloudProfile', name: 'custom' }
    wrapper = shallowMount(GWorkerConfiguration, commonMountOptions(cloudProfileRef))

    expect(getNamespacedCloudProfileStatus).not.toHaveBeenCalled()

    wrapper.vm.onBeforeConfigurationDialogOpened()
    await flushPromises()

    expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.cloudProfile).toBe(fullCloudProfile)
    expect(wrapper.get('[data-test="action-dialog"]').attributes('data-valid')).toBe('true')

    wrapper.vm.closeConfigurationDialog()

    expect(wrapper.vm.cloudProfile).toBeNull()
  })

  it('does not request status when worker editing uses a regular CloudProfile', () => {
    const cloudProfileRef = { kind: 'CloudProfile', name: 'parent' }
    wrapper = shallowMount(GWorkerConfiguration, commonMountOptions(cloudProfileRef))

    wrapper.vm.onBeforeConfigurationDialogOpened()

    expect(wrapper.vm.cloudProfile).toBe(cloudProfileStore.list[0])
    expect(getNamespacedCloudProfileStatus).not.toHaveBeenCalled()
  })

  it('loads one workflow-local full NCP for access-restriction options', async () => {
    const fullCloudProfile = createFullNamespacedCloudProfile()
    getNamespacedCloudProfileStatus.mockResolvedValue({ data: fullCloudProfile })
    const cloudProfileRef = { kind: 'NamespacedCloudProfile', name: 'custom' }
    wrapper = shallowMount(GAccessRestrictionsConfiguration, commonMountOptions(cloudProfileRef))

    expect(getNamespacedCloudProfileStatus).not.toHaveBeenCalled()

    wrapper.vm.onBeforeConfigurationDialogOpened()
    await flushPromises()

    expect(getNamespacedCloudProfileStatus).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.cloudProfile).toBe(fullCloudProfile)
    expect(wrapper.get('[data-test="action-dialog"]').attributes('data-valid')).toBe('true')

    wrapper.vm.closeConfigurationDialog()

    expect(wrapper.vm.cloudProfile).toBeNull()
  })
})
