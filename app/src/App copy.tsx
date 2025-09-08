import React, { useEffect, useMemo, useState, useRef } from "react";
import { BrowserProvider, Contract, parseUnits } from "ethers";
import ABI from "./abi/PrivateCrowdfund.json";
import "./App.css";

const CONTRACT_ADDR = import.meta.env.VITE_CROWDFUND_ADDRESS as string | undefined;
const USDC_ADDRESS = import.meta.env.VITE_USDC_ADDRESS as string | undefined;

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

function explainRevert(e: any, contract: Contract): string | null {
  try {
    const data: string | undefined =
      e?.error?.data ?? e?.info?.error?.data ?? e?.data ?? e?.transaction?.data ?? e?.receipt?.revertReason;

    if (data && typeof data === "string" && data.startsWith("0x")) {
      const parsed = contract.interface.parseError(data);
      if (parsed) {
        console.error("⛔️ Reverted with custom error:", parsed.name, parsed.args);
        return `Reverted: ${parsed.name}(${parsed.args.map((a: any) => String(a)).join(", ")})`;
      }
    }
  } catch {
    // ignore parse errors
  }
  return null;
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
      if (!USDC_ADDRESS) {
        setStatus("⚠ Set VITE_USDC_ADDRESS in environment");
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
          setTotal(-1);
        } else {
          try {
            const out: Record<string, bigint | number> = await _r.publicDecrypt([handle as string]);
            const v = out[handle as string];
            const microUsdc = typeof v === "bigint" ? Number(v) : Number(v || 0);
            setTotal(microUsdc / 1000000);
          } catch {
            setTotal(-1);
          }
        }
      }
    } catch {
      // ignore
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

      // Convert to micro-USDC (6 decimals)
      const amount6 = parseUnits(n.toString(), 6); // bigint
      const microUsdcAmount = amount6;

      // Resolve the EXACT contract address once, and reuse everywhere below
      const toAddr = await contract.getAddress();

      // 1) Check on-chain campaign bounds/status
      try {
        const isActive = await contract.isActive();
        if (!isActive) {
          setStatus("⚠ Campaign is no longer active");
          setPending(false);
          return;
        }
        const minContribution = await contract.minContribution();
        const maxContribution = await contract.maxContribution();
        if (microUsdcAmount < minContribution || microUsdcAmount > maxContribution) {
          const minUsdc = Number(minContribution) / 1_000_000;
          const maxUsdc = Number(maxContribution) / 1_000_000;
          setStatus(`⚠ Amount must be between ${minUsdc.toFixed(2)} and ${maxUsdc.toFixed(2)} USDC`);
          setPending(false);
          return;
        }
      } catch (boundsErr) {
        console.warn("Bounds/status read failed (continuing):", boundsErr);
      }

      // 2) Check USDC balance & allowance (and approve if needed)
      setStatus("Checking USDC balance...");
      const balance = await usdcContract.balanceOf(signerAddress);
      if (balance < amount6) {
        setStatus("⚠ Insufficient USDC balance");
        setPending(false);
        return;
      }

      setStatus("Checking USDC allowance...");
      const currentAllowance = await usdcContract.allowance(signerAddress, toAddr);
      if (currentAllowance < amount6) {
        setStatus("Approving USDC spend…");
        const approveTx = await usdcContract.approve(toAddr, amount6);
        setStatus(`Approval pending: ${approveTx.hash.slice(0, 10)}…`);
        await approveTx.wait();
        setStatus("USDC approved ✅");
        await new Promise((r) => setTimeout(r, 1200));
      }

      // 3) Encrypt AFTER allowance is ready — bind to EXACT same address
      setStatus("Encrypting your contribution…");
      const encryptedInput = relayer.createEncryptedInput(toAddr, signerAddress);
      encryptedInput.add64(microUsdcAmount); // bigint works
      const encrypted = await encryptedInput.encrypt();
      if (!encrypted.handles?.[0] || !encrypted.inputProof) {
        throw new Error("Failed to create encrypted input");
      }

      // (Optional) Log signature + selector to catch ABI mismatch
      try {
        const fn = contract.interface.getFunction("contributeUSDC(uint256,bytes32,bytes)");
        console.log("Using ABI function:", fn.format("full"));
        console.log("Selector:", fn.selector); // ✅ works in ethers v6
      } catch (sigErr) {
        console.warn(
          "ABI does not have contributeUSDC(uint256,bytes32,bytes). Double-check ABI file matches deployed bytecode.",
          sigErr,
        );
      }

      // 4) Encode calldata and send RAW tx (skip estimateGas for FHE)
      setStatus("Sending encrypted transaction…");
      const data = contract.interface.encodeFunctionData("contributeUSDC(uint256,bytes32,bytes)", [
        amount6,
        encrypted.handles[0],
        encrypted.inputProof,
      ]);

      const tx = await signer.sendTransaction({
        to: toAddr,
        data,
        gasLimit: 1_500_000n, // generous cap; adjust if needed
      });

      setStatus(`Transaction pending: ${tx.hash.slice(0, 10)}…`);
      const receipt = await tx.wait();
      if (receipt.status === 0) throw new Error("Transaction failed during execution");

      setUserContributions((prev) => prev + n);
      setStatus(`✅ Contribution of ${n} USDC successful! Tx: ${tx.hash.slice(0, 10)}…`);
      setAmount("");
      await refresh();
    } catch (e: any) {
      const decoded = contract ? explainRevert(e, contract) : null;
      let msg = decoded || e?.reason || e?.error?.message || e?.shortMessage || e?.message || "Transaction failed";
      const lower = String(msg).toLowerCase();
      if (lower.includes("insufficient funds")) msg = "Insufficient ETH for gas fees";
      else if (lower.includes("user rejected")) msg = "Transaction cancelled by user";
      else if (lower.includes("transferfrom")) msg = "USDC transfer failed — check allowance/balance";
      else if (lower.includes("expired")) msg = "Campaign has expired";
      else if (lower.includes("finalized")) msg = "Campaign already finalized";
      else if (lower.includes("bounds")) msg = "Contribution amount is outside allowed bounds";
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

  const shortAddr = CONTRACT_ADDR
    ? `${CONTRACT_ADDR.slice(0, 8)}…${CONTRACT_ADDR.slice(-6)}`
    : "(set VITE_CROWDFUND_ADDRESS)";

  return (
    <div className="container">
      <header className="header">
        <h1>🔐 Private Crowdfund</h1>
        <p className="subtitle">Powered by Zama's Fully Homomorphic Encryption</p>
        <div className="meta">
          <span className="addr">Contract: {shortAddr}</span>
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
