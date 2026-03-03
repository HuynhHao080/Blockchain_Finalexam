const crypto = require('crypto');
console.log("Lab-01");

function createSHA256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

console.log("Thực Hành SH256 Hashing");
const input1 = "Blockchain buoi 1 2";
const input2 = "blockchain buoi 1 2";
const input3 = "Blockchain buoi 1";
const input4 = "Blockchain buoi 1 2 ";
const hash1 = createSHA256(input1);
const hash2 = createSHA256(input2);
const hash3 = createSHA256(input3);
const hash4 = createSHA256(input4);

console.log("Dữ liệu gốc");
console.log(`Input 1:"${input1}"`);
console.log(`Input 2:"${input2}"`);
console.log(`Input 3:"${input3}"`);
console.log(`Input 4:"${input4}"`);

console.log("Mã SH256 Hash");
console.log(`Hash 1: "${hash1}"`);
console.log(`Hash 2: "${hash2}"`);
console.log(`Hash 3: "${hash3}"`);
console.log(`Hash 4: "${hash4}"`);

console.log("Độ dài mã hash");
console.log(`Hash 1: "${hash1.length}" ký tự`);
console.log(`Hash 2: "${hash2.length}" ký tự`);
console.log(`Hash 3: "${hash3.length}" ký tự`);
console.log(`Hash 4: "${hash4.length}" ký tự`);


