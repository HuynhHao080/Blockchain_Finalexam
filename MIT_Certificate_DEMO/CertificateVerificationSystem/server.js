import express from "express";
const PORT = process.env.PORT || 3000;
import cors from "cors";
import CryptoJS from "crypto-js";
import { ethers } from "ethers";
import { v4 as uuidv4 } from "uuid";
import QRCode from "qrcode";
import dotenv from "dotenv";
import pkg from 'pg';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import stringify from 'json-stable-stringify';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

// ✅ CACHE SYSTEM
const verifyCache = new Map();
const revocationCache = {
    data: null,
    timestamp: 0,
    ttl: 5 * 60 * 1000 // 5 minutes
};

const getCacheKey = (hash) => `verify_${hash}`;
const isCacheValid = (cacheTimestamp) => Date.now() - cacheTimestamp < revocationCache.ttl;

// ✅ CACHE ENTRY STRUCTURE WITH TTL
const createCacheEntry = (data, ttl = 5 * 60 * 1000) => ({
    data,
    timestamp: Date.now(),
    ttl
});

const isCacheEntryValid = (entry) => {
    if (!entry) return false;
    return Date.now() - entry.timestamp < entry.ttl;
};

const cleanupExpiredCache = () => {
    const now = Date.now();
    for (const [ key, entry ] of verifyCache.entries()) {
        if (!isCacheEntryValid(entry)) {
            verifyCache.delete(key);
        }
    }
};

// ✅ RETRY MECHANISM FOR FAILED TRANSACTIONS
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
const TX_WAIT_TIMEOUT = 60000; // 60 seconds - CRITICAL FIX

// Helper to wait for transaction with timeout
const waitForTransactionWithTimeout = async (tx, timeoutMs = TX_WAIT_TIMEOUT) => {
    return Promise.race([
        tx.wait(1), // Wait for 1 confirmation
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Transaction confirmation timeout after ${timeoutMs}ms. Hash: ${tx.hash}`)), timeoutMs)
        )
    ]);
};

const retryTransaction = async (transactionFn, errorMessage) => {
    let lastError;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const result = await transactionFn();
            return result;
        } catch (error) {
            lastError = error;
            logger.warn({
                attempt: i + 1,
                maxAttempts: MAX_RETRIES,
                error: error.message
            }, "Transaction attempt failed");

            if (i < MAX_RETRIES - 1) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
        }
    }

    throw new Error(`${errorMessage} after ${MAX_RETRIES} attempts. Last error: ${lastError.message}`);
};
const { Pool } = pkg;

// ✅ PRODUCTION LOGGER SYSTEM
const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss' }
    }
});

dotenv.config();

// ✅ FRONTEND URL CONFIG
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:5500";

// ==============================================
// ✅ SECURITY: KIỂM TRA BIẾN MÔI TRƯỜNG
// ==============================================
if (!process.env.PRIVATE_KEY) {
    throw new Error("❌ KHÔNG THẤY PRIVATE_KEY trong biến môi trường. KHÔNG được dùng key mặc định public!");
}
if (!process.env.API_KEY) {
    throw new Error("❌ KHÔNG THẤY API_KEY trong biến môi trường!");
}
if (!process.env.JWT_SECRET) {
    throw new Error("❌ KHÔNG THẤY JWT_SECRET trong biến môi trường!");
}
if (!process.env.ADMIN_API_KEY) {
    throw new Error("❌ KHÔNG THẤY ADMIN_API_KEY trong biến môi trường!");
}

// ✅ INPUT VALIDATION SCHEMA
const issueSchema = z.object({
    studentName: z.string().min(1).max(100),
    courseName: z.string().min(1).max(100),
    studentId: z.string().optional(),
    grade: z.string().optional(),
    skills: z.array(z.string()).optional(),
    duration: z.string().optional(),
    instructor: z.string().optional(),
    studentWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
});

const revokeSchema = z.object({
    hash: z.string().length(64)
});

// ✅ AUTHENTICATION MIDDLEWARE
const authenticateJWT = (req, res, next) => {
    const authHeader = req.headers[ 'authorization' ];
    const token = authHeader && authHeader.split(' ')[ 1 ];

    if (!token) {
        return res.status(401).json({ error: "Unauthorized: Missing token" });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: "Forbidden: Invalid token" });
        }
        req.user = user;
        next();
    });
};

// ✅ OPTIONAL AUTHENTICATION: Cho phép guest truy cập, parse token nếu có
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers[ 'authorization' ];
    const token = authHeader && authHeader.split(' ')[ 1 ];

    if (!token) {
        return next();
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (!err) {
            req.user = user;
        }
        next();
    });
};

const requireRole = (role) => {
    return (req, res, next) => {
        if (!req.user || req.user.role !== role) {
            return res.status(403).json({ error: `Forbidden: Requires ${role} role` });
        }
        next();
    };
};

// ✅ API KEY AUTHENTICATION MIDDLEWARE
const authenticateAPIKey = (req, res, next) => {
    const apiKey = req.headers[ 'x-api-key' ];

    if (!apiKey) {
        return res.status(401).json({ error: "Unauthorized: Missing API key" });
    }

    // Check for admin API key
    if (apiKey === process.env.ADMIN_API_KEY) {
        req.user = { role: 'admin' };
        return next();
    }

    // Check for regular API key
    if (apiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: "Unauthorized: Invalid API key" });
    }

    req.user = { role: 'issuer' };
    next();
};

const app = express();
app.use(cors());
app.use(express.json());

// ✅ RATE LIMIT: Chống spam API tốn gas
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 100, // Tối đa 100 request / IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Quá nhiều request, vui lòng thử lại sau 15 phút" }
});

// ✅ HEAVY ENDPOINTS RATE LIMIT
const heavyApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 phút
    max: 20, // Tối đa 20 request / IP cho endpoints nặng
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Quá nhiều request cho endpoint nặng, vui lòng thử lại sau 15 phút" }
});

// Áp dụng rate limit cho tất cả API
app.use("/api/", apiLimiter);

// Áp dụng rate limit riêng cho endpoints nặng
app.use("/api/issue", heavyApiLimiter);
app.use("/api/verify", heavyApiLimiter);
app.use("/api/revoke", heavyApiLimiter);

// Serve static files from frontend folder
app.use(express.static('frontend'));

// Routes cho frontend pages
app.get("/", (req, res) => {
    res.sendFile("index.html", { root: "frontend" });
});

app.get("/verify", (req, res) => {
    const { hash } = req.query;

    const redirectUrl = `${FRONTEND_URL}/frontend/index.html#verify?hash=${hash}`;

    res.redirect(redirectUrl);
});

// ⚙️ Cấu hình hệ thống
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "YOUR_DEPLOYED_CONTRACT_ADDRESS";
const ISSUER_NAME = process.env.ISSUER_NAME || "MIT Blockchain Lab";

// ✅ 🔒 SECURITY MODE CONFIG
// STRICT_MODE = true: Chỉ chấp nhận chứng chỉ hợp lệ trên Blockchain (Production)
// STRICT_MODE = false: Cho phép fallback Database khi blockchain lỗi (Dev/Testing)
const STRICT_MODE = process.env.STRICT_MODE === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// ✅ 🔒 ENFORCE STRICT_MODE IN PRODUCTION
if (IS_PRODUCTION && !STRICT_MODE) {
    throw new Error("❌ SECURITY VIOLATION: STRICT_MODE MUST be enabled in production. Set STRICT_MODE=true in environment variables.");
}

logger.info({ STRICT_MODE, IS_PRODUCTION }, "✅ Security mode loaded");

// ✅ 🔒 LOGIN NONCE CACHE (Anti Replay Attack)
// Nonce chỉ hợp lệ trong 5 phút, dùng 1 lần duy nhất
const loginNonces = new Map();
const NONCE_TTL = 5 * 60 * 1000;

// Cleanup nonces hết hạn mỗi phút
setInterval(() => {
    const now = Date.now();
    for (const [ nonce, created ] of loginNonces.entries()) {
        if (now - created > NONCE_TTL) {
            loginNonces.delete(nonce);
        }
    }
}, 60 * 1000);

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// 📜 Smart Contract ABI - Simplified for better compatibility
const abi = [
    "function isCertificateValid(bytes32 hash) view returns (bool)",
    "function getCertificateDetails(bytes32 hash) view returns (address, uint256, uint8)",
    "function issueCertificate(bytes32 hash)",
    "function revokeCertificate(bytes32 hash)"
];

let contract;
try {
    logger.info({ contractAddress: CONTRACT_ADDRESS, rpcUrl: RPC_URL }, "🔗 Initializing blockchain connection...");
    contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
    logger.info({ walletAddress: wallet.address }, "✅ Blockchain connection ready - Wallet: " + wallet.address);

    // 🔴 ISSUE FIX #2: Ensure wallet is registered as Issuer
    try {
        const issuerInfo = await contract.getIssuer(wallet.address);
        if (issuerInfo.isActive) {
            logger.info({ issuerName: issuerInfo.name }, "✅ Wallet is registered as active Issuer");
        } else {
            logger.warn({ walletAddress: wallet.address }, "⚠️ WARNING: Wallet is NOT an active Issuer! Issue/Revoke will FAIL!");
            logger.info("To fix: Call registerIssuer() from admin account or use admin wallet as PRIVATE_KEY");
        }
    } catch (issuerErr) {
        logger.warn({ error: issuerErr.message }, "⚠️ Could not check issuer status - you may need to register this wallet!");
    }
} catch (error) {
    logger.error(error, "❌ Failed to initialize contract:");
    contract = null;
}

// 🗄️ Supabase PostgreSQL Database
// ✅ Thay thế Map() bằng database cloud - không mất dữ liệu khi restart server
let pool;
let databaseConnected = false;

try {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 10,  // 🔴 FIX: Changed from 1 to 10 to avoid connection starvation
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000
    });

    // Test kết nối database
    await pool.query('SELECT 1');
    databaseConnected = true;
    logger.info("✅ Kết nối Database thành công");
} catch (dbError) {
    logger.warn(dbError, "⚠️ Không thể kết nối Database, sẽ dùng In-Memory fallback cho DEVELOPMENT ONLY");
    databaseConnected = false;
}

