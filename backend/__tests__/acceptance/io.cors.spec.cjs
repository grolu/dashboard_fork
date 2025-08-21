//
// SPDX-FileCopyrightText: 2024 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

'use strict'

const pEvent = require('p-event')

describe('io cors', () => {
  let agent
  let socket

  afterEach(async () => {
    socket?.destroy()
    await agent?.close()
    delete process.env.IO_ALLOWED_ORIGINS
  })

  it('should reject connections from disallowed origins', async () => {
    process.env.IO_ALLOWED_ORIGINS = 'https://allowed.example.org'
    agent = createAgent('io')
    socket = await agent.connect({ connected: false, originHeader: 'https://forbidden.example.org' })
    await expect(pEvent(socket, 'connect_error', { timeout: 1000 })).resolves.toBeInstanceOf(Error)
  })

  it('should allow connections from allowed origins', async () => {
    process.env.IO_ALLOWED_ORIGINS = 'https://allowed.example.org'
    agent = createAgent('io')
    socket = await agent.connect({ originHeader: 'https://allowed.example.org' })
    expect(socket.connected).toBe(true)
  })

  it('should allow connections when no origins are configured', async () => {
    agent = createAgent('io')
    socket = await agent.connect({ originHeader: 'https://any.example.org' })
    expect(socket.connected).toBe(true)
  })
})
