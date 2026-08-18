//
// SPDX-FileCopyrightText: 2026 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import crypto from 'crypto'
import express from 'express'
import services from '../services/index.js'
import logger from '../logger/index.js'
import { metricsRoute } from '../middleware.js'
const { namespacedCloudProfiles } = services

const router = express.Router({ mergeParams: true })

const metricsMiddleware = metricsRoute('namespacedcloudprofiles')

function roundedTrace (trace) {
  return Object.fromEntries(Object.entries(trace).map(([key, value]) => [
    key,
    key.endsWith('Milliseconds') && typeof value === 'number'
      ? Math.round(value * 100) / 100
      : value,
  ]))
}

router.route('/')
  .all(metricsMiddleware)
  .get(async (req, res, next) => {
    const user = req.user
    const namespace = req.params.namespace
    const scope = namespace ?? '_all'
    const trace = {}
    const traceId = req.get('x-request-id') || crypto.randomUUID()
    const requestStartedAt = performance.now()
    let traceLogged = false

    const logTrace = ({ outcome, statusCode, streamingStartedAt }) => {
      if (traceLogged) {
        return
      }
      traceLogged = true
      if (streamingStartedAt !== undefined) {
        trace.streamingMilliseconds = performance.now() - streamingStartedAt
      }
      trace.itemCount ??= 0
      trace.totalMilliseconds = performance.now() - requestStartedAt
      trace.statusCode = statusCode
      trace.outcome = outcome
      logger.info(
        'NamespacedCloudProfile list request trace %s for namespace %s: %s',
        traceId,
        scope,
        JSON.stringify(roundedTrace(trace)),
      )
    }

    try {
      const items = namespace
        ? await namespacedCloudProfiles.listForNamespace({ user, namespace, trace })
        : await namespacedCloudProfiles.listAll({ user, trace })

      const serializationStartedAt = performance.now()
      const body = JSON.stringify(items)
      trace.serializationMilliseconds = performance.now() - serializationStartedAt

      const streamingStartedAt = performance.now()
      res.once('finish', () => logTrace({
        outcome: 'finished',
        statusCode: res.statusCode,
        streamingStartedAt,
      }))
      res.once('close', () => logTrace({
        outcome: res.writableFinished ? 'finished' : 'closedEarly',
        statusCode: res.statusCode,
        streamingStartedAt,
      }))
      res.type('json').send(body)
    } catch (err) {
      logTrace({
        outcome: 'failed',
        statusCode: err.statusCode ?? err.status ?? 500,
      })
      next(err)
    }
  })

export default router
