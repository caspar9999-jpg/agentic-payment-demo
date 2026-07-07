import { useState, useEffect, useRef, useCallback } from "react";
import { processMessage, x402Client } from "./sodaEngine.js";
import {
  isMetaMaskInstalled,
  connectMetaMask,
  getConnectedAccounts,
  registerMetaMaskCallbacks,
  signMessage,
} from "./metamask.js";
import "./App.css";

const SESSION_ID = "demo_user_" + Math.random().toString(36).slice(2, 8);

function TypingDots() {
  return (
    <div className="typing-dots">
      <span className="dot" /><span className="dot" /><span className="dot" />
    </div>
  );
}

function MCPPanel({ mcpData, visible }) {
  if (!visible || !mcpData) return null;
  const hasToolCall = mcpData.toolName && mcpData.toolStatus;
  return (
    <div className="mcp-panel">
      <div className="mcp-header">
        <div className="mcp-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
          </svg>
        </div>
        <span className="mcp-title">MCP Discovery</span>
        <span className="mcp-status active">active</span>
      </div>
      <div className="mcp-body">
        <div className="mcp-section-label">Agent → MCP Marketplace</div>
        <div className="mcp-row">
          <span className="mcp-label">tools/list</span>
          <span className="mcp-value">{mcpData.toolsFound || 0} tools</span>
        </div>
        <div className="mcp-row">
          <span className="mcp-label">Selected Tool</span>
          <span className="mcp-value">{hasToolCall ? mcpData.toolName : "—"}</span>
        </div>
        {hasToolCall && (
          <>
            <div className="mcp-section-label">Agent → Tool Execution</div>
            <div className="mcp-row">
              <span className="mcp-label">{mcpData.toolName}</span>
              <span className="mcp-value">{mcpData.toolStatus}</span>
            </div>
          </>
        )}
        <div className="mcp-section-label">Results</div>
        <div className="mcp-row">
          <span className="mcp-label">Products Found</span>
          <span className="mcp-value">{mcpData.productsDiscovered}</span>
        </div>
        <div className="mcp-row">
          <span className="mcp-label">Selected</span>
          <span className="mcp-value">{mcpData.selectedProduct || "—"}</span>
        </div>
        <div className="mcp-row">
          <span className="mcp-label">Payment</span>
          <span className="mcp-value">{mcpData.paymentStatus || "—"}</span>
        </div>
        <div className="mcp-section-label">Protocol</div>
        <div className="mcp-row">
          <span className="mcp-label">Transport</span>
          <span className="mcp-value">HTTP + JSON-RPC</span>
        </div>
        <div className="mcp-row">
          <span className="mcp-label">Timestamp</span>
          <span className="mcp-value">{new Date(mcpData.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>
    </div>
  );
}

function MetaMaskPanel({ metamaskAccount, onConnect, onDisconnect, isConnecting }) {
  const installed = isMetaMaskInstalled();
  if (!installed) {
    return (
      <div className="metamask-panel">
        <div className="metamask-header"><span className="metamask-icon">🦊</span><span className="metamask-title">MetaMask</span></div>
        <div className="metamask-body">
          <p className="metamask-not-installed">MetaMask not detected</p>
          <a className="metamask-install-btn" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Install MetaMask</a>
        </div>
      </div>
    );
  }
  if (!metamaskAccount) {
    return (
      <div className="metamask-panel">
        <div className="metamask-header">
          <span className="metamask-icon">🦊</span><span className="metamask-title">MetaMask</span>
          <span className="metamask-status disconnected">disconnected</span>
        </div>
        <div className="metamask-body">
          <button className="metamask-connect-btn" onClick={onConnect} disabled={isConnecting}>
            {isConnecting ? <><span className="pay-spinner" /> Connecting...</> : "Connect MetaMask"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="metamask-panel connected">
      <div className="metamask-header">
        <span className="metamask-icon">🦊</span><span className="metamask-title">MetaMask</span>
        <span className="metamask-status connected-status">connected</span>
      </div>
      <div className="metamask-body">
        <div className="metamask-detail-row">
          <span className="metamask-label">Address</span>
          <span className="metamask-value metamask-address">{metamaskAccount.address.slice(0, 6)}…{metamaskAccount.address.slice(-4)}</span>
        </div>
        <div className="metamask-detail-row">
          <span className="metamask-label">Network</span>
          <span className="metamask-value">{metamaskAccount.chainName}</span>
        </div>
        <button className="metamask-disconnect-btn" onClick={onDisconnect}>Disconnect</button>
      </div>
    </div>
  );
}

function WalletPanel({ walletInfo, onReset, purchasesCount }) {
  if (!walletInfo) return null;
  return (
    <div className="wallet-panel">
      <div className="wallet-header"><span className="wallet-icon">x402</span><span className="wallet-title">x402 Wallet</span></div>
      <div className="wallet-body">
        <div className="wallet-balance-row">
          <span className="wallet-label">Balance</span>
          <span className="wallet-balance-value">{walletInfo.balanceUSD}</span>
        </div>
        <div className="wallet-detail-row">
          <span className="wallet-label">Currency</span>
          <span className="wallet-detail-value">{walletInfo.currency}</span>
        </div>
        <div className="wallet-detail-row">
          <span className="wallet-label">Network</span>
          <span className="wallet-detail-value">{walletInfo.network}</span>
        </div>
        <div className="wallet-detail-row">
          <span className="wallet-label">Session</span>
          <span className="wallet-detail-value wallet-session">{walletInfo.sessionId}</span>
        </div>
        {purchasesCount > 0 && (
          <div className="wallet-detail-row">
            <span className="wallet-label">Purchases</span>
            <span className="wallet-detail-value">{purchasesCount}</span>
          </div>
        )}
        <button className="wallet-reset-btn" onClick={onReset}>Reset Wallet</button>
      </div>
    </div>
  );
}

function PaymentCard({ product, walletInfo, sessionId, onPaid, onResetWallet, metamaskAccount }) {
  const [isPaying, setIsPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const payment = product?.payment;

  const handlePay = async () => {
    setIsPaying(true);
    setError(null);
    try {
      let signature, signerAddress;
      if (metamaskAccount) {
        const message = `x402 payment: Pay ${product.price} to ${product.payment?.payTo || product.payTo} for ${product.name}`;
        const signed = await signMessage(message);
        signature = signed.signature;
        signerAddress = signed.signer;
      }
      const res = await x402Client.payForResource(product.id, sessionId, signature, signerAddress);
      if (res.status === "purchased") {
        setPaid(true);
        setResult(res);
        if (onPaid) onPaid(res);
      } else {
        setError(res.error || "Payment failed");
      }
    } catch (e) {
      setError(e.message || "Payment failed");
    }
    setIsPaying(false);
  };

  if (paid && result) {
    const nftSvg = result.data?.resource;
    const sr = result.settlementResponse || result.data?.settlementResponse;
    const shortTx = sr?.txHash ? sr.txHash.slice(0, 10) + "..." + sr.txHash.slice(-6) : null;
    return (
      <div className="payment-card purchased">
        <div className="payment-card-header purchased-header">
          <span className="payment-status-icon">✅</span>
          <span className="payment-status-text">Payment Verified</span>
        </div>
        <div className="payment-card-body">
          <div className="purchased-product">
            <div className="purchased-info">
              <span className="purchased-name">{product.name}</span>
              <span className="purchased-price">{product.price}</span>
            </div>
          </div>
          {nftSvg && <div className="nft-preview" dangerouslySetInnerHTML={{ __html: nftSvg }} />}
          {sr && (
            <div className="receipt-section">
              <span className="receipt-label">Settlement</span>
              <div className="receipt-details">
                <span className="receipt-tx">{shortTx}</span>
                <span className="receipt-time">Balance: ${(sr.balance / 100).toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="payment-card error-card">
        <div className="payment-card-header error-header">
          <span className="payment-status-icon">⚠️</span>
          <span className="payment-status-text error-text">Payment Failed</span>
        </div>
        <div className="payment-card-body">
          <p className="payment-error-msg">{error}</p>
          <div className="error-actions">
            <button className="pay-button" onClick={handlePay} disabled={isPaying}>
              {isPaying ? <><span className="pay-spinner" /> Retrying...</> : "Retry Payment"}
            </button>
            <button className="wallet-reset-btn" onClick={onResetWallet}>Reset Wallet</button>
          </div>
        </div>
      </div>
    );
  }

  const canAfford = walletInfo && walletInfo.balance >= (product.priceInCents || 99999);

  return (
      <div className="payment-card">
        <div className="payment-card-header">
          <span className="payment-status-icon">🔒</span>
          <span className="payment-status-text">HTTP 402 — Payment Required</span>
          <span className="x402-badge">x402</span>
          {metamaskAccount && <span className="mm-badge">🦊</span>}
        </div>
      <div className="payment-card-body">
        {!payment && <span className="demo-badge">🧪 Demo Mode</span>}
        <div className="payment-product-row">
          <div className="payment-product-info">
            <span className="payment-product-name">{product.name}</span>
            <span className="payment-product-price">{product.price}</span>
          </div>
        </div>
        <div className="payment-details">
          <div className="payment-detail-row">
            <span className="payment-detail-label">Network</span>
            <span className="payment-detail-value">{payment?.network || "eip155:84532"}</span>
          </div>
          <div className="payment-detail-row">
            <span className="payment-detail-label">Amount</span>
            <span className="payment-detail-value amount">{product.price}</span>
          </div>
          <div className="payment-detail-row">
            <span className="payment-detail-label">Pay To</span>
            <span className="payment-detail-value address">
              {payment?.payTo ? `${payment.payTo.slice(0, 10)}…${payment.payTo.slice(-6)}` : "—"}
            </span>
          </div>
        </div>
        <button className={`pay-button ${!canAfford ? "disabled" : ""}`} onClick={handlePay} disabled={isPaying || !canAfford}>
          {isPaying ? (
            <><span className="pay-spinner" /> Processing Payment...</>
          ) : !canAfford ? (
            "Insufficient Balance"
          ) : (
            `Pay ${product.price}${metamaskAccount ? " with MetaMask" : " via x402"}`
          )}
        </button>
      </div>
    </div>
  );
}

function ChatMessage({ message, onConfirm, walletInfo, sessionId, onPaid, onResetWallet, onCatalogSelect, metamaskAccount }) {
  const isUser = message.role === "user";

  return (
    <div className={`chat-message ${isUser ? "user" : "assistant"}`}>
      {!isUser && (
        <div className="avatar assistant-avatar"><span>🤖</span></div>
      )}
      <div className="message-content">
        <div className="message-bubble"><p>{message.text}</p></div>

        {!isUser && message.agentAction === "confirm_gate" && message.agentProduct && (
          <div className="confirm-gate">
            <span className="confirm-gate-text">Would you like to purchase {message.agentProduct.name} for {message.agentProduct.price}?</span>
            <div className="confirm-gate-actions">
              <button className="confirm-btn yes" onClick={() => onConfirm("yes", message.agentProduct)}>Buy Now</button>
              <button className="confirm-btn no" onClick={() => onConfirm("no", message.agentProduct)}>No Thanks</button>
            </div>
          </div>
        )}

        {!isUser && message.agentAction === "show_catalog" && message.agentProducts && (
          <div className="catalog-list">
            <span className="catalog-title">Available Products — click to buy</span>
            {message.agentProducts.map(p => (
              <button key={p.id} className={`catalog-item ${message.agentProduct?.id === p.id ? "recommended" : ""}`}
                onClick={() => onCatalogSelect && onCatalogSelect(p)} title={`Buy ${p.name} for ${p.price}`}>
                <span className="catalog-item-name">{p.name}</span>
                <span className="catalog-item-price">{p.price}{p.calories != null ? ` · ${p.calories} cal` : ""}</span>
                {message.agentProduct?.id === p.id && <span className="catalog-recommend-badge">Recommended</span>}
              </button>
            ))}
            {message.agentProduct && (
              <div className="confirm-gate">
                <span className="confirm-gate-text">Would you like to purchase {message.agentProduct.name} for {message.agentProduct.price}?</span>
                <div className="confirm-gate-actions">
                  <button className="confirm-btn yes" onClick={() => onConfirm("yes", message.agentProduct)}>Buy Now</button>
                  <button className="confirm-btn no" onClick={() => onConfirm("no", message.agentProduct)}>No Thanks</button>
                </div>
              </div>
            )}
          </div>
        )}

        {!isUser && message.agentAction === "show_payment_card" && message.agentProduct && (
          <PaymentCard product={message.agentProduct} walletInfo={walletInfo} sessionId={sessionId}
            onPaid={(result) => onPaid(message, result)} onResetWallet={onResetWallet}
            metamaskAccount={metamaskAccount} />
        )}

        <span className="message-time">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      {isUser && <div className="avatar user-avatar"><span>👤</span></div>}
    </div>
  );
}

function InventoryPanel({ sessionId, visible }) {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    x402Client.getPurchases(sessionId).then(data => {
      setPurchases(data.purchases || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [sessionId, visible]);

  if (!visible) return null;

  return (
    <div className="inventory-panel">
      <div className="inventory-header">
        <span className="inventory-title">Inventory</span>
        <span className="inventory-count">{purchases.length} item{purchases.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="inventory-body">
        {loading && <p className="inventory-loading">Loading...</p>}
        {!loading && purchases.length === 0 && <p className="inventory-empty">No purchases yet. Ask the agent to find products!</p>}
        {purchases.map(p => (
          <div key={p.purchaseId} className="inventory-item">
            <div className="inventory-item-header">
              <span className="inventory-item-name">{p.productName}</span>
              <span className="inventory-item-price">{p.displayPrice}</span>
            </div>
            {p.nft && <div className="inventory-nft" dangerouslySetInnerHTML={{ __html: p.nft }} />}
            <div className="inventory-item-meta">
              <span className="inventory-tx" title={p.txHash}>TX: {p.txHash?.slice(0, 10)}…{p.txHash?.slice(-6)}</span>
              <span className="inventory-date">{new Date(p.timestamp).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [agentContext, setAgentContext] = useState({});
  const [walletInfo, setWalletInfo] = useState(null);
  const [showMCP, setShowMCP] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [latestMCP, setLatestMCP] = useState(null);
  const [metamaskAccount, setMetamaskAccount] = useState(null);
  const [isConnectingMetaMask, setIsConnectingMetaMask] = useState(false);
  const [purchasedProducts, setPurchasedProducts] = useState({});
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const walletErrorRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const refreshWallet = async () => {
    try {
      const info = await x402Client.getBalance(SESSION_ID);
      setWalletInfo(info);
      walletErrorRef.current = false;
    } catch (e) {
      if (!walletErrorRef.current) {
        console.error("Wallet refresh failed:", e.message);
        walletErrorRef.current = true;
      }
    }
  };

  useEffect(() => {
    const init = async () => {
      await refreshWallet();
      setMessages([{
        role: "assistant",
        text: "Hello! I'm your AI assistant. I can discover products and services for you using MCP Discovery, and handle payments via the x402 protocol. What are you looking for today?",
        timestamp: new Date().toISOString(),
      }]);
    };
    init();
  }, []);

  useEffect(() => {
    const interval = setInterval(refreshWallet, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleMetaMaskConnect = useCallback(async () => {
    setIsConnectingMetaMask(true);
    try {
      const account = await connectMetaMask();
      setMetamaskAccount(account);
    } catch (err) {
      console.error("MetaMask connection failed:", err);
    }
    setIsConnectingMetaMask(false);
  }, []);

  const handleMetaMaskDisconnect = useCallback(() => {
    setMetamaskAccount(null);
  }, []);

  useEffect(() => {
    async function checkExisting() {
      const account = await getConnectedAccounts();
      if (account) setMetamaskAccount(account);
    }
    checkExisting();
    const cleanup = registerMetaMaskCallbacks({
      onAccountsChanged: (accounts) => {
        if (accounts.length === 0) setMetamaskAccount(null);
        else getConnectedAccounts().then(a => a && setMetamaskAccount(a));
      },
      onChainChanged: () => getConnectedAccounts().then(a => a && setMetamaskAccount(a)),
    });
    return cleanup;
  }, []);

  const addAssistantMessage = (result, delay = 800) => {
    return new Promise(resolve => {
      setTimeout(() => {
        const aiMsg = {
          role: "assistant",
          text: result.text,
          timestamp: new Date().toISOString(),
          agentAction: result.action || null,
          agentProduct: result.product || null,
          agentProducts: result.products || null,
        };
        setMessages(prev => [...prev, aiMsg]);
        resolve(aiMsg);
      }, delay + Math.random() * 500);
    });
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || isTyping) return;

    const userMsg = { role: "user", text: trimmed, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const result = await processMessage(trimmed, agentContext);

      if (result.action === "confirm_gate") {
        setAgentContext({ lastAction: "confirm_gate", lastProduct: result.product });
      } else {
        setAgentContext({});
      }

      if (result.action === "show_payment_card" && result.product) {
        try {
          await x402Client.accessResource(result.product.id);
        } catch (_) {}
      }

      if (result.product?.payment) {
        setLatestMCP({
          toolsFound: 1,
          toolName: "product_discovery",
          toolStatus: "completed",
          productsDiscovered: result.products?.length || 1,
          selectedProduct: result.product.id,
          paymentStatus: result.action === "show_payment_card" ? "ready" : "pending",
          timestamp: new Date().toISOString(),
        });
      }

      await addAssistantMessage(result);
    } catch (e) {
      console.error("Agent error:", e);
    }
    setIsTyping(false);
  };

  const handleConfirm = async (answer, product) => {
    const text = answer === "yes" ? `Yes, I'd like to buy ${product.name}` : "No thanks";
    const userMsg = { role: "user", text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
      let result;
      if (answer === "yes") {
        const access = await x402Client.accessResource(product.id);
        if (access.status === "payment_required") {
          result = {
            text: `HTTP 402 — Payment Required for ${product.name} (${product.price}). Click below to complete via x402.`,
            action: "show_payment_card",
            product,
          };
        } else {
          result = {
            text: `Sorry, there was an issue accessing ${product.name}: ${access.error || "unknown error"}`,
            action: "show_catalog",
            products: [],
            product: null,
          };
        }
      } else {
        const context = { lastAction: "confirm_gate", lastProduct: product };
        result = await processMessage(answer, context);
      }

      if (result.action === "confirm_gate") {
        setAgentContext({ lastAction: "confirm_gate", lastProduct: result.product });
      } else {
        setAgentContext({});
      }

      if (result.product?.payment) {
        setLatestMCP({
          toolsFound: 1,
          toolName: "product_discovery",
          toolStatus: "completed",
          productsDiscovered: 1,
          selectedProduct: result.product.id,
          paymentStatus: result.action === "show_payment_card" ? "ready" : "pending",
          timestamp: new Date().toISOString(),
        });
      }

      await addAssistantMessage(result, 400);
    } catch (e) {
      console.error("Confirm error:", e);
    }
    setIsTyping(false);
  };

  const handleCatalogSelect = async (product) => {
    const userMsg = { role: "user", text: `Buy ${product.name}`, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
      setAgentContext({});
      const access = await x402Client.accessResource(product.id);
      let result;
      if (access.status === "payment_required") {
        result = {
          text: `HTTP 402 — Payment Required for ${product.name} (${product.price}). Click below to complete via x402.`,
          action: "show_payment_card",
          product,
        };
      } else {
        result = {
          text: `Sorry, there was an issue accessing ${product.name}: ${access.error || "unknown error"}`,
          action: "show_catalog",
          products: [],
          product: null,
        };
      }

      if (product.payment) {
        setLatestMCP({
          toolsFound: 1,
          toolName: "product_discovery",
          toolStatus: "completed",
          productsDiscovered: 1,
          selectedProduct: product.id,
          paymentStatus: "ready",
          timestamp: new Date().toISOString(),
        });
      }

      await addAssistantMessage(result, 400);
    } catch (e) {
      console.error("Catalog select error:", e);
    }
    setIsTyping(false);
  };

  const handlePaid = async (message, result) => {
    setPurchasedProducts(prev => ({ ...prev, [message.agentProduct?.id]: result }));
    await refreshWallet();
  };

  const handleResetWallet = async () => {
    try {
      const info = await x402Client.resetWallet(SESSION_ID);
      setWalletInfo(info);
      setPurchasedProducts({});
    } catch (e) {
      console.error("Wallet reset failed:", e.message);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="app-container">
      <div className="bg-gradient" />
      <aside className="sidebar">
        <div className="sidebar-top">
          <div className="brand">
            <div className="brand-icon">🤖</div>
            <div className="brand-text">
              <h1>AI Assistant</h1>
              <span className="brand-sub">MCP + x402 Demo</span>
            </div>
          </div>
        </div>
        <div className="sidebar-nav">
          <button className="nav-item active">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg> Chat
          </button>
          <button className={`nav-item ${showMCP ? "active" : ""}`} onClick={() => setShowMCP(!showMCP)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg> MCP Panel
          </button>
          <button className={`nav-item ${showInventory ? "active" : ""}`} onClick={() => setShowInventory(!showInventory)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
            </svg> Inventory
          </button>
        </div>
        <div className="sidebar-bottom">
          <MetaMaskPanel metamaskAccount={metamaskAccount} onConnect={handleMetaMaskConnect}
            onDisconnect={handleMetaMaskDisconnect} isConnecting={isConnectingMetaMask} />
          <WalletPanel walletInfo={walletInfo} onReset={handleResetWallet}
            purchasesCount={Object.keys(purchasedProducts).length} />
          <div className="model-badge">
            <span className="model-dot" /> AI + MCP + x402
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="chat-area">
          <div className="messages-container">
            {messages.map((msg, i) => (
              <ChatMessage key={i} message={msg} onConfirm={handleConfirm} walletInfo={walletInfo}
                sessionId={SESSION_ID} onPaid={handlePaid} onResetWallet={handleResetWallet}
                onCatalogSelect={handleCatalogSelect} metamaskAccount={metamaskAccount} />
            ))}
            {isTyping && (
              <div className="chat-message assistant">
                <div className="avatar assistant-avatar"><span>🤖</span></div>
                <div className="message-content">
                  <div className="message-bubble typing-bubble"><TypingDots /></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            <div className="input-container">
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown} placeholder="What are you looking for?" rows={1} />
              <button className="send-button" onClick={handleSend} disabled={!input.trim() || isTyping}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
            <p className="input-hint">AI discovers products via MCP Discovery and pays via x402 protocol.</p>
          </div>
        </div>

        {showMCP && <div className="mcp-panel-wrapper"><MCPPanel mcpData={latestMCP} visible={showMCP} /></div>}
        {showInventory && <div className="mcp-panel-wrapper"><InventoryPanel sessionId={SESSION_ID} visible={showInventory} /></div>}
      </main>
    </div>
  );
}
