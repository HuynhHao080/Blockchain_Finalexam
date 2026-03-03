// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Crowdfunding {

    // ===== STATE VARIABLES =====
    address public owner;
    uint public goal;
    uint public deadline;
    uint public totalRaised;
    bool public withdrawn;

    mapping(address => uint) public contributions;

    // ===== EVENTS =====
    event ContributionReceived(address contributor, uint amount);
    event FundsWithdrawn(address owner, uint amount);
    event RefundIssued(address contributor, uint amount);

    // ===== CONSTRUCTOR =====
    constructor(uint _goal, uint _duration) {
        owner = msg.sender;
        goal = _goal;
        deadline = block.timestamp + _duration;
        withdrawn = false;
    }

    // ===== CONTRIBUTE =====
    function contribute() public payable {
        require(block.timestamp < deadline, "Campaign ended");
        require(msg.value > 0, "Must send ETH");

        contributions[msg.sender] += msg.value;
        totalRaised += msg.value;

        emit ContributionReceived(msg.sender, msg.value);
    }

    // ===== WITHDRAW =====
    function withdrawFunds() public {
        require(msg.sender == owner, "Only owner");
        require(block.timestamp >= deadline, "Not ended");
        require(totalRaised >= goal, "Goal not met");
        require(!withdrawn, "Already withdrawn");

        withdrawn = true;

        (bool success, ) = owner.call{value: totalRaised}("");
        require(success, "Transfer failed");

        emit FundsWithdrawn(owner, totalRaised);
    }

    // ===== REFUND =====
    function refund() public {
        require(block.timestamp >= deadline, "Not ended");
        require(totalRaised < goal, "Goal was met");
        require(contributions[msg.sender] > 0, "No contribution");

        uint amount = contributions[msg.sender];
        contributions[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Refund failed");

        emit RefundIssued(msg.sender, amount);
    }

    // ===== VIEW FUNCTIONS =====
    function getTimeLeft() public view returns (uint) {
        if (block.timestamp >= deadline) {
            return 0;
        }
        return deadline - block.timestamp;
    }

    function getProgress() public view returns (uint) {
        if (goal == 0) {
            return 0;
        }
        return (totalRaised * 100) / goal;
    }
}