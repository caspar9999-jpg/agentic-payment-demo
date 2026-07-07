import { describe, it, expect, vi, beforeEach } from "vitest";
import { processMessage, detectIntent } from "../src/sodaEngine.js";

const MOCK_PRODUCTS = [
  {
    id: "coke", name: "Coca-Cola Classic", price: "$1.99", priceInCents: 199, calories: 140,
    description: "Coca-Cola Classic is the world's most iconic carbonated soft drink.",
    payment_url: "http://localhost:3002/resource/coke",
    payment: { scheme: "exact", price: "$1.99", network: "eip155:84532", payTo: "0x5c3be24560feb69bd4b47983219383f6426736ca" },
  },
  {
    id: "pepsi", name: "Pepsi Cola", price: "$1.89", priceInCents: 189, calories: 150,
    description: "Pepsi Cola is a bold, refreshing carbonated soft drink.",
    payment_url: "http://localhost:3002/resource/pepsi",
    payment: { scheme: "exact", price: "$1.89", network: "eip155:84532", payTo: "0xabcd1234..." },
  },
  {
    id: "sprite", name: "Sprite", price: "$1.79", priceInCents: 179, calories: 140,
    description: "Sprite is a crisp, clean lemon-lime soda.",
    payment_url: "http://localhost:3002/resource/sprite",
    payment: { scheme: "exact", price: "$1.79", network: "eip155:84532", payTo: "0xdeadbeef..." },
  },
  {
    id: "fanta", name: "Fanta Orange", price: "$1.69", priceInCents: 169, calories: 160,
    description: "Fanta Orange is a vibrant, fruity carbonated soft drink.",
    payment_url: "http://localhost:3002/resource/fanta",
    payment: { scheme: "exact", price: "$1.69", network: "eip155:84532", payTo: "0xfeedcafe..." },
  },
  {
    id: "dasani", name: "Dasani Water", price: "$0.99", priceInCents: 99, calories: 0,
    description: "Dasani Water is pure, refreshing drinking water.",
    payment_url: "http://localhost:3002/resource/dasani",
    payment: { scheme: "exact", price: "$0.99", network: "eip155:84532", payTo: "0xbaadf00d..." },
  },
];

let mockDiscover;

beforeEach(() => {
  mockDiscover = vi.fn();
  vi.clearAllMocks();
});

function mockAllProducts() {
  mockDiscover.mockResolvedValue({ products: MOCK_PRODUCTS, total: MOCK_PRODUCTS.length });
}

function mockEmptyProducts() {
  mockDiscover.mockResolvedValue({ products: [], total: 0 });
}

function mockProductsForQuery(query) {
  const lower = query.toLowerCase();
  let results;
  if (lower === "all") {
    results = MOCK_PRODUCTS;
  } else {
    results = MOCK_PRODUCTS.filter(p =>
      p.id.includes(lower) || p.name.toLowerCase().includes(lower) || p.description.toLowerCase().includes(lower)
    );
  }
  mockDiscover.mockResolvedValue({ products: results, total: results.length });
}

describe("detectIntent", () => {
  it("detects direct buy intent", () => {
    expect(detectIntent("buy coke").type).toBe("direct_buy");
    expect(detectIntent("purchase pepsi").type).toBe("direct_buy");
    expect(detectIntent("i want sprite").type).toBe("direct_buy");
    expect(detectIntent("i'd like fanta").type).toBe("direct_buy");
    expect(detectIntent("give me dasani").type).toBe("direct_buy");
  });

  it("detects yes with pending confirm_gate context", () => {
    const ctx = { lastAction: "confirm_gate" };
    expect(detectIntent("yes", ctx).type).toBe("yes");
    expect(detectIntent("yeah", ctx).type).toBe("yes");
    expect(detectIntent("sure", ctx).type).toBe("yes");
    expect(detectIntent("ok", ctx).type).toBe("yes");
    expect(detectIntent("let's do it", ctx).type).toBe("yes");
  });

  it("does not treat yes as confirm without context", () => {
    expect(detectIntent("yes").type).not.toBe("yes");
  });

  it("detects no with pending confirm_gate context", () => {
    const ctx = { lastAction: "confirm_gate" };
    expect(detectIntent("no", ctx).type).toBe("no");
    expect(detectIntent("nope", ctx).type).toBe("no");
    expect(detectIntent("no thanks", ctx).type).toBe("no");
  });

  it("detects specific product queries", () => {
    expect(detectIntent("cola").type).toBe("specific");
    expect(detectIntent("pepsi").type).toBe("specific");
    expect(detectIntent("sprite").type).toBe("specific");
    expect(detectIntent("orange").type).toBe("specific");
    expect(detectIntent("water").type).toBe("specific");
  });

  it("detects vague queries", () => {
    expect(detectIntent("what drinks do you have").type).toBe("vague");
    expect(detectIntent("show me options").type).toBe("vague");
    expect(detectIntent("what's available").type).toBe("vague");
    expect(detectIntent("i'm thirsty").type).toBe("vague");
  });

  it("returns no_match for unrelated queries", () => {
    expect(detectIntent("coffee").type).toBe("no_match");
    expect(detectIntent("tea").type).toBe("no_match");
    expect(detectIntent("hello").type).toBe("no_match");
    expect(detectIntent("what's the weather").type).toBe("no_match");
  });
});

