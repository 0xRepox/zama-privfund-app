# 🔐 PrivFund

https://zamaprivfund.netlify.app/

A privacy-preserving crowdfunding platform powered by **Zama's Fully Homomorphic Encryption (FHE)** technology. This
application demonstrates real-world FHE implementation where contribution amounts are encrypted client-side and computed
on-chain without revealing individual donor amounts.

## 🌟 Key Features

- **Client-side Encryption**: Contribution amounts encrypted in the browser using Zama's FHE SDK
- **On-chain Privacy**: Individual contributions remain encrypted in smart contract storage
- **Homomorphic Computation**: Goal achievement calculated over encrypted values without decryption
- **Permission-based Decryption**: Users control who can decrypt their contribution data
- **USDC Integration**: Real cryptocurrency contributions with micro-precision (6 decimals)
- **Modern Web3 UX**: Seamless integration with MetaMask and familiar wallet workflows

## 🛡️ Privacy Model

### What's Private

- **Individual contribution amounts** - Encrypted and only visible to the contributor
- **Aggregate computations** - Totals computed homomorphically without revealing inputs
- **Goal status** - Determined through encrypted comparison operations

### What's Public

- **Transaction existence** - USDC transfers are visible on-chain (blockchain requirement)
- **Contributor count** - Number of unique contributors
- **Campaign metadata** - Goals, deadlines, and campaign information

### Decryption Permissions

- **Contributors**: Can decrypt their own contribution totals
- **Oracle**: Can decrypt aggregate totals when authorized
- **Contract Owner**: Administrative access to encrypted campaign data

## 🏗️ Architecture

```
Frontend (React + Vite)
├── Client-side FHE encryption
├── MetaMask integration
└── Real-time encrypted data display

Smart Contract (Solidity)
├── Encrypted storage (euint64, ebool)
├── Homomorphic operations
├── Permission-based decryption
└── USDC treasury management

Zama FHEVM
├── Encrypted computation layer
├── Oracle decryption service
└── Sepolia testnet deployment
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MetaMask wallet
- Sepolia testnet ETH
- Sepolia testnet USDC

### Installation

```bash
# Clone repository
git clone https://github.com/0xRepox/private-crowdfund.git
cd private-crowdfund

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values
```

### Environment Configuration

```env
# Frontend Configuration
VITE_CROWDFUND_ADDRESS=your-deployed-contract-address
VITE_USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238

# Development Configuration (local only)
PRIVATE_KEY=your-deployer-private-key
INFURA_API_KEY=your-infura-project-id
ETHERSCAN_API_KEY=your-etherscan-api-key
TREASURY_ADDR=your-treasury-address
```

### Smart Contract Deployment

```bash
# Compile contracts
npx hardhat compile

# Deploy to Sepolia testnet
npx hardhat run scripts/deploy.ts --network sepolia

# Verify contract (optional)
npx hardhat verify --network sepolia DEPLOYED_ADDRESS [constructor-args]
```

### Frontend Development

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## 📋 Usage Guide

### For Contributors

1. **Connect Wallet**: Link your MetaMask to Sepolia testnet
2. **Get Test Tokens**: Obtain Sepolia ETH and USDC from faucets
3. **Enter Amount**: Specify contribution in USDC (supports decimals like 1.25 USDC)
4. **Approve & Contribute**: Approve USDC spending, then submit encrypted contribution
5. **Track Progress**: View campaign progress with your contributions remaining private

### For Campaign Owners

1. **Deploy Contract**: Use provided deployment script with your parameters
2. **Configure Campaign**: Set funding goals, contribution limits, and duration
3. **Monitor Progress**: Check encrypted totals and goal achievement status
4. **Manage Campaign**: Update goals or extend deadlines as needed

## 🔧 Technical Implementation

### FHE Integration

The application uses Zama's FHEVM for client-side encryption and on-chain computation:

```typescript
// Client-side encryption
const encryptedInput = relayer.createEncryptedInput(contractAddress, userAddress);
encryptedInput.add64(contributionAmount);
const encrypted = await encryptedInput.encrypt();

// Smart contract homomorphic addition
totalRaisedEnc = FHE.add(totalRaisedEnc, encAmount);

// Encrypted comparison for goal checking
goalReached = FHE.ge(totalRaisedEnc, goalEnc);
```

### Smart Contract Architecture

```solidity
contract PrivateCrowdfund {
  // Encrypted state
  euint64 private totalRaisedEnc;
  ebool private lastGoalReachedCache;
  mapping(address => euint64) private contributionAmounts;

  // Public functions with encrypted operations
  function contributeUSDC(uint256 amount6, externalEuint64 encHandle, bytes calldata inputProof) external;
  function checkGoalReached() external returns (ebool);
  function getTotalRaised() external view returns (euint64);
}
```

## 🧪 Testing

### Sepolia Testnet Resources

- **USDC Faucet**: [Circle Faucet](https://faucet.circle.com/)
- **ETH Faucet**: [Sepolia Faucet](https://sepoliafaucet.com/)
- **Network**: Sepolia (Chain ID: 11155111)

### Test Scenarios

1. **Single Contribution**: Test basic encryption and contribution flow
2. **Multiple Contributors**: Verify privacy between different users
3. **Goal Achievement**: Test encrypted goal checking functionality
4. **Permission System**: Validate decryption access controls

## 🌐 Live Demo

**Frontend**: [Deploy on Vercel/Netlify with your contract address] **Contract**: Deployed on Sepolia testnet
**Explorer**: View on [Sepolia Etherscan](https://sepolia.etherscan.io/)

## 🏆 Zama Challenge Objectives

This project demonstrates:

✅ **Real-world FHE Use Case**: Privacy-preserving crowdfunding addresses actual privacy concerns in fundraising ✅
**Intuitive User Experience**: Complex FHE operations hidden behind familiar Web3 interface ✅ **Financial Application
Viability**: Handles real USDC transactions with encrypted computation ✅ **Ecosystem Contribution**: Provides reusable
patterns for FHE application development

## 📜 Contract Parameters

The deployed contract uses these parameters for demonstration:

- **Funding Goal**: 1000 USDC
- **Contribution Range**: 1.0 - 100.0 USDC
- **Campaign Duration**: 30 days
- **Treasury**: Configurable recipient address

## 🛠️ Development Stack

- **Frontend**: React 18, TypeScript, Vite, Ethers.js v6
- **Smart Contracts**: Solidity 0.8.24, Hardhat, OpenZeppelin
- **FHE**: Zama FHEVM, Sepolia testnet
- **Styling**: Custom CSS with modern design system
- **Deployment**: Vercel/Netlify ready

## 🤝 Contributing

Contributions welcome! Areas for improvement:

- Enhanced UI/UX design
- Additional privacy features
- Gas optimization
- Extended testing coverage
- Documentation improvements

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Links

- **Zama Documentation**: [docs.zama.ai](https://docs.zama.ai)
- **FHEVM SDK**: [fhevm documentation](https://docs.zama.ai/fhevm)
- **Sepolia Testnet**: [Ethereum testnet](https://sepolia.dev/)

---

Built for the **Zama FHE Challenge** - demonstrating practical privacy-preserving applications on Ethereum.
