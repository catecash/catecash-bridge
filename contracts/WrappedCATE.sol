// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Testnet bridge token. Native CATE custody and release happen off Ethereum.
contract WrappedCATE is ERC20, Ownable2Step, Pausable, EIP712 {
    bytes32 public constant MINT_TYPEHASH = keccak256(
        "Mint(bytes32 cateTxId,uint32 outputIndex,address recipient,uint256 amount,uint256 deadline,uint256 committeeEpoch)"
    );

    bytes32 public immutable catecashGenesis;
    mapping(address => bool) public isSigner;
    mapping(bytes32 => bool) public processedDeposit;
    uint256 public signerThreshold;
    uint256 public committeeEpoch;
    uint256 public maxOutstanding;
    uint256 public nextWithdrawalId;

    event DepositMinted(bytes32 indexed depositId, bytes32 indexed cateTxId, uint32 outputIndex, address indexed recipient, uint256 amount);
    event WithdrawalRequested(uint256 indexed withdrawalId, address indexed sender, string cateAddress, uint256 amount);
    event CommitteeChanged(uint256 indexed epoch, address[] signers, uint256 threshold);
    event MaxOutstandingChanged(uint256 maxOutstanding);

    constructor(
        bytes32 genesis,
        address initialOwner,
        address[] memory signers,
        uint256 threshold,
        uint256 initialMaxOutstanding
    ) ERC20("Wrapped Catecash", "wCATE") Ownable(initialOwner) EIP712("Wrapped Catecash", "1") {
        require(genesis != bytes32(0), "zero genesis");
        require(initialMaxOutstanding > 0, "zero cap");
        catecashGenesis = genesis;
        maxOutstanding = initialMaxOutstanding;
        _setCommittee(signers, threshold);
    }

    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function depositId(bytes32 cateTxId, uint32 outputIndex) public view returns (bytes32) {
        return keccak256(abi.encode(catecashGenesis, cateTxId, outputIndex));
    }

    /// @dev Signers must attest to a finalized, uniquely identified transparent deposit.
    ///      Recovered signer addresses must be strictly ascending to prevent duplicates.
    function mintForDeposit(
        bytes32 cateTxId,
        uint32 outputIndex,
        address recipient,
        uint256 amount,
        uint256 deadline,
        uint256 epoch,
        bytes[] calldata signatures
    ) external whenNotPaused {
        require(cateTxId != bytes32(0), "zero transaction");
        require(recipient != address(0), "zero recipient");
        require(amount > 0, "zero amount");
        require(block.timestamp <= deadline, "attestation expired");
        require(epoch == committeeEpoch, "stale committee");
        require(totalSupply() + amount <= maxOutstanding, "cap exceeded");

        bytes32 id = depositId(cateTxId, outputIndex);
        require(!processedDeposit[id], "deposit processed");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            MINT_TYPEHASH, cateTxId, outputIndex, recipient, amount, deadline, epoch
        )));
        require(signatures.length >= signerThreshold, "insufficient signatures");
        address previous;
        for (uint256 i = 0; i < signatures.length; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            require(isSigner[signer], "unauthorized signer");
            require(signer > previous, "signers not unique and sorted");
            previous = signer;
        }

        processedDeposit[id] = true;
        _mint(recipient, amount);
        emit DepositMinted(id, cateTxId, outputIndex, recipient, amount);
    }

    /// @notice Burning requests a native CATE payment; operators must verify the destination.
    function requestWithdrawal(uint256 amount, string calldata cateAddress) external whenNotPaused {
        require(amount > 0, "zero amount");
        bytes memory addressBytes = bytes(cateAddress);
        require(addressBytes.length > 0 && addressBytes.length <= 128, "invalid address length");
        uint256 id = nextWithdrawalId++;
        _burn(msg.sender, amount);
        emit WithdrawalRequested(id, msg.sender, cateAddress, amount);
    }

    function setCommittee(address[] calldata signers, uint256 threshold) external onlyOwner {
        _setCommittee(signers, threshold);
    }

    function setMaxOutstanding(uint256 newMaxOutstanding) external onlyOwner {
        require(newMaxOutstanding >= totalSupply() && newMaxOutstanding > 0, "cap below supply");
        maxOutstanding = newMaxOutstanding;
        emit MaxOutstandingChanged(newMaxOutstanding);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _setCommittee(address[] memory signers, uint256 threshold) internal {
        require(signers.length > 0 && threshold > 0 && threshold <= signers.length, "invalid threshold");
        // The old signer set is supplied through events and cleared via the active list.
        for (uint256 i = 0; i < activeSigners.length; ++i) {
            isSigner[activeSigners[i]] = false;
        }
        delete activeSigners;
        for (uint256 i = 0; i < signers.length; ++i) {
            address signer = signers[i];
            require(signer != address(0) && !isSigner[signer], "invalid signer");
            isSigner[signer] = true;
            activeSigners.push(signer);
        }
        signerThreshold = threshold;
        ++committeeEpoch;
        emit CommitteeChanged(committeeEpoch, signers, threshold);
    }

    address[] public activeSigners;
}
