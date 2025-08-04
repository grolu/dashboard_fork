//
// SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  defineStore,
  acceptHMRUpdate,
  storeToRefs,
} from 'pinia'
import {
  computed,
  reactive,
} from 'vue'

import { useApi } from '@/composables/useApi'
import {
  isDnsBinding,
  isInfrastructureBinding,
  isSharedCredential,
} from '@/composables/credential/helper'

import { useAuthzStore } from './authz'
import { useAppStore } from './app'
import { useGardenerExtensionStore } from './gardenerExtension'
import { useCloudProfileStore } from './cloudProfile'

import filter from 'lodash/filter'
import set from 'lodash/set'
import get from 'lodash/get'

function namespaceNameKey ({ namespace, name }) {
  return `${namespace}/${name}`
}

const providerPrefix = 'provider.shoot.gardener.cloud/'
const providerTypesFromLabels = labels =>
  Object.entries(labels || {})
    .filter(([key, value]) => value === 'true' && key.startsWith(providerPrefix))
    .map(([key]) => key.slice(providerPrefix.length))

export const useCredentialStore = defineStore('credential', () => {
  const api = useApi()
  const appStore = useAppStore()
  const authzStore = useAuthzStore()
  const gardenerExtensionStore = useGardenerExtensionStore()
  const cloudProfileStore = useCloudProfileStore()

  const { sortedProviderTypeList } = storeToRefs(cloudProfileStore)
  const { dnsProviderTypes } = storeToRefs(gardenerExtensionStore)

  const state = reactive({
    secretBindings: {},
    secrets: {},
    credentialsBindings: {},
    workloadIdentities: {},
    quotas: {},
  })

  function $reset () {
    state.secretBindings = {}
    state.secrets = {}
    state.credentialsBindings = {}
    state.workloadIdentities = {}
    state.quotas = {}
  }

  async function fetchCredentials () {
    const namespace = authzStore.namespace
    try {
      const { data: { secretBindings, secrets, credentialsBindings, workloadIdentities, quotas } } = await api.getCloudProviderCredentials(namespace)
      _setCredentials({ secretBindings, secrets, credentialsBindings, workloadIdentities, quotas })
    } catch (err) {
      $reset()
      throw err
    }
  }

  function _setCredentials ({ secretBindings, secrets, credentialsBindings, workloadIdentities, quotas }) {
    $reset()

    secretBindings?.forEach(item => {
      const key = namespaceNameKey(item.metadata)
      item.kind = 'SecretBinding' // ensure kind is set (might not be set if objects are retrieved using list call)
      set(state.secretBindings, [key], item)
    })

    secrets?.forEach(item => {
      const key = namespaceNameKey(item.metadata)
      item.kind = 'Secret' // ensure kind is set (might not be set if objects are retrieved using list call)
      set(state.secrets, [key], item)

      providerTypesFromLabels(item.metadata.labels).forEach(type => {
        const bindingKey = `${key}/${type}`
        set(state.credentialsBindings, [bindingKey], {
          kind: 'Secret',
          metadata: { ...item.metadata, uid: `${item.metadata.uid}-${type}` },
          provider: { type },
          secretRef: {
            name: item.metadata.name,
            namespace: item.metadata.namespace,
          },
        })
      })
    })

    credentialsBindings?.forEach(item => {
      const key = namespaceNameKey(item.metadata)
      item.kind = 'CredentialsBinding' // ensure kind is set (might not be set if objects are retrieved using list call)
      set(state.credentialsBindings, [key], item)
    })

    workloadIdentities?.forEach(item => {
      const key = namespaceNameKey(item.metadata)
      item.kind = 'WorkloadIdentity' // ensure kind is set (might not be set if objects are retrieved using list call)
      set(state.workloadIdentities, [key], item)

      providerTypesFromLabels(item.metadata.labels).forEach(type => {
        const bindingKey = `${key}/${type}`
        set(state.credentialsBindings, [bindingKey], {
          kind: 'WorkloadIdentity',
          apiVersion: item.apiVersion,
          metadata: { ...item.metadata, uid: `${item.metadata.uid}-${type}` },
          provider: { type },
          credentialsRef: {
            name: item.metadata.name,
            namespace: item.metadata.namespace,
            kind: 'WorkloadIdentity',
            apiVersion: item.apiVersion,
          },
        })
      })
    })

    quotas?.forEach(item => {
      const key = namespaceNameKey(item.metadata)
      set(state.quotas, [key], item)
    })
  }

  const cloudProviderBindingList = computed(() => {
    return [
      ...Object.values(state.secretBindings),
      ...Object.values(state.credentialsBindings),
    ]
  })

  const quotaList = computed(() => {
    return Object.values(state.quotas)
  })

  async function createCredential (params) {
    const { data: { binding, secret } } = await api.createCloudProviderCredential({ binding: params.binding, secret: params.secret })
    _updateCloudProviderCredential({ binding, secret })
    appStore.setSuccess(`Cloud Provider credential ${binding.metadata.name} created`)
  }

  async function updateCredential (params) {
    const { binding, secret } = params
    const { data: { secret: updatedSecret } } = await api.updateCloudProviderCredential({ secret })
    _updateCloudProviderCredential({ secret: updatedSecret })
    const name = binding?.metadata?.name || secret.metadata.name
    appStore.setSuccess(`Cloud Provider credential ${name} updated`)
  }

  async function deleteCredential ({ bindingKind, bindingNamespace, bindingName }) {
    await api.deleteCloudProviderCredential({ bindingKind, bindingNamespace, bindingName })
    await fetchCredentials()
    appStore.setSuccess(`Cloud Provider credential ${bindingName} deleted`)
  }

  const infrastructureBindingList = computed(() => {
    return filter(cloudProviderBindingList.value, binding => {
      return isInfrastructureBinding(binding, sortedProviderTypeList.value)
    })
  })

  const dnsBindingList = computed(() => {
    return filter(cloudProviderBindingList.value, binding => {
      return isDnsBinding(binding, dnsProviderTypes.value) &&
        !isSharedCredential(binding)
    })
  })

  const secretBindingList = computed(() =>
    Object.values(state.secretBindings),
  )

  const credentialsBindingList = computed(() =>
    Object.values(state.credentialsBindings).filter(({ kind }) => kind === 'CredentialsBinding'),
  )

  function getSecret ({ namespace, name }) {
    return get(state.secrets, [namespaceNameKey({ namespace, name })])
  }

  function getWorkloadIdentity ({ namespace, name }) {
    return get(state.workloadIdentities, [namespaceNameKey({ namespace, name })])
  }

  function getQuota ({ namespace, name }) {
    return get(state.quotas, [namespaceNameKey({ namespace, name })])
  }

  function _updateCloudProviderCredential ({ binding, secret }) {
    if (binding) {
      const key = namespaceNameKey(binding.metadata)
      if (binding.kind === 'SecretBinding') {
        set(state.secretBindings, [key], binding)
      } else if (binding.kind === 'CredentialsBinding') {
        set(state.credentialsBindings, [key], binding)
      }
    }

    if (secret) {
      const key = namespaceNameKey(secret.metadata)
      set(state.secrets, [key], secret)

      // refresh virtual bindings for this secret
      Object.keys(state.credentialsBindings).forEach(k => {
        if (k === key || k.startsWith(`${key}/`)) {
          const item = state.credentialsBindings[k]
          if (item.kind === 'Secret') {
            delete state.credentialsBindings[k]
          }
        }
      })
      providerTypesFromLabels(secret.metadata.labels).forEach(type => {
        const bindingKey = `${key}/${type}`
        set(state.credentialsBindings, [bindingKey], {
          kind: 'Secret',
          metadata: { ...secret.metadata, uid: `${secret.metadata.uid}-${type}` },
          provider: { type },
          secretRef: {
            name: secret.metadata.name,
            namespace: secret.metadata.namespace,
          },
        })
      })
    }

    // no update logic for quotas as they currently cannot be updated using the dashboard
  }

  return {
    state,
    cloudProviderBindingList,
    quotaList,
    fetchCredentials,
    _setCredentials,
    updateCredential,
    createCredential,
    deleteCredential,
    infrastructureBindingList,
    dnsBindingList,
    secretBindingList,
    credentialsBindingList,
    getSecret,
    getWorkloadIdentity,
    getQuota,
    $reset,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useCredentialStore, import.meta.hot))
}
