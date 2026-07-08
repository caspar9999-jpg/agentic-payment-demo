import { useState, useEffect } from "react";
import { Link } from "react-router-dom";

function JsonBlock({ label, data, variant }) {
  return (
    <div className={`pipeline-json-block ${variant || ""}`}>
      <div className="pipeline-json-label">{label}</div>
      <pre className="pipeline-json-pre">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}

function StepArrow() {
  return (
    <div className="pipeline-arrow">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <line x1="12" y1="5" x2="12" y2="19" /><polyline points="5 12 12 19 19 12" />
      </svg>
    </div>
  );
}

export default function BazaarDemoPage() {
  const [resources, setResources] = useState([]);
  const [sourceProducts, setSourceProducts] = useState([]);
  const [debug, setDebug] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [lastRequest, setLastRequest] = useState(null);

  const fetchResources = async (query = "") => {
    setLoading(true);
    setError(null);
    const reqUrl = query
      ? `/bazaar/discovery/resources/search?q=${encodeURIComponent(query)}`
      : "/bazaar/discovery/resources";
    const x402Url = "/x402/products";
    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const [bazaarRes, x402Res] = await Promise.all([
        fetch(reqUrl, { signal: controller.signal }),
        fetch(x402Url, { signal: controller.signal }),
      ]);
      clearTimeout(timeout);
      const elapsed = Date.now() - start;

      if (!bazaarRes.ok) throw new Error(`Bazaar HTTP ${bazaarRes.status}`);
      if (!x402Res.ok) throw new Error(`x402 HTTP ${x402Res.status}`);

      const bazaarData = await bazaarRes.json();
      const x402Data = await x402Res.json();
      const items = bazaarData.resources || [];
      const rawProducts = x402Data.products || [];
      const bazaarDebug = bazaarData._debug;

      setResources(items);
      setSourceProducts(rawProducts);
      setDebug({
        status: bazaarRes.status,
        elapsed,
        bazaarDebug,
      });
      setLastRequest({ url: reqUrl, query: query || null, x402Url, timestamp: Date.now() });
    } catch (e) {
      setError(e.name === "AbortError" ? "Servers not running — start x402server and mcpdiscovery first" : e.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchResources(); }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    fetchResources(searchQuery);
  };

  return (
    <div className="bazaar-demo-page">
      <div className="bg-gradient" />

      <header className="bazaar-demo-header">
        <Link to="/" className="merchant-back-link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to Chat
        </Link>
        <div className="bazaar-demo-title-block">
          <h1 className="bazaar-demo-title">Bazaar Discovery — Data Flow</h1>
          <p className="bazaar-demo-subtitle">
            Authentic request/response trace showing how the agent discovers x402 services via Bazaar
          </p>
        </div>
      </header>

      <main className="bazaar-demo-body">
        <form className="bazaar-search-form" onSubmit={handleSearch}>
          <input
            className="bazaar-search-input"
            type="text"
            placeholder="Search resources (e.g. coffee, cola, water)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="bazaar-search-btn" type="submit" disabled={loading}>Search</button>
          <button className="bazaar-search-btn bazaar-search-refresh" type="button" disabled={loading}
            onClick={() => { setSearchQuery(""); fetchResources(); }}>
            All
          </button>
        </form>

        {error && (
          <div className="bazaar-error">
            <span className="bazaar-error-icon">!</span>
            <span>{error}</span>
            <p style={{ marginTop: 8, color: "rgba(255,255,255,0.3)", fontSize: 11 }}>
              Make sure both <code>x402server</code> and <code>mcpdiscovery</code> are running before the frontend.
            </p>
          </div>
        )}

        <div className="pipeline-container">
          {loading && <p className="merchant-loading">{"Discovering via Bazaar... (ensure x402 + bazaar servers are running)"}</p>}

          {!loading && (<>
            {/* ═══ Step 1: Agent request ═══ */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <span className="pipeline-step-num">1</span>
                <div>
                  <h3 className="pipeline-step-title">Agent → Bazaar Request</h3>
                  <p className="pipeline-step-desc">
                    The agent queries the Bazaar discovery layer to find available x402 services
                  </p>
                </div>
              </div>
              <div className="pipeline-step-data">
                <JsonBlock
                  label={`GET ${lastRequest?.url || "/bazaar/discovery/resources"}`}
                  variant="request"
                  data={{
                    method: "GET",
                    url: lastRequest?.url || "/bazaar/discovery/resources",
                    headers: {
                      "Accept": "application/json",
                      "User-Agent": "x402-agent/2.0",
                    },
                  }}
                />
              </div>
            </div>

            <StepArrow />

            {/* ═══ Step 2: x402 products (what Bazaar discovers) ═══ */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <span className="pipeline-step-num">2</span>
                <div>
                  <h3 className="pipeline-step-title">Bazaar → x402 Server: <code>GET /products</code></h3>
                  <p className="pipeline-step-desc">
                    Bazaar queries the x402 server&apos;s product catalog to learn what services exist and their prices
                    <span className="pipeline-step-meta"> — {sourceProducts.length} products</span>
                  </p>
                </div>
              </div>
              <div className="pipeline-step-data">
                <JsonBlock
                  label={`GET ${lastRequest?.x402Url || "http://localhost:3002/products"}`}
                  variant="source"
                  data={{
                    request: { method: "GET", url: "http://localhost:3002/products" },
                    response: { products: sourceProducts, total: sourceProducts.length },
                  }}
                />
              </div>
            </div>

            <StepArrow />

            {/* ═══ Step 3: Bazaar response ═══ */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <span className="pipeline-step-num">3</span>
                <div>
                  <h3 className="pipeline-step-title">Bazaar → Agent: Discovery Response</h3>
                  <p className="pipeline-step-desc">
                    Bazaar transforms x402 products into standard resource format and returns them to the agent
                    {debug && <span className="pipeline-step-meta"> — {debug.status} OK, {debug.elapsed}ms, {resources.length} resources</span>}
                  </p>
                </div>
              </div>
              <div className="pipeline-step-data">
                <JsonBlock
                  label="Response body (Bazaar resource format)"
                  variant="response"
                  data={{ resources }}
                />
              </div>
            </div>

            <StepArrow />

            {/* ═══ Step 4: Comparison ═══ */}
            <div className="pipeline-step">
              <div className="pipeline-step-header">
                <span className="pipeline-step-num">4</span>
                <div>
                  <h3 className="pipeline-step-title">Transformation: x402 Product → Bazaar Resource</h3>
                  <p className="pipeline-step-desc">
                    How Bazaar maps the x402 product catalog into discoverable resources with scheme/network/amount metadata
                  </p>
                </div>
              </div>
              <div className="pipeline-step-data pipeline-compare">
                {sourceProducts.slice(0, 3).map((sp, i) => {
                  const matchingResource = resources.find(r => {
                    const pid = r.extensions?.bazaar?.info?.input?.pathParams?.productId;
                    return pid === sp.productId || r.resource?.endsWith(`/resource/${sp.productId}`);
                  });
                  return (
                    <div key={sp.productId} className="pipeline-compare-pair">
                      <div className="pipeline-compare-side">
                        <div className="pipeline-compare-label">x402 /products[{i}]</div>
                        <pre className="pipeline-json-pre small">{JSON.stringify(sp, null, 2)}</pre>
                      </div>
                      <div className="pipeline-compare-arrow">→</div>
                      <div className="pipeline-compare-side">
                        <div className="pipeline-compare-label">Bazaar Resource[{i}]</div>
                        <pre className="pipeline-json-pre small">{matchingResource ? JSON.stringify(matchingResource, null, 2) : "—"}</pre>
                      </div>
                    </div>
                  );
                })}
                {sourceProducts.length > 3 && (
                  <p className="pipeline-compare-more">+ {sourceProducts.length - 3} more products (omitted for brevity)</p>
                )}
              </div>
            </div>
          </>
        )}
        </div>

        {lastRequest && (
          <p className="merchant-last-updated">
            Last request: {new Date(lastRequest.timestamp).toLocaleTimeString()}
          </p>
        )}
      </main>
    </div>
  );
}
