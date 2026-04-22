const API_BASE = "http://localhost:3000";
let syncInterval;
let currentStats = {};
let currentUser = null;

// ✅ XSS Protection function
function escapeHTML(str) {
    if (!str) return '';
    return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ✅ Notification System thay thế alert
function showNotification(message, type = "success") {
    const container = document.getElementById("notification-container");
    const notification = document.createElement("div");

    const colors = {
        success: "bg-green-500/90 border-green-500",
        error: "bg-red-500/90 border-red-500",
        warning: "bg-yellow-500/90 border-yellow-500",
        info: "bg-blue-500/90 border-blue-500",
    };

    const icons = {
        success: "✅",
        error: "❌",
        warning: "⚠️",
        info: "ℹ️",
    };

    notification.className = `notification glass ${colors[ type ]} p-4 rounded-lg shadow-xl border max-w-sm flex items-center gap-3`;
    notification.innerHTML = `
    <span class="text-xl">${icons[ type ]}</span>
    <span class="text-white">${message}</span>
    <button onclick="this.parentElement.remove()" class="ml-auto text-white/70 hover:text-white">
      <i class="fa fa-times"></i>
    </button>
  `;

    container.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.style.opacity = "0";
        notification.style.transform = "translateX(100%)";
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Connection status management
async function checkConnection() {
    try {
        const response = await fetch(`${API_BASE}/api/health`);
        if (response.ok) {
            document.getElementById("status-indicator").className =
                "w-3 h-3 rounded-full status-indicator status-online";
            document.getElementById("status-text").textContent =
                "✅ Kết nối thành công";
            document.getElementById("connection-status").className =
                "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full glass status-indicator status-online";
            return true;
        }
    } catch (error) {
        document.getElementById("status-indicator").className =
            "w-3 h-3 rounded-full status-indicator status-offline";
        document.getElementById("status-text").textContent =
            "❌ Không thể kết nối";
        document.getElementById("connection-status").className =
            "mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full glass status-indicator status-offline";
    }
    return false;
}

// Enhanced sync progress
async function syncProgress() {
    const progressBar = document.getElementById("sync-progress");
    const progressText = document.getElementById("sync-progress-text");
    let progress = 0;

    progressBar.style.width = progress + "%";
    progressText.textContent = progress + "%";

    // Check connection
    progress += 25;
    const connected = await checkConnection();
    progressBar.style.width = progress + "%";
    progressText.textContent = progress + "%";

    if (connected) {
        // Fetch stats
        try {
            const res = await fetch(`${API_BASE}/api/stats`);
            if (res.ok) {
                const data = await res.json();
                currentStats = data;
                progress += 25;
                progressBar.style.width = progress + "%";
                progressText.textContent = progress + "%";
            }
        } catch (err) {
            console.error("Sync error:", err);
        }
    }

    progress = 100;
    progressBar.style.width = progress + "%";
    progressText.textContent = progress + "%";

    // Update stats display
    updateStatsDisplay();
}

function updateStatsDisplay() {
    // ✅ SAFE NULL CHECK - các element chỉ tồn tại trên trang Admin thôi
    const totalCertsEl = document.getElementById("total-certs");
    if (totalCertsEl) totalCertsEl.textContent = currentStats.totalCertificates || 0;

    const validCertsEl = document.getElementById("valid-certs");
    if (validCertsEl) validCertsEl.textContent = (currentStats.totalCertificates || 0) - (currentStats.revoked || 0);

    const revokedCertsEl = document.getElementById("revoked-certs");
    if (revokedCertsEl) revokedCertsEl.textContent = currentStats.revoked || 0;

    const notFoundCertsEl = document.getElementById("notfound-certs");
    if (notFoundCertsEl) notFoundCertsEl.textContent = currentStats.notFound || 0;
}
function showTab(tab) {
    const panels = [
        "issuePanel",
        "verifyPanel",
        "explorerPanel",
        "adminPanel",
        "auditPanel",
    ];
    const tabs = [ "tabIssue", "tabVerify", "tabExplorer", "tabAdmin", "tabAudit" ];

    panels.forEach((panel) => {
        document.getElementById(panel).classList.add("hidden");
    });

    tabs.forEach((t) => {
        document.getElementById(t).className =
            "px-6 py-3 rounded-lg font-medium transition-all tab-button glass hover:bg-white/10";
    });

    if (tab === "issue") {
        document.getElementById("issuePanel").classList.remove("hidden");
        document.getElementById("tabIssue").className =
            "px-6 py-3 rounded-lg font-medium transition-all tab-button active";
    } else if (tab === "verify") {
        document.getElementById("verifyPanel").classList.remove("hidden");
        document.getElementById("tabVerify").className =
            "px-6 py-3 rounded-lg font-medium transition-all tab-button active";
    } else if (tab === "explorer") {
        document.getElementById("explorerPanel").classList.remove("hidden");
        document.getElementById("tabExplorer").className =
            "px-6 py-3 rounded-lg font-medium transition-all tab-button active";
        loadExplorerCertificates();
    } else if (tab === "admin") {
        document.getElementById("adminPanel").classList.remove("hidden");
        document.getElementById("tabAdmin").className =
            "px-6 py-3 rounded-lg font-medium transition-all tab-button active";
        loadAdminDashboard();
        loadRecentActivities();
    } else if (tab === "audit") {
        document.getElementById("auditPanel").classList.remove("hidden");
        document.getElementById("tabAudit").className =
            "px-6 py-3 rounded-lg font-medium transition-all tab-button active";
        loadAuditLogs();
    }
}

async function issueCertificate() {
    const studentName = document.getElementById("studentName").value;
    const studentId = document.getElementById("studentId").value;
    const courseName = document.getElementById("courseName").value;
    const grade = document.getElementById("grade").value;
    const instructor = document.getElementById("instructor").value;
    const studentWalletAddress = document.getElementById(
        "studentWalletAddress",
    ).value;

    if (!studentName || !courseName) {
        showNotification(
            "Vui lòng nhập đầy đủ thông tin học viên và khóa học!",
            "warning",
        );
        return;
    }

    const btn = document.getElementById("issue-btn");
    const resultDiv = document.getElementById("issueResult");

    // Show loading state
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner-full mx-auto"></div>';
    resultDiv.classList.add("hidden");

    try {
        // ✅ SECURITY FIX: Remove MetaMask transaction - Backend handles everything
        // Only use JWT authentication for API calls
        const token = localStorage.getItem("jwtToken");
        const headers = {
            "Content-Type": "application/json",
        };

        if (token) {
            headers[ "Authorization" ] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE}/api/issue`, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                studentName,
                studentId,
                courseName,
                grade,
                instructor,
                studentWalletAddress,
            }),
        });

        const data = await res.json();

        if (res.ok && data.certificate) {
            // ✅ Backend handles blockchain transaction - no MetaMask needed
            // Update result with transaction hash from backend
            document.getElementById("certHash").textContent = data.certificate.hash;
            document.getElementById("txHash").textContent = data.transactionHash || "N/A";
            document.getElementById("shortCode").textContent = data.certificate.shortCode;
            document.getElementById("issueQR").src = data.qrCode;
            resultDiv.classList.remove("hidden");

            // Update stats
            fetchStats();

            // Show success notification
            showNotification("✅ Chứng chỉ đã được phát hành thành công!");
        } else {
            // ✅ FIX: Duplicate error hiển thị màu đỏ
            if (
                data.error &&
                (data.error.includes("đã tồn tại") ||
                    data.error.includes("duplicate"))
            ) {
                showNotification("⚠️ " + data.error, "warning");
            } else {
                showNotification("❌ " + (data.error || "Lỗi không xác định"), "error");
            }
        }
    } catch (err) {
        console.error(err);
        showNotification("Lỗi kết nối server: " + err.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = "🚀 Phát hành lên Blockchain";
    }
}

let videoStreamVerify = null;
let scanningVerify = false;

async function verifyCertificate(hash = null) {
    if (!hash) {
        hash = document.getElementById("verifyHash").value;
    } else {
        document.getElementById("verifyHash").value = hash;
    }

    // ✅ FIX: Normalize hash - trim and lowercase
    hash = hash.trim().toLowerCase();

    const resultDiv = document.getElementById("verifyResult");
    const inputsDiv = document.getElementById("verify-inputs");

    if (!hash || hash.length !== 64) {
        showNotification(
            "Vui lòng nhập hash chứng chỉ hợp lệ (64 ký tự)",
            "warning",
        );
        return;
    }

    // Hide inputs, show loading
    inputsDiv.classList.add("hidden");
    resultDiv.innerHTML = `
    <div class="text-center py-12">
      <div class="loading-spinner-full mx-auto"></div>
      <p class="mt-4 text-gray-400">🔍 Đang xác minh chứng chỉ trên Blockchain...</p>
    </div>
  `;
    resultDiv.classList.remove("hidden");

    try {
        // Gửi JWT token nếu đã đăng nhập để kiểm tra quyền xem chi tiết
        const headers = {};
        const token = localStorage.getItem("jwtToken");
        if (token) {
            headers[ "Authorization" ] = `Bearer ${token}`;
        }

        const res = await fetch(`${API_BASE}/api/verify/${hash}`, {
            headers: {
                ...headers,
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            },
        });
        const data = await res.json();

        if (res.ok) {
            // ✅ KIỂM TRA QUYỀN TRƯỚC KHI RENDER
            if (data.privateRestricted) {
                resultDiv.innerHTML = `
                    <div class="text-center py-12">
                        <div class="text-8xl mb-6">🔒</div>
                        <h2 class="text-2xl font-bold text-yellow-400 mb-3">
                            Bạn không có quyền xem chứng chỉ này
                        </h2>
                        <p class="text-gray-400 max-w-md mx-auto">
                            ${data.restrictedMessage || "Vui lòng đăng nhập bằng tài khoản chủ sở hữu để xem chi tiết"}
                        </p>
                        <div class="mt-6 flex gap-4 justify-center">
                            <button
                              onclick="resetVerify()"
                              class="bg-white/10 text-white py-3 px-4 rounded-lg font-semibold hover:bg-white/20 transition">
                              <i class="fa fa-refresh mr-2"></i> Xác minh khác
                            </button>
                        </div>
                    </div>
                `;
                return;
            }

            if (!data.finalValid) {
                resultDiv.innerHTML = `
                    <div class="text-center py-12">
                        <div class="text-8xl mb-6">❌</div>
                        <h2 class="text-2xl font-bold text-red-400 mb-3">
                            Chứng chỉ không hợp lệ
                        </h2>
                        <p class="text-gray-400 max-w-md mx-auto">${data.error || "Chứng chỉ này đã bị thu hồi hoặc không hợp lệ"}</p>
                        <div class="mt-6 flex gap-4 justify-center">
                            <button
                              onclick="resetVerify()"
                              class="bg-white/10 text-white py-3 px-4 rounded-lg font-semibold hover:bg-white/20 transition">
                              <i class="fa fa-refresh mr-2"></i> Thử lại
                            </button>
                        </div>
                    </div>
                `;
                return;
            }

            const cert = data.certificate;
            const subject = cert.credentialSubject;
            const verifyUrl = `${window.location.origin}/#verify?hash=${hash}`;

            // 🔥 FIX DATE 100% CHUẨN - Hỗ trợ cả ISO string và timestamp seconds
            let formattedDate = "Không có dữ liệu";
            if (cert.issuanceDate) {
                formattedDate = new Date(cert.issuanceDate).toLocaleString("vi-VN");
            } else if (data.issuedAt) {
                formattedDate = new Date(data.issuedAt * 1000).toLocaleString("vi-VN");
            }

            // ✅ Kiểm tra chủ sở hữu AN TOÀN - cover tất cả edge cases
            const isOwner =
                currentUser &&
                subject.ownerAddress &&
                currentUser.address.toLowerCase() === subject.ownerAddress.toLowerCase();

            // 🔥 Check chứng chỉ mới phát hành (< 5 phút)
            const isFresh = cert.issuanceDate &&
                (Date.now() - new Date(cert.issuanceDate)) < 5 * 60 * 1000;

            let restrictedNotice = "";
            if (data.privateRestricted) {
                restrictedNotice = `<div class="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-400">
          <i class="fa fa-lock"></i> ${data.restrictedMessage}
        </div>`;
            }

            resultDiv.innerHTML = `
            <!-- Status Badge -->
            <div class="text-center mb-6">
              <div class="inline-flex items-center gap-2 bg-green-500/10 text-green-400 px-6 py-3 rounded-full border border-green-500/30">
                <i class="fa fa-check-circle text-xl"></i>
                <span class="font-bold text-lg">✅ CHỨNG CHỈ HỢP LỆ</span>
              </div>
            </div>

            <!-- Certificate Card -->
            <div class="glass rounded-2xl overflow-hidden">
              <!-- Certificate Header -->
              <div
                class="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-8 text-white text-center">
                <div class="text-5xl mb-2">🏆</div>
                <h2 class="text-2xl font-bold">CERTIFICATE OF COMPLETION</h2>
                <p class="text-xl opacity-90 mt-1 font-medium">${escapeHTML(subject.courseName)}</p>
              </div>

              <!-- Certificate Body -->
              <div class="p-6 space-y-5">
                ${restrictedNotice}
                <div class="text-center border-b border-white/10 pb-4">
                  <p class="text-sm text-gray-400 uppercase">
                    CERTIFIED THAT
                  </p>
                  <h3 class="text-3xl font-bold text-white mt-2">${escapeHTML(subject.name)}</h3>
                </div>

                <div class="grid grid-cols-2 gap-4">
                  <div class="bg-white/5 rounded-lg p-4">
                    <p class="text-xs text-gray-400 uppercase">Issued By</p>
                    <p class="font-semibold text-white mt-1">${cert.issuer.name
                }</p>
                  </div>
                   <div class="bg-white/5 rounded-lg p-4">
                     <p class="text-xs text-gray-400 uppercase">Issued Date</p>
                     <p class="font-semibold text-white mt-1">${formattedDate}</p>
                   </div>
                 </div>

                 <div class="grid grid-cols-2 gap-4">
                  <div class="bg-white/5 rounded-lg p-4">
                    <p class="text-xs text-gray-400 uppercase">Certificate ID</p>
                    <p class="font-mono text-sm font-semibold text-white mt-1">${cert.id
                    .substring(0, 8)
                    .toUpperCase()}</p>
                  </div>
                  <div class="bg-white/5 rounded-lg p-4">
                    <p class="text-xs text-gray-400 uppercase">Blockchain Status</p>
                    <p class="font-semibold mt-1 text-green-400">${data.status
                }</p>
                  </div>
                 </div>

                 <div class="grid grid-cols-2 gap-4">
                   <div class="bg-white/5 rounded-lg p-4">
                     <p class="text-xs text-gray-400 uppercase">Student ID</p>
                     <p class="font-semibold text-white mt-1">${subject.studentId || "-"}</p>
                   </div>

                   <div class="bg-white/5 rounded-lg p-4">
                     <p class="text-xs text-gray-400 uppercase">Grade</p>
                     <p class="font-semibold text-white mt-1">${subject.grade || "-"}</p>
                   </div>

                   <div class="bg-white/5 rounded-lg p-4">
                     <p class="text-xs text-gray-400 uppercase">Instructor</p>
                     <p class="font-semibold text-white mt-1">${subject.instructor || "-"}</p>
                   </div>

                   <div class="bg-white/5 rounded-lg p-4 col-span-2">
                     <p class="text-xs text-gray-400 uppercase">Owner Wallet</p>
                     <p class="font-mono text-sm text-blue-300 mt-1 break-all">
                       ${subject.ownerAddress
                    ? `${subject.ownerAddress.slice(0, 6)}...${subject.ownerAddress.slice(-4)}`
                    : "-"}
                     </p>
                   </div>
                 </div>
                 
                 ${isOwner ? `
                 <div class="text-green-400 mt-2 text-center">
                   👑 Bạn là chủ sở hữu chứng chỉ này
                 </div>
                 ` : ""}
                 
                 ${isFresh ? `
                 <div class="text-yellow-400 text-center mt-1">
                   🔥 Mới được phát hành
                 </div>
                 ` : ""}

                 <!-- Verification Details -->
                <div
                  class="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                  <div class="flex items-center gap-2">
                    <i class="fa fa-check-circle text-green-500 text-xl"></i>
                    <p class="font-semibold text-green-400">
                      ✓ Verified on Ethereum Blockchain
                    </p>
                  </div>
                </div>

                <!-- Certificate Hash -->
                <div class="bg-white/5 rounded-lg p-4">
                  <p class="text-xs text-gray-400 uppercase">
                    Certificate Hash (SHA-256)
                  </p>
                  <p class="font-mono text-xs break-all text-blue-300 mt-1">${cert.hash
                }</p>
                </div>
              </div>

              <!-- Footer QR -->
              <div
                class="border-t border-white/10 p-6 flex justify-between items-center">
                <div class="text-sm text-gray-400">
                  <p>✅ Digitally signed</p>
                  <p class="text-xs">Scan QR to verify</p>
                </div>
                <div id="verifyQR" class="bg-white p-2 rounded"></div>
              </div>
            </div>

            <!-- Action Buttons -->
            <div class="mt-6 grid grid-cols-2 gap-4">
              <button
                onclick="resetVerify()"
                class="bg-white/10 text-white py-3 px-4 rounded-lg font-semibold hover:bg-white/20 transition"
                title="Xác minh chứng chỉ khác">
                <i class="fa fa-refresh mr-2"></i> Xác minh khác
              </button>
              <button
                onclick="showTab('explorer')"
                class="bg-blue-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-blue-700 transition"
                title="Mở Explorer">
                <i class="fa fa-search mr-2"></i> Explorer
              </button>
            </div>
          `;

            // Generate QR code
            if (typeof QRCode !== "undefined") {
                QRCode.toDataURL(verifyUrl, {
                    width: 80,
                    height: 80,
                    margin: 0,
                    color: {
                        dark: "#1A1A1A",
                        light: "#ffffff",
                    },
                })
                    .then((url) => {
                        const qrDiv = document.getElementById("verifyQR");
                        if (qrDiv) {
                            qrDiv.innerHTML = `<img src="${url}" class="w-20 h-20" alt="QR Code" />`;
                        }
                    })
                    .catch((err) => {
                        console.error("QR Code error:", err);
                    });
            }
        } else {
            resultDiv.innerHTML = `
            <div class="text-center py-12">
              <div class="text-8xl mb-6">❌</div>
              <h2 class="text-2xl font-bold text-red-400 mb-3">
                Chứng chỉ không hợp lệ
              </h2>
              <p class="text-gray-400 max-w-md mx-auto">${data.error ||
                "Chứng chỉ này đã bị thu hồi hoặc không hợp lệ"
                }</p>
              <div class="mt-6 flex gap-4 justify-center">
                <button
                  onclick="resetVerify()"
                  class="bg-white/10 text-white py-3 px-4 rounded-lg font-semibold hover:bg-white/20 transition">
                  <i class="fa fa-refresh mr-2"></i> Thử lại
                </button>
              </div>
            </div>
          `;
        }
    } catch (err) {
        console.error(err);
        showNotification("Lỗi xác minh: " + err.message, "error");
    }
}

function resetVerify() {
    document.getElementById("verify-inputs").classList.remove("hidden");
    document.getElementById("verifyResult").classList.add("hidden");
    document.getElementById("verifyHash").value = "";
    stopCameraVerify();
}

async function startCameraVerify() {
    try {
        const video = document.getElementById("qr-video-verify");

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }
        });

        video.srcObject = stream;
        video.style.display = "block";

        // 🔥 FIX: Chờ video load xong metadata mới quét
        video.onloadedmetadata = () => {
            video.play();
            scanningVerify = true;
            videoStreamVerify = stream;
            scanQRCodeFromVideo(video);
        };
    } catch (err) {
        console.error(err);
        showNotification("Không thể mở camera", "error");
    }
}

