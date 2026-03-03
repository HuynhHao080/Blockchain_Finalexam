// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract VotingSystem {
    
    // --- Structs ---
    struct Voter {
        uint weight;
        bool voted;
        uint vote;
    }

    struct Proposal {
        string name;
        uint voteCount;
    }

    // --- State Variables ---
    address public chairperson;
    uint public deadline; // Thời gian kết thúc voting

    mapping(address => Voter) public voters;
    Proposal[] public proposals;

    // --- Constructor ---
    constructor(string[] memory proposalNames, uint duration) {
        chairperson = msg.sender;
        voters[chairperson].weight = 1;

        // Set deadline = thời gian hiện tại + duration (giây)
        deadline = block.timestamp + duration;

        for (uint i = 0; i < proposalNames.length; i++) {
            proposals.push(Proposal({
                name: proposalNames[i],
                voteCount: 0
            }));
        }
    }

    // --- Give Right To Vote ---
    function giveRightToVote(address voter, uint weight) public {
        require(msg.sender == chairperson, "Only chairperson");
        require(!voters[voter].voted, "Already voted");
        require(voters[voter].weight == 0, "Already has right");

        voters[voter].weight = weight;
    }

    // --- Vote ---
    function vote(uint proposalIndex) public {

        require(block.timestamp < deadline, "Voting ended"); // ✅ CHECK DEADLINE

        Voter storage sender = voters[msg.sender];

        require(sender.weight > 0, "No right to vote");
        require(!sender.voted, "Already voted");
        require(proposalIndex < proposals.length, "Invalid proposal");

        sender.voted = true;
        sender.vote = proposalIndex;

        proposals[proposalIndex].voteCount += sender.weight;
    }

    // --- Get Results ---
    function getResults() public view returns (string[] memory, uint[] memory) {
        string[] memory names = new string[](proposals.length);
        uint[] memory counts = new uint[](proposals.length);

        for (uint i = 0; i < proposals.length; i++) {
            names[i] = proposals[i].name;
            counts[i] = proposals[i].voteCount;
        }

        return (names, counts);
    }

    // --- Time Left ---
    function getTimeLeft() public view returns (uint) {
        if (block.timestamp >= deadline) {
            return 0;
        }
        return deadline - block.timestamp;
    }
}