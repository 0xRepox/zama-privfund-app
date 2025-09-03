import { ethers } from "hardhat";
import "dotenv/config";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("🚀 Deploying PrivateCrowdfund contract...");
  console.log("Deployer:", await deployer.getAddress());

  // Check deployer balance
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");

  // Circle USDC address on Sepolia
  const USDC_SEPOLIA = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

  // Treasury (read from .env or fallback to deployer)
  const TREASURY = process.env.TREASURY_ADDR || deployer.address;

  // Parameters in micro USDC (6 decimals)
  const FUNDING_GOAL = 1000n * 1_000_000n; // 1000 USDC
  const DURATION_DAYS = 30; // 30 days
  const MIN_CONTRIBUTION = 1n * 1_000_000n; // 1 USDC
  const MAX_CONTRIBUTION = 100n * 1_000_000n; // 100 USDC

  console.log("\n📊 Campaign Parameters:");
  console.log("- Funding Goal:", FUNDING_GOAL.toString(), "micro USDC");
  console.log("- Duration:", DURATION_DAYS, "days");
  console.log("- Min Contribution:", MIN_CONTRIBUTION.toString(), "micro USDC");
  console.log("- Max Contribution:", MAX_CONTRIBUTION.toString(), "micro USDC");
  console.log("- Treasury:", TREASURY);

  // Get the contract factory
  const Factory = await ethers.getContractFactory("PrivateCrowdfund");

  // Deploy the contract
  const contract = await Factory.deploy(
    Number(FUNDING_GOAL),
    DURATION_DAYS,
    Number(MIN_CONTRIBUTION),
    Number(MAX_CONTRIBUTION),
    USDC_SEPOLIA,
    TREASURY,
  );

  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\n✅ PrivateCrowdfund deployed to:", address);
  console.log("Funding goal:", await contract.fundingGoal());
  console.log("Deadline:", new Date(Number(await contract.deadline()) * 1000).toLocaleString());
  console.log("Min contribution:", await contract.minContribution());
  console.log("Max contribution:", await contract.maxContribution());

  return address;
}

main()
  .then((address) => {
    console.log("\n🎉 Deployment successful!");
    console.log("Save this contract address for your frontend:", address);
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
