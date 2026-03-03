const crypto = require("crypto");

/* =====================================================
   LỚP HASH – HÀM TIỆN ÍCH
===================================================== */
function calculateHash(data) {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(data))
        .digest("hex");
}

/* =====================================================
   LỚP BLOCK (Khối blockchain)
===================================================== */
class Block {
    constructor(index, timestamp, transactions, previousHash) {
        this.index = index;
        this.timestamp = timestamp;
        this.transactions = transactions;
        this.previousHash = previousHash;
        this.nonce = 0; // dùng cho Proof of Work
        this.hash = this.calculateHash();
    }

    // Hash của block hiện tại
    calculateHash() {
        const blockData = {
            index: this.index,
            timestamp: this.timestamp,
            transactions: this.transactions,
            previousHash: this.previousHash,
            nonce: this.nonce
        };
        return calculateHash(blockData);
    }

    // Proof of Work
    mineBlock(difficulty) {
        const target = "0".repeat(difficulty);
        console.log(`⛏️  Mining block #${this.index}...`);

        const startTime = Date.now();

        while (!this.hash.startsWith(target)) {
            this.nonce++;
            this.hash = this.calculateHash();

            if (this.nonce % 50000 === 0) {
                process.stdout.write(`\r   Tried: ${this.nonce} nonces`);
            }
        }

        const endTime = Date.now();
        console.log(`\n✅ Block #${this.index} mined!`);
        console.log(`   Nonce: ${this.nonce}`);
        console.log(`   Hash : ${this.hash}`);
        console.log(`   Time : ${endTime - startTime} ms\n`);
    }
}

/* =====================================================
   LỚP BLOCKCHAIN (Chuỗi khối)
===================================================== */
class Blockchain {
    constructor(difficulty = 2) {
        this.chain = [];
        this.difficulty = difficulty;

        // Genesis Block
        console.log("🚀 Creating Genesis Block...\n");
        const genesisBlock = new Block(
            0,
            new Date("2024-01-01").toISOString(),
            [ "Genesis Block - khối đầu blockchain" ],
            "0"
        );
        genesisBlock.mineBlock(this.difficulty);
        this.chain.push(genesisBlock);
    }

    getLatestBlock() {
        return this.chain[ this.chain.length - 1 ];
    }

    addBlock(transactions) {
        const newBlock = new Block(
            this.chain.length,
            new Date().toISOString(),
            transactions,
            this.getLatestBlock().hash
        );
        newBlock.mineBlock(this.difficulty);
        this.chain.push(newBlock);
        return newBlock;
    }

    // Kiểm tra tính hợp lệ của blockchain
    isChainValid() {
        console.log("\n🔍 VALIDATING BLOCKCHAIN...\n");

        for (let i = 1; i < this.chain.length; i++) {
            const currentBlock = this.chain[ i ];
            const previousBlock = this.chain[ i - 1 ];

            // Kiểm tra hash
            if (currentBlock.hash !== currentBlock.calculateHash()) {
                console.log(`❌ Block #${i}: Hash không khớp`);
                return false;
            }

            // Kiểm tra previousHash
            if (currentBlock.previousHash !== previousBlock.hash) {
                console.log(`❌ Block #${i}: Previous hash không khớp`);
                return false;
            }

            console.log(`✔ Block #${i}: Valid`);
        }

        console.log("\n✅ Blockchain hoàn toàn hợp lệ!\n");
        return true;
    }

    // Hiển thị blockchain
    displayChain() {
        console.log("\n" + "=".repeat(80));
        console.log("BLOCKCHAIN CHAIN");
        console.log("=".repeat(80) + "\n");

        this.chain.forEach((block, idx) => {
            console.log(`🔗 Block #${idx}`);
            console.log(` Timestamp     : ${block.timestamp}`);
            console.log(` Transactions  : ${block.transactions.length}`);
            block.transactions.slice(0, 2).forEach(tx => {
                console.log(`   - ${tx}`);
            });
            if (block.transactions.length > 2) {
                console.log(`   ... (${block.transactions.length - 2} more)`);
            }
            console.log(` Previous Hash : ${block.previousHash}`);
            console.log(` Hash          : ${block.hash}`);
            console.log(` Nonce         : ${block.nonce}\n`);
        });

        console.log("=".repeat(80) + "\n");
    }
}

/* =====================================================
   THỰC HÀNH BLOCKCHAIN
===================================================== */
console.log("=".repeat(100));
console.log("XÂY DỰNG BLOCKCHAIN CƠ BẢN");
console.log("=".repeat(100) + "\n");

const blockchain = new Blockchain(5);

// Block 1
console.log("➕ THÊM BLOCK 1");
blockchain.addBlock([
    "TX1: Tung -> A: 10 BTC",
    "TX2: An -> C: 5 BTC"
]);

// Block 2
console.log("➕ THÊM BLOCK 2");
blockchain.addBlock([
    "TX3: Eve -> Frank: 7 BTC",
    "TX4: Grace -> Henry: 3 BTC",
    "TX5: Ivy -> Jack: 2 BTC"
]);

// Block 3
console.log("➕ THÊM BLOCK 3");
blockchain.addBlock([
    "TX6: Kelly -> Leo: 8 BTC"
]);

// Hiển thị blockchain
blockchain.displayChain();

// Kiểm tra hợp lệ
blockchain.isChainValid();

/* =====================================================
   THỬ GIẢ MẠO DỮ LIỆU
===================================================== */
console.log("⚠️  THỬ GIẢ MẠO NỘI DUNG");
console.log("Bước 1: Sửa transaction trong Block #1\n");

console.log(blockchain.chain[ 1 ].transactions[ 0 ]);
blockchain.chain[ 1 ].transactions[ 0 ] += " HACKED";
console.log(blockchain.chain[ 1 ].transactions[ 0 ]);

console.log("\nBước 2: Kiểm tra lại blockchain\n");
const isValid = blockchain.isChainValid();

if (!isValid) {
    console.log("🚨 Phát hiện sửa đổi dữ liệu!");
    console.log("🔐 Blockchain bảo vệ dữ liệu thành công!\n");
}
