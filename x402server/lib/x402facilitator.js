import { HTTPFacilitatorClient } from '@x402/core/server'

const DEFAULT_URL = 'https://x402.org/facilitator'

export function createFacilitator(url) {
  return new HTTPFacilitatorClient({
    url: url || process.env.FACILITATOR_URL || DEFAULT_URL,
  })
}

export async function getSupported(url) {
  return createFacilitator(url).getSupported()
}

export async function verifyPayment(payload, requirements, url) {
  return createFacilitator(url).verify(payload, requirements)
}

export async function settlePayment(payload, requirements, url) {
  return createFacilitator(url).settle(payload, requirements)
}