function stopCameraVerify() {
    if (videoStreamVerify) {
        videoStreamVerify.getTracks().forEach(track => track.stop());
        videoStreamVerify = null;
    }
    scanningVerify = false;

    const video = document.getElementById("qr-video-verify");
    if (video) {
        video.srcObject = null;
        video.style.display = "none";
    }
}

// 🔥 FIX: Camera cleanup on page unload
window.addEventListener("beforeunload", stopCameraVerify);

function scanQRCodeFromVideo(video) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    function scan() {
        if (!scanningVerify) return;

        // 🔥 FIX: Kiểm tra video đã load xong chưa
        if (video.videoWidth === 0 || video.videoHeight === 0) {
            requestAnimationFrame(scan);
            return;
        }

        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        const code = jsQR(imageData.data, canvas.width, canvas.height);

        if (code) {
            console.log("QR detected:", code.data);

            let scannedData = code.data;

            // 🔥 FIX: Nếu là URL verify → auto extract hash
            if (scannedData.startsWith("http")) {
                try {
                    const url = new URL(scannedData);
                    let hash = url.searchParams.get("hash");

                    // ✅ fallback nếu nằm trong #verify
                    if (!hash && url.hash.includes("?")) {
                        const hashQuery = url.hash.split("?")[ 1 ];
                        const params = new URLSearchParams(hashQuery);
                        hash = params.get("hash");
                    }

                    scannedData = hash || scannedData;
                } catch (e) {
                    console.error("QR parse error:", e);
                }
            }

            // ✅ Validate hash format
            if (!/^[a-f0-9]{64}$/i.test(scannedData)) {
                showNotification("❌ Hash không hợp lệ (phải 64 ký tự hex)", "error");
                stopCameraVerify();
                return;
            }

            stopCameraVerify();
            verifyCertificate(scannedData);
            return;
        }

        requestAnimationFrame(scan);
    }

    scan();
}

