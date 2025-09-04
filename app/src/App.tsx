import { useEffect, useMemo, useState, useRef } from "react";
import { BrowserProvider, Contract, parseUnits } from "ethers";
import ABI from "./abi/PrivateCrowdfund.json";
import "./App.css";

const CONTRACT_ADDR = import.meta.env.VITE_CROWDFUND_ADDRESS;
const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS;

const SEPOLIA_ID = 11155111;

/** Load FHEVM SDK from CDN global */
async function loadRelayer() {
  const src = (window as any).relayerSDK || (window as any).RelayerSDK || (window as any).ZamaSDK;
  const sdk = src?.default || src;
  if (!sdk) throw new Error("FHEVM SDK not loaded. Add the script tag.");
  const { initSDK, createInstance, SepoliaConfig } = sdk;
  if (!initSDK || !createInstance || !SepoliaConfig) {
    throw new Error("FHEVM SDK missing required exports");
  }
  await initSDK();
  return { createInstance, SepoliaConfig };
}

export default function App() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signerAddr, setSignerAddr] = useState("");
  const [contract, setContract] = useState<Contract | null>(null);
  const [usdcContract, setUsdcContract] = useState<Contract | null>(null);
  const [relayer, setRelayer] = useState<any | null>(null);

  const [goal, setGoal] = useState(0);
  const [total, setTotal] = useState<number>(0); // -1 means encrypted/unavailable
  const [donors, setDonors] = useState(0);
  const [amount, setAmount] = useState("");
  const [goalReached, setGoalReached] = useState(false);
  const [userContributions, setUserContributions] = useState(0);

  const [status, setStatus] = useState("Ready to connect");
  const [pending, setPending] = useState(false);
  const [connected, setConnected] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const progress = useMemo(() => {
    if (!goal || goal === 0) return 0;
    if (total === -1) {
      if (donors > 0) return Math.min(95, donors * 5);
      return 0;
    }
    const pct = Math.round((total / goal) * 100);
    return Math.max(0, Math.min(100, pct));
  }, [total, goal, donors]);

  useEffect(() => {
    if (!contract) return;
    const id = setInterval(() => refresh(), 15000);
    return () => clearInterval(id);
  }, [contract, relayer]);

  async function switchToSepolia() {
    try {
      const eth = (window as any).ethereum;
      if (!eth) return;
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
      setStatus("Switched to Sepolia");
    } catch {
      setStatus("Failed to switch network");
    }
  }

  async function connect() {
    try {
      setStatus("Connecting...");
      const eth = (window as any).ethereum;
      if (!eth) {
        setStatus("⚠ Install MetaMask to continue");
        return;
      }
      if (!CONTRACT_ADDR) {
        setStatus("⚠ Set VITE_CROWDFUND_ADDRESS in environment");
        return;
      }

      const prov = new BrowserProvider(eth);
      await prov.send("eth_requestAccounts", []);
      const net = await prov.getNetwork();
      if (Number(net.chainId) !== SEPOLIA_ID) {
        setStatus("⚠ Please switch to Sepolia network");
        return;
      }
      setProvider(prov);

      const signer = await prov.getSigner();
      setSignerAddr(await signer.getAddress());

      // Relayer
      let rel: any = null;
      try {
        const { createInstance, SepoliaConfig } = await loadRelayer();
        rel = await createInstance(SepoliaConfig);
        setRelayer(rel);
      } catch (sdkError) {
        console.error("FHEVM SDK failed:", sdkError);
        setStatus("⚠ FHEVM SDK failed to load");
        setRelayer(null);
      }

      // Contract
      const abiArray = (ABI as any).abi || (ABI as any);
      if (!Array.isArray(abiArray) || abiArray.length === 0) {
        throw new Error("ABI is empty or invalid");
      }
      const c = new Contract(CONTRACT_ADDR, abiArray, signer);

      // USDC Contract - Simple ERC20 ABI
      const usdcAbi = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
      ];
      const usdcC = new Contract(USDC_ADDRESS, usdcAbi, signer);

      // test read
      await c.fundingGoal();

      setContract(c);
      setUsdcContract(usdcC);
      setConnected(true);
      setStatus("✅ Connected to Private Crowdfund");

      // autofocus input
      setTimeout(() => inputRef.current?.focus(), 0);

      // pass the created relayer explicitly
      await refresh(c, rel);
    } catch (e: any) {
      setStatus(`⚠ ${e?.message || "Connection failed"}`);
    }
  }

  async function refresh(c?: Contract | null, r?: any | null) {
    const _c = c ?? contract;
    const _r = r ?? relayer;
    if (!_c) return;

    // goal - convert from micro-USDC to display units
    try {
      const g: bigint = await _c.fundingGoal();
      setGoal(Number(g) / 1000000); // Convert from micro-USDC to USDC
    } catch {}

    // total
    try {
      const initialized: boolean = await _c.isInitialized();
      if (!initialized) {
        setTotal(0);
      } else {
        const handle = await _c.getTotalRaised();
        if (!_r) {
          // cannot decrypt without relayer
          setTotal(-1);
        } else {
          try {
            const out: Record<string, bigint | number> = await _r.publicDecrypt([handle as string]);
            const v = out[handle as string];
            const microUsdc = typeof v === "bigint" ? Number(v) : Number(v || 0);
            setTotal(microUsdc / 1000000); // Convert from micro-USDC to USDC
          } catch {
            // decryption not allowed yet
            setTotal(-1);
          }
        }
      }
    } catch {
      // if read fails, keep previous total
    }

    // donors
    try {
      const count: bigint = await _c.contributorCount();
      setDonors(Number(count));
    } catch {}
  }

  async function contribute() {
    console.log("Contribute called", { contract, usdcContract, provider, relayer });
    if (!contract || !usdcContract || !provider) {
      if (!contract) setStatus("Contract not loaded");
      else if (!usdcContract) setStatus("USDC contract not loaded");
      else setStatus("Provider not available");
      return;
    }

    const trimmed = amount.trim();
    if (!trimmed) {
      setStatus("Please enter an amount");
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0 || n > 10000) {
      setStatus("Please enter a valid amount (maximum 10,000 USDC for safety)");
      return;
    }

    if (!relayer) {
      setStatus("FHEVM SDK not available. Please refresh the page.");
      return;
    }

    setPending(true);
    setStatus("Preparing contribution...");

    try {
      const signer = await provider.getSigner();
      const signerAddress = await signer.getAddress();

      // Convert USDC to micro-USDC (6 decimals) - both for ERC20 and FHE
      const amount6 = parseUnits(n.toString(), 6);
      const microUsdcAmount = amount6; // Keep as BigInt for FHE encryption

      // Check contract limits first
      try {
        const minContribution = await contract.minContribution();
        const maxContribution = await contract.maxContribution();

        if (microUsdcAmount < minContribution || microUsdcAmount > maxContribution) {
          const minUsdc = Number(minContribution) / 1000000;
          const maxUsdc = Number(maxContribution) / 1000000;
          setStatus(`⚠ Amount must be between ${minUsdc.toFixed(2)} and ${maxUsdc.toFixed(2)} USDC`);
          setPending(false);
          return;
        }
      } catch (e) {
        console.warn("Could not check contribution limits:", e);
        // Continue without checking limits
      }

      // Check if campaign is still active
      const isActive = await contract.isActive();
      if (!isActive) {
        setStatus("⚠ Campaign is no longer active");
        setPending(false);
        return;
      }

      // Check USDC balance
      setStatus("Checking USDC balance...");
      const balance = await usdcContract.balanceOf(signerAddress);
      if (balance < amount6) {
        setStatus("⚠ Insufficient USDC balance");
        setPending(false);
        return;
      }

      // Check and set USDC allowance if needed
      setStatus("Checking USDC allowance...");
      const currentAllowance = await usdcContract.allowance(signerAddress, contract.target);

      if (currentAllowance < amount6) {
        setStatus("Approving USDC spend...");
        const approveTx = await usdcContract.approve(contract.target, amount6, {
          gasLimit: 100000, // Reasonable gas limit for approval
        });
        setStatus(`Approval pending: ${approveTx.hash.slice(0, 10)}...`);
        await approveTx.wait();
        setStatus("USDC approved ✅");

        // Wait a moment for the approval to be confirmed
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Encrypt the amount (use the BigInt value directly)
      setStatus("Encrypting your contribution...");
      const encryptedInput = relayer.createEncryptedInput(contract.target as string, signerAddress);
      encryptedInput.add64(microUsdcAmount); // BigInt works directly
      const encrypted = await encryptedInput.encrypt();

      // Verify the encrypted input is valid
      if (!encrypted.handles || !encrypted.handles[0] || !encrypted.inputProof) {
        throw new Error("Failed to create encrypted input");
      }

      // Send contribution transaction with optimized gas
      setStatus("Sending encrypted transaction...");

      console.log("Transaction parameters:", {
        amount6: amount6.toString(),
        handle: encrypted.handles[0],
        proofLength: encrypted.inputProof.length,
      });

      // First estimate gas to catch any issues early
      try {
        const gasEstimate = await contract.contributeUSDC.estimateGas(
          amount6,
          encrypted.handles[0],
          encrypted.inputProof,
        );
        console.log("Gas estimate:", gasEstimate.toString());
      } catch (gasError: any) {
        console.error("Gas estimation failed:", gasError);
        throw new Error("Transaction would fail - check contract state and allowances");
      }

      const tx = await contract.contributeUSDC(amount6, encrypted.handles[0], encrypted.inputProof, {
        gasLimit: 1000000, // Increased gas limit for FHE operations
      });

      setStatus(`Transaction pending: ${tx.hash.slice(0, 10)}...`);
      const receipt = await tx.wait();

      if (receipt.status === 0) {
        throw new Error("Transaction failed during execution");
      }

      setUserContributions((prev) => prev + n);
      setStatus(`✅ Contribution of ${n} USDC successful! Tx: ${tx.hash.slice(0, 10)}...`);
      setAmount("");

      await refresh();
    } catch (e: any) {
      let msg = e?.error?.message || e?.shortMessage || e?.message || "Transaction failed";

      // Handle specific error cases
      if (msg.includes("insufficient funds")) {
        msg = "Insufficient ETH for gas fees";
      } else if (msg.includes("user rejected")) {
        msg = "Transaction cancelled by user";
      } else if (msg.includes("gas")) {
        msg = "Transaction failed due to gas estimation. Check contract state.";
      } else if (msg.includes("bounds")) {
        msg = "Contribution amount is outside allowed bounds";
      } else if (msg.includes("transferFrom failed")) {
        msg = "USDC transfer failed - check allowance and balance";
      } else if (msg.includes("Campaign")) {
        msg = "Campaign is not active or has expired";
      }

      setStatus(`Error: ${msg}`);
      console.error("Contribution error:", e);
    } finally {
      setPending(false);
    }
  }

  async function checkGoal() {
    if (!contract || !relayer) return;
    setPending(true);
    setStatus("🎯 Checking if goal is reached...");
    try {
      const tx = await contract.checkGoalReached({
        gasLimit: 200000, // Conservative gas limit
      });
      await tx.wait();

      const h = await contract.getLastGoalStatus();
      const out: Record<string, bigint | number | boolean> = await relayer.publicDecrypt([h as string]);
      const v = out[h as string];
      const reached = typeof v === "bigint" ? v === 1n : !!v;
      setGoalReached(reached);
      setStatus(reached ? "🎉 Goal reached! Campaign successful!" : "📈 Funding still in progress");
    } catch (e: any) {
      setStatus(`⚠ ${e?.shortMessage || e?.message || "Goal check failed"}`);
    } finally {
      setPending(false);
    }
  }

  const getProgressColor = () => {
    if (total === -1) return "#6366f1";
    if (progress >= 100) return "#10b981";
    if (progress >= 75) return "#f59e0b";
    return "#3b82f6";
  };

  return (
    <div className="container">
      <header className="header">
        <h1>🔐 Private Crowdfund</h1>
        <p className="subtitle">Powered by Zama's Fully Homomorphic Encryption</p>
        <div className="meta">
          <span className="addr">
            Contract: {CONTRACT_ADDR.slice(0, 8)}…{CONTRACT_ADDR.slice(-6)}
          </span>
          <span>Network: Sepolia Testnet</span>
        </div>
      </header>

      <div className="encryption-info">
        <h4>🛡️ Privacy-First Crowdfunding</h4>
        <p>
          Your contribution amounts are encrypted on your device and remain private forever. The smart contract can
          compute totals without revealing individual contributions using FHE technology. Contributions are made in
          USDC.
        </p>
      </div>

      <div className="actions">
        <button onClick={connect} disabled={connected || pending}>
          {connected ? "✅ Connected" : "Connect Wallet"}
        </button>
        <button onClick={switchToSepolia} disabled={pending}>
          Switch to Sepolia
        </button>
        {signerAddr && (
          <span className="wallet">
            {signerAddr.slice(0, 6)}…{signerAddr.slice(-4)}
            {userContributions > 0 && (
              <span style={{ marginLeft: "8px", fontSize: "12px", color: "#10b981" }}>
                (contributed: {userContributions} USDC)
              </span>
            )}
          </span>
        )}
      </div>

      <div className="grid">
        <Stat label="Funding Goal" value={goal ? goal.toFixed(2) : "1000.00"} unit="USDC" />
        <Stat
          label="Total Raised"
          value={total === -1 ? "🔒 Encrypted" : total.toFixed(2)}
          unit={total === -1 ? "" : "USDC"}
        />
        <Stat label="Contributors" value={String(donors)} unit="people" />
      </div>

      <div className="progress-section">
        <div className="progress-label">
          Campaign Progress
          {total === -1 && (
            <span style={{ marginLeft: "8px", fontSize: "12px", color: "#6b7280" }}>(estimated based on activity)</span>
          )}
        </div>
        <div className="progress">
          <div
            className="bar"
            style={{
              width: `${progress}%`,
              backgroundColor: getProgressColor(),
              transition: "width 0.3s ease-in-out",
            }}
          />
        </div>
        <div className="progressText">
          {total === -1
            ? `~${progress}% activity ${goalReached ? "🎉" : ""}`
            : `${progress}% funded ${goalReached ? "🎉" : ""}`}
        </div>
      </div>

      <div className="form">
        <h3>Make a Private Contribution</h3>
        <p style={{ fontSize: "14px", textAlign: "center", display: "block", color: "#6b7280", marginBottom: "16px" }}>
          You can contribute multiple times. Each contribution is encrypted separately. Supports decimal amounts like
          1.25 USDC.
        </p>
        <div className="form-row">
          <input
            ref={inputRef}
            placeholder="Amount in USDC (e.g., 1.25, 10.50)"
            type="number"
            step="0.000001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={!connected || pending}
            autoComplete="off"
            style={{ pointerEvents: "auto", userSelect: "text", WebkitUserSelect: "text" }}
          />
          <button className="contribute-btn" onClick={contribute} disabled={pending}>
            {pending ? "🔒 Processing..." : "Contribute"}
          </button>
        </div>
        <div className="form-row">
          <button className="secondary-btn" onClick={checkGoal} disabled={pending}>
            Check Goal Status
          </button>
          <button className="secondary-btn" onClick={() => refresh()} disabled={pending}>
            Refresh Data
          </button>
        </div>
      </div>

      <div className={`status ${status.includes("✅") ? "success" : status.includes("⚠") ? "error" : ""}`}>
        {status}
      </div>
      <div
        className="footer"
        style={{
          marginTop: "32px",
          textAlign: "center",
          fontSize: "12px",
          color: "#6b7280",
        }}
      >
        developed by{" "}
        <span style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
          {/* Discord icon SVG */}
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.317 4.369A19.91 19.91 0 0 0 16.885 3c-.197.352-.42.83-.576 1.203a18.27 18.27 0 0 0-4.617 0A12.3 12.3 0 0 0 11.116 3c-1.18.213-2.32.574-3.432 1.062C3.674 9.105 2.956 14.65 3.278 20.11a19.956 19.956 0 0 0 5.927 1.897c.48-.647.907-1.333 1.276-2.057-.699-.262-1.363-.594-1.986-.98.166-.123.329-.25.486-.38 3.816 1.8 7.949 1.8 11.72 0 .158.13.32.257.486.38-.623.386-1.287.718-1.986.98.369.724.796 1.41 1.276 2.057a19.957 19.957 0 0 0 5.927-1.897c.406-6.689-.674-12.165-5.071-15.741ZM9.5 15.5c-.895 0-1.625-.863-1.625-1.922 0-1.058.72-1.922 1.625-1.922s1.625.864 1.625 1.922c0 1.059-.72 1.922-1.625 1.922Zm5 0c-.895 0-1.625-.863-1.625-1.922 0-1.058.72-1.922 1.625-1.922s1.625.864 1.625 1.922c0 1.059-.72 1.922-1.625 1.922Z" />
          </svg>
          @Klints_
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="stat">
      <div className="statLabel">{label}</div>
      <div className="statValue">
        {value}
        {unit && <span style={{ fontSize: "14px", color: "#6B7280", marginLeft: "4px" }}>{unit}</span>}
      </div>
    </div>
  );
}
