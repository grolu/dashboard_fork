//
// SPDX-FileCopyrightText: 2023 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import {
  defineStore,
  acceptHMRUpdate,
} from 'pinia'
import {
  ref,
  computed,
} from 'vue'

import { useConfigStore } from '@/store/config'

import { useApi } from '@/composables/useApi'

import filter from 'lodash/filter'
import sortBy from 'lodash/sortBy'
import uniq from 'lodash/uniq'
import map from 'lodash/map'
import find from 'lodash/find'
import omit from 'lodash/omit'

export const useCloudProfileStore = defineStore('cloudProfile', () => {
  const api = useApi()

  const configStore = useConfigStore()

  const list = ref(null)
  const namespacedCloudProfileDescriptors = ref(null)
  let generation = 0
  let namespacedCloudProfileDescriptorsRequest

  const isInitial = computed(() => {
    return list.value === null
  })

  const cloudProfileList = computed(() => {
    return list.value
  })

  const areNamespacedCloudProfileDescriptorsInitial = computed(() => {
    return namespacedCloudProfileDescriptors.value === null
  })

  async function fetchCloudProfiles () {
    const requestGeneration = generation
    const response = await api.getCloudProfiles()
    if (requestGeneration === generation) {
      setCloudProfiles(response.data)
    }
  }

  function fetchNamespacedCloudProfileDescriptors () {
    if (namespacedCloudProfileDescriptors.value !== null) {
      return
    }
    if (namespacedCloudProfileDescriptorsRequest) {
      return namespacedCloudProfileDescriptorsRequest
    }

    const requestGeneration = generation
    const request = api.getNamespacedCloudProfiles()
      .then(response => {
        if (requestGeneration === generation) {
          setNamespacedCloudProfileDescriptors(response.data)
        }
      })
    namespacedCloudProfileDescriptorsRequest = request

    return request.finally(() => {
      if (namespacedCloudProfileDescriptorsRequest === request) {
        namespacedCloudProfileDescriptorsRequest = undefined
      }
    })
  }

  function setCloudProfiles (cloudProfiles) {
    list.value = cloudProfiles
  }

  function setNamespacedCloudProfileDescriptors (descriptors) {
    namespacedCloudProfileDescriptors.value = map(descriptors, descriptor => omit(descriptor, ['status']))
  }

  function namespacedCloudProfileDescriptorByRef (cloudProfileRef, namespace) {
    if (cloudProfileRef?.kind !== 'NamespacedCloudProfile' || !namespace) {
      return null
    }
    return find(namespacedCloudProfileDescriptors.value, descriptor => {
      return descriptor.metadata?.name === cloudProfileRef.name &&
        descriptor.metadata?.namespace === namespace
    }) ?? null
  }

  function parentCloudProfileForDescriptor (descriptor) {
    return cloudProfileByRef(descriptor?.spec?.parent) ?? null
  }

  function $reset () {
    generation++
    namespacedCloudProfileDescriptorsRequest = undefined
    list.value = null
    namespacedCloudProfileDescriptors.value = null
  }

  const infraProviderTypesList = computed(() => {
    return uniq(map(list.value, 'spec.type'))
  })

  const sortedInfraProviderTypeList = computed(() => {
    const infraProviderVendors = map(infraProviderTypesList.value, name => {
      return configStore.vendorDetails({
        type: 'infra',
        name,
      })
    })
    const sortedVisibleInfraVendors = sortBy(infraProviderVendors, 'weight')
    return map(sortedVisibleInfraVendors, 'name')
  })

  function cloudProfilesByProviderType (providerType) {
    const predicate = item => item.spec.type === providerType
    const filteredCloudProfiles = filter(list.value, predicate)
    return sortBy(filteredCloudProfiles, 'metadata.name')
  }

  function cloudProfileByRef (cloudProfileRef) {
    if (cloudProfileRef?.kind !== 'CloudProfile') {
      return null
    }
    return find(list.value, ['metadata.name', cloudProfileRef?.name])
  }

  return {
    list,
    namespacedCloudProfileDescriptors,
    isInitial,
    areNamespacedCloudProfileDescriptorsInitial,
    cloudProfileList,
    setCloudProfiles,
    setNamespacedCloudProfileDescriptors,
    fetchCloudProfiles,
    fetchNamespacedCloudProfileDescriptors,
    cloudProfilesByProviderType,
    sortedInfraProviderTypeList,
    cloudProfileByRef,
    namespacedCloudProfileDescriptorByRef,
    parentCloudProfileForDescriptor,
    $reset,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useCloudProfileStore, import.meta.hot))
}
