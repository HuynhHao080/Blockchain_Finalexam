// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Import contract NFT vừa tạo
import "./SimpleNFT.sol";

contract NFTMarketplace {
    SimpleNFT public nftContract;

    // Struct lưu thông tin món hàng đang bán
    struct Listing {
        address seller;
        uint price;
        bool active;
    }

    mapping(uint => Listing) public listings;
    //NEW
    struct Offer {
        address bidder;
        uint amount;
        bool active;
    }

    mapping(uint => Offer[]) public offers;
    //NEW2
    struct Auction {
        address seller;
        uint startTime;
        uint endTime;
        address highestBidder;
        uint highestBid;
        bool ended;
    }

    mapping(uint => Auction) public auctions;   


    // Sự kiện khi có người mua thành công
    event ItemBought(uint indexed tokenId, address seller, address buyer, uint price);

    constructor(address _nftContractAddress) {
        nftContract = SimpleNFT(_nftContractAddress);
    }

    // HÀM 1: Đăng bán (List)
    function listNFT(uint tokenId, uint price) public {
        require(nftContract.ownerOf(tokenId) == msg.sender, "You are not the owner");
        require(price > 0, "Price must be > 0");

        // Phải approve (ủy quyền) cho Marketplace trước khi gọi hàm này
        // (Sẽ hướng dẫn ở bước thao tác)
        
        // Chuyển NFT từ ví người bán vào ví của Contract Marketplace
        nftContract.transferFrom(msg.sender, address(this), tokenId);

        listings[tokenId] = Listing({
            seller: msg.sender,
            price: price,
            active: true
        });
    }

    // HÀM 2: Mua hàng (Buy) - Tính cả Royalty
    function buyNFT(uint tokenId) public payable {
        Listing storage listing = listings[tokenId];
        require(listing.active, "Item is not for sale");
        require(msg.value >= listing.price, "Not enough ETH sent");

        address seller = listing.seller;
        address creator = nftContract.creators(tokenId);
        uint price = listing.price;

        // Tính toán Royalty (5% cho Creator)
        uint royalty = (price * 5) / 100;
        uint amountToSeller = price - royalty;

        // 1. Chuyển Royalty cho Creator
        payable(creator).transfer(royalty);

        // 2. Chuyển phần còn lại cho Seller
        payable(seller).transfer(amountToSeller);

        // 3. Chuyển NFT từ Contract Marketplace cho Buyer
        nftContract.transferFrom(address(this), msg.sender, tokenId);

        // 4. Tắt trạng thái bán (hoặc xóa listing)
        listings[tokenId].active = false;

        emit ItemBought(tokenId, seller, msg.sender, price);
    }

    function makeOffer(uint tokenId) public payable {
        require(msg.value > 0, "Offer must be > 0");

        offers[tokenId].push(Offer({
            bidder: msg.sender,
            amount: msg.value,
            active: true
        }));
    }

    function acceptOffer(uint tokenId, uint offerIndex) public {
        require(nftContract.ownerOf(tokenId) == msg.sender, "Not owner");

        Offer storage offer = offers[tokenId][offerIndex];
        require(offer.active, "Offer not active");

        address seller = msg.sender;
        address creator = nftContract.creators(tokenId);
        uint price = offer.amount;

        uint royalty = (price * 5) / 100;
        uint amountToSeller = price - royalty;

        // 1. Chuyển tiền
        payable(creator).transfer(royalty);
        payable(seller).transfer(amountToSeller);

        // 2. Chuyển NFT
        if (nftContract.ownerOf(tokenId) == address(this)) {
            nftContract.transferFrom(address(this), offer.bidder, tokenId);
        } else {
            nftContract.transferFrom(seller, offer.bidder, tokenId);
        }

        offer.active = false;

        emit ItemBought(tokenId, seller, offer.bidder, price);
    }

    function createAuction(uint tokenId, uint duration) public {
        require(nftContract.ownerOf(tokenId) == msg.sender, "Not owner");

        nftContract.transferFrom(msg.sender, address(this), tokenId);

        auctions[tokenId] = Auction({
            seller: msg.sender,
            startTime: block.timestamp,
            endTime: block.timestamp + duration,
            highestBidder: address(0),
            highestBid: 0,
            ended: false
        });
    }

    function bid(uint tokenId) public payable {
        Auction storage auction = auctions[tokenId];

        require(auction.seller != address(0), "Auction not exist");
        require(block.timestamp < auction.endTime, "Auction ended");
        require(msg.value > auction.highestBid, "Bid too low");

        if (auction.highestBidder != address(0)) {
            payable(auction.highestBidder).transfer(auction.highestBid);
        }

        auction.highestBidder = msg.sender;
        auction.highestBid = msg.value;
    }

    function endAuction(uint tokenId) public {
        Auction storage auction = auctions[tokenId];

        require(auction.seller != address(0), "Auction not exist");
        require(block.timestamp >= auction.endTime, "Auction not ended");
        require(!auction.ended, "Already ended");

        auction.ended = true;

        address creator = nftContract.creators(tokenId);
        uint royalty = (auction.highestBid * 5) / 100;
        uint amountToSeller = auction.highestBid - royalty;

        if (auction.highestBidder != address(0)) {

            payable(creator).transfer(royalty);
            payable(auction.seller).transfer(amountToSeller);

            nftContract.transferFrom(address(this), auction.highestBidder, tokenId);

        } else {
            nftContract.transferFrom(address(this), auction.seller, tokenId);
        }
    }
}