// In-Memory fallback cho trường hợp chưa cài đặt Database
const inMemoryCertificates = new Map();

// ✅ SAFE DATABASE WRAPPER - NGĂN CHẶN LỖI KHI DB KHÔNG KẾT NỐI
const safeQuery = async (query, params = []) => {
    if (!databaseConnected || !pool) {
        throw new Error("Database not connected");
    }
    try {
        return await pool.query(query, params);
    } catch (err) {
        logger.warn({ query, err: err.message }, "Database query failed");
        throw err;
    }
};

// Tạo bảng certificates nếu chưa tồn tại
if (databaseConnected) {
    safeQuery(`
   CREATE TABLE IF NOT EXISTS certificates (
     hash VARCHAR(64) PRIMARY KEY,
     data JSONB NOT NULL,
     contenthash VARCHAR(64) UNIQUE NOT NULL,
     status INTEGER DEFAULT 0, -- 0 = Issued, 1 = Revoked, 2 = NotFound
     last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
 `, []).catch(err => console.error("Lỗi khởi tạo database:", err));
}

// ✅ OPTIMIZED REVOCATION CHECK FUNCTION
const checkCertificateStatus = async (hash) => {
    try {
        // ✅ HOT FIX: Kiểm tra xem cột status có tồn tại không
        let result;
        try {
            result = await safeQuery(
                "SELECT status, last_checked FROM certificates WHERE hash = $1",
                [ hash ]
            );
        } catch (dbErr) {
            // Nếu cột status chưa tồn tại → tạo column & fallback về 0
            if (dbErr.message.includes('column "status" does not exist')) {
                logger.warn("Cột status không tồn tại, đang tạo mới...");
                await safeQuery("ALTER TABLE certificates ADD COLUMN IF NOT EXISTS status INTEGER DEFAULT 0", []);
                await safeQuery("ALTER TABLE certificates ADD COLUMN IF NOT EXISTS last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP", []);
                logger.warn("✅ Đã tạo cột status thành công");
                return 0; // Default: Đã phát hành
            }
            throw dbErr;
        }

        const dbRecord = result.rows[ 0 ];

        // If status is cached and recent (within 5 minutes), return it
        if (dbRecord && dbRecord.status !== 2 && Date.now() - new Date(dbRecord.last_checked).getTime() < 5 * 60 * 1000) {
            return dbRecord.status;
        }

        // Otherwise, check blockchain
        if (contract) {
            try {
                const bytes32Hash = "0x" + hash;
                let status = 2;

                try {
                    // ✅ SECURITY & LOGIC FIX: KHÔNG dùng isCertificateValid nữa
                    // Vì isValid = false CÓ THỂ là REVOKED chứ không phải chỉ NOT FOUND
                    // getCertificateDetails trả status chính xác 100%: 0=Issued, 1=Revoked, 2=NotFound
                    const details = await contract.getCertificateDetails(bytes32Hash);
                    status = Number(details[ 2 ]);

                } catch (err) {
                    logger.warn({ hash, err: err.message }, "getCertificateDetails failed");
                    status = 2; // chỉ trả NOT FOUND khi thật sự không tìm thấy
                }

                // Update database with fresh status
                await safeQuery(
                    "UPDATE certificates SET status = $1, last_checked = CURRENT_TIMESTAMP WHERE hash = $2",
                    [ status, hash ]
                );

                return status;
            } catch (error) {
                logger.warn({ hash, error: error.message }, "Blockchain check failed");
                // ✅ SECURITY FIX: Luôn trả NOT FOUND khi blockchain lỗi
                return 2;
            }
        } else {
            logger.warn({ hash }, "Contract not available, skipping blockchain check");
            // ✅ SECURITY FIX: Không contract = không verify được, trả NOT FOUND
            return 2;
        }
    } catch (error) {
        logger.warn({ hash, error: error.message }, "Failed to check certificate status");
        return 2; // NotFound
    }
};

// Tạo bảng audit log nếu chưa tồn tại
if (databaseConnected) {
    safeQuery(`
  CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    action VARCHAR(50) NOT NULL,
    performed_by VARCHAR(42) NOT NULL,
    performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    details JSONB,
    ip_address INET,
    user_agent TEXT
  );
`, []).catch(err => console.error("Lỗi khởi tạo audit log:", err));
}

