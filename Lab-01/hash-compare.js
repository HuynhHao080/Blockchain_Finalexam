const crypto = require('crypto');

console.log('Lab-01 - Hello World!');

function createHash(algorithm, data) {
    return crypto
        .createHash(algorithm)
        .update(data)
        .digest('hex');
}

console.log('==== SO SÁNH CÁC THUẬT TOÁN HASH ====');

const data = "Blockchain Bitcoin Ethereum";

console.log('Input: ' + data);
console.log('');

const hashSHA1 = createHash('sha1', data);
const hashSHA256 = createHash('sha256', data);
const hashSHA512 = createHash('sha512', data);
const hashMD5 = createHash('md5', data);

console.log('SHA-1:   ', hashSHA1, `(${hashSHA1.length} ký tự)`);
console.log('SHA-256: ', hashSHA256, `(${hashSHA256.length} ký tự)`);
console.log('SHA-512: ', hashSHA512, `(${hashSHA512.length} ký tự)`);
console.log('MD5:     ', hashMD5, `(${hashMD5.length} ký tự)`);

console.log('\nNhận xét:');
console.log(' - SHA-256 được sử dụng trong Bitcoin (256 bits = 64 hex chars)');
console.log(' - SHA-512 an toàn hơn nhưng chậm hơn (512 bits = 128 hex chars)');
console.log(' - SHA-1 không còn an toàn và dần bị thay thế (160 bits = 40 hex chars)');
console.log(' - MD5 không còn được sử dụng vì đã bị crack (128 bits = 32 hex chars)\n');