async function login() {
    if (!window.ethereum) {
        showNotification("❌ Bạn cần cài MetaMask!", "error");
        return;
    }

    try {
        const accounts = await ethereum.request({
            method: "eth_requestAccounts",
        });
        const address = accounts[ 0 ];

        // lấy nonce
        const nonceRes = await fetch(`${API_BASE}/api/auth/nonce`);
        const nonceData = await nonceRes.json();

        const message = nonceData.message;

        // ký
        const signature = await ethereum.request({
            method: "personal_sign",
            params: [ message, address ],
        });

        // gửi login
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                address,
                signature,
                message,
            }),
        });

        const data = await res.json();

        if (res.ok) {
            localStorage.setItem("jwtToken", data.token);
            localStorage.setItem("currentUser", JSON.stringify(data.user));
            currentUser = data.user;

            updateUserUI();
            applyRoleRestrictions();

            showNotification("✅ Đăng nhập thành công!");
            closeLoginModal();
        } else {
            showNotification(data.error, "error");
        }
    } catch (err) {
        console.error(err);
        showNotification("Login thất bại", "error");
    }
}

function updateUserUI() {
    if (!currentUser) return;

    document.getElementById("loginBtn").classList.add("hidden");
    document.getElementById("userInfo").classList.remove("hidden");

    document.getElementById("userName").textContent =
        currentUser.address.slice(0, 6) + "...";

    document.getElementById("userRole").textContent =
        currentUser.role || "user";
}