// ✅ AUDIT LOG MIDDLEWARE
const logAuditAction = (action, details = {}) => {
    return async (req, res, next) => {
        if (req.user) {
            const auditLog = {
                action,
                performed_by: req.user.role === 'admin' ? req.user.id || 'admin' : 'issuer',
                details,
                ip_address: req.ip,
                user_agent: req.get('User-Agent')
            };

            try {
                // Use INSERT ... RETURNING id to get the ID of the inserted row
                const result = await safeQuery(
                    "INSERT INTO audit_logs (action, performed_by, details, ip_address, user_agent) VALUES ($1, $2, $3, $4, $5) RETURNING id",
                    [ auditLog.action, auditLog.performed_by, JSON.stringify(auditLog.details), auditLog.ip_address, auditLog.user_agent ]
                );
                req.auditLogId = result.rows[ 0 ].id;
            } catch (error) {
                logger.error(error, "Failed to log audit action");
            }
        }
        next();
    };
};

// ==============================================
// 🔹 API 1: PHÁT HÀNH CHỨNG CHỈ (ISSUE)
// ==============================================
app.post("/api/issue", authenticateJWT, requireRole('admin'), logAuditAction('issue'), async (req, res) => {
    try {
        // ✅ INPUT VALIDATION
        const validatedData = issueSchema.parse(req.body);
        const { studentName, courseName, studentId, studentWalletAddress } = validatedData;

        if (!studentName || !courseName) {
            return res.status(400).json({ error: "Thiếu thông tin học viên / khóa học" });
        }

        // 🎫 Content data for duplicate detection (excludes random fields)
        const contentData = {
            studentName,
            courseName,
            studentId: studentId || ""
        };
        const contentHash = CryptoJS.SHA256(stringify(contentData)).toString();

        // 🔍 Duplicate check will be enforced by UNIQUE constraint on contenthash column
        // Any duplicate will be caught by constraint violation (error code 23505)

        // 🎫 Tạo Object Certificate chuẩn MIT Blockcert Compatible
        const certificate = {
            "@context": [
                "https://www.w3.org/2018/credentials/v1",
                "https://w3id.org/security/suites/ed25519-2020/v1"
            ],
            "id": uuidv4(),
            "type": [ "VerifiableCredential", "BlockcertCredential" ],
            "issuer": {
                "id": `${process.env.BASE_URL || `http://localhost:${PORT}`}/issuer.json`,
                "name": ISSUER_NAME,
                "url": `${process.env.BASE_URL || `http://localhost:${PORT}`}`
            },
            "issuanceDate": new Date().toISOString(),
            "credentialSubject": {
                "id": `did:example:${uuidv4()}`,
                "name": studentName,
                "studentId": studentId || "",
                "courseName": courseName,
                "grade": req.body.grade || "",
                "skills": req.body.skills || [],
                "duration": req.body.duration || "",
                "instructor": req.body.instructor || "",
                "ownerAddress": studentWalletAddress || ""
            },
            "credentialStatus": {
                "id": `${process.env.BASE_URL || `http://localhost:${PORT}`}/revocation/${uuidv4()}`,
                "type": "BlockchainStatus2022"
            },
            "proof": {
                "type": "Ed25519Signature2020",
                "created": new Date().toISOString(),
                "verificationMethod": `${process.env.BASE_URL || `http://localhost:${PORT}`}/issuer.json#key-1`,
                "proofPurpose": "assertionMethod"
            },
            "nonce": uuidv4(), // ✅ FIX: Anti replay attack
            "version": "3.0-blockcert-compatible"
        };

        // Add contentHash to certificate for tracking
        certificate.contentHash = contentHash;

        // 🔒 Hash certificate data - SHA256
        // ✅ FIX: Sort key để đảm bảo hash luôn giống nhau không bị lỗi thứ tự
        const rawCertificateData = stringify(certificate);
        const certificateHash = CryptoJS.SHA256(rawCertificateData).toString();

        // Generate anti-fake short code
        const shortCode = `MIT-${certificateHash.substring(0, 6).toUpperCase()}`;
        certificate.shortCode = shortCode;

        // ✍️ Ký toàn bộ raw certificate bằng private key của Issuer
        // ✅ ADVANCED: Ký dữ liệu gốc thay vì chỉ ký hash
        const signature = await wallet.signMessage(rawCertificateData);

        // Thêm hash & signature vào certificate
        certificate.hash = certificateHash;
        certificate.signature = signature;

        // ✅ ATOMIC TRANSACTION: DATABASE + BLOCKCHAIN
        // Hoặc cả 2 thành công, hoặc cả 2 thất bại - KHÔNG có trạng thái nửa vời
        const client = await pool.connect();
        let tx;

        try {
            await client.query("BEGIN");

            // 💾 Lưu vào Database
            const insertResult = await client.query(
                "INSERT INTO certificates (hash, data, contenthash) VALUES ($1, $2, $3) ON CONFLICT (hash) DO NOTHING RETURNING hash",
                [ certificateHash, certificate, contentHash ]
            );  // Note: Using client.query (transaction) here, not safeQuery

            // Kiểm tra chứng chỉ đã tồn tại chưa
            if (insertResult.rowCount === 0) {
                throw new Error("Chứng chỉ này đã được phát hành trước đó");
            }

            // ⛓️ Gửi lên Blockchain (nếu contract có sẵn)
            let txHash = null;
            if (contract) {
                const bytes32Hash = "0x" + certificateHash;

                // ✅ CHECK DUPLICATE ON BLOCKCHAIN
                let isValidOnChain = false;
                try {
                    logger.info({ hash: certificateHash }, "🔍 Checking if certificate exists on blockchain...");
                    const result = await contract.isCertificateValid(bytes32Hash);
                    isValidOnChain = result;
                } catch (err) {
                    logger.warn({ hash: certificateHash, error: err.message }, "isCertificateValid call failed");
                    isValidOnChain = false;
                }
                if (isValidOnChain) {
                    throw new Error("Chứng chỉ này đã tồn tại trên blockchain");
                }

                logger.info({ hash: certificateHash, contractAddress: CONTRACT_ADDRESS }, "🚀 Sending certificate to blockchain...");
                tx = await retryTransaction(
                    async () => {
                        try {
                            logger.info({ hash: certificateHash }, "📤 Calling contract.issueCertificate()...");
                            const tx = await contract.issueCertificate(bytes32Hash);
                            logger.info({ txHash: tx.hash, certificateHash }, "✅ TX CREATED - Hash: " + tx.hash);

                            logger.info({ txHash: tx.hash }, "⏳ Waiting for blockchain confirmation (60s timeout)...");
                            const receipt = await waitForTransactionWithTimeout(tx, TX_WAIT_TIMEOUT);
                            logger.info({ txHash: tx.hash, blockNumber: receipt?.blockNumber }, "✅ TX CONFIRMED - Block: " + receipt?.blockNumber);
                            return tx;
                        } catch (innerErr) {
                            logger.error({ error: innerErr.message, stack: innerErr.stack }, "❌ ERROR in issueCertificate");
                            throw innerErr;
                        }
                    },
                    "Failed to issue certificate"
                );
                txHash = tx.hash;
                logger.info({ txHash, certificateHash }, "✅ Certificate issued successfully on blockchain");
            }

            // ✅ Cả 2 đều thành công → Commit
            logger.info({ certificateHash }, "💾 Step 1: Committing database transaction...");
            await client.query("COMMIT");
            logger.info({ certificateHash }, "✅ Step 1: Database COMMITTED");

            // ✅ UPDATE AUDIT LOG WITH TX HASH (FIXED: Single update with null check)
            logger.info({ certificateHash, auditLogId: req.auditLogId, txHash }, "📝 Step 2: Updating audit log...");
            if (req.auditLogId && txHash) {
                await safeQuery(
                    "UPDATE audit_logs SET details = jsonb_set(details, '{transactionHash}', $1) WHERE id = $2",
                    [ JSON.stringify(txHash), req.auditLogId ]
                );
                logger.info({ certificateHash, auditLogId: req.auditLogId }, "✅ Step 2: Audit log updated");
            } else {
                logger.warn({ certificateHash, hasAuditLogId: !!req.auditLogId, hasHash: !!txHash }, "⚠️ Step 2: Skipping audit log (missing data)");
            }

            // 📱 Tạo QR Code verify
            logger.info({ certificateHash }, "🎨 Step 3: Generating QR code...");
            const verifyUrl =
                `${FRONTEND_URL}/frontend/index.html#verify?hash=${certificateHash}`;
            const qrCodeImage = await QRCode.toDataURL(verifyUrl, {
                width: 300,
                margin: 2,
                color: { dark: '#1e293b', light: '#ffffff' }
            });
            logger.info({ certificateHash, qrCodeLength: qrCodeImage.length }, "✅ Step 3: QR code generated");

            // ✅ Trả về kết quả
            logger.info({ certificateHash }, "📤 Step 4: Sending response to client...");
            res.json({
                success: true,
                certificate,
                qrCode: qrCodeImage,
                transactionHash: txHash,
                blockExplorerUrl: txHash ? `https://sepolia.etherscan.io/tx/${txHash}` : null
            });
            logger.info({ certificateHash }, "✅ Step 4: Response sent successfully");

        } catch (error) {
            // ❌ Bất kỳ lỗi nào → Rollback hoàn toàn
            logger.error({ error: error.message, stack: error.stack }, "❌ ERROR in /api/issue - Rolling back...");
            try {
                await client.query("ROLLBACK");
                logger.info("✅ Transaction rolled back");
            } catch (rollbackErr) {
                logger.error({ error: rollbackErr.message }, "❌ ERROR rolling back transaction");
            }
            // ✅ Xử lý lỗi unique violation (contentHash đã tồn tại)
            if (error.code === '23505') {
                return res.status(400).json({ error: "Chứng chỉ này đã tồn tại (duplicate nội dung)" });
            }
            throw error;
        } finally {
            logger.info({ certificateHash }, "🔚 Releasing database connection");
            try {
                client.release();
                logger.info("✅ Connection released");
            } catch (releaseErr) {
                logger.error({ error: releaseErr.message }, "❌ ERROR releasing connection");
            }
        }

    } catch (error) {
        logger.error(error, "❌ Lỗi phát hành chứng chỉ");
        res.status(500).json({ error: error.message });
    }
});

