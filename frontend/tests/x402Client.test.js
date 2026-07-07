import { describe, it, expect, beforeEach, vi } from "vitest";
import { x402Client } from "../src/sodaEngine.js";

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
    { scheme: "exact", price: "$1.99", network: "eip155:84532", payTo: "0xmerchant_coke" },
  ],
  description: "Payment for Coca-Cola Classic",
  mimeType: "application/json",
};

const sampleNft = `<svg>mock nft content</svg>`;

const sampleSettlementSettled = {
  status: "settled",
  txHash: "0xabc123def456",
  amount: "199",
  network: "eip155:84532",
  timestamp: "2026-07-06T12:00:00.000Z",
  balance: 801,
};

const sampleSettlementFailed = {
  status: "settle_failed",
  error: "Insufficient balance",
  amount: "199",
  network: "eip155:84532",
  timestamp: "2026-07-06T12:00:00.000Z",
  shortBy: 50,
};

const sessionId = "test_session_001";

beforeEach(() => {
  vi.restoreAllMocks();
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
  it("performs full 402→pay→settle flow and returns purchased", async () => {
    // First call: accessResource gets 402
    // Second call: payForResource sends PAYMENT-SIGNATURE, gets 200
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

    const result = await x402Client.payForResource("coke", sessionId);

    expect(result.status).toBe("purchased");
    expect(result.data.resource).toBe(sampleNft);
    expect(result.settlementResponse).toEqual(sampleSettlementSettled);
    expect(result.paymentId).toMatch(/^pay_coke_\d+_\w+$/);

    // Second call should have PAYMENT-SIGNATURE header
    const secondCall = fetchMock.mock.results[1].value;
    const resolvedSecond = await secondCall;
    expect(resolvedSecond.status).toBe(200);
  });

  it("sends correctly structured PaymentPayload in PAYMENT-SIGNATURE header", async () => {
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

    await x402Client.payForResource("coke", sessionId);

    const secondCallArgs = fetchMock.mock.calls[1];
    const headers = secondCallArgs[1]?.headers;
    expect(headers).toBeDefined();
    expect(headers["PAYMENT-SIGNATURE"]).toBeDefined();

    const decoded = JSON.parse(
      Buffer.from(headers["PAYMENT-SIGNATURE"], "base64").toString("utf-8")
    );
    expect(decoded.scheme).toBe("exact");
    expect(decoded.price).toBe("$1.99");
    expect(decoded.network).toBe("eip155:84532");
    expect(decoded.payTo).toBe("0xmerchant_coke");
    expect(decoded.sessionId).toBe(sessionId);
    expect(decoded.paymentId).toMatch(/^pay_coke_/);
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

    const result = await x402Client.payForResource("coke", sessionId);

    expect(result.status).toBe("payment_failed");
    expect(result.settlementResponse.status).toBe("settle_failed");
    expect(result.settlementResponse.shortBy).toBe(50);
  });

  it("short-circuits if resource is already paid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      mockResponse(200, { status: "paid", resource: sampleNft }, {
        "PAYMENT-RESPONSE": b64(sampleSettlementSettled),
      })
    );

    const result = await x402Client.payForResource("coke", sessionId);

    expect(result.status).toBe("paid");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("getBalance", () => {
  it("returns wallet info for a session", async () => {
    const walletData = { sessionId, balance: 1000, balanceUSD: "$10.00" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(200, walletData)
    );

    const result = await x402Client.getBalance(sessionId);

    expect(result).toEqual(walletData);
    expect(fetch.mock.calls[0][0]).toBe(`${X402_BASE}/wallet/${sessionId}`);
  });
});

describe("resetWallet", () => {
  it("resets wallet to default balance", async () => {
    const resetData = { sessionId, balance: 1000, balanceUSD: "$10.00", message: "Wallet reset" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(200, resetData)
    );

    const result = await x402Client.resetWallet(sessionId);

    expect(result.balance).toBe(1000);
    expect(fetch.mock.calls[0][0]).toBe(`${X402_BASE}/wallet/${sessionId}/reset`);
  });
});

describe("getPurchases", () => {
  it("returns purchase history for a session", async () => {
    const purchaseData = {
      sessionId,
      purchases: [
        { purchaseId: "x402_coke_abc", productName: "Coca-Cola", priceInCents: 199 },
      ],
      total: 1,
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(200, purchaseData)
    );

    const result = await x402Client.getPurchases(sessionId);

    expect(result.total).toBe(1);
    expect(result.purchases[0].productName).toBe("Coca-Cola");
    expect(fetch.mock.calls[0][0]).toBe(`${X402_BASE}/purchases/${sessionId}`);
  });
});

describe("getMerchantBalances", () => {
  it("returns merchant list with balances", async () => {
    const merchantData = {
      merchants: [
        { wallet: "0xmerchant_coke", productName: "Coca-Cola", balance: 199, balanceUSD: "$1.99" },
        { wallet: "0xmerchant_pepsi", productName: "Pepsi", balance: 0, balanceUSD: "$0.00" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockResponse(200, merchantData)
    );

    const result = await x402Client.getMerchantBalances();

    expect(result).toHaveLength(2);
    expect(result[0].wallet).toBe("0xmerchant_coke");
    expect(result[1].productName).toBe("Pepsi");
    expect(fetch.mock.calls[0][0]).toBe(`${X402_BASE}/merchants`);
  });
});
