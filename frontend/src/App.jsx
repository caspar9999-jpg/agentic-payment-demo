import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { processMessage, x402Client, initPaymentClient, resetPaymentClient } from "./sodaEngine.js";
import {
  isMetaMaskInstalled,
  connectMetaMask,
  getConnectedAccounts,
  registerMetaMaskCallbacks,
} from "./metamask.js";
import "./App.css";

const USER_ID = "user_" + Math.random().toString(36).slice(2, 8);

function TypingDots() {
  return (
    <div className="typing-dots">
      <span className="dot" /><span className="dot" /><span className="dot" />
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

function WalletPanel({ metamaskAccount, purchasesCount }) {
  return (
    <div className="wallet-panel">
      <div className="wallet-header"><span className="wallet-icon">x402</span><span className="wallet-title">x402 Wallet</span></div>
      <div className="wallet-body">
        <div className="wallet-detail-row">
          <span className="wallet-label">Network</span>
          <span className="wallet-detail-value">Base Sepolia (eip155:84532)</span>
        </div>
        {metamaskAccount?.address && (
          <div className="wallet-detail-row">
            <span className="wallet-label">Address</span>
            <span className="wallet-detail-value address">{metamaskAccount.address.slice(0, 10)}...{metamaskAccount.address.slice(-6)}</span>
          </div>
        )}
        {purchasesCount > 0 && (
          <div className="wallet-detail-row">
            <span className="wallet-label">Purchases</span>
            <span className="wallet-detail-value">{purchasesCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function PaymentCard({ product, onPaid, metamaskAccount }) {
  const [isPaying, setIsPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handlePay = async () => {
    setIsPaying(true);
    setError(null);
    try {
      const res = await x402Client.payForResource(product.id);
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
    const shortTx = sr?.transaction ? sr.transaction.slice(0, 10) + "..." + sr.transaction.slice(-6) : null;
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
                <span className="receipt-time">{sr.network}</span>
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
          </div>
        </div>
      </div>
    );
  }

  return (
      <div className="payment-card">
        <div className="payment-card-header">
          <span className="payment-status-icon">🔒</span>
          <span className="payment-status-text">HTTP 402 — Payment Required</span>
          <span className="x402-badge">x402</span>
          {metamaskAccount && <span className="mm-badge">🦊</span>}
        </div>
      <div className="payment-card-body">
        <div className="payment-product-row">
          <div className="payment-product-info">
            <span className="payment-product-name">{product.name}</span>
            <span className="payment-product-price">{product.price}</span>
          </div>
        </div>
        <div className="payment-details">
          <div className="payment-detail-row">
            <span className="payment-detail-label">Network</span>
            <span className="payment-detail-value">eip155:84532</span>
          </div>
          <div className="payment-detail-row">
            <span className="payment-detail-label">Amount</span>
            <span className="payment-detail-value amount">{product.price}</span>
          </div>
          <div className="payment-detail-row">
            <span className="payment-detail-label">Pay To</span>
            <span className="payment-detail-value address">
              {product.payTo ? `${product.payTo.slice(0, 10)}…${product.payTo.slice(-6)}` : "—"}
            </span>
          </div>
        </div>
        <button className="pay-button" onClick={handlePay} disabled={isPaying}>
          {isPaying ? (
            <><span className="pay-spinner" /> Processing Payment...</>
          ) : (
            `Pay ${product.price}${metamaskAccount ? " via x402" : " via x402"}`
          )}
        </button>
      </div>
    </div>
  );
}

function ChatMessage({ message, onConfirm, onPaid, onCatalogSelect, metamaskAccount }) {
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
          <PaymentCard product={message.agentProduct}
            onPaid={(result) => onPaid(message, result)}
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

function InventoryPanel({ purchases, visible }) {
  if (!visible) return null;

  return (
    <div className="inventory-panel">
      <div className="inventory-header">
        <span className="inventory-title">Inventory</span>
        <span className="inventory-count">{purchases.length} item{purchases.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="inventory-body">
        {purchases.length === 0 && <p className="inventory-empty">No purchases yet. Ask the agent to find products!</p>}
        {purchases.map(p => {
          const txHash = p.settlementResponse?.transaction || p.txHash;
          const nft = p.data?.resource || p.nft;
          return (
            <div key={p.paymentId || p.purchaseId} className="inventory-item">
              <div className="inventory-item-header">
                <span className="inventory-item-name">{p.data?.name || p.productName}</span>
                <span className="inventory-item-price">{p.data?.displayPrice || p.displayPrice}</span>
              </div>
              {nft && <div className="inventory-nft" dangerouslySetInnerHTML={{ __html: nft }} />}
              <div className="inventory-item-meta">
                {txHash && <span className="inventory-tx" title={txHash}>TX: {txHash.slice(0, 10)}…{txHash.slice(-6)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [agentContext, setAgentContext] = useState({});
  const [showInventory, setShowInventory] = useState(false);
  const [metamaskAccount, setMetamaskAccount] = useState(null);
  const [isConnectingMetaMask, setIsConnectingMetaMask] = useState(false);
  const [purchasedProducts, setPurchasedProducts] = useState([]);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  useEffect(() => {
    setMessages([{
      role: "assistant",
      text: "Hello! I'm your AI assistant. I can discover products and services for you using the x402 Bazaar, and handle payments via the x402 protocol. What are you looking for today?",
      timestamp: new Date().toISOString(),
    }]);
  }, []);

  const handleMetaMaskConnect = useCallback(async () => {
    setIsConnectingMetaMask(true);
    try {
      const account = await connectMetaMask();
      setMetamaskAccount(account);
      initPaymentClient(account.address);
    } catch (err) {
      console.error("MetaMask connection failed:", err);
    }
    setIsConnectingMetaMask(false);
  }, []);

  const handleMetaMaskDisconnect = useCallback(() => {
    setMetamaskAccount(null);
    resetPaymentClient();
  }, []);

  useEffect(() => {
    async function checkExisting() {
      const account = await getConnectedAccounts();
      if (account) {
        setMetamaskAccount(account);
        initPaymentClient(account.address);
      }
    }
    checkExisting();
    const cleanup = registerMetaMaskCallbacks({
      onAccountsChanged: (accounts) => {
        if (accounts.length === 0) {
          setMetamaskAccount(null);
          resetPaymentClient();
        } else getConnectedAccounts().then(a => { if (a) { setMetamaskAccount(a); initPaymentClient(a.address); } });
      },
      onChainChanged: () => getConnectedAccounts().then(a => { if (a) { setMetamaskAccount(a); initPaymentClient(a.address); } }),
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

      await addAssistantMessage(result, 400);
    } catch (e) {
      console.error("Catalog select error:", e);
    }
    setIsTyping(false);
  };

  const handlePaid = (message, result) => {
    setPurchasedProducts(prev => [...prev, { ...result, productName: message.agentProduct?.name, displayPrice: message.agentProduct?.price }]);
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
          <WalletPanel metamaskAccount={metamaskAccount}
            purchasesCount={purchasedProducts.length} />
          <div className="model-badge">
            <span className="model-dot" /> AI + Bazaar + x402
          </div>
        </div>
      </aside>

      <main className="main-content">
        <div className="chat-area">
          <div className="messages-container">
            {messages.map((msg, i) => (
              <ChatMessage key={i} message={msg} onConfirm={handleConfirm}
                onPaid={handlePaid} onCatalogSelect={handleCatalogSelect}
                metamaskAccount={metamaskAccount} />
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
            <p className="input-hint">AI discovers products via the x402 Bazaar and pays via x402 protocol. <Link to="/debug/bazaar" className="debug-link">🔬</Link></p>
          </div>
        </div>

        {showInventory && <div className="mcp-panel-wrapper"><InventoryPanel purchases={purchasedProducts} visible={showInventory} /></div>}
      </main>
    </div>
  );
}
