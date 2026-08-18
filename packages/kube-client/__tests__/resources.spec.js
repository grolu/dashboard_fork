//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//
const request = await import('@gardener-dashboard/request')
const { default: { mockClient } } = request
const gardenerCore = await import('../lib/resources/GardenerCore.js')
const { Shoot, default: GardenerCoreResources } = gardenerCore

describe('kube-client', () => {
  describe('resources', () => {
    describe('core.gardener.cloud', () => {
      describe('namespacedcloudprofiles', () => {
        it('should define the namespaced readable and observable resource', function () {
          const Resource = GardenerCoreResources.NamespacedCloudProfile
          const resource = new Resource({ url: 'http://example.org' })

          expect(Resource.scope).toBe('Namespaced')
          expect(Resource.names).toEqual({
            plural: 'namespacedcloudprofiles',
            singular: 'namespacedcloudprofile',
            kind: 'NamespacedCloudProfile',
          })
          expect(resource.get).toBeTypeOf('function')
          expect(resource.listAllNamespaces).toBeTypeOf('function')
          expect(resource.watchListAllNamespaces).toBeTypeOf('function')
          expect(resource.informerAllNamespaces).toBeTypeOf('function')
        })
      })

      describe('shoots', () => {
        const url = 'http://example.org'
        const namespace = 'default'
        const name = 'test'
        const data = { foo: 'bar' }

        let shoot

        beforeEach(() => {
          shoot = new Shoot({ url })
          mockClient.request.mockImplementation((...args) => args)
        })

        it('should create an adminkubeconfig subresource', async () => {
          const args = await shoot.createAdminKubeconfigRequest(namespace, name, data)
          expect(args).toEqual([
            `namespaces/${namespace}/shoots/${name}/adminkubeconfig`,
            {
              method: 'post',
              json: data,
            },
          ])
        })
      })
    })
  })
})