describe("processMessage — conversation paths", () => {
  it("specific query → confirm_gate with matched product", async () => {
    mockProductsForQuery("coke");
    const result = await processMessage("do you have cola?", {}, mockDiscover);
    expect(result.action).toBe("confirm_gate");
    expect(result.product).toBeDefined();
    expect(result.product.id).toBe("coke");
  });

  it("'i want X' → show_payment_card as direct buy", async () => {
    mockProductsForQuery("pepsi");
    const result = await processMessage("i want pepsi", {}, mockDiscover);
    expect(result.action).toBe("show_payment_card");
    expect(result.product.id).toBe("pepsi");
  });

  it("yes → show_payment_card with last product", async () => {
    const context = {
      lastAction: "confirm_gate",
      lastProduct: MOCK_PRODUCTS[0],
    };
    const result = await processMessage("yes", context);
    expect(result.action).toBe("show_payment_card");
    expect(result.product).toBe(MOCK_PRODUCTS[0]);
  });

  it("no → show_catalog with different product recommendation", async () => {
    mockAllProducts();
    const context = {
      lastAction: "confirm_gate",
      lastProduct: MOCK_PRODUCTS[0],
    };
    const result = await processMessage("no thanks", context, mockDiscover);
    expect(result.action).toBe("show_catalog");
    expect(result.products).toHaveLength(5);
    expect(result.product).toBeDefined();
    expect(result.product.id).not.toBe("coke");
  });

  it("vague query → show_catalog + confirm_gate with first product", async () => {
    mockAllProducts();
    const result = await processMessage("what drinks do you have?", {}, mockDiscover);
    expect(result.action).toBe("show_catalog");
    expect(result.products).toHaveLength(5);
    expect(result.product).toBeDefined();
    expect(result.product.id).toBe(MOCK_PRODUCTS[0].id);
  });

  it("no-match query → show_catalog with all products + recommendation", async () => {
    mockEmptyProducts();
    mockProductsForQuery("all");
    const result = await processMessage("coffee", {}, mockDiscover);
    expect(result.action).toBe("show_catalog");
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.product).toBeDefined();
  });

  it("direct buy → show_payment_card without confirmation", async () => {
    mockProductsForQuery("pepsi");
    const result = await processMessage("buy pepsi", {}, mockDiscover);
    expect(result.action).toBe("show_payment_card");
    expect(result.product).toBeDefined();
    expect(result.product.id).toBe("pepsi");
  });

  it("direct buy with i want → show_payment_card", async () => {
    mockProductsForQuery("sprite");
    const result = await processMessage("i want sprite", {}, mockDiscover);
    expect(result.action).toBe("show_payment_card");
    expect(result.product.id).toBe("sprite");
  });

  it("includes calorie info in recommendation text", async () => {
    mockProductsForQuery("coke");
    const result = await processMessage("cola", {}, mockDiscover);
    expect(result.action).toBe("confirm_gate");
    expect(result.text).toContain("140 cal");
  });

  it("includes calorie info in direct buy text", async () => {
    mockProductsForQuery("pepsi");
    const result = await processMessage("buy pepsi", {}, mockDiscover);
    expect(result.action).toBe("show_payment_card");
    expect(result.text).toContain("150 cal");
  });

  it("shows zero calories for water", async () => {
    mockProductsForQuery("dasani");
    const result = await processMessage("buy dasani", {}, mockDiscover);
    expect(result.text).toContain("0 cal");
  });
});

describe("processMessage — edge cases", () => {
  it("handles empty product catalog gracefully", async () => {
    mockEmptyProducts();
    const result = await processMessage("what drinks?", {}, mockDiscover);
    expect(result.action).toBe("show_catalog");
    expect(result.products).toHaveLength(0);
  });

  it("includes V2 payment details on matched product for payment_card", async () => {
    mockProductsForQuery("coke");
    const result = await processMessage("buy coke", {}, mockDiscover);
    expect(result.action).toBe("show_payment_card");
    expect(result.product.payment).toBeDefined();
    expect(result.product.payment.scheme).toBe("exact");
    expect(result.product.payment.network).toBe("eip155:84532");
    expect(result.product.payment.payTo).toBeTruthy();
  });

  it("produces valid action values", async () => {
    mockAllProducts();
    const results = await Promise.all([
      processMessage("cola", {}, mockDiscover),
      processMessage("what drinks?", {}, mockDiscover),
      processMessage("buy pepsi", {}, mockDiscover),
    ]);
    const actions = results.map(r => r.action);
    actions.forEach(a => {
      expect(["show_payment_card", "show_catalog", "confirm_gate"]).toContain(a);
    });
  });

  it("agent never returns show_payment_card without product", async () => {
    mockProductsForQuery("pepsi");
    const result = await processMessage("buy pepsi", {}, mockDiscover);
    if (result.action === "show_payment_card") {
      expect(result.product).toBeDefined();
    }
  });

  it("yes without context falls through to normal intent detection", async () => {
    mockProductsForQuery("all");
    const result = await processMessage("yes", {}, mockDiscover);
    expect(result.action).not.toBe("show_payment_card");
  });
});