function logout() {
    localStorage.removeItem("jwtToken");
    localStorage.removeItem("currentUser");
    currentUser = null;

    document.getElementById("loginBtn").classList.remove("hidden");
    document.getElementById("userInfo").classList.add("hidden");

    showNotification("Đã đăng xuất", "info");
}

function applyRoleRestrictions() {
    if (!currentUser) return;

    const issueTab = document.getElementById("tabIssue");
    const adminTab = document.getElementById("tabAdmin");
    const auditTab = document.getElementById("tabAudit");
    const issuePanel = document.getElementById("issuePanel");

    if (currentUser.role === "admin") {
        issueTab.style.display = "block";
        adminTab.style.display = "block";
        auditTab.style.display = "block";
    }

    if (currentUser.role === "student") {
        issueTab.style.display = "none";
        adminTab.style.display = "none";
        auditTab.style.display = "none";

        // 🔥 QUAN TRỌNG: ẩn luôn panel
        issuePanel.classList.add("hidden");

        // 👉 chuyển sang tab verify
        showTab("verify");
    }
}
function closeLoginModal() {
    document.getElementById("loginModal").classList.add("hidden");
}

function showLoginModal() {
    document.getElementById("loginModal").classList.remove("hidden");
}

async function fetchStats() {
    try {
        const res = await fetch(`${API_BASE}/api/stats`);
        if (res.ok) {
            currentStats = await res.json();
            updateStatsDisplay();
        }
    } catch (err) {
        console.error("Stats error:", err);
    }
}

