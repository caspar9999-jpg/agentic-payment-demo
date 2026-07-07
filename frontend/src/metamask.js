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

function getChainName(chainIdHex) {
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
