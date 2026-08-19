<!--
SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <g-action-button-dialog
    :key="componentKey"
    ref="actionDialog"
    width="1250"
    confirm-required
    caption="Configure Workers"
    :tooltip="dialogTooltip"
    disable-confirm-input-focus
    max-height="80vh"
    :disabled="!hasShootWorkerGroups"
    :valid="isCloudProfileReady"
    @before-dialog-opened="onBeforeConfigurationDialogOpened"
    @dialog-opened="onConfigurationDialogOpened"
  >
    <template #header>
      <v-tabs
        v-model="tab"
        color="primary"
        :disabled="!isCloudProfileReady"
      >
        <v-tab
          key="overview"
          value="overview"
        >
          Overview
        </v-tab>
        <v-tab
          key="yaml"
          value="yaml"
        >
          Yaml
        </v-tab>
      </v-tabs>
    </template>
    <template #content>
      <v-card-text
        v-if="isCloudProfileLoading"
        data-test="cloud-profile-loading"
        class="py-6 text-center"
      >
        <v-progress-circular
          color="primary"
          indeterminate
        />
        <div class="mt-3">
          Loading cloud profile…
        </div>
      </v-card-text>
      <v-card-text v-else-if="cloudProfileError">
        <v-alert
          data-test="cloud-profile-error"
          type="error"
          variant="tonal"
        >
          <div>{{ cloudProfileLoadErrorMessage }}</div>
          <v-btn
            data-test="cloud-profile-retry"
            class="mt-3"
            color="primary"
            variant="text"
            @click="reloadCloudProfile"
          >
            Retry
          </v-btn>
        </v-alert>
      </v-card-text>
      <v-window
        v-else-if="cloudProfile"
        v-model="tab"
      >
        <v-window-item
          ref="overviewTab"
          value="overview"
        >
          <v-card-text>
            <g-manage-workers
              :disable-worker-animation="disableWorkerAnimation"
            />
          </v-card-text>
        </v-window-item>
        <v-window-item value="yaml">
          <div :style="{ 'min-height': `${overviewTabHeight}px` }">
            <g-yaml-editor
              :identifier="injectionKey"
              warning-identifier="workerEditorWarning"
              hide-toolbar
              animate-on-appear
            >
              <template #modificationWarning>
                Directly modifying this resource can result in irreversible configurations that may severely compromise your cluster's stability and functionality.
                Use worker resource editor with caution.
              </template>
            </g-yaml-editor>
          </div>
        </v-window-item>
      </v-window>
    </template>
    <template #footer>
      <v-expand-transition>
        <v-alert
          v-if="isCloudProfileReady && newZonesYaml"
          v-model="newZonesAlert"
          type="warning"
          variant="tonal"
          tile
          prominent
          closable
        >
          <span>Adding addtional zones will extend the zone network configuration by adding new networks to your cluster:</span>
          <g-code-block
            lang="yaml"
            :content="newZonesYaml"
            :show-copy-button="false"
          />
          <div class="font-weight-bold">
            This change cannot be undone.
          </div>
          <div>
            You can verify and modify the network configuration on the <a
              href="#"
              class="text-anchor"
              @click="tab = 'yaml'"
            >yaml</a> tab.
          </div>
        </v-alert>
      </v-expand-transition>
    </template>
  </g-action-button-dialog>
</template>

<script>
import {
  ref,
  computed,
  provide,
} from 'vue'
import { useVuelidate } from '@vuelidate/core'
import { dump as yamlDump } from 'js-yaml'

import GActionButtonDialog from '@/components/dialogs/GActionButtonDialog'
import GCodeBlock from '@/components/GCodeBlock'
import GManageWorkers from '@/components/ShootWorkers/GManageWorkers'
import GYamlEditor from '@/components/GYamlEditor.vue'

import { useProvideShootContext } from '@/composables/useShootContext'
import { useShootItem } from '@/composables/useShootItem'
import { useShootEditor } from '@/composables/useShootEditor'
import { useProvideCloudProfile } from '@/composables/useCloudProfile/useCloudProfile'

import { errorDetailsFromError } from '@/utils/error'
import { v4 as uuidv4 } from '@/utils/uuid'

import map from 'lodash/map'
import isEqual from 'lodash/isEqual'
import pick from 'lodash/pick'
import isEmpty from 'lodash/isEmpty'
import includes from 'lodash/includes'
import filter from 'lodash/filter'
import set from 'lodash/set'
import get from 'lodash/get'