async function loadExplorerCertificates() {
    const container = document.getElementById("explorer-certificates-list");

    container.innerHTML = "Đang tải...";

    try {
        // ✅ Switch endpoint theo role user
        const endpoint =
            currentUser?.role === "admin"
                ? "/api/certificates"
                : "/api/my-certificates";

        // ✅ Đổi title Explorer theo quyền
        if (document.getElementById("explorer-title")) {
            document.getElementById("explorer-title").textContent =
                currentUser?.role === "admin"
                    ? "📊 Tất cả chứng chỉ"
                    : "🎓 Chứng chỉ của bạn";
        }

        const res = await fetch(API_BASE + endpoint, {
            headers: {
                Authorization: "Bearer " + localStorage.getItem("jwtToken"),
            },
        });

        const data = await res.json();

        if (!data.certificates || data.certificates.length === 0) {
            container.innerHTML = "Chưa có chứng chỉ nào";
            return;
        }

        // ✅ Search / Filter
        const keyword = document.getElementById("explorerSearch")?.value?.toLowerCase() || "";

        const filtered = data.certificates.filter(c => {
            const s = c.credentialSubject || {};
            return (
                !keyword ||
                s.name?.toLowerCase().includes(keyword) ||
                s.studentId?.toLowerCase().includes(keyword) ||
                s.courseName?.toLowerCase().includes(keyword)
            );
        });

        container.innerHTML = filtered.map((c) => {
            const subject = c.credentialSubject || {};
            const shortHash = c.hash.slice(0, 10) + "...";
            const qrId = "qr-" + c.hash.slice(0, 8);

            const issuedDate = c.issuanceDate
                ? new Date(c.issuanceDate).toLocaleDateString("vi-VN")
                : "-";

            const owner = subject.ownerAddress
                ? subject.ownerAddress.slice(0, 6) + "..." + subject.ownerAddress.slice(-4)
                : "-";

            const statusClass = c.status === 1 ? "bg-red-500/10 text-red-400" : "bg-green-500/10 text-green-400";
            const statusText = c.status === 1 ? "❌ Revoked" : "✅ Valid";

            return `
            <div class="certificate-card glass p-5 rounded-xl mb-4 border border-white/10 hover:border-blue-500/40 hover:scale-[1.02] hover:shadow-xl transition-all cursor-pointer">
              
              <div class="flex justify-between items-start">
                <div>
                  <p class="text-lg font-bold text-white">${subject.name || "Unknown"}</p>
                  <p class="text-sm text-gray-400">${subject.courseName || ""}</p>
                </div>

                <span class="text-xs ${statusClass} px-3 py-1 rounded-full">
                  ${statusText}
                </span>
              </div>

              <div class="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span class="text-gray-400">Student ID:</span>
                  <span class="text-white">${subject.studentId || "-"}</span>
                </div>

                <div>
                  <span class="text-gray-400">Grade:</span>
                  <span class="text-white">${subject.grade || "-"}</span>
                </div>

                <div>
                  <span class="text-gray-400">Instructor:</span>
                  <span class="text-white">${subject.instructor || "-"}</span>
                </div>

                <div>
                  <span class="text-gray-400">Hash:</span>
                  <span class="text-blue-400 font-mono">${shortHash}</span>
                </div>
                
                <div>
                  <span class="text-gray-400">Issued:</span>
                  <span class="text-white">${issuedDate}</span>
                </div>

                <div>
                  <span class="text-gray-400">Owner:</span>
                  <span class="text-blue-300 font-mono">${owner}</span>
                </div>
              </div>

<!-- Actions -->
              <div class="flex gap-2 mt-3">
                <button onclick="event.stopPropagation(); showCertificateDetails('${c.hash}')"
                  class="flex-1 bg-purple-600 hover:bg-purple-700 text-white py-1 px-2 rounded text-xs font-medium">
                  📋 Details
                </button>

                <button onclick="event.stopPropagation(); verifyFromExplorer('${c.hash}')"
                  class="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-1 px-2 rounded text-xs font-medium">
                  🔍 Verify
                </button>

                <button onclick="event.stopPropagation(); copyToClipboard('${c.hash}')"
                  class="flex-1 bg-white/10 hover:bg-white/20 text-white py-1 px-2 rounded text-xs font-medium">
                  📋 Copy
                </button>
              </div>

              <!-- QR -->
              <div id="${qrId}" class="mt-3 text-center"></div>

            </div>
            `;
        }).join("");

        // ✅ Generate QR locally sau khi render
        setTimeout(() => {
            filtered.forEach(c => {
                const qrId = "qr-" + c.hash.slice(0, 8);
                const el = document.getElementById(qrId);

                if (el && typeof QRCode !== "undefined") {
                    QRCode.toDataURL(
                        window.location.origin + "/#verify?hash=" + c.hash,
                        { width: 80, height: 80, margin: 0 }
                    ).then(url => {
                        if (el) {
                            el.innerHTML = `
                            <img src="${url}" class="mx-auto rounded bg-white p-1" />
                            <p class="text-xs text-gray-400 mt-1">Scan để verify</p>
                            `;
                        }
                    });
                }
            });
        }, 0);
    } catch (err) {
        container.innerHTML = "Lỗi load explorer";
    }
}

// 🔥 FIX: Real-time search event listener
document.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("explorerSearch");
    if (searchInput) {
        searchInput.addEventListener("input", loadExplorerCertificates);
    }
});

async function loadAdminDashboard() {
    // Admin dashboard demo
    try {
        // Refresh stats
        await fetchStats();

        document.getElementById("admin-total").textContent = currentStats.totalCertificates || 0;
        document.getElementById("admin-valid").textContent =
            (currentStats.totalCertificates || 0) - (currentStats.revoked || 0);

        document.getElementById("admin-revoked").textContent =
            currentStats.revoked || 0;

        const container = document.getElementById("certificates-list");
        if (!container) return;

        container.innerHTML = "Đang tải...";

        const res = await fetch(`${API_BASE}/api/certificates`, {
            headers: {
                Authorization: "Bearer " + localStorage.getItem("jwtToken"),
            },
        });

        const data = await res.json();

        if (!data.certificates) {
            container.innerHTML = "Không có dữ liệu";
            return;
        }

        container.innerHTML = data.certificates.map(c => {
            const s = c.credentialSubject || {};
            const statusClass = c.status === 1 ? "text-red-400" : "text-green-400";
            const statusText = c.status === 1 ? "❌ Revoked" : "✅ Valid";

            return `
            <div class="glass p-4 rounded-lg mb-3 border border-white/10">
                <div class="flex justify-between items-start">
                    <div>
                        <p class="font-bold text-white">${s.name}</p>
                        <p class="text-sm text-gray-400">${s.courseName}</p>
                        <p class="text-xs ${statusClass}">${statusText}</p>
                    </div>

                    <div class="flex gap-2">
                        <button onclick="event.stopPropagation(); verifyFromExplorer('${c.hash}')"
                            class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm">
                            Verify
                        </button>

                        <button onclick="event.stopPropagation(); revokeCert('${c.hash}')"
                            class="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
                             ${c.status === 1 ? 'disabled' : ''}>
                            Revoke
                        </button>
                    </div>
                </div>
            </div>
            `;
        }).join("");

    } catch (err) {
        console.error("Admin dashboard error:", err);
        const container = document.getElementById("admin-cert-list");
        if (container) container.innerHTML = "Lỗi load admin";
    }
}

