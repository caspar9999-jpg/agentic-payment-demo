import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import request from 'supertest'

// Mock global fetch before any imports from @x402
function mockFetchResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
    json: async () => data,
    headers: { get: () => undefined },
  }
}

vi.stubGlobal('fetch', vi.fn((url) => {
  const urlStr = typeof url === 'string' ? url : url.toString()
  if (urlStr.includes('/supported')) {
    return Promise.resolve(mockFetchResponse({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:84532' }],
      extensions: [],
      signers: {},
    }))
  }
  if (urlStr.includes('/verify')) {
    return Promise.resolve(mockFetchResponse({ isValid: true, payer: '0xmock' }))
  }
  if (urlStr.includes('/settle')) {
    return Promise.resolve(mockFetchResponse({
      success: true, transaction: '0xmocksettlementtx', network: 'eip155:84532',
    }))
  }
  return Promise.resolve(mockFetchResponse({ error: 'not found' }, 404))
}))

describe('x402 server (Fix #11 – @x402/express SDK)', () => {
  describe('unpaid request → 402', () => {
    it('returns 402 Payment Required with PAYMENT-REQUIRED header when no payment-signature sent', async () => {
      const app = (await import('../app.js')).default
      const res = await request(app)
        .get('/resource/coke')
        .expect(402)

      expect(res.headers['payment-required']).toBeDefined()

      const decoded = JSON.parse(
        Buffer.from(res.headers['payment-required'], 'base64').toString('utf-8')
      )
      expect(decoded.accepts).toBeInstanceOf(Array)
      expect(decoded.accepts.length).toBeGreaterThanOrEqual(1)
      expect(decoded.accepts[0].scheme).toBe('exact')
    })

    it('returns 402 for any productId on the protected route pattern', async () => {
      const app = (await import('../app.js')).default
      const res = await request(app)
        .get('/resource/latte')
        .expect(402)

      expect(res.headers['payment-required']).toBeDefined()
    })
  })

  describe('POST /register', () => {
    it('no longer exists — returns 404', async () => {
      const app = (await import('../app.js')).default
      await request(app)
        .post('/register')
        .send({ productId: 'coke', priceInCents: 199 })
        .expect(404)
    })
  })

  describe('GET /products', () => {
    it('returns route products as configured', async () => {
      const app = (await import('../app.js')).default
      const res = await request(app)
        .get('/products')
        .expect(200)

      expect(res.body.products).toBeInstanceOf(Array)
    })
  })

  describe('valid PAYMENT-SIGNATURE → 200 + resource', () => {
    it('returns 200 with product data when valid payment-signature sent', async () => {
      const app = (await import('../app.js')).default

      // First, get the 402 to know the payment requirements
      const unpaidRes = await request(app).get('/resource/coke')
      expect(unpaidRes.status).toBe(402)

      const paymentRequired = JSON.parse(
        Buffer.from(unpaidRes.headers['payment-required'], 'base64').toString('utf-8')
      )
      const reqs = paymentRequired.accepts[0]

      // Build a valid payment payload matching the requirements
      const paymentPayload = {
        x402Version: 2,
        paymentId: 'test-payment-' + Date.now(),
        accepted: {
          scheme: reqs.scheme,
          network: reqs.network,
          amount: reqs.amount,
          asset: reqs.asset,
          payTo: reqs.payTo,
          maxTimeoutSeconds: reqs.maxTimeoutSeconds,
          extra: reqs.extra || {},
        },
        payload: {
          sessionId: 'test-session-1',
          productId: 'coke',
        },
        signature: '0xmocksignature',
        signerAddress: '0x1234567890123456789012345678901234567890',
      }

      const headerValue = Buffer.from(JSON.stringify(paymentPayload)).toString('base64')

      const res = await request(app)
        .get('/resource/coke')
        .set('PAYMENT-SIGNATURE', headerValue)

      expect(res.status).toBe(200)

      expect(res.body.productId).toBe('coke')
      expect(res.body.name).toBeDefined()
      expect(res.body.displayPrice).toBe('$1.99')
      expect(res.headers['payment-response']).toBeDefined()

      const settlementResponse = JSON.parse(
        Buffer.from(res.headers['payment-response'], 'base64').toString('utf-8')
      )
      expect(settlementResponse.success).toBe(true)
    })
  })

  describe('invalid PAYMENT-SIGNATURE → 402', () => {
    it('returns 402 when accepted does not match requirements', async () => {
      const app = (await import('../app.js')).default

      const badPayload = {
        x402Version: 2,
        paymentId: 'bad-payment',
        accepted: {
          scheme: 'exact',
          network: 'eip155:11111',
          amount: '100',
          asset: '0x0000000000000000000000000000000000000000',
          payTo: '0x0000000000000000000000000000000000000000',
          extra: {},
        },
        payload: { sessionId: 'test' },
      }
      const headerValue = Buffer.from(JSON.stringify(badPayload)).toString('base64')

      await request(app)
        .get('/resource/coke')
        .set('PAYMENT-SIGNATURE', headerValue)
        .expect(402)
    })
  })
})