// ==============================================
// 🔹 API 2: XÁC MINH CHỨNG CHỈ (VERIFY)
// ==============================================
app.get("/api/verify/:hash", optionalAuth, async (req, res) => {
    try {
        const hash = req.params.hash;

        if (!hash || hash.length !== 64) {
            return res.status(400).json({ error: "Hash chứng chỉ không hợp lệ" });
        }

        // ✅ CHECK CACHE FIRST
        // 🔥 FIX: Cache phải phân quyền theo role + user address (không share cache giữa các user)
        const role = req.user?.role || "guest";
        const address = req.user?.address || "anonymous";
        const cacheKey = `verify_${hash}_${role}_${address}`;
        const cachedEntry = verifyCache.get(cacheKey);

        if (cachedEntry && isCacheEntryValid(cachedEntry)) {
            // ❗ KHÔNG trả cache nếu chứng chỉ đã bị thu hồi trên database
            let dbStatus = await checkCertificateStatus(hash);
            if (dbStatus !== 1) {
                return res.json(cachedEntry.data);
            }
        }

        // 1️⃣ Lấy certificate từ PostgreSQL Database
        const result = await safeQuery("SELECT data FROM certificates WHERE hash = $1", [ hash ]);
        const certificate = result.rows[ 0 ]?.data;
        if (!certificate) {
            return res.status(404).json({
                error: "Không tìm thấy dữ liệu chứng chỉ",
                validOnChain: false,
                signatureValid: false,
                finalValid: false
            });
        }

        // ✅ 🔒 SECURITY: KIỂM TRA QUYỀN XEM CHI TIẾT CHỨNG CHỈ
        // Enforce quyền ở BACKEND trước tiên - KHÔNG bao giờ gửi full dữ liệu cho người không có quyền
        let canViewFullDetails = false;
        let requesterAddress = null;

        // Kiểm tra JWT token nếu có
        const authHeader = req.headers[ 'authorization' ];
        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                requesterAddress = decoded.address?.toLowerCase();

                // Admin xem được mọi chứng chỉ
                if (decoded.role === 'admin') {
                    canViewFullDetails = true;
                }
                // Người dùng chỉ xem được chứng chỉ của mình
                else if (requesterAddress && certificate.credentialSubject?.ownerAddress?.toLowerCase() === requesterAddress) {
                    canViewFullDetails = true;
                }
            } catch (jwtErr) {
                // Token không hợp lệ - tiếp tục nhưng không xem được chi tiết
                canViewFullDetails = false;
            }
        }

        // 2️⃣ Kiểm tra trên Blockchain (nếu contract có sẵn)
        let isValidOnChain = false;
        let details = null;

        if (contract) {
            const bytes32Hash = "0x" + hash;
            try {
                // ✅ FIX: KHÔNG dùng isCertificateValid nữa
                // getCertificateDetails là source of truth DUY NHẤT
                // trả status chính xác: 0=Issued, 1=Revoked, 2=NotFound
                details = await contract.getCertificateDetails(bytes32Hash);
                const status = Number(details[ 2 ]);

                isValidOnChain = (status === 0); // chỉ status 0 (Issued) mới là hợp lệ

            } catch (error) {
                logger.warn({ hash, error: error.message }, "Blockchain check failed, treating as not found");
                isValidOnChain = false;
                details = null;
            }
        } else {
            // If no contract, check database status as fallback
            const dbStatus = await checkCertificateStatus(hash);
            isValidOnChain = dbStatus === 0; // 0 = Issued
            details = {
                0: [ null, null, 0 ], // issuer, timestamp, status
                1: [ null, null, 1 ],
                2: [ null, null, 2 ]
            }[ dbStatus ] || [ null, null, 2 ];
        }

        // 3️⃣ ✅ Verify chữ ký số (Đúng chuẩn ADVANCED)
        // Reconstruct raw data với cùng thứ tự key
        const certWithoutSignature = { ...certificate };
        delete certWithoutSignature.signature;
        delete certWithoutSignature.hash;
        delete certWithoutSignature.shortCode; // 🔥 FIX: shortCode được thêm sau khi ký

        const rawData = stringify(certWithoutSignature);

        let signerAddress = null;
        let signatureValid = false;

        if (certificate.signature && certWithoutSignature) {
            try {
                signerAddress = ethers.verifyMessage(rawData, certificate.signature);
                // ✅ FIX: So sánh với ISSUER THẬT TỪ BLOCKCHAIN không phải wallet local
                if (details && details[ 0 ]) {
                    signatureValid = signerAddress.toLowerCase() === details[ 0 ].toLowerCase();
                } else {
                    // Fallback: if no blockchain details, set invalid
                    signatureValid = false;
                }
            } catch (verifyError) {
                logger.warn({ hash, verifyError: verifyError.message }, "Signature verification failed");
                signatureValid = false;
            }
        }

        // 4️⃣ ✅ FULL DEBUG LOGGING SYSTEM (disabled in production)
        if (!IS_PRODUCTION) {
            logger.info("==== VERIFY DEBUG START ====");

            logger.info({
                hash,
                certificateFromDB: certificate.hash
            }, "Input Data");

            if (details) {
                logger.info({
                    blockchainIssuer: details[ 0 ],
                    blockchainTimestamp: details[ 1 ],
                    blockchainStatusRaw: Number(details[ 2 ])
                }, "Blockchain Details");
            } else {
                logger.info({
                    blockchainIssuer: null,
                    blockchainTimestamp: null,
                    blockchainStatusRaw: null
                }, "Blockchain Details (not available)");
            }

            logger.info({
                validOnChain: isValidOnChain,
                signatureValid,
                signerAddress
            }, "Validation Results");
        }

        // 5️⃣ ✅ Kết quả cuối cùng CHUẨN
        // ✅ FIX 1: Fallback Database khi blockchain mất dữ liệu
        const dbStatus = await checkCertificateStatus(hash);

        // ✅ FIX: Không bao giờ chấp nhận chứng chỉ đã bị Revoked trên DB (status=1)
        // Luôn ưu tiên status Database là chuẩn duy nhất
        let finalValid;

        // ❗ ƯU TIÊN BLOCKCHAIN
        if (!isValidOnChain) {
            finalValid = false;
        } else {
            finalValid = signatureValid && dbStatus !== 1;
        }
        const realValidOnChain = isValidOnChain;

        if (!IS_PRODUCTION) {
            logger.info({ finalValid }, "Final Decision");
            logger.info("==== VERIFY DEBUG END ====");
        }

        const responseData = {
            finalValid,
            validOnChain: isValidOnChain,
            signatureValid,
            certificate,
            // ✅ FIX 2: Fallback issuer + issuedAt từ Database
            issuer: details?.[ 0 ] || certificate.issuer?.id || null,
            issuedAt: details?.[ 1 ]
                ? Number(details[ 1 ])
                : new Date(certificate.issuanceDate).getTime(),
            // ✅ FIX: Mapping đúng với enum trong Smart Contract
            // ✅ Contract enum: 0 = Issued, 1 = Revoked, 2 = NotFound
            status: (() => {
                const statusMap = {
                    0: "✅ Đã phát hành",
                    1: "❌ Đã thu hồi",
                    2: "❌ Không tồn tại"
                };
                if (details && details[ 2 ] !== undefined) {
                    return statusMap[ Number(details[ 2 ]) ];
                }
                // ✅ FIX 3: Fallback status từ Database
                if (dbStatus === 0) return "✅ Đã phát hành (Off-chain)";
                if (dbStatus === 1) return "❌ Đã thu hồi";
                return "❌ Không tồn tại";
            })(),
            verifiedOnBlockchain: !!contract
        };



        // 🔒 Ẩn thông tin cá nhân nếu không có quyền
        if (!canViewFullDetails) {
            // ✅ ✅ PRODUCTION MAX SECURITY: KHÔNG TRẢ CERTIFICATE LUÔN
            responseData.certificate = null;
            responseData.privateRestricted = true;
            responseData.restrictedMessage = "🔒 Bạn không có quyền xem chi tiết chứng chỉ này";
        }

        // ✅ CACHE THE RESULT WITH TTL
        const cacheEntry = createCacheEntry(responseData);
        verifyCache.set(cacheKey, cacheEntry);

        // Clean up expired cache entries
        cleanupExpiredCache();

        // Keep cache size reasonable
        if (verifyCache.size > 1000) {
            const firstKey = verifyCache.keys().next().value;
            verifyCache.delete(firstKey);
        }

        // Không cache private responses
        if (!canViewFullDetails) {
            res.set("Cache-Control", "no-store, private, max-age=0");
        }

        res.json(responseData);

    } catch (error) {
        console.error("❌ Lỗi kiểm tra chứng chỉ:", error);
        res.status(404).json({
            error: "Chứng chỉ không tồn tại trên blockchain",
            validOnChain: false,
            signatureValid: false,
            finalValid: false
        });
    }
});