// ✅ Load Audit Logs for Admin Dashboard
async function loadAuditLogs() {
    const container = document.getElementById("audit-logs-list");
    if (!container) return;

    container.innerHTML = `
        <div class="text-center text-gray-400 py-8">
            <i class="fa fa-spinner fa-spin text-2xl"></i>
            <p class="mt-2">Đang tải audit logs...</p>
        </div>
    `;

    try {
        const res = await fetch(`${API_BASE}/api/admin/audit-logs`, {
            headers: {
                Authorization: "Bearer " + localStorage.getItem("jwtToken"),
            },
        });

        const data = await res.json();

        if (!data.logs || data.logs.length === 0) {
            container.innerHTML = `
                <div class="text-center text-gray-400 py-8">
                    <i class="fa fa-list-alt text-4xl"></i>
                    <p class="mt-2">Chưa có audit logs nào</p>
                </div>
            `;
            return;
        }

        // Enhanced audit logs with better formatting and filtering
        container.innerHTML = `
            <div class="space-y-3 max-h-96 overflow-y-auto">
                ${data.logs.map(log => {
            const time = new Date(log.performedAt).toLocaleString("vi-VN");
            const actionIcon = log.action === 'issue' ? '🎓' : log.action === 'revoke' ? '🚫' : '📝';
            const actionColor = log.action === 'issue' ? 'text-green-400' : log.action === 'revoke' ? 'text-red-400' : 'text-blue-400';

            let details = '';
            if (log.details && log.details.transactionHash) {
                details = `<br><span class="text-xs text-gray-500">TX: ${log.details.transactionHash.slice(0, 10)}...${log.details.transactionHash.slice(-8)}</span>`;
            }

            return `
                    <div class="glass p-4 rounded-lg border border-white/10 hover:border-blue-500/40 transition">
                        <div class="flex justify-between items-start">
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1 leading-none">
                                    <span class="text-lg">${actionIcon}</span>
                                    <span class="font-semibold ${actionColor} capitalize">${log.action}</span>
                                    <span class="text-sm text-gray-400">by ${log.performedBy}</span>
                                </div>
                                <p class="text-sm text-gray-300">${time}</p>
                                ${details}
                            </div>
                        </div>
                    </div>
                    `;
        }).join("")}
            </div>
        `;

    } catch (err) {
        console.error("Audit logs error:", err);
        container.innerHTML = `
            <div class="text-center text-red-400 py-8">
                <i class="fa fa-exclamation-triangle text-4xl"></i>
                <p class="mt-2">Lỗi tải audit logs</p>
                <p class="text-sm text-gray-400">${err.message}</p>
            </div>
        `;
    }
}

// ✅ Helper function for token validation
function getAuthHeaders() {
    const token = localStorage.getItem("jwtToken");
    if (!token) {
        showNotification("Bạn cần đăng nhập để thực hiện hành động này", "warning");
        return null;
    }

    return {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
    };
}

// ✅ Admin Revoke Certificate function
async function revokeCert(hash) {
    if (!confirm("⚠️ BẠN CHẮC CHẮN MUỐN THU HỒI CHỨNG CHỈ NÀY?\n\nHành động này không thể hoàn tác!")) return;

    const headers = getAuthHeaders();
    if (!headers) return;

    try {
        const res = await fetch(`${API_BASE}/api/revoke`, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({ hash }),
        });

        const data = await res.json();

        if (res.ok) {
            showNotification("🚫 Đã thu hồi chứng chỉ thành công", "success");
            loadAdminDashboard();
            fetchStats();
        } else {
            showNotification(data.error, "error");
        }
    } catch (err) {
        showNotification("Lỗi thu hồi chứng chỉ: " + err.message, "error");
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => {
            showNotification("📋 Đã copy!", "success");
        })
        .catch(err => {
            console.error(err);
            showNotification("❌ Không thể copy", "error");
        });
}

// ✅ Verify từ Explorer: Chuyển tab + scroll + delay render
function verifyFromExplorer(hash) {
    showTab("verify");

    setTimeout(() => {
        verifyCertificate(hash);

        // Auto scroll xuống verify panel
        document.getElementById("verifyPanel")
            ?.scrollIntoView({ behavior: "smooth" });
    }, 100);
}

