//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import { cloneDeep } from 'lodash-es'

function getNamespacedCloudProfile ({ uid, name, namespace, parentName, kind }) {
  return {
    apiVersion: 'core.gardener.cloud/v1beta1',
    kind: 'NamespacedCloudProfile',
    metadata: {
      annotations: {
        'dashboard.gardener.cloud/fixture': `${namespace}/${name}`,
      },
      creationTimestamp: '2026-08-18T10:00:00Z',
      generation: 2,
      labels: {
        environment: namespace,
      },
      managedFields: [{ manager: 'fixture' }],
      name,
      namespace,
      resourceVersion: String(uid * 100),
      uid,
    },
    spec: {
      parent: {
        kind: 'CloudProfile',
        name: parentName,
      },
      kubernetes: {
        versions: [{
          version: '1.31.1',
          expirationDate: '2027-02-28T23:59:59Z',
        }],
      },
      machineTypes: [{
        name: `${kind}-large`,
        cpu: '4',
        gpu: '0',
        memory: '16Gi',
        usable: true,
      }],
    },
  }
}

const namespacedCloudProfileList = [
  getNamespacedCloudProfile({
    uid: 1001,
    name: 'shared-profile',
    namespace: 'garden-foo',
    parentName: 'infra1-profileName',
    kind: 'infra1',
  }),
  getNamespacedCloudProfile({
    uid: 1002,
    name: 'shared-profile',
    namespace: 'garden-bar',
    parentName: 'infra2-profileName',
    kind: 'infra2',
  }),
  getNamespacedCloudProfile({
    uid: 1003,
    name: 'private-profile',
    namespace: 'garden-secret',
    parentName: 'infra3-profileName',
    kind: 'infra3',
  }),
]

const namespacedcloudprofiles = {
  create (...args) {
    return getNamespacedCloudProfile(...args)
  },
  list (namespace) {
    const items = cloneDeep(namespacedCloudProfileList)
    if (namespace === undefined || namespace === '_all') {
      return items
    }
    return items.filter(item => item.metadata.namespace === namespace)
  },
  reset () {},
}

export default namespacedcloudprofiles
