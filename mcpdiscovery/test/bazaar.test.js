import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import request from 'supertest'

const MOCK_PRODUCTS = {
  products: [
    { productId: 'coke', name: 'Coca-Cola Classic', displayPrice: '$1.99', payTo: '0xabc', network: 'eip155:84532', merchant: 'Soft Drink Provider' },
    { productId: 'pepsi', name: 'Pepsi Cola', displayPrice: '$1.89', payTo: '0xabc', network: 'eip155:84532', merchant: 'Soft Drink Provider' },
    { productId: 'latte', name: 'Latte', displayPrice: '$3.49', payTo: '0xdef', network: 'eip155:84532', merchant: 'Coffee Provider' },
  ],
  total: 3,
}

vi.stubGlobal('fetch', vi.fn((url) => {
  const urlStr = typeof url === 'string' ? url : url.toString()
  if (urlStr.includes('/products')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(MOCK_PRODUCTS),
      json: async () => MOCK_PRODUCTS,
      headers: { get: () => undefined },
    })
  }
  return Promise.resolve({
    ok: false,
    status: 404,
    text: async () => 'Not found',
    headers: { get: () => undefined },
  })
}))

describe('Bazaar discovery server (Fix #1)', () => {
  let app

  beforeAll(async () => {
    const mod = await import('../index.js')
    app = mod.default
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  describe('GET /discovery/resources', () => {
    it('returns resources in Bazaar format with type: "http"', async () => {
      const res = await request(app)
        .get('/discovery/resources')
        .expect(200)

      expect(res.body.resources).toBeInstanceOf(Array)
      expect(res.body.resources.length).toBeGreaterThan(0)

      const resource = res.body.resources[0]
      expect(resource.type).toBe('http')
      expect(resource.accepts).toBeInstanceOf(Array)
      expect(resource.accepts.length).toBeGreaterThanOrEqual(1)
      expect(resource.extensions).toBeDefined()
      expect(resource.extensions.bazaar).toBeDefined()
      expect(resource.extensions.bazaar.info).toBeDefined()
      expect(resource.extensions.bazaar.info.input).toBeDefined()
      expect(resource.extensions.bazaar.info.input.type).toBe('http')
    })

    it('includes x402 payment details in accepts[]', async () => {
      const res = await request(app).get('/discovery/resources').expect(200)
      const accept = res.body.resources[0].accepts[0]
      expect(accept.scheme).toBe('exact')
      expect(accept.network).toBe('eip155:84532')
      expect(accept.payTo).toBeDefined()
    })
  })

  describe('GET /discovery/resources/search?q=', () => {
    it('filters resources by search query', async () => {
      const res = await request(app)
        .get('/discovery/resources/search')
        .query({ q: 'coke' })
        .expect(200)

      expect(res.body.resources).toBeInstanceOf(Array)
      expect(res.body.resources.length).toBe(1)
      expect(res.body.resources[0].resource).toContain('coke')
    })

    it('returns all resources when query is empty', async () => {
      const res = await request(app)
        .get('/discovery/resources/search')
        .query({ q: '' })
        .expect(200)

      expect(res.body.resources.length).toBe(MOCK_PRODUCTS.products.length)
    })
  })

  describe('old MCP endpoints return 404', () => {
    it('POST /mcp returns 404', async () => {
      await request(app)
        .post('/mcp')
        .send({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
        .expect(404)
    })

    it('GET /sse returns 404', async () => {
      await request(app).get('/sse').expect(404)
    })

    it('GET /discover returns 404', async () => {
      await request(app).get('/discover').expect(404)
    })
  })
})

describe('error handling + cache rigor (Fix #1)', () => {
  const okResponse = (data) => Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(data),
    json: async () => data,
    headers: { get: () => undefined },
  })

  const errorResponse = (status = 500) => Promise.resolve({
    ok: false,
    status,
    text: async () => 'Server error',
    json: async () => { throw new Error('not json') },
    headers: { get: () => undefined },
  })

  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
    delete process.env.CACHE_TTL
  })

  it('returns empty resources when cache empty and x402 unreachable (no crash)', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValue(errorResponse(500))
    vi.stubGlobal('fetch', fetchMock)

    const { default: app } = await import('../index.js')

    const res = await request(app).get('/discovery/resources').expect(200)
    expect(res.body.resources).toBeInstanceOf(Array)
    expect(res.body.resources).toHaveLength(0)
  })

  it('handles malformed JSON from x402 server gracefully (no crash, stale cache preserved)', async () => {
    process.env.CACHE_TTL = '0'

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce(okResponse(MOCK_PRODUCTS))
    fetchMock.mockResolvedValueOnce(Promise.resolve({
      ok: true,
      status: 200,
      text: async () => 'not valid json{{{',
      json: async () => { throw new SyntaxError('Unexpected token {') },
      headers: { get: () => undefined },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { default: app } = await import('../index.js')

    const res1 = await request(app).get('/discovery/resources').expect(200)
    expect(res1.body.resources.length).toBe(3)

    const res2 = await request(app).get('/discovery/resources').expect(200)
    expect(res2.body.resources.length).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('lastUpdated is consistent across all resources in same response and stable within cache cycle', async () => {
    const fetchMock = vi.fn()
    fetchMock.mockResolvedValue(okResponse(MOCK_PRODUCTS))
    vi.stubGlobal('fetch', fetchMock)

    const { default: app } = await import('../index.js')

    const res1 = await request(app).get('/discovery/resources').expect(200)
    const timestamps1 = res1.body.resources.map(r => r.lastUpdated)
    timestamps1.forEach(ts => expect(typeof ts).toBe('string'))

    const res2 = await request(app).get('/discovery/resources').expect(200)
    const timestamps2 = res2.body.resources.map(r => r.lastUpdated)

    // All resources in same response share one lastUpdated
    expect(new Set(timestamps1).size).toBe(1)
    // Stable across requests within same cache cycle (TTL is 30s)
    expect(new Set(timestamps2).size).toBe(1)
    expect(timestamps1[0]).toBe(timestamps2[0])
  })

  it('returns stale cached data when x402 server errors after cache populated', async () => {
    process.env.CACHE_TTL = '0'

    const fetchMock = vi.fn()
    fetchMock.mockResolvedValueOnce(okResponse(MOCK_PRODUCTS))
    fetchMock.mockResolvedValue(errorResponse(500))
    vi.stubGlobal('fetch', fetchMock)

    const { default: app } = await import('../index.js')

    const res1 = await request(app).get('/discovery/resources').expect(200)
    expect(res1.body.resources.length).toBe(3)

    const res2 = await request(app).get('/discovery/resources').expect(200)
    expect(res2.body.resources.length).toBe(3)

    // fetch should have been called twice (cached re-fetched due to TTL=0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
