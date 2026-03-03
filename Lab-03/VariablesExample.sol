// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VariablesExample {

    uint public count;

    constructor() {
        count = 0;
    }

    function increase() public {
        count = count + 1;
    }

    function decrease() public {
        count = count - 1;
    }

    function getCount() public view returns (uint) {
        return count;
    }
}
contract SwitchExample {

    bool public isOn;

    constructor() {
        isOn = false;
    }

    function turnOn() public {
        isOn = true;
    }

    function turnOff() public {
        isOn = false;
    }
}
contract NameExample {

    string public name;

    function setName(string memory _name) public {
        name = _name;
    }
}
contract AddressExample {

    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function getOwner() public view returns (address) {
        return owner;
    }
}