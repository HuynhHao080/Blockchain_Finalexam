const crypto = require('crypto');

// Hàm hash SHA-256
function hash(data) {
    return crypto
        .createHash('sha256')
        .update(data)
        .digest('hex');
}

console.log("=== THỰC HÀNH: MERKLE TREE DYNAMIC ===\n");

// ==============================
// Hàm build Merkle Tree động
// ==============================
function buildMerkleTree(transactions) {
    console.log("\n" + "=".repeat(50));
    console.log(` MERKLE TREE WITH ${transactions.length} TRANSACTIONS`);
    console.log("=".repeat(50) + "\n");

    let level = 0;

    // Lớp 0: hash từng transaction
    let currentLevel = transactions.map((tx, idx) => {
        const h = hash(tx);
        console.log(
            `[Level ${level}] TX${idx + 1}: ${tx.substring(0, 25).padEnd(25)} -> ${h}`
        );
        return h;
    });

    // Xây cây cho đến khi còn 1 hash duy nhất
    while (currentLevel.length > 1) {
        level++;
        let nextLevel = [];

        for (let i = 0; i < currentLevel.length; i += 2) {
            let left = currentLevel[ i ];

            // Nếu số node lẻ → duplicate node cuối
            let right = (i + 1 < currentLevel.length)
                ? currentLevel[ i + 1 ]
                : left;

            let parent = hash(left + right);

            console.log(`\n[Level ${level}]`);
            console.log(` ${left}`);
            console.log(` ${right}`);
            console.log(` -> ${parent}`);

            nextLevel.push(parent);
        }

        currentLevel = nextLevel;
    }

    console.log(`\nMERKLE ROOT: ${currentLevel[ 0 ]}\n`);
    return currentLevel[ 0 ];
}

// ==============================
// Test với số lượng transaction khác nhau
// ==============================
const tx_2 = [
    "TX1: Tung -> A: 10",
    "TX2: B -> C: 5"
];

const tx_4 = [
    "TX1: Alice->Bob 10",
    "TX2: Charlie->David 5",
    "TX3: Eve->Frank 8",
    "TX4: Grace->Henry 3"
];

const tx_8 = [
    "TX1: Alice->Bob 10",
    "TX2: Charlie->David 5",
    "TX3: Eve->Frank 8",
    "TX4: Grace->Henry 3",
    "TX5: Ivy->Jack 2",
    "TX6: Kelly->Leo 7",
    "TX7: Mike->Nancy 4",
    "TX8: Oscar->Pam 6"
];
const tx_16 = [
    "TX1: Alice->Bob 10",
    "TX2: Charlie->David 5",
    "TX3: Eve->Frank 8",
    "TX4: Grace->Henry 3",
    "TX5: Ivy->Jack 2",
    "TX6: Kelly->Leo 7",
    "TX7: Mike->Nancy 4",
    "TX8: Oscar->Pam 6",
    "TX9: Quinn->Rose 9",
    "TX10: Steve->Tom 1",
    "TX11: Uma->Victor 12",
    "TX12: Wendy->Xavier 11",
    "TX13: Yara->Zack 15",
    "TX14: Anna->Brian 14",
    "TX15: Cindy->Duke 13",
    "TX16: Ethan->Fiona 16"
];


buildMerkleTree(tx_2);
buildMerkleTree(tx_4);
buildMerkleTree(tx_8);
// chạy test
buildMerkleTree(tx_16);