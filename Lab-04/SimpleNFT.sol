// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import trực tiếp từ GitHub (Remix load được)
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/token/ERC721/ERC721.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v5.0.2/contracts/token/ERC721/extensions/ERC721URIStorage.sol";

contract SimpleNFT is ERC721URIStorage {

    uint private _nextTokenId;

    // Lưu creator của mỗi NFT
    mapping(uint => address) public creators;

    constructor() ERC721("MyNFT", "MNFT") {}

    function mint(address to, string memory uri) public returns (uint) {

        uint tokenId = _nextTokenId;
        _nextTokenId++;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);

        creators[tokenId] = msg.sender;

        return tokenId;
    }
}