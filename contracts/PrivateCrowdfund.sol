// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig, ZamaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/** Minimal ERC20 interface (no OZ dependency needed) */
interface IERC20 {
    function decimals() external view returns (uint8);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    function approve(address spender, uint256 amount) external returns (bool);

    function allowance(address owner, address spender) external view returns (uint256);

    function balanceOf(address) external view returns (uint256);
}

/**
 * @title PrivateCrowdfund
 * @notice Privacy-preserving crowdfunding using Fully Homomorphic Encryption (FHE)
 * @dev Demonstrates real-world FHE application for financial privacy
 *
 * Key Features:
 * - Individual contribution amounts are encrypted and stored privately
 * - On-chain computation over encrypted values (totals, goal checking)
 * - Permission-based decryption (users see own amounts, oracle enables public totals)
 * - USDC-based contributions with micro-USDC precision (6 decimals)
 * - Supports decimal contributions (1.25 USDC, 50.5 USDC, etc.)
 *
 * Privacy Model:
 * - Contribution amounts: Private to contributor only
 * - Total raised: Publicly decryptable via oracle when authorized
 * - Goal status: Computed homomorphically, publicly decryptable
 * - Transaction existence: Visible (USDC transfers), but amounts encrypted in contract storage
 *
 * Deployment Example for 1-100 USDC range with 1000 USDC goal:
 * constructor(
 *   1000000000,  // 1000 USDC goal (1000 * 1e6)
 *   30,          // 30 days duration
 *   1000000,     // 1.0 USDC minimum (1.0 * 1e6)
 *   100000000,   // 100.0 USDC maximum (100.0 * 1e6)
 *   usdcAddress, // Sepolia: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 *   treasury
 * );
 */
contract PrivateCrowdfund is SepoliaConfig {
    // Core parameters
    address public immutable owner;
    IERC20 public immutable usdc;
    address public immutable treasury;

    // Campaign configuration (all amounts in micro-USDC, 6 decimals)
    uint64 public fundingGoal; // Target amount in micro-USDC
    uint64 public minContribution; // Minimum contribution in micro-USDC
    uint64 public maxContribution; // Maximum contribution in micro-USDC
    uint64 public deadline; // Campaign end timestamp

    // Encrypted state using FHE
    euint64 private totalRaisedEnc; // Encrypted total raised amount
    ebool private lastGoalReachedCache; // Encrypted goal achievement status

    // Contributor tracking
    mapping(address => bool) private hasContributedMap;
    mapping(address => euint64) private contributionAmounts; // Encrypted per-user totals
    uint64 public contributorCount;

    // Campaign status flags
    bool private totalInitialized;
    bool private campaignFinalized;

    // Events
    event Contributed(address indexed contributor, bool isFirstTime, uint256 timestamp);
    event CampaignEnded(bool goalMet, uint256 timestamp);
    event GoalUpdated(uint64 oldGoal, uint64 newGoal);
    event DeadlineExtended(uint64 oldDeadline, uint64 newDeadline);

    // Custom errors
    error NotOwner();
    error CampaignExpired();
    error CampaignAlreadyFinalized();
    error InvalidGoal();
    error InvalidDeadline();
    error InvalidContributionLimits();
    error NoContributions();

    // Access control modifiers
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier campaignActive() {
        if (block.timestamp >= deadline) revert CampaignExpired();
        if (campaignFinalized) revert CampaignAlreadyFinalized();
        _;
    }

    modifier hasTotalInitialized() {
        if (!totalInitialized) revert NoContributions();
        _;
    }

    /**
     * @notice Deploy a new private crowdfunding campaign
     * @param _goalMicro Target funding amount in micro-USDC (goal * 1e6)
     * @param _durationDays Campaign duration in days
     * @param _minContributionMicro Minimum contribution in micro-USDC
     * @param _maxContributionMicro Maximum contribution in micro-USDC
     * @param _usdc USDC token contract address
     * @param _treasury Address to receive collected funds
     */
    constructor(
        uint64 _goalMicro,
        uint64 _durationDays,
        uint64 _minContributionMicro,
        uint64 _maxContributionMicro,
        address _usdc,
        address _treasury
    ) {
        if (_goalMicro == 0) revert InvalidGoal();
        if (_durationDays == 0) revert InvalidDeadline();
        if (_minContributionMicro == 0 || _minContributionMicro > _maxContributionMicro)
            revert InvalidContributionLimits();
        require(_usdc != address(0) && _treasury != address(0), "Invalid addresses");

        owner = msg.sender;
        usdc = IERC20(_usdc);
        treasury = _treasury;

        fundingGoal = _goalMicro;
        deadline = uint64(block.timestamp + (_durationDays * 1 days));
        minContribution = _minContributionMicro;
        maxContribution = _maxContributionMicro;
    }

    /**
     * @notice Make a private contribution using USDC
     * @param amount6 USDC amount with 6 decimal precision
     * @param encHandle Encrypted handle of the contribution amount
     * @param inputProof Zero-knowledge proof for the encrypted input
     *
     * Privacy Features:
     * - amount6 is visible in transaction (USDC transfer requirement)
     * - Encrypted amount is stored privately and used for computations
     * - Only contributor can decrypt their individual contribution total
     * - Aggregate totals only decryptable with oracle permission
     */
    function contributeUSDC(
        uint256 amount6,
        externalEuint64 encHandle,
        bytes calldata inputProof
    ) external campaignActive {
        require(amount6 > 0, "Amount cannot be zero");
        require(amount6 >= uint256(minContribution) && amount6 <= uint256(maxContribution), "Amount outside bounds");

        // Transfer USDC to treasury
        bool success = usdc.transferFrom(msg.sender, treasury, amount6);
        require(success, "USDC transfer failed");

        // Convert external encrypted input to internal format
        euint64 encAmount = FHE.fromExternal(encHandle, inputProof);

        // Update encrypted totals using homomorphic operations
        if (!totalInitialized) {
            totalRaisedEnc = encAmount;
            totalInitialized = true;
        } else {
            totalRaisedEnc = FHE.add(totalRaisedEnc, encAmount);
        }

        // Track contributors and their encrypted contribution totals
        bool isFirstContribution = !hasContributedMap[msg.sender];
        if (isFirstContribution) {
            hasContributedMap[msg.sender] = true;
            contributionAmounts[msg.sender] = encAmount;
            unchecked {
                contributorCount += 1;
            }
        } else {
            contributionAmounts[msg.sender] = FHE.add(contributionAmounts[msg.sender], encAmount);
        }

        // Set decryption permissions
        _setDecryptionPermissions(encAmount);

        emit Contributed(msg.sender, isFirstContribution, block.timestamp);

        // Update goal status after contribution
        _updateGoalStatus();
    }

    /**
     * @notice Check if funding goal has been reached using encrypted computation
     * @return Encrypted boolean handle representing goal achievement status
     */
    function checkGoalReached() external returns (ebool) {
        return _updateGoalStatus();
    }

    /**
     * @notice Get the last computed goal status (encrypted handle)
     * @return Encrypted boolean handle for goal achievement
     */
    function getLastGoalStatus() external view returns (ebool) {
        return lastGoalReachedCache;
    }

    /**
     * @notice Get encrypted total raised amount (handle)
     * @return Encrypted uint64 handle for total raised amount
     */
    function getTotalRaised() external view hasTotalInitialized returns (euint64) {
        return totalRaisedEnc;
    }

    /**
     * @notice Get a contributor's encrypted contribution total
     * @param contributor Address of the contributor
     * @return Encrypted uint64 handle for contributor's total
     */
    function getContributionAmount(address contributor) external view returns (euint64) {
        require(hasContributedMap[contributor], "Address has not contributed");
        return contributionAmounts[contributor];
    }

    /**
     * @notice Finalize the campaign after deadline (owner or anyone can call)
     */
    function finalizeCampaign() external {
        require(block.timestamp >= deadline, "Campaign still active");
        require(!campaignFinalized, "Campaign already finalized");

        campaignFinalized = true;

        // Simple goal achievement check (could be enhanced)
        bool goalMet = totalInitialized;

        emit CampaignEnded(goalMet, block.timestamp);
    }

    /**
     * @notice Update funding goal (owner only, campaign must be active)
     * @param newGoalMicro New goal in micro-USDC
     */
    function updateGoal(uint64 newGoalMicro) external onlyOwner campaignActive {
        if (newGoalMicro == 0) revert InvalidGoal();

        uint64 oldGoal = fundingGoal;
        fundingGoal = newGoalMicro;

        _updateGoalStatus();

        emit GoalUpdated(oldGoal, newGoalMicro);
    }

    /**
     * @notice Extend campaign deadline (owner only)
     * @param additionalDays Number of additional days
     */
    function extendDeadline(uint64 additionalDays) external onlyOwner {
        require(!campaignFinalized, "Campaign already finalized");
        if (additionalDays == 0) revert InvalidDeadline();

        uint64 oldDeadline = deadline;
        deadline += additionalDays * 1 days;

        emit DeadlineExtended(oldDeadline, deadline);
    }

    /**
     * @notice Grant public decryption permissions for current handles
     * @dev Useful for ensuring oracle can decrypt totals and goal status
     */
    function grantPublicDecrypt() external {
        // Grant permissions for goal status
        FHE.allow(lastGoalReachedCache, address(this));
        FHE.allow(lastGoalReachedCache, owner);
        FHE.allow(lastGoalReachedCache, ZamaConfig.getSepoliaOracleAddress());

        // Grant permissions for total if initialized
        if (totalInitialized) {
            FHE.allow(totalRaisedEnc, address(this));
            FHE.allow(totalRaisedEnc, owner);
            FHE.allow(totalRaisedEnc, ZamaConfig.getSepoliaOracleAddress());
        }
    }

    // View functions
    function hasContributed(address user) external view returns (bool) {
        return hasContributedMap[user];
    }

    function isFinalized() external view returns (bool) {
        return campaignFinalized;
    }

    function isActive() external view returns (bool) {
        return block.timestamp < deadline && !campaignFinalized;
    }

    function getTimeRemaining() external view returns (uint64) {
        if (block.timestamp >= deadline) return 0;
        return deadline - uint64(block.timestamp);
    }

    function isInitialized() external view returns (bool) {
        return totalInitialized;
    }

    function usdcDecimals() external pure returns (uint8) {
        return 6;
    }

    /**
     * @dev Internal function to update goal achievement status using FHE
     */
    function _updateGoalStatus() internal returns (ebool) {
        if (!totalInitialized) {
            lastGoalReachedCache = FHE.asEbool(false);
        } else {
            euint64 goalEnc = FHE.asEuint64(fundingGoal);
            lastGoalReachedCache = FHE.ge(totalRaisedEnc, goalEnc);
        }

        // Grant decryption permissions for goal status
        FHE.allow(lastGoalReachedCache, address(this));
        FHE.allow(lastGoalReachedCache, owner);
        FHE.allow(lastGoalReachedCache, msg.sender);
        FHE.allow(lastGoalReachedCache, ZamaConfig.getSepoliaOracleAddress());

        return lastGoalReachedCache;
    }

    /**
     * @dev Set appropriate decryption permissions for encrypted values
     */
    function _setDecryptionPermissions(euint64 /* encAmount */) internal {
        // Total raised: publicly decryptable via oracle
        FHE.allow(totalRaisedEnc, address(this));
        FHE.allow(totalRaisedEnc, owner);
        FHE.allow(totalRaisedEnc, ZamaConfig.getSepoliaOracleAddress());

        // Individual contribution: only contributor can decrypt
        FHE.allow(contributionAmounts[msg.sender], msg.sender);
    }
}
