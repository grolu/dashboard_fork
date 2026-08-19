<!--
SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <g-action-button-dialog
    ref="actionDialog"
    :icon="shootSupportedPatchAvailable ? 'mdi-arrow-up-bold-circle' : 'mdi-arrow-up-bold-circle-outline'"
    width="450"
    caption="Update Cluster"
    confirm-button-text="Update"
    :confirm-required="confirmRequired"
    :text="buttonText"
    :disabled="!canUpdate"
    :valid="isCloudProfileReady"
    @before-dialog-opened="onBeforeConfigurationDialogOpened"
    @dialog-opened="onConfigurationDialogOpened"
  >
    <template #content>
      <v-card-text>
        <div
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
        </div>
        <v-alert
          v-else-if="cloudProfileError"
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
        <g-shoot-version-update
          v-else-if="cloudProfile"
          v-model="selectedItem"
        />
        <template v-if="!v$.$invalid && selectedVersionType === 'minor'">
          <div class="my-2">
            You should always test your scenario and back up all your data before attempting an upgrade. Don’t forget to include the workload inside your cluster!
          </div>
          <div class="my-2">
            You should consider the
            <a
              href="https://github.com/kubernetes/kubernetes/releases"
              target="_blank"
              rel="noopener"
              class="text-anchor"
            >
              Kubernetes release notes
              <v-icon style="font-size:80%">mdi-open-in-new</v-icon>
            </a>
            before upgrading your cluster.
          </div>
          <div class="my-2">
            Type <strong>{{ shootName }}</strong> below and confirm to upgrade the Kubernetes version of your cluster.
          </div>
          <div class="my-2 font-weight-bold">
            This action cannot be undone.
          </div>
        </template>
        <template v-if="!v$.$invalid && selectedVersionType === 'patch'">
          <div class="my-2">
            Applying a patch to your cluster will increase the Kubernetes version which can lead to unexpected side effects.
          </div>
          <div class="my-2 font-weight-bold">
            This action cannot be undone.
          </div>
        </template>
      </v-card-text>
    </template>
  </g-action-button-dialog>
</template>

<script>
import { ref } from 'vue'
import { useVuelidate } from '@vuelidate/core'

import GShootVersionUpdate from '@/components/ShootVersion/GShootVersionUpdate.vue'
import GActionButtonDialog from '@/components/dialogs/GActionButtonDialog'

import { useShootItem } from '@/composables/useShootItem'
import { useProvideCloudProfile } from '@/composables/useCloudProfile/useCloudProfile'

import { errorDetailsFromError } from '@/utils/error'

import get from 'lodash/get'

export default {
  components: {
    GActionButtonDialog,
    GShootVersionUpdate,
  },
  inject: ['api', 'logger'],
  props: {
    text: {
      type: Boolean,
      default: false,
    },
  },
  setup () {
    const {
      shootNamespace,
      shootName,
      shootKubernetesUpdateAvailable,
      shootSupportedPatchAvailable,
      shootCloudProfileRef,
    } = useShootItem()

    const selectedItem = ref(null)
    const workflowActive = ref(false)
    const {
      cloudProfile,
      isLoading: isCloudProfileLoading,
      error: cloudProfileError,
      reload: reloadCloudProfile,
    } = useProvideCloudProfile(shootCloudProfileRef, shootNamespace, {
      enabled: workflowActive,
    })

    return {
      v$: useVuelidate(),
      shootNamespace,
      shootName,
      shootSupportedPatchAvailable,
      shootKubernetesUpdateAvailable,
      selectedItem,
      workflowActive,
      cloudProfile,
      isCloudProfileLoading,
      cloudProfileError,
      reloadCloudProfile,
    }
  },
  computed: {
    canUpdate () {
      return this.shootKubernetesUpdateAvailable
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
    buttonText () {
      if (!this.text) {
        return
      }
      return 'Update Cluster'
    },
    selectedVersion () {
      return get(this.selectedItem, ['version'])
    },
    selectedVersionType () {
      return get(this.selectedItem, ['updateType'])
    },
    confirmRequired () {
      return this.selectedVersionType !== 'patch'
    },
  },
  methods: {
    onBeforeConfigurationDialogOpened () {
      this.selectedItem = null
      this.workflowActive = true
    },
    closeConfigurationDialog () {
      this.workflowActive = false
      this.selectedItem = null
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
        await this.api.updateShootVersion({
          namespace: this.shootNamespace,
          name: this.shootName,
          data: {
            version: this.selectedVersion,
          },
        })
        return true
      } catch (err) {
        const errorMessage = 'Update Kubernetes version failed'
        const errorDetails = errorDetailsFromError(err)
        const detailedErrorMessage = errorDetails.detailedMessage
        this.$refs.actionDialog.setError({ errorMessage, detailedErrorMessage })
        this.logger.error(errorMessage, errorDetails.errorCode, errorDetails.detailedMessage, err)
        return false
      }
    },
  },
}
</script>
