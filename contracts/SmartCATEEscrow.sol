// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Testnet escrow for SmartCatecash wCAT bridged to Ethereum.
/// @dev The PoW-to-SmartCatecash bridge must issue native CATE separately.
contract SmartCATEEscrow is Ownable2Step, Pausable, EIP712 {
    using SafeERC20 for IERC20;
    bytes32 public constant RELEASE_TYPEHASH = keccak256(
        "Release(bytes32 ethTxHash,uint32 logIndex,uint256 withdrawalId,address recipient,uint256 amount,uint256 deadline,uint256 committeeEpoch)"
    );

    uint256 public immutable ethereumChainId;
    IERC20 public immutable wrappedSmartCate;
    address public ethereumToken;
    mapping(address => bool) public isSigner;
    address[] public activeSigners;
    mapping(bytes32 => bool) public processedRelease;
    uint256 public signerThreshold;
    uint256 public committeeEpoch;
    uint256 public nextDepositId;

    event EthereumTokenBound(address indexed token);
    event DepositLocked(uint256 indexed depositId, address indexed sender, address indexed ethereumRecipient, uint256 amountAtoms);
    event WithdrawalReleased(bytes32 indexed releaseId, uint256 indexed withdrawalId, address indexed recipient, uint256 amountAtoms);
    event CommitteeChanged(uint256 indexed epoch, address[] signers, uint256 threshold);

    constructor(uint256 ethChainId, address wrappedToken, address initialOwner, address[] memory signers, uint256 threshold)
        Ownable(initialOwner) EIP712("SmartCatecash Escrow", "1")
    {
        require(block.chainid == 31337, "local-only rejected bridge prototype");
        require(ethChainId != 0, "zero Ethereum chain ID");
        require(wrappedToken != address(0), "zero wrapped token");
        ethereumChainId = ethChainId;
        wrappedSmartCate = IERC20(wrappedToken);
        _setCommittee(signers, threshold);
    }

    /// @notice One-time binding after the Ethereum token has been deployed and verified.
    function bindEthereumToken(address token) external onlyOwner {
        require(ethereumToken == address(0) && token != address(0), "token already bound or zero");
        ethereumToken = token;
        emit EthereumTokenBound(token);
    }

    function lockForEthereum(uint256 amountAtoms, address recipient) external whenNotPaused {
        require(ethereumToken != address(0), "token not bound");
        require(recipient != address(0), "zero recipient");
        require(amountAtoms > 0, "zero amount");
        wrappedSmartCate.safeTransferFrom(msg.sender, address(this), amountAtoms);
        uint256 id = nextDepositId++;
        emit DepositLocked(id, msg.sender, recipient, amountAtoms);
    }

    function releaseId(bytes32 ethTxHash, uint32 logIndex) public view returns (bytes32) {
        return keccak256(abi.encode(ethereumChainId, ethereumToken, ethTxHash, logIndex));
    }

    /// @dev Signers must independently verify the finalized Ethereum burn log.
    function releaseFromEthereum(
        bytes32 ethTxHash,
        uint32 logIndex,
        uint256 withdrawalId,
        address payable recipient,
        uint256 amountAtoms,
        uint256 deadline,
        uint256 epoch,
        bytes[] calldata signatures
    ) external whenNotPaused {
        require(ethereumToken != address(0), "token not bound");
        require(ethTxHash != bytes32(0) && recipient != address(0), "invalid release");
        require(amountAtoms > 0, "invalid amount");
        require(block.timestamp <= deadline && epoch == committeeEpoch, "expired or stale");
        bytes32 id = releaseId(ethTxHash, logIndex);
        require(!processedRelease[id], "release processed");
        require(wrappedSmartCate.balanceOf(address(this)) >= amountAtoms, "insufficient escrow");
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
            RELEASE_TYPEHASH, ethTxHash, logIndex, withdrawalId, recipient, amountAtoms, deadline, epoch
        )));
        require(signatures.length >= signerThreshold, "insufficient signatures");
        address previous;
        for (uint256 i = 0; i < signatures.length; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            require(isSigner[signer] && signer > previous, "invalid signer order");
            previous = signer;
        }
        processedRelease[id] = true;
        wrappedSmartCate.safeTransfer(recipient, amountAtoms);
        emit WithdrawalReleased(id, withdrawalId, recipient, amountAtoms);
    }

    function setCommittee(address[] calldata signers, uint256 threshold) external onlyOwner {
        _setCommittee(signers, threshold);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _setCommittee(address[] memory signers, uint256 threshold) internal {
        require(signers.length > 0 && threshold > 0 && threshold <= signers.length, "invalid threshold");
        for (uint256 i = 0; i < activeSigners.length; ++i) isSigner[activeSigners[i]] = false;
        delete activeSigners;
        for (uint256 i = 0; i < signers.length; ++i) {
            require(signers[i] != address(0) && !isSigner[signers[i]], "invalid signer");
            isSigner[signers[i]] = true;
            activeSigners.push(signers[i]);
        }
        signerThreshold = threshold;
        ++committeeEpoch;
        emit CommitteeChanged(committeeEpoch, signers, threshold);
    }
}