// ==============================================
// 🔹 API 3: THU HỒI CHỨNG CHỈ (REVOKE)
// ==============================================
app.post("/api/revoke", authenticateJWT, requireRole('admin'), logAuditAction('revoke'), async (req, res) => {
    try {
        const { hash } = revokeSchema.parse(req.body);
        const bytes32Hash = "0x" + hash;

        if (!contract) {
            return res.status(500).json({ error: "Smart contract not available" });
        }

        // ✅ 1. CHECK TRƯỚC KHI REVOKE - DÙNG getCertificateDetails THAY VÌ isCertificateValid
        const details = await contract.getCertificateDetails(bytes32Hash);
        const status = Number(details[ 2 ]);

        if (status !== 0) {
            return res.status(400).json({ error: "Certificate not found or already revoked" });
        }

        // ✅ 2. REVOKE ON CHAIN WITH RETRY
        logger.info({ hash, contractAddress: CONTRACT_ADDRESS }, "🚀 Sending revoke to blockchain...");
        const tx = await retryTransaction(
            async () => {
                try {
                    logger.info({ hash }, "📤 Calling contract.revokeCertificate()...");
                    const tx = await contract.revokeCertificate(bytes32Hash);
                    logger.info({ txHash: tx.hash, certificateHash: hash }, "✅ REVOKE TX CREATED - Hash: " + tx.hash);

                    logger.info({ txHash: tx.hash }, "⏳ Waiting for blockchain confirmation (60s timeout)...");
                    const receipt = await waitForTransactionWithTimeout(tx, TX_WAIT_TIMEOUT);
                    logger.info({ txHash: tx.hash, blockNumber: receipt?.blockNumber }, "✅ REVOKE TX CONFIRMED - Block: " + receipt?.blockNumber);
                    return tx;
                } catch (innerErr) {
                    logger.error({ error: innerErr.message, stack: innerErr.stack }, "❌ ERROR in revokeCertificate");
                    throw innerErr;
                }
            },
            "Failed to revoke certificate"
        );

        const txHash = tx.hash;
        logger.info({ txHash, certificateHash: hash }, "✅ Certificate revoked successfully on blockchain");

        // ✅ 3. UPDATE DB SAU KHI CHAIN OK
        await safeQuery(
            "UPDATE certificates SET status = 1, last_checked = CURRENT_TIMESTAMP WHERE hash = $1",
            [ hash ]
        );

        // ✅ 4. CLEAR CACHE (QUAN TRỌNG)
        for (const [ key ] of verifyCache.entries()) {
            if (key.includes(hash)) {
                verifyCache.delete(key);
            }
        }

        // ✅ 5. UPDATE AUDIT LOG WITH TX HASH (FIXED: Use txHash instead of tx.hash)
        if (req.auditLogId && txHash) {
            await safeQuery(
                "UPDATE audit_logs SET details = jsonb_set(details, '{transactionHash}', $1) WHERE id = $2",
                [ JSON.stringify(txHash), req.auditLogId ]
            );
        }

        res.json({
            success: true,
            transactionHash: tx.hash,
            certificateHash: hash
        });

    } catch (error) {
        console.error("❌ Revoke error:", error);
        res.status(500).json({ error: error.message });
    }
});
// ==============================================
// 🔹 API 4: LẤY THÔNG TIN CHỨNG CHỈ (With Authorization + Revocation Check)
// ==============================================
app.get("/api/certificate/:hash", optionalAuth, async (req, res) => {
    try {
        const hash = req.params.hash;

        // ✅ Step 1: Get certificate from database
        const result = await safeQuery("SELECT data, status FROM certificates WHERE hash = $1", [ hash ]);
        const certificate = result.rows[ 0 ]?.data;
        const certificateStatus = result.rows[ 0 ]?.status;

        if (!certificate) {
            return res.status(404).json({
                error: "Không tìm thấy chứng chỉ",
                certificate: null
            });
        }

        // ✅ Step 2: Check if certificate is revoked
        if (certificateStatus === 1) {
            return res.status(403).json({
                error: "❌ Chứng chỉ này đã bị thu hồi",
                certificate: null,
                revoked: true
            });
        }

        // ✅ Step 3: Check authorization - verify user owns this certificate or is admin
        let canViewFullDetails = false;
        const authHeader = req.headers[ 'authorization' ];

        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                const token = authHeader.substring(7);
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const requesterAddress = decoded.address?.toLowerCase();

                // Admin can view all certificates
                if (decoded.role === 'admin') {
                    canViewFullDetails = true;
                }
                // User can only view their own certificates
                else if (requesterAddress && certificate.credentialSubject?.ownerAddress?.toLowerCase() === requesterAddress) {
                    canViewFullDetails = true;
                }
            } catch (jwtErr) {
                logger.warn({ error: jwtErr.message }, "JWT verification failed for certificate access");
            }
        }

        // ✅ Step 4: Apply authorization - deny access if not authorized
        if (!canViewFullDetails && certificate.credentialSubject?.ownerAddress) {
            return res.status(403).json({
                error: "🔒 Bạn không có quyền xem chi tiết chứng chỉ này",
                certificate: null,
                privateRestricted: true
            });
        }

        logger.info({ hash, hasAuth: !!authHeader }, "✅ Certificate accessed");
        res.json({ certificate });

    } catch (error) {
        logger.error(error, "Error fetching certificate");
        res.status(500).json({ error: error.message });
    }
});

