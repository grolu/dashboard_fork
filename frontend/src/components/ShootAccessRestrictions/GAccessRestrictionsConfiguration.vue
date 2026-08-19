<!--
SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <g-action-button-dialog
    ref="actionDialog"
    :disabled="disabled"
    :tooltip="tooltip"
    :valid="isCloudProfileReady"
    width="900"
    caption="Configure Access Restrictions"
    @before-dialog-opened="onBeforeConfigurationDialogOpened"
    @dialog-opened="onConfigurationDialogOpened"
  >
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
      <v-card-text v-else-if="cloudProfile">
        <g-access-restrictions />
      </v-card-text>
    </template>
  </g-action-button-dialog>
</template>

<script>
import {
  computed,
  ref,
} from 'vue'

import GActionButtonDialog from '@/components/dialogs/GActionButtonDialog'
import GAccessRestrictions from '@/components/ShootAccessRestrictions/GAccessRestrictions'

import { useProvideShootContext } from '@/composables/useShootContext'
import { useShootItem } from '@/composables/useShootItem'
import { useShootHelper } from '@/composables/useShootHelper'
import { useProvideCloudProfile } from '@/composables/useCloudProfile/useCloudProfile'

import { errorDetailsFromError } from '@/utils/error'

import isEmpty from 'lodash/isEmpty'

export default {
  components: {
    GActionButtonDialog,
    GAccessRestrictions,
  },
  inject: ['api', 'logger'],
  setup () {
    const {
      shootItem,
      shootNamespace,
      shootName,
      shootCloudProfileRef,
    } = useShootItem()

    const {
      accessRestrictionDefinitionList,
      accessRestrictionNoItemsText,
    } = useShootHelper()

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
      getAccessRestrictionPatchData,
      setShootManifest,
    } = useProvideShootContext({
      cloudProfile,
    })

    const disabled = computed(() => {
      if (shootCloudProfileRef.value?.kind === 'NamespacedCloudProfile') {
        return false
      }
      return isEmpty(accessRestrictionDefinitionList.value)
    })

    const tooltip = computed(() => {
      return disabled.value
        ? accessRestrictionNoItemsText.value
        : ''
    })

    return {
      shootItem,
      shootNamespace,
      shootName,
      getAccessRestrictionPatchData,
      setShootManifest,
      disabled,
      tooltip,
      workflowActive,
      cloudProfile,
      isCloudProfileLoading,
      cloudProfileError,
      reloadCloudProfile,
    }
  },
  computed: {
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
      this.workflowActive = true
      this.setShootManifest(this.shootItem)
    },
    closeConfigurationDialog () {
      this.workflowActive = false
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
      const data = this.getAccessRestrictionPatchData()
      try {
        await this.api.patchShoot({
          namespace: this.shootNamespace,
          name: this.shootName,
          data,
        })
        return true
      } catch (err) {
        const errorMessage = 'Could not save access restriction configuration'
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
