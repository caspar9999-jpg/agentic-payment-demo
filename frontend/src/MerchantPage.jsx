import { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { x402Client } from "./sodaEngine.js";

function MerchantDirectory() {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rangeHours, setRangeHours] = useState(0);

  const fetchMerchants = async (hours) => {
    try {
      const data = await x402Client.getMerchantBalances(hours);
      setMerchants(data || []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("Failed to fetch merchants:", e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMerchants(rangeHours);
    const interval = setInterval(() => fetchMerchants(rangeHours), 5000);
    return () => clearInterval(interval);
  }, [rangeHours]);

  const handleRangeChange = (e) => {
    const hours = parseInt(e.target.value);
    setRangeHours(hours);
    setLoading(true);
  };

  const totalRevenue = merchants.reduce((sum, m) => sum + (m.balance || 0), 0);
  const totalProducts = merchants.reduce((sum, m) => sum + (m.totalProducts || 0), 0);

  return (
    <>
      <header className="merchant-page-header">
        <Link to="/" className="merchant-back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Chat
        </Link>
        <div className="merchant-page-title-block">
          <h1 className="merchant-page-title">MCP Marketplace</h1>
          <p className="merchant-page-subtitle">Browse merchants and their products — auto-refreshes every 5s</p>
        </div>
        <div className="merchant-page-summary">
          <div className="merchant-summary-card">
            <span className="merchant-summary-label">Total Revenue</span>
            <span className="merchant-summary-value revenue">${(totalRevenue / 100).toFixed(2)}</span>
          </div>
          <div className="merchant-summary-card">
            <span className="merchant-summary-label">Merchants</span>
            <span className="merchant-summary-value">{merchants.length}</span>
          </div>
          <div className="merchant-summary-card">
            <span className="merchant-summary-label">Products</span>
            <span className="merchant-summary-value">{totalProducts}</span>
          </div>
          <div className="merchant-summary-card" style={{ minWidth: "160px" }}>
            <span className="merchant-summary-label">Time Range</span>
            <select className="merchant-range-select" value={rangeHours} onChange={handleRangeChange}>
              <option value="0">All Time</option>
              <option value="24">Last 24 Hours</option>
              <option value="168">Last Week</option>
              <option value="720">Last Month</option>
            </select>
          </div>
        </div>
      </header>

      <main className="merchant-page-body">
        {loading && <p className="merchant-loading">Loading merchants...</p>}

        {!loading && merchants.length === 0 && (
          <div className="merchant-empty-state">
            <p className="merchant-empty-text">No merchants registered yet.</p>
            <p className="merchant-empty-hint">Make a purchase to see merchant data.</p>
            <Link to="/" className="merchant-empty-link">← Back to Chat</Link>
          </div>
        )}

        {!loading && merchants.length > 0 && (
          <div className="merchant-grid">
            {merchants.map(m => (
              <Link to={`/merchant/${m.wallet}`} key={m.wallet} className="merchant-card">
                <div className="merchant-card-header">
                  <div>
                    <h2 className="merchant-card-name">{m.name || "Merchant"}</h2>
                    <span className="merchant-card-revenue-label">Revenue</span>
                  </div>
                  <span className="merchant-card-balance">{m.balanceUSD}</span>
                </div>
                <div className="merchant-card-body">
                  <div className="merchant-card-products">
                    {m.products?.slice(0, 4).map(p => (
                      <span key={p.productId} className="merchant-card-product-tag">{p.name}</span>
                    ))}
                    {(m.totalProducts || 0) > 4 && (
                      <span className="merchant-card-product-tag more">+{m.totalProducts - 4} more</span>
                    )}
                  </div>
                  <div className="merchant-card-wallet">
                    <code>{m.wallet.slice(0, 10)}…{m.wallet.slice(-6)}</code>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {lastUpdated && (
          <p className="merchant-last-updated">Last updated: {lastUpdated.toLocaleTimeString()}</p>
        )}
      </main>
    </>
  );
}

function MerchantDetail() {
  const { merchantId } = useParams();
  const [merchant, setMerchant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [rangeHours, setRangeHours] = useState(0);

  const fetchMerchant = async (hours) => {
    try {
      const data = await x402Client.getMerchant(merchantId, hours);
      setMerchant(data);
      setLastUpdated(new Date());
    } catch (e) {
      console.error("Failed to fetch merchant:", e.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchMerchant(rangeHours);
    const interval = setInterval(() => fetchMerchant(rangeHours), 5000);
    return () => clearInterval(interval);
  }, [merchantId, rangeHours]);

  const handleRangeChange = (e) => {
    const hours = parseInt(e.target.value);
    setRangeHours(hours);
    setLoading(true);
  };

  return (
    <>
      <header className="merchant-page-header">
        <Link to="/merchant" className="merchant-back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          All Merchants
        </Link>
        <div className="merchant-page-title-block">
          {merchant && (
            <>
              <h1 className="merchant-page-title">{merchant.name || "Merchant Wallet"}</h1>
              <p className="merchant-page-subtitle">
                <code className="merchant-detail-wallet">{merchant.wallet}</code>
              </p>
            </>
          )}
        </div>
        {merchant && (
          <div className="merchant-page-summary">
            <div className="merchant-summary-card">
              <span className="merchant-summary-label">Total Revenue</span>
              <span className="merchant-summary-value revenue">{merchant.totalRevenueUSD || "$0.00"}</span>
            </div>
            <div className="merchant-summary-card">
              <span className="merchant-summary-label">Total Sales</span>
              <span className="merchant-summary-value">{merchant.totalSales || 0}</span>
            </div>
            <div className="merchant-summary-card">
              <span className="merchant-summary-label">Products</span>
              <span className="merchant-summary-value">{merchant.totalProducts}</span>
            </div>
            <div className="merchant-summary-card" style={{ minWidth: "160px" }}>
              <span className="merchant-summary-label">Time Range</span>
              <select className="merchant-range-select" value={rangeHours} onChange={handleRangeChange}>
                <option value="0">All Time</option>
                <option value="24">Last 24 Hours</option>
                <option value="168">Last Week</option>
                <option value="720">Last Month</option>
              </select>
            </div>
          </div>
        )}
      </header>

      <main className="merchant-page-body">
        {loading && <p className="merchant-loading">Loading merchant data...</p>}

        {!loading && !merchant && (
          <div className="merchant-empty-state">
            <p className="merchant-empty-text">Merchant not found</p>
            <Link to="/merchant" className="merchant-empty-link">← All Merchants</Link>
          </div>
        )}

        {!loading && merchant && merchant.products?.length > 0 && (
          <div className="merchant-table-container">
            <table className="merchant-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Sales</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {merchant.products.map(p => (
                  <tr key={p.productId}>
                    <td className="merchant-cell-product">{p.name}</td>
                    <td className="merchant-cell-price">{p.displayPrice}</td>
                    <td className="merchant-cell-sales">{p.sales || 0}</td>
                    <td className="merchant-cell-balance">{p.revenueUSD || "$0.00"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && merchant && merchant.recentPurchases?.length > 0 && (
          <div className="merchant-table-container" style={{ marginTop: "32px" }}>
            <h3 style={{ fontWeight: 600, marginBottom: "12px", color: "#94a3b8", fontSize: "14px", letterSpacing: "0.5px" }}>Recent Purchases</h3>
            <table className="merchant-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Time</th>
                  <th>Purchase ID</th>
                </tr>
              </thead>
              <tbody>
                {merchant.recentPurchases.map(p => (
                  <tr key={p.purchaseId}>
                    <td className="merchant-cell-product">{p.productName}</td>
                    <td className="merchant-cell-price">${(p.priceInCents / 100).toFixed(2)}</td>
                    <td className="merchant-cell-sales">{new Date(p.timestamp).toLocaleTimeString()}</td>
                    <td className="merchant-cell-balance"><code>{p.purchaseId.slice(0, 12)}…</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && merchant && !merchant.products?.length && (
          <div className="merchant-empty-state">
            <p className="merchant-empty-text">No products registered for this merchant.</p>
          </div>
        )}

        {lastUpdated && (
          <p className="merchant-last-updated">Last updated: {lastUpdated.toLocaleTimeString()}</p>
        )}
      </main>
    </>
  );
}

export default function MerchantPage() {
  const { merchantId } = useParams();
  return (
    <div className="merchant-page">
      <div className="bg-gradient" />
      {merchantId ? <MerchantDetail /> : <MerchantDirectory />}
    </div>
  );
}