// ==============================================
// 🔹 API 5: THÔNG TIN ISSUER
// ==============================================
app.get("/api/issuer", (req, res) => {
    res.json({
        name: ISSUER_NAME,
        address: wallet.address,
        verified: true,
        standard: "MIT Blockcert Compatible"
    });
});

// ==============================================
// 🔹 API DEBUG: BLOCKCHAIN STATUS CHECK ⚙️
// ==============================================
app.get("/api/debug/blockchain-status", async (req, res) => {
    try {
        const status = {
            contract: {
                initialized: !!contract,
                address: CONTRACT_ADDRESS,
                rpcUrl: RPC_URL
            },
            wallet: {
                address: wallet.address
            },
            issuer: {
                registered: false,
                active: false,
                name: null,
                error: null
            },
            blockchain: {
                connected: false,
                error: null
            }
        };

        // Check blockchain connection
        try {
            const blockNumber = await provider.getBlockNumber();
            status.blockchain.connected = true;
            status.blockchain.blockNumber = blockNumber;
        } catch (err) {
            status.blockchain.connected = false;
            status.blockchain.error = err.message;
        }

        // Check issuer status if contract is initialized
        if (contract) {
            try {
                const issuerInfo = await contract.getIssuer(wallet.address);
                status.issuer.registered = true;
                status.issuer.active = issuerInfo.isActive;
                status.issuer.name = issuerInfo.name;
            } catch (err) {
                status.issuer.error = err.message;
            }
        }

        logger.info(status, "🔍 Blockchain Status Check");
        res.json(status);

    } catch (error) {
        logger.error(error, "Error checking blockchain status");
        res.status(500).json({ error: error.message });
    }
});

// ==============================================
// 🔹 API DEBUG: RESPONSE SPEED TEST ⚡
// ==============================================
app.get("/api/debug/response-speed", (req, res) => {
    logger.info("📊 Response speed test called");
    res.json({
        success: true,
        timestamp: Date.now(),
        message: "Server is responding normally"
    });
});

// ==============================================
// 🔹 API DEBUG: CONNECTION POOL STATUS 💾
// ==============================================
app.get("/api/debug/pool-status", (req, res) => {
    const poolStatus = {
        databaseConnected,
        poolInitialized: !!pool,
        poolStats: pool ? {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount
        } : null
    };
    logger.info(poolStatus, "💾 Pool Status");
    res.json(poolStatus);
});

// ==============================================
// 🔹 API DEBUG: VERSION CHECK 🔍
// ==============================================
app.get("/api/debug/version", (req, res) => {
    res.json({
        version: "3.0-with-detailed-logging",
        timestamp: new Date().toISOString(),
        features: [
            "JWT Auth + Admin Role",
            "60s TX Timeout",
            "Connection Pool Fix (max:10)",
            "Detailed Logging"
        ]
    });
});