export default {
  components: {
    GActionButtonDialog,
    GManageWorkers,
    GYamlEditor,
    GCodeBlock,
  },
  inject: ['api', 'logger'],
  setup () {
    const {
      shootItem,
      shootNamespace,
      shootName,
      shootCloudProfileRef,
      hasShootWorkerGroups,
    } = useShootItem()

    const workflowActive = ref(false)
    const {
      cloudProfile,
      isLoading: isCloudProfileLoading,
      error: cloudProfileError,
      reload: reloadCloudProfile,
    } = useProvideCloudProfile(shootCloudProfileRef, shootNamespace, {
      enabled: workflowActive,
    })

    const {
      providerWorkers,
      providerInfrastructureConfigNetworksZones,
      initialProviderInfrastructureConfigNetworksZones,
      setShootManifest,
    } = useProvideShootContext({
      cloudProfile,
    })

    const injectionKey = 'shoot-worker-editor'
    const lazyTab = ref('overview')
    const open = ref(false)
    const overviewTabHeight = ref(0)
    const componentKey = ref(uuidv4())
    const disableWorkerAnimation = ref(false)
    const newZonesAlert = ref(true)

    const newZoneNetworks = computed(() => {
      const initialNetworkNames = map(initialProviderInfrastructureConfigNetworksZones.value, 'name')
      return filter(providerInfrastructureConfigNetworksZones.value, ({ name }) => {
        return !includes(initialNetworkNames, name)
      })
    })

    const newZonesYaml = computed(() => {
      return isEmpty(newZoneNetworks.value)
        ? undefined
        : yamlDump(newZoneNetworks.value)
    })

    const editorData = computed({
      get () {
        if (!open.value) {
          return pick(shootItem.value, [
            'spec.provider.workers',
            'spec.provider.infrastructureConfig.networks.zones',
          ])
        }
        const data = {}
        set(data, ['spec', 'provider', 'workers'], providerWorkers.value)
        const zones = providerInfrastructureConfigNetworksZones.value
        if (zones) {
          set(data, ['spec', 'provider', 'infrastructureConfig', 'networks', 'zones'], zones)
        }
        return data
      },
      set (value) {
        providerWorkers.value = get(value, ['spec', 'provider', 'workers'], [])
        const zones = get(value, ['spec', 'provider', 'infrastructureConfig', 'networks', 'zones'])
        if (!isEqual(zones, providerInfrastructureConfigNetworksZones.value)) {
          providerInfrastructureConfigNetworksZones.value = get(value, ['spec', 'provider', 'infrastructureConfig', 'networks', 'zones'])
        }
      },
    })

    const useProvide = (key, value) => {
      provide(key, value)
      return value
    }
    const {
      touched,
      getEditorValue,
      refreshEditor,
    } = useProvide(injectionKey, useShootEditor(editorData, {
      completionPaths: [
        'spec.properties.provider.properties.workers',
        'spec.properties.provider.properties.infrastructureConfig',
      ],
      disableLineHighlighting: true,
    }))

    return {
      v$: useVuelidate(),
      shootItem,
      shootNamespace,
      shootName,
      hasShootWorkerGroups,
      workflowActive,
      cloudProfile,
      isCloudProfileLoading,
      cloudProfileError,
      reloadCloudProfile,
      providerWorkers,
      providerInfrastructureConfigNetworksZones,
      setShootManifest,
      injectionKey,
      open,
      lazyTab,
      overviewTabHeight,
      componentKey,
      disableWorkerAnimation,
      newZonesAlert,
      newZonesYaml,
      editorData,
      touched,
      getEditorValue,
      refreshEditor,
    }
  },
  computed: {
    tab: {
      get () {
        return this.lazyTab
      },
      set (value) {
        this.lazyTab = value
        switch (value) {
          case 'overview': {
            this.touched = false
            this.editorData = this.getEditorValue()
            setTimeout(() => {
              // enable worker group animations after tab navigation animation completed
              this.disableWorkerAnimation = false
            }, 1500)
            break
          }
          case 'yaml': {
            // set current height as min-height for yaml tab to avoid
            // dialog downsize as editor not yet rendered
            this.overviewTabHeight = this.$refs.overviewTab.$el.getBoundingClientRect().height
            this.disableWorkerAnimation = true
            this.refreshEditor()
            break
          }
        }
      },
    },
    dialogTooltip () {
      return !this.hasShootWorkerGroups
        ? 'It is not possible to add worker groups to workerless clusters'
        : undefined
    },
    isCloudProfileReady () {
      return !!this.cloudProfile && !this.isCloudProfileLoading && !this.cloudProfileError
    },
    cloudProfileLoadErrorMessage () {
      if (!this.cloudProfileError?.response && this.cloudProfileError?.message) {
        return this.cloudProfileError.message
      }
      return errorDetailsFromError(this.cloudProfileError).detailedMessage
    },
  },
  methods: {
    onBeforeConfigurationDialogOpened () {
      this.open = true
      this.workflowActive = true
      this.setShootManifest(this.shootItem)
    },
    closeConfigurationDialog () {
      this.open = false
      this.workflowActive = false
      this.lazyTab = 'overview'
      this.componentKey = uuidv4() // force re-render
    },
    async onConfigurationDialogOpened () {
      const confirmed = await this.$refs.actionDialog.waitForDialogClosed()
      if (!confirmed) {
        this.closeConfigurationDialog()
        return
      }
      if (!this.isCloudProfileReady) {
        return
      }
      if (await this.updateConfiguration()) {
        this.closeConfigurationDialog()
      }
    },
    async updateConfiguration () {
      try {
        if (this.lazyTab === 'yaml') {
          this.touched = false
          this.editorData = this.getEditorValue()
        }
        await this.api.patchShootProvider({
          namespace: this.shootNamespace,
          name: this.shootName,
          data: get(this.editorData, ['spec', 'provider']),
        })
        return true
      } catch (err) {
        const errorMessage = 'Could not save worker configuration'
        let detailedErrorMessage
        if (err.response) {
          const errorDetails = errorDetailsFromError(err)
          detailedErrorMessage = errorDetails.detailedMessage
        } else {
          detailedErrorMessage = err.message
        }
        this.$refs.actionDialog.setError({ errorMessage, detailedErrorMessage })
        this.logger.error(errorMessage, detailedErrorMessage, err)
        return false
      }
    },
  },
}
</script>