describe('x402 testnet settlement (Fix #5-7 – Base Sepolia)', () => {
  describe('demo wallet endpoints removed', () => {
    it('GET /wallet/:sessionId returns 404', async () => {
      const app = (await import('../app.js')).default
      await request(app).get('/wallet/test-session').expect(404)
    })

    it('POST /wallet/:sessionId/reset returns 404', async () => {
      const app = (await import('../app.js')).default
      await request(app).post('/wallet/test-session/reset').expect(404)
    })

    it('GET /purchases/:sessionId returns 404', async () => {
      const app = (await import('../app.js')).default
      await request(app).get('/purchases/test-session').expect(404)
    })
  })

  describe('settlement returns real transaction hash', () => {
    it('PAYMENT-RESPONSE contains transaction from facilitator', async () => {
      const app = (await import('../app.js')).default

      const unpaidRes = await request(app).get('/resource/coke')
      const paymentRequired = JSON.parse(
        Buffer.from(unpaidRes.headers['payment-required'], 'base64').toString('utf-8')
      )
      const reqs = paymentRequired.accepts[0]

      const paymentPayload = {
        x402Version: 2,
        paymentId: 'tx-hash-test-' + Date.now(),
        accepted: {
          scheme: reqs.scheme, network: reqs.network,
          amount: reqs.amount, asset: reqs.asset,
          payTo: reqs.payTo, maxTimeoutSeconds: reqs.maxTimeoutSeconds,
          extra: reqs.extra || {},
        },
        payload: { productId: 'coke' },
        signature: '0xmocksignature',
      }

      const res = await request(app)
        .get('/resource/coke')
        .set('PAYMENT-SIGNATURE', Buffer.from(JSON.stringify(paymentPayload)).toString('base64'))

      const settlementResponse = JSON.parse(
        Buffer.from(res.headers['payment-response'], 'base64').toString('utf-8')
      )

      expect(settlementResponse.transaction).toBe('0xmocksettlementtx')
      expect(settlementResponse.network).toBe('eip155:84532')
    })
  })

  describe('PAYMENT-REQUIRED includes x402 V2 fields', () => {
    it('contains amount, asset, maxTimeoutSeconds, and extra', async () => {
      const app = (await import('../app.js')).default
      const res = await request(app).get('/resource/coke').expect(402)

      const pr = JSON.parse(
        Buffer.from(res.headers['payment-required'], 'base64').toString('utf-8')
      )
      const reqs = pr.accepts[0]

      expect(reqs.amount).toBe('1990000')
      expect(reqs.asset).toMatch(/^0x[a-fA-F0-9]{40}$/)
      expect(reqs.maxTimeoutSeconds).toBeGreaterThan(0)
      expect(reqs.extra).toBeDefined()
      expect(reqs.extra.name).toBe('USDC')
      expect(reqs.extra.version).toBe('2')
      expect(reqs.extra.assetTransferMethod).toBe('eip3009')
    })
  })

  describe('no sessionId required for payment', () => {
    it('succeeds without sessionId in payload', async () => {
      const app = (await import('../app.js')).default

      const unpaidRes = await request(app).get('/resource/coke')
      const paymentRequired = JSON.parse(
        Buffer.from(unpaidRes.headers['payment-required'], 'base64').toString('utf-8')
      )
      const reqs = paymentRequired.accepts[0]

      const paymentPayload = {
        x402Version: 2,
        paymentId: 'no-session-' + Date.now(),
        accepted: {
          scheme: reqs.scheme, network: reqs.network,
          amount: reqs.amount, asset: reqs.asset,
          payTo: reqs.payTo, maxTimeoutSeconds: reqs.maxTimeoutSeconds,
          extra: reqs.extra || {},
        },
        payload: {},
        signature: '0xmocksignature',
        signerAddress: '0x1234567890123456789012345678901234567890',
      }

      const res = await request(app)
        .get('/resource/coke')
        .set('PAYMENT-SIGNATURE', Buffer.from(JSON.stringify(paymentPayload)).toString('base64'))

      expect(res.status).toBe(200)
      const settlementResponse = JSON.parse(
        Buffer.from(res.headers['payment-response'], 'base64').toString('utf-8')
      )
      expect(settlementResponse.success).toBe(true)
    })
  })

  describe('facilitator module interface', () => {
    it('exports verifyPayment, settlePayment, getSupported, createFacilitator', async () => {
      const mod = await import('../lib/x402facilitator.js')
      expect(typeof mod.verifyPayment).toBe('function')
      expect(typeof mod.settlePayment).toBe('function')
      expect(typeof mod.getSupported).toBe('function')
      expect(typeof mod.createFacilitator).toBe('function')
    })

    it('createFacilitator returns object with verify, settle, getSupported', async () => {
      const { createFacilitator } = await import('../lib/x402facilitator.js')
      const fac = createFacilitator('http://test.facilitator')
      expect(typeof fac.verify).toBe('function')
      expect(typeof fac.settle).toBe('function')
      expect(typeof fac.getSupported).toBe('function')
    })
  })
})