// ✅ Show certificate details in a modal
function showCertificateDetails(hash) {
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-2";
    modal.innerHTML = `
        <div class="glass rounded-xl p-4 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center mb-3">
                <h3 class="text-lg font-semibold">📋 Chi tiết Chứng chỉ</h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-white text-lg" title="Đóng modal">
                    <i class="fa fa-times"></i>
                </button>
            </div>

            <div class="text-center py-8">
                <div class="loading-spinner-full mx-auto"></div>
                <p class="mt-3 text-gray-400 text-sm">Đang tải chi tiết chứng chỉ...</p>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Fetch certificate details
    fetch(`${API_BASE}/api/certificate/${hash}`, {
        headers: {
            Authorization: "Bearer " + localStorage.getItem("jwtToken"),
        },
    })
        .then(res => res.json())
        .then(data => {
            if (!data.certificate) {
                modal.querySelector(".text-center").innerHTML = `
                <div class="text-center py-8">
                    <div class="text-6xl mb-3">❌</div>
                    <h2 class="text-lg font-bold text-red-400 mb-2">
                        Không tìm thấy chứng chỉ
                    </h2>
                    <p class="text-gray-400 text-sm">Chứng chỉ này không tồn tại</p>
                </div>
            `;
                return;
            }

            const cert = data.certificate;
            const subject = cert.credentialSubject || {};
            const statusClass = cert.status === 1 ? "text-red-400" : "text-green-400";
            const statusText = cert.status === 1 ? "❌ Revoked" : "✅ Valid";

            modal.querySelector(".text-center").innerHTML = `
            <!-- Certificate Card -->
            <div class="glass rounded-xl overflow-hidden">
                <!-- Certificate Header -->
                <div class="bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-5 text-white text-center">
                    <div class="text-4xl mb-1">🏆</div>
                    <h2 class="text-lg font-bold">CERTIFICATE OF COMPLETION</h2>
                    <p class="text-sm opacity-90 mt-1">${subject.courseName || ""}</p>
                </div>

                <!-- Certificate Body -->
                <div class="p-4 space-y-3">
                    <div class="text-center border-b border-white/10 pb-3">
                        <p class="text-xs text-gray-400 uppercase">CERTIFIED THAT</p>
                        <h3 class="text-xl font-bold text-white mt-1">${subject.name || "Unknown"}</h3>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Issued By</p>
                            <p class="text-sm font-semibold text-white mt-1">${cert.issuer.name || "Unknown"}</p>
                        </div>
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Issued Date</p>
                            <p class="text-sm font-semibold text-white mt-1">${new Date(cert.issuanceDate).toLocaleString("vi-VN")}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Cert ID</p>
                            <p class="text-xs font-mono font-semibold text-white mt-1">${cert.id?.substring(0, 8).toUpperCase() || "-"}</p>
                        </div>
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Status</p>
                            <p class="text-sm font-semibold mt-1 ${statusClass}">${statusText}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Student ID</p>
                            <p class="text-sm font-semibold text-white mt-1">${subject.studentId || "-"}</p>
                        </div>
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Grade</p>
                            <p class="text-sm font-semibold text-white mt-1">${subject.grade || "-"}</p>
                        </div>
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Instructor</p>
                            <p class="text-sm font-semibold text-white mt-1">${subject.instructor || "-"}</p>
                        </div>
                        <div class="bg-white/5 rounded p-3">
                            <p class="text-xs text-gray-400 uppercase">Duration</p>
                            <p class="text-sm font-semibold text-white mt-1">${subject.duration || "-"}</p>
                        </div>
                    </div>

                    <div class="bg-white/5 rounded p-3 col-span-2">
                        <p class="text-xs text-gray-400 uppercase">Owner Wallet</p>
                        <p class="font-mono text-xs text-blue-300 mt-1 break-all">${subject.ownerAddress || "-"}</p>
                    </div>

                    <div class="grid grid-cols-2 gap-2 text-xs">
                        <div class="bg-white/5 rounded p-2">
                            <p class="text-gray-400 uppercase">Content Hash</p>
                            <p class="font-mono text-blue-300 break-all">${cert.contentHash || "-"}</p>
                        </div>
                        <div class="bg-white/5 rounded p-2">
                            <p class="text-gray-400 uppercase">Cert Hash</p>
                            <p class="font-mono text-blue-300 break-all">${cert.hash || "-"}</p>
                        </div>
                    </div>

                    <div class="bg-white/5 rounded p-2">
                        <p class="text-xs text-gray-400 uppercase">Signature</p>
                        <p class="font-mono text-xs text-blue-300 break-all">${cert.signature || "-"}</p>
                    </div>
                </div>

                <!-- Footer Actions -->
                <div class="border-t border-white/10 p-3 flex justify-between items-center gap-2">
                    <div class="text-xs text-gray-400">
                        <p>✅ Digitally signed</p>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="copyToClipboard('${cert.hash}')"
                            class="bg-white/10 text-white py-1 px-2 rounded text-xs hover:bg-white/20 transition">
                            📋 Copy
                        </button>
                        <button onclick="verifyFromExplorer('${cert.hash}')"
                            class="bg-blue-600 text-white py-1 px-2 rounded text-xs hover:bg-blue-700 transition">
                            🔍 Verify
                        </button>
                    </div>
                </div>
            </div>

            <!-- Action Buttons -->
            <div class="mt-3 grid grid-cols-2 gap-2">
                <button onclick="this.closest('.fixed').remove()"
                    class="bg-white/10 text-white py-2 px-3 rounded text-sm font-semibold hover:bg-white/20 transition"
                    title="Đóng modal">
                    <i class="fa fa-times mr-1"></i> Đóng
                </button>
                <button onclick="showTab('explorer')"
                    class="bg-blue-600 text-white py-2 px-3 rounded text-sm font-semibold hover:bg-blue-700 transition"
                    title="Mở Explorer">
                    <i class="fa fa-search mr-1"></i> Explorer
                </button>
            </div>
        `;
        })
        .catch(err => {
            console.error(err);
            modal.querySelector(".text-center").innerHTML = `
            <div class="text-center py-8">
                <div class="text-5xl mb-3">❌</div>
                <h2 class="text-lg font-bold text-red-400 mb-2">
                    Lỗi tải chi tiết
                </h2>
                <p class="text-gray-400 text-sm">${err.message}</p>
            </div>
        `;
        });
}

// ✅ Admin Dashboard helper functions
// ✅ Download tất cả chứng chỉ dạng file (STANDARD PRODUCTION WAY)
async function downloadAllCertificates(format = 'json') {
    try {
        const token = localStorage.getItem("jwtToken");

        showNotification("✅ Đang tải file chứng chỉ...", "info");

        const res = await fetch(`${API_BASE}/api/certificates/export?format=${format}`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (!res.ok) throw new Error("Lỗi tải file");

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `certificates.${format}`;
        a.click();

        window.URL.revokeObjectURL(url);

        showNotification("✅ Tải file thành công!", "success");

    } catch (err) {
        showNotification("❌ Lỗi tải file: " + err.message, "error");
    }
}

function loadAllCertificates() {
    // ✅ Bây giờ chức năng đúng nghĩa: TẢI FILE EXPORT, không reload UI
    downloadAllCertificates();
}

function refreshStats() {
    fetchStats();
    loadAdminDashboard();
    loadRecentActivities();
    showNotification("🔄 Đã refresh dữ liệu!", "success");
}

// ✅ Load recent activities for Admin Dashboard
async function loadRecentActivities() {
    const container = document.getElementById("recent-actions");
    if (!container) return;

    container.innerHTML = "Đang tải...";

    try {
        const res = await fetch(`${API_BASE}/api/certificates`, {
            headers: {
                Authorization: "Bearer " + localStorage.getItem("jwtToken"),
            },
        });

        const data = await res.json();

        if (!data.certificates || data.certificates.length === 0) {
            container.innerHTML = "Chưa có hoạt động";
            return;
        }

        // ✅ Sắp xếp đúng theo thời gian mới nhất trước
        const recent = data.certificates
            .sort((a, b) => new Date(b.issuanceDate) - new Date(a.issuanceDate))
            .slice(0, 5);

        container.innerHTML = recent.map(c => {
            const s = c.credentialSubject || {};
            const isRevoked = c.status === 1;

            const icon = isRevoked ? "🚫" : "🎓";
            const color = isRevoked ? "text-red-400" : "text-green-400";
            const action = isRevoked ? "Đã thu hồi" : "Đã phát hành";

            const time = c.issuanceDate
                ? new Date(c.issuanceDate).toLocaleString("vi-VN")
                : "-";

            return `
            <div class="flex gap-3 items-start relative fade-in">

                <!-- timeline dot -->
                <div class="w-3 h-3 mt-2 rounded-full ${isRevoked ? "bg-red-500" : "bg-green-500"}"></div>

                <div class="flex-1 bg-white/5 p-3 rounded-lg border border-white/10 hover:border-blue-500/40 transition">

                    <div class="flex justify-between">
                        <p class="font-semibold text-white">
                            ${icon} ${s.name}
                        </p>
                        <span class="text-xs text-gray-500">${time}</span>
                    </div>

                    <p class="text-sm text-gray-400">${s.courseName}</p>

                    <p class="text-xs ${color} mt-1 font-medium">
                        ${action}
                    </p>

                </div>
            </div>
            `;
        }).join("");

    } catch (err) {
        console.error(err);
        container.innerHTML = "Lỗi load hoạt động";
    }
}

// 🔥 QUÉT QR TỪ ẢNH
function handleQRImage(file) {
    const img = new Image();

    img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        canvas.width = img.width;
        canvas.height = img.height;

        ctx.drawImage(img, 0, 0);

        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, canvas.width, canvas.height);

        if (code) {
            showNotification("📷 QR detected!", "success");

            let scannedData = code.data;

            // 🔥 FIX: Nếu là URL verify → auto extract hash
            if (scannedData.startsWith("http")) {
                try {
                    const url = new URL(scannedData);
                    let hash = url.searchParams.get("hash");

                    // ✅ fallback nếu nằm trong #verify
                    if (!hash && url.hash.includes("?")) {
                        const hashQuery = url.hash.split("?")[ 1 ];
                        const params = new URLSearchParams(hashQuery);
                        hash = params.get("hash");
                    }

                    scannedData = hash || scannedData;
                } catch (e) {
                    console.error("QR parse error:", e);
                }
            }

            // ✅ Validate hash format
            if (!/^[a-f0-9]{64}$/i.test(scannedData)) {
                showNotification("❌ Hash không hợp lệ (phải 64 ký tự hex)", "error");
                return;
            }

            verifyCertificate(scannedData);
        } else {
            showNotification("❌ Không đọc được QR", "error");
        }
    };

    img.src = URL.createObjectURL(file);
}

// ✅ Backward compatibility với HTML cũ
function uploadQRFileVerify(event) {
    if (!event || !event.target) {
        console.warn("No event passed to uploadQRFileVerify");
        return;
    }

    const file = event.target.files[ 0 ];
    if (file) handleQRImage(file);

    event.target.value = "";
}

// Load user khi trang mở
window.addEventListener("DOMContentLoaded", () => {
    // Khởi tạo handlers upload QR
    const dropzone = document.getElementById("qr-file-dropzone");
    const fileInput = document.getElementById("qr-file-verify");

    if (dropzone && fileInput) {
        // CLICK UPLOAD
        dropzone.addEventListener("click", () => {
            dropzone.focus();
            fileInput.click();
        });

        // FOCUS EFFECTS
        dropzone.addEventListener("focus", () => {
            dropzone.classList.add("ring-2", "ring-blue-500");
        });

        dropzone.addEventListener("blur", () => {
            dropzone.classList.remove("ring-2", "ring-blue-500");
        });

        fileInput.addEventListener("change", (e) => {
            const file = e.target.files[ 0 ];
            if (file) handleQRImage(file);
            fileInput.value = "";
        });

        // DRAG & DROP
        dropzone.addEventListener("dragover", (e) => {
            e.preventDefault();
            dropzone.classList.add("border-blue-500");
        });

        dropzone.addEventListener("dragleave", () => {
            dropzone.classList.remove("border-blue-500");
        });

        dropzone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropzone.classList.remove("border-blue-500");

            const file = e.dataTransfer.files[ 0 ];
            if (file) handleQRImage(file);
        });

        // CTRL + V PASTE
        dropzone.setAttribute("tabindex", "0");

        dropzone.addEventListener("paste", (event) => {
            const items = event.clipboardData.items;

            for (let item of items) {
                if (item.type.indexOf("image") !== -1) {
                    const file = item.getAsFile();
                    handleQRImage(file);
                }
            }
        });
    }

    // ✅ GLOBAL PASTE FALLBACK: Dù ở đâu cũng paste được ảnh QR
    document.addEventListener("paste", (event) => {
        const items = event.clipboardData.items;

        for (let item of items) {
            if (item.type.indexOf("image") !== -1) {
                const file = item.getAsFile();
                handleQRImage(file);
            }
        }
    });

    const savedUser = localStorage.getItem("currentUser");
    if (savedUser) {
        // Kiểm tra token còn hợp lệ không
        if (!localStorage.getItem("jwtToken")) {
            logout();
        } else {
            currentUser = JSON.parse(savedUser);
            updateUserUI();
            applyRoleRestrictions();
        }
    }

    syncProgress();

    // ✅ Auto refresh real-time mỗi 5 giây
    syncInterval = setInterval(() => {
        if (document.getElementById("adminPanel") && !document.getElementById("adminPanel").classList.contains("hidden")) {
            loadRecentActivities();
            fetchStats();
        }
    }, 5000);

    // 🔥 AUTO VERIFY TỪ QR (IMPROVED)
    window.addEventListener("load", () => {
        const hashStr = window.location.hash;

        if (hashStr.startsWith("#verify")) {
            showTab("verify"); // 👉 chuyển tab trước

            const query = hashStr.split("?")[ 1 ];
            if (!query) return;

            const params = new URLSearchParams(query);
            const certHash = params.get("hash");

            if (certHash && certHash.length >= 64) {
                console.log("QR Auto Verify:", certHash);

                // delay nhẹ cho UI load
                setTimeout(() => {
                    verifyCertificate(certHash);
                }, 300);
            }
        }
    });
});
