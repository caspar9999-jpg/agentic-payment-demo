import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@x402/core/client", () => {
  class MockX402Client {
    createPaymentPayload(pr) {
      const accept = pr.accepts[0];
      return Promise.resolve({
        x402Version: 2,
        paymentId: "pay_test_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
        accepted: { ...accept },
        payload: { productId: "coke" },
      });
    }
  }
  class MockX402HTTPClient {
    constructor() {}
    encodePaymentSignatureHeader(payload) {
      return { "PAYMENT-SIGNATURE": Buffer.from(JSON.stringify(payload)).toString("base64") };
    }
  }
  return { x402Client: MockX402Client, x402HTTPClient: MockX402HTTPClient };
});

vi.mock("@x402/evm/exact/client", () => ({
  registerExactEvmScheme: vi.fn(),
}));

import { x402Client, setTestPaymentClient } from "../src/sodaEngine.js";

const X402_BASE = "/x402";

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64");
}

function mockResponse(status, body, headers = {}) {
  const h = new Map();
  for (const [k, v] of Object.entries(headers)) {
    h.set(k.toLowerCase(), String(v));
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) { return h.get(name.toLowerCase()) ?? null; },
    },
    json: () => Promise.resolve(body),
  };
}

const samplePaymentRequired = {
  accepts: [
    {
      scheme: "exact", amount: "199", asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      network: "eip155:84532", payTo: "0xmerchant_coke",
      maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" },
    },
  ],
  description: "Payment for Coca-Cola Classic",
  mimeType: "application/json",
  x402Version: 2,
};

const sampleNft = `<svg>mock nft content</svg>`;

const sampleSettlementSettled = {
  success: true,
  transaction: "0xabc123def456",
  amount: "199",
  network: "eip155:84532",
};

const sampleSettlementFailed = {
  success: false,
  error: "Settlement failed",
  amount: "199",
  network: "eip155:84532",
};

let cleanupClient;

beforeEach(() => {
  vi.restoreAllMocks();
  cleanupClient = setTestPaymentClient({
    createPaymentPayload: async (pr) => {
      const accept = pr.accepts[0];
      return {
        x402Version: 2,
        paymentId: "pay_coke_" + Date.now() + "_test",
        accepted: { ...accept },
        payload: { productId: "coke" },
      };
    },
  });
});

describe("accessResource", () => {
  it("returns payment_required when server returns 402 with PAYMENT-REQUIRED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(402, { status: "payment_required" }, {
        "PAYMENT-REQUIRED": b64(samplePaymentRequired),
      })
    );

    const result = await x402Client.accessResource("coke");

    expect(result.status).toBe("payment_required");
    expect(result.paymentRequired).toEqual(samplePaymentRequired);
    expect(fetch.mock.calls[0][0]).toBe(`${X402_BASE}/resource/coke`);
  });

  it("returns paid when server responds 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(200, { status: "paid", resource: sampleNft }, {
        "PAYMENT-RESPONSE": b64(sampleSettlementSettled),
      })
    );

    const result = await x402Client.accessResource("coke");

    expect(result.status).toBe("paid");
    expect(result.data.resource).toBe(sampleNft);
    expect(result.settlementResponse).toEqual(sampleSettlementSettled);
  });

  it("returns payment_failed when server returns 402 without PAYMENT-REQUIRED", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(402, { status: "payment_failed" })
    );

    const result = await x402Client.accessResource("coke");

    expect(result.status).toBe("payment_failed");
  });
});

describe("payForResource", () => {
  it("performs full 402->pay->settle flow and returns purchased", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(402, { status: "payment_required" }, {
          "PAYMENT-REQUIRED": b64(samplePaymentRequired),
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, { status: "paid", resource: sampleNft }, {
          "PAYMENT-RESPONSE": b64(sampleSettlementSettled),
        })
      );

    const result = await x402Client.payForResource("coke");

    expect(result.status).toBe("purchased");
    expect(result.data.resource).toBe(sampleNft);
    expect(result.settlementResponse).toEqual(sampleSettlementSettled);
    expect(result.paymentId).toMatch(/^pay_coke/);

    const secondCall = fetchMock.mock.results[1].value;
    const resolvedSecond = await secondCall;
    expect(resolvedSecond.status).toBe(200);
  });

  it("sends PAYMENT-SIGNATURE header with base64-encoded payload", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    fetchMock
      .mockResolvedValueOnce(
        mockResponse(402, { status: "payment_required" }, {
          "PAYMENT-REQUIRED": b64(samplePaymentRequired),
        })
      )
      .mockResolvedValueOnce(
        mockResponse(200, { status: "paid", resource: sampleNft }, {
          "PAYMENT-RESPONSE": b64(sampleSettlementSettled),
        })
      );

    await x402Client.payForResource("coke");

    const secondCallArgs = fetchMock.mock.calls[1];
    const headers = secondCallArgs[1]?.headers;
    expect(headers).toBeDefined();
    expect(headers["PAYMENT-SIGNATURE"]).toBeDefined();

    const decoded = JSON.parse(
      Buffer.from(headers["PAYMENT-SIGNATURE"], "base64").toString("utf-8")
    );
    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepted.scheme).toBe("exact");
    expect(decoded.accepted.amount).toBe("199");
    expect(decoded.accepted.network).toBe("eip155:84532");
    expect(decoded.paymentId).toMatch(/^pay_coke/);
  });

  it("returns payment_failed when settlement fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        mockResponse(402, { status: "payment_required" }, {
          "PAYMENT-REQUIRED": b64(samplePaymentRequired),
        })
      )
      .mockResolvedValueOnce(
        mockResponse(402, { status: "payment_failed" }, {
          "PAYMENT-RESPONSE": b64(sampleSettlementFailed),
        })
      );

    const result = await x402Client.payForResource("coke");

    expect(result.status).toBe("payment_failed");
    expect(result.settlementResponse.success).toBe(false);
  });

  it("short-circuits if resource is already paid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockResponse(200, { status: "paid", resource: sampleNft }, {
        "PAYMENT-RESPONSE": b64(sampleSettlementSettled),
      })
    );

    const result = await x402Client.payForResource("coke");

    expect(result.status).toBe("paid");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("getMerchantBalances", () => {
  it("returns merchant list from server", async () => {
    const merchantData = {
      merchants: [
        { wallet: "0xmerchant_coke", productName: "Coca-Cola" },
        { wallet: "0xmerchant_pepsi", productName: "Pepsi" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(200, merchantData)
    );

    const result = await x402Client.getMerchantBalances();

    expect(result).toHaveLength(2);
    expect(result[0].wallet).toBe("0xmerchant_coke");
    expect(fetch.mock.calls[0][0]).toBe(`${X402_BASE}/merchants`);
  });
});