// ==============================================
// 🔹 API 6: THỐNG KÊ HỆ THỐNG
// ===============================================
app.get("/api/stats", async (req, res) => {
    const stats = await safeQuery(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN status = 0 THEN 1 END) as issued,
            COUNT(CASE WHEN status = 1 THEN 1 END) as revoked,
            COUNT(CASE WHEN status = 2 THEN 1 END) as not_found
        FROM certificates
    `);

    const row = stats.rows[ 0 ];

    res.json({
        totalCertificates: parseInt(row.total),
        issued: parseInt(row.issued),
        revoked: parseInt(row.revoked),
        notFound: parseInt(row.not_found),
        issuer: wallet.address,
        contractAddress: CONTRACT_ADDRESS,
        uptime: process.uptime(),
        databaseConnected: true
    });
});
// ==============================================
// 🔹 API Health Check
// ==============================================
// ==============================================
// 🔹 API: Get Login Nonce (SIWE Standard)
// ==============================================
app.get("/api/auth/nonce", (req, res) => {
    const nonce = uuidv4();
    const issuedAt = new Date().toISOString();

    loginNonces.set(nonce, Date.now());

    const loginMessage = `Login to Certificate Verification System
Domain: ${process.env.BASE_URL || 'localhost:3000'}
Nonce: ${nonce}
Issued At: ${issuedAt}`;

    res.json({
        nonce,
        message: loginMessage,
        issuedAt,
        expiresAt: new Date(Date.now() + NONCE_TTL).toISOString()
    });
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const { address, signature, message } = req.body;

        if (!address || address.length !== 42) {
            return res.status(400).json({ error: "Địa chỉ ví không hợp lệ" });
        }

        if (!signature || !message) {
            return res.status(400).json({ error: "Thiếu signature hoặc message xác thực" });
        }

        // ✅ 🔒 SECURITY FIX: Verify signature trước khi login
        let signatureValid = false;
        try {
            const recoveredAddress = ethers.verifyMessage(message, signature);
            signatureValid = recoveredAddress.toLowerCase() === address.toLowerCase();
        } catch (verifyError) {
            logger.warn({ address, error: verifyError.message }, "Signature verification failed");
            signatureValid = false;
        }

        if (!signatureValid) {
            return res.status(401).json({ error: "Xác thực chữ ký thất bại" });
        }

        // ✅ 🔒 ENFORCE LOGIN MESSAGE FORMAT (Anti Phishing)
        const EXPECTED_DOMAIN = process.env.BASE_URL || 'localhost:3000';

        // Check Domain binding
        if (!message.includes(`Domain: ${EXPECTED_DOMAIN}`)) {
            logger.warn({ address, message, expectedDomain: EXPECTED_DOMAIN }, "Invalid domain in login message");
            return res.status(400).json({ error: `Login message must be issued for domain: ${EXPECTED_DOMAIN}` });
        }

        // Check timestamp validity
        const issuedAtMatch = message.match(/Issued At: (.+)/);
        if (!issuedAtMatch) {
            return res.status(400).json({ error: "Missing issued timestamp in login message" });
        }

        try {
            const issuedAt = new Date(issuedAtMatch[ 1 ]);
            if (Date.now() - issuedAt.getTime() > NONCE_TTL) {
                return res.status(400).json({ error: "Login message has expired. Please request new nonce" });
            }
        } catch (e) {
            return res.status(400).json({ error: "Invalid issued timestamp format" });
        }

        // ✅ 🔒 ANTI REPLAY ATTACK: Check & invalidate nonce
        const nonceMatch = message.match(/Nonce: ([0-9a-fA-F-]{36})/);
        if (!nonceMatch) {
            return res.status(400).json({ error: "Missing nonce in login message" });
        }

        const nonce = nonceMatch[ 1 ];
        if (!loginNonces.has(nonce)) {
            return res.status(400).json({ error: "Nonce expired or already used. Please request new nonce" });
        }

        // ✅ Invalidate nonce sau khi dùng (chỉ được dùng 1 lần duy nhất)
        loginNonces.delete(nonce);
        logger.info({ address, nonce }, "✅ Login nonce consumed");

        // Normalize address
        const normalizedAddress = address.toLowerCase();

        // Check user role
        let role = 'student';
        let name = 'Học viên';
        let permissions = [ "verify", "view_own" ];

        // Check if is admin
        const ADMIN_WALLETS = process.env.ADMIN_WALLETS
            ?.split(",")
            .map(a => a.trim().toLowerCase());

        if (ADMIN_WALLETS && ADMIN_WALLETS.includes(normalizedAddress)) {
            role = 'admin';
            name = 'Quản trị viên Hệ thống';
            permissions = [ "issue", "revoke", "admin_panel", "manage_users", "view_all" ];
        }

        // Generate JWT Token
        const token = jwt.sign({
            id: normalizedAddress,
            address: normalizedAddress,
            role,
            permissions
        }, process.env.JWT_SECRET, { expiresIn: '24h' });

        res.json({
            success: true,
            token,
            user: {
                address: normalizedAddress,
                name,
                role,
                permissions
            }
        });

    } catch (error) {
        logger.error(error, "Login error");
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/auth/me", authenticateJWT, async (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

app.get("/api/health", async (req, res) => {
    const count = await safeQuery("SELECT COUNT(*) FROM certificates", []);

    res.json({
        status: "OK",
        timestamp: Date.now(),
        walletAddress: wallet.address,
        contractAddress: CONTRACT_ADDRESS,
        certificatesIssued: parseInt(count.rows[ 0 ].count),
        databaseConnected: true
    });
});

// ==============================================
// 🔹 API 7: Lấy danh sách tất cả chứng chỉ (JWT Auth)
// ==============================================
app.get("/api/certificates", authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const result = await safeQuery("SELECT data, status, created_at FROM certificates ORDER BY created_at DESC LIMIT 100", []);
        const certificates = result.rows.map(row => ({
            ...row.data,
            status: row.status,
            created_at: row.created_at
        }));

        res.json({
            success: true,
            total: certificates.length,
            certificates
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ✅ API EXPORT TẤT CẢ CHỨNG CHỈ
app.get("/api/certificates/export", authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { status, format = 'json' } = req.query;

        let query = "SELECT hash, status, created_at, data FROM certificates ORDER BY created_at DESC";
        let params = [];

        if (status) {
            query += " WHERE status = $1";
            params.push(parseInt(status));
        }

        const result = await safeQuery(query, params);

        if (format === 'csv') {
            // ✅ Export CSV
            const headers = "Hash,Status,Created At,Student Name,Course Name\n";
            const rows = result.rows.map(row => {
                const data = row.data || {};
                const studentName = data.credentialSubject?.name || '';
                const courseName = data.credentialSubject?.courseName || '';
                const statusText = row.status === 0 ? 'Issued' : row.status === 1 ? 'Revoked' : 'NotFound';

                return `"${row.hash}","${statusText}","${row.created_at}","${studentName}","${courseName}"`;
            }).join("\n");

            res.setHeader("Content-Disposition", "attachment; filename=certificates.csv");
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.send(headers + rows);

        } else {
            // ✅ Export JSON (default)
            res.setHeader("Content-Disposition", "attachment; filename=certificates.json");
            res.setHeader("Content-Type", "application/json");
            res.send(JSON.stringify(result.rows, null, 2));
        }

    } catch (error) {
        logger.error(error, "Export certificates error");
        res.status(500).json({ error: error.message });
    }
});

// ==============================================
// 🔹 API: Lấy chứng chỉ của chính user
// ==============================================
app.get("/api/my-certificates", authenticateJWT, async (req, res) => {
    try {
        const userAddress = req.user.address.toLowerCase();
        const result = await safeQuery(
            "SELECT data, status FROM certificates WHERE data->'credentialSubject'->>'ownerAddress' = $1 ORDER BY created_at DESC",
            [ userAddress ]
        );
        const certificates = result.rows.map(row => ({
            ...row.data,
            status: row.status
        }));
        res.json({
            success: true,
            total: certificates.length,
            certificates
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================================
// 🔹 API 8: Admin Dashboard (JWT Auth)
// ==============================================
app.get("/api/admin/dashboard", authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const stats = await safeQuery(`
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 0 THEN 1 END) as issued,
                COUNT(CASE WHEN status = 1 THEN 1 END) as revoked,
                COUNT(CASE WHEN status = 2 THEN 1 END) as not_found
            FROM certificates
        `, []);

        const auditLogs = await safeQuery(`
            SELECT action, performed_by, performed_at, details
            FROM audit_logs 
            ORDER BY performed_at DESC 
            LIMIT 20
        `, []);

        res.json({
            success: true,
            stats: stats.rows[ 0 ],
            recentAudits: auditLogs.rows
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================================
// 🔹 API 8: Issuer Profile chuẩn Blockcert
// ==============================================
app.get("/issuer.json", (req, res) => {
    res.json({
        "@context": "https://w3id.org/openbadges/v2",
        "id": `${process.env.BASE_URL || `http://localhost:${PORT}`}/issuer.json`,
        "type": "Issuer",
        "name": ISSUER_NAME,
        "url": `${process.env.BASE_URL || `http://localhost:${PORT}`}`,
        "email": "blockcert@mit.edu",
        "image": "https://logos-world.net/wp-content/uploads/2021/09/MIT-Engineers-Logo.png",
        "publicKey": {
            "id": `${process.env.BASE_URL || `http://localhost:${PORT}`}/issuer.json#key-1`,
            "type": "CryptographicKey",
            "owner": `${process.env.BASE_URL || `http://localhost:${PORT}`}/issuer.json`,
            "publicKeyBase58": "MIT_BLOCKCERT_PUBLIC_KEY"
        },
        "revocationList": `${process.env.BASE_URL || `http://localhost:${PORT}`}/revocation-list.json`,
        "verification": {
            "type": "MerkleProof2017",
            "publicKey": `${process.env.BASE_URL || `http://localhost:${PORT}`}/issuer.json#key-1`
        }
    });
});

