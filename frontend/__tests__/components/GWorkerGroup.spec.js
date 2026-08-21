//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import GWorkerGroup from '@/components/ShootWorkers/GWorkerGroup.vue'

describe('components', () => {
  describe('g-worker-group', () => {
    it('renders targeted lifecycle properties for a sparse machine-image version', () => {
      const imageVersion = {
        version: '2150.7.0',
        expirationDate: '2026-12-31T23:59:59Z',
      }
      const getMachineImageVersionProperty = vi.fn()
        .mockReturnValueOnce('deprecated')
        .mockReturnValueOnce(imageVersion.expirationDate)
      const context = {
        workerGroup: {
          machine: {
            architecture: 'arm64',
            image: {
              name: 'gardenlinux',
              version: imageVersion.version,
            },
          },
        },
        findMachineImageVersion: vi.fn(() => imageVersion),
        getMachineImageVersionProperty,
        configStore: {
          vendorDetails: vi.fn(() => ({
            displayName: 'Garden Linux',
            icon: 'gardenlinux-icon',
          })),
        },
      }

      const machineImage = GWorkerGroup.computed.machineImage.call(context)

      expect(machineImage).toMatchObject({
        name: 'gardenlinux',
        displayName: 'Garden Linux',
        version: imageVersion.version,
        expirationDate: imageVersion.expirationDate,
        classification: 'deprecated',
        isDeprecated: true,
      })
      expect(imageVersion).toEqual({
        version: '2150.7.0',
        expirationDate: '2026-12-31T23:59:59Z',
      })
      expect(getMachineImageVersionProperty).toHaveBeenCalledWith(
        'gardenlinux',
        imageVersion.version,
        'arm64',
        'classification',
      )
      expect(getMachineImageVersionProperty).toHaveBeenCalledWith(
        'gardenlinux',
        imageVersion.version,
        'arm64',
        'expirationDate',
      )
    })
  })
})
