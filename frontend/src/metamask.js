export function isMetaMaskInstalled() {
  return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
}

export async function connectMetaMask() {
  if (!isMetaMaskInstalled()) {
    throw new Error("MetaMask is not installed");
  }

  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  });

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found");
  }

  const chainId = await window.ethereum.request({ method: "eth_chainId" });

  return {
    address: accounts[0],
    chainId,
    chainName: getChainName(chainId),
  };
}

export async function getConnectedAccounts() {
  if (!isMetaMaskInstalled()) return null;

  try {
    const accounts = await window.ethereum.request({
      method: "eth_accounts",
    });
    if (accounts && accounts.length > 0) {
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      return {
        address: accounts[0],
        chainId,
        chainName: getChainName(chainId),
      };
    }
  } catch (e) {}
  return null;
}

export function registerMetaMaskCallbacks({ onAccountsChanged, onChainChanged }) {
  if (!isMetaMaskInstalled()) return () => {};

  const handleAccountsChanged = (accounts) => {
    if (onAccountsChanged) onAccountsChanged(accounts);
  };

  const handleChainChanged = (chainId) => {
    if (onChainChanged) onChainChanged(chainId);
  };

  window.ethereum.on("accountsChanged", handleAccountsChanged);
  window.ethereum.on("chainChanged", handleChainChanged);

  return () => {
    window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
    window.ethereum.removeListener("chainChanged", handleChainChanged);
  };
}

export async function signMessage(message) {
  if (!isMetaMaskInstalled()) {
    throw new Error("MetaMask is not installed");
  }
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!accounts || accounts.length === 0) {
    throw new Error("No connected MetaMask account");
  }
  const signature = await window.ethereum.request({
    method: "personal_sign",
    params: [message, accounts[0]],
  });
  return { signer: accounts[0], signature };
}

export async function testEIP712Signing() {
  if (!isMetaMaskInstalled()) {
    console.error("MetaMask not installed");
    return;
  }
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!accounts?.[0]) {
    console.error("No connected account");
    return;
  }
  const addr = accounts[0].toLowerCase();
  console.log("=== MetaMask EIP-712 Diagnostic ===");
  console.log("Connected account:", addr);

  const { recoverTypedDataAddress } = await import("viem");

  const testDomain = { name: "TestDomain", version: "1", chainId: 84532, verifyingContract: "0x0000000000000000000000000000000000000001" };
  const testTypes = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Test: [{ name: "message", type: "string" }],
  };
  const testMessage = { message: "hello x402" };

  const serialized = JSON.stringify({ domain: testDomain, types: testTypes, primaryType: "Test", message: testMessage });

  console.log("1. Testing personal_sign...");
  const psSig = await window.ethereum.request({ method: "personal_sign", params: ["hello x402", addr] });
  const { recoverAddress, hashMessage } = await import("viem");
  const psHash = hashMessage("hello x402");
  const psRecovered = await recoverAddress({ hash: psHash, signature: psSig });
  console.log("   personal_sign recovered:", psRecovered.toLowerCase(), "===", addr, "?", psRecovered.toLowerCase() === addr);

  console.log("2. Testing eth_signTypedData_v4 (Test domain, chainId 84532)...");
  const sig1 = await window.ethereum.request({ method: "eth_signTypedData_v4", params: [addr, serialized] });
  const recovered1 = await recoverTypedDataAddress({ domain: testDomain, types: testTypes, primaryType: "Test", message: testMessage, signature: sig1 });
  console.log("   Orig sig recovered:", recovered1.toLowerCase());
  const sigBytes = sig1.replace("0x", "");
  const v1 = parseInt(sigBytes.slice(128, 130), 16);
  console.log("   v value:", "0x" + v1.toString(16), `(${v1})`);

  const flipV = v1 === 27 ? 28 : v1 === 28 ? 27 : v1 === 0 ? 1 : v1 === 1 ? 0 : v1;
  const fixedSig1 = "0x" + sigBytes.slice(0, 128) + flipV.toString(16).padStart(2, "0");
  const recovered1b = await recoverTypedDataAddress({ domain: testDomain, types: testTypes, primaryType: "Test", message: testMessage, signature: fixedSig1 });
  console.log("   Flipped v recovered:", recovered1b.toLowerCase());
  console.log("   Match after v-flip?", recovered1b.toLowerCase() === addr);

  if (recovered1b.toLowerCase() === addr) {
    console.log("*** SUCCESS: v-flip workaround fixes the signature! ***");
  } else if (recovered1.toLowerCase() === addr) {
    console.log("*** Original signature already correct (no v-flip needed) ***");
  } else {
    console.log("*** Neither v value works - different issue ***");
  }

  return { personal: psRecovered.toLowerCase() === addr, typedData: recovered1.toLowerCase() === addr, flipped: recovered1b.toLowerCase() === addr };
}

export function getChainName(chainIdHex) {
  const chains = {
    "0x1": "Ethereum Mainnet",
    "0x5": "Goerli Testnet",
    "0xaa36a7": "Sepolia Testnet",
    "0x89": "Polygon Mainnet",
    "0x13881": "Polygon Mumbai",
    "0xa4b1": "Arbitrum One",
    "0xa86a": "Avalanche C-Chain",
    "0x2105": "Base Mainnet",
    "0x14a34": "Base Sepolia",
    "0xa": "Optimism",
  };
  return chains[chainIdHex] || `Chain ${chainIdHex}`;
}