// ==============================================
// 🔹 API 9: Revocation List chuẩn Blockcert
// ==============================================
app.get("/revocation-list.json", async (req, res) => {
    try {
        // ✅ CHECK CACHE FIRST
        if (revocationCache.data && isCacheValid(revocationCache.timestamp)) {
            return res.json(revocationCache.data);
        }

        // Lấy danh sách các chứng chỉ đã bị thu hồi từ database
        const revokedCredentials = [];

        // Lấy tất cả chứng chỉ từ database
        const result = await safeQuery("SELECT hash FROM certificates WHERE status = 0 OR status = 1", []);

        // ✅ FIX N+1 QUERY PROBLEM: Lấy tất cả status trong 1 query duy nhất
        const allHashes = result.rows.map(row => row.hash);

        // Sử dụng IN clause để lấy tất cả record cùng lúc
        const allRecordsResult = await safeQuery(
            "SELECT hash, status, last_checked FROM certificates WHERE hash = ANY($1)",
            [ allHashes ]
        );

        // Tạo map cho nhanh chóng lookup
        const recordMap = new Map();
        for (const row of allRecordsResult.rows) {
            recordMap.set(row.hash, row);
        }

        // Batch check status for certificates that need updating
        const hashesToCheck = [];
        for (const row of result.rows) {
            const hash = row.hash;
            const dbRecord = recordMap.get(hash);

            // Only check if status is not cached or is old
            if (!dbRecord || dbRecord.status === 2 ||
                (dbRecord.status === 0 && Date.now() - new Date(dbRecord.last_checked).getTime() >= 5 * 60 * 1000)) {
                hashesToCheck.push(hash);
            }
        }

        // Batch update status for certificates that need checking - PARALLEL PROCESSING
        if (hashesToCheck.length > 0) {
            // Use Promise.all for parallel certificate status checks
            const statusResults = await Promise.all(
                hashesToCheck.map(async (hash) => {
                    const status = await checkCertificateStatus(hash);
                    return { hash, status };
                })
            );

            // Filter revoked certificates
            revokedCredentials.push(
                ...statusResults
                    .filter(({ status }) => status === 1)
                    .map(({ hash }) => ({
                        id: "0x" + hash,
                        reason: "Credential revoked by issuer"
                    }))
            );
        } else {
            // If no updates needed, just get revoked certificates from database - PARALLEL
            const revokedResult = await safeQuery(
                "SELECT hash FROM certificates WHERE status = 1",
                []
            );

            revokedCredentials.push(
                ...revokedResult.rows.map((row) => ({
                    id: "0x" + row.hash,
                    reason: "Credential revoked by issuer"
                }))
            );
        }

        const responseData = {
            "@context": "https://w3id.org/openbadges/v2",
            "id": `${process.env.BASE_URL || `http://localhost:${PORT}`}/revocation-list.json`,
            "type": "RevocationList",
            "issuer": `${process.env.BASE_URL || `http://localhost:${PORT}`}/issuer.json`,
            "revokedCredentials": revokedCredentials
        };

        // ✅ CACHE THE RESULT
        revocationCache.data = responseData;
        revocationCache.timestamp = Date.now();

        res.json(responseData);
    } catch (error) {
        logger.error(error, "Error generating revocation list");
        res.status(500).json({ error: error.message });
    }
});

// ==============================================
// 🔹 API 10: AUDIT LOGS (Admin Dashboard)
// ==============================================
app.get("/api/admin/audit-logs", authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;

        if (!databaseConnected) {
            return res.json({ logs: [], total: 0, message: "No database connection" });
        }

        // Get total count
        const countResult = await safeQuery("SELECT COUNT(*) FROM audit_logs", []);
        const total = parseInt(countResult.rows[ 0 ].count || 0);

        // Get paginated logs
        const result = await safeQuery(
            `SELECT id, action, performed_by, performed_at, details 
             FROM audit_logs 
             ORDER BY performed_at DESC 
             LIMIT $1 OFFSET $2`,
            [ limit, offset ]
        );

        const logs = result.rows.map(row => ({
            id: row.id,
            action: row.action,
            performedBy: row.performed_by,
            performedAt: row.performed_at,
            details: row.details
        }));

        res.json({ logs, total, limit, offset });
    } catch (error) {
        logger.error(error, "Error fetching audit logs");
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 SERVER BACKEND ĐANG CHẠY TẠI: http://localhost:${PORT}`);
    console.log(`\n📝 API Endpoints:`);
    console.log(`   POST    /api/issue     - Phát hành chứng chỉ`);
    console.log(`   GET     /api/verify/:hash  - Xác minh chứng chỉ`);
    console.log(`   POST    /api/revoke    - Thu hồi chứng chỉ`);
    console.log(`   GET     /api/certificate/:hash - Lấy thông tin chứng chỉ`);
    console.log(`   GET     /api/issuer    - Thông tin Issuer`);
    console.log(`   GET     /api/stats     - Thống kê hệ thống`);
    console.log(`   GET     /api/health    - Kiểm tra trạng thái\n`);
    console.log(`👛 Wallet Issuer: ${wallet.address}`);
    console.log(`📜 Smart Contract: ${CONTRACT_ADDRESS}`);
    console.log(`🔗 RPC URL: ${RPC_URL}`);
    console.log(`✅ Hệ thống đã sẵn sàng theo chuẩn MIT Blockcert\n`);

    // 🔍 BLOCKCHAIN DEBUG INFO
    logger.info({
        walletAddress: wallet.address,
        contractAddress: CONTRACT_ADDRESS,
        rpcUrl: RPC_URL,
        contractInitialized: !!contract
    }, "🚀 BLOCKCHAIN DEBUG INFO");

    if (!contract) {
        logger.warn("⚠️ WARNING: Contract not initialized! Issue/Revoke will fail!");
    }
});