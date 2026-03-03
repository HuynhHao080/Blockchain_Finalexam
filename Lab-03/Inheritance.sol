// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

abstract contract User {

    address public wallet;

    constructor(address _wallet) {
        wallet = _wallet;
    }

    // Hàm virtual bắt buộc contract con phải override
    function getRole() public view virtual returns (string memory);
}


contract Student is User {

    uint public studentId;

    constructor(address _wallet, uint _studentId)
        User(_wallet)
    {
        studentId = _studentId;
    }

    function getRole() public view override returns (string memory) {
        return "STUDENT";
    }
}


contract Admin is User {

    uint public level;

    constructor(address _wallet, uint _level)
        User(_wallet)
    {
        level = _level;
    }

    function getRole() public view override returns (string memory) {
        return "ADMIN";
    }
}