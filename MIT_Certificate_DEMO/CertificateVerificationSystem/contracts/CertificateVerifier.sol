// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CertificateVerifier
 * @notice Hệ thống xác minh chứng chỉ trên Blockchain (tương tự Blockcerts MIT)
 * @dev Quản lý việc phát hành, thu hồi và xác minh tính xác thực của chứng chỉ thông qua hàm băm.
 */
contract CertificateVerifier {
    // ==================== ENUMS ====================

    /// @dev Trạng thái của chứng chỉ
    enum CertificateStatus {
        Issued, // Đã phát hành
        Revoked, // Đã thu hồi
        NotFound // Không tồn tại trong hệ thống
    }

    // ==================== STRUCTS ====================

    /// @dev Thông tin về tổ chức phát hành chứng chỉ
    struct Issuer {
        address account; // Địa chỉ ví của tổ chức phát hành
        string name; // Tên của tổ chức
        bool isActive; // Trạng thái hoạt động (đã đăng ký/hủy đăng ký)
    }

    /// @dev Thông tin chi tiết của một chứng chỉ được lưu trên blockchain
    struct CertificateInfo {
        bytes32 certificateHash; // Hàm băm duy nhất của nội dung chứng chỉ (e.g., SHA256 của file PDF/JSON)
        address issuerAddress; // Địa chỉ của tổ chức đã phát hành chứng chỉ này
        uint256 issueTimestamp; // Thời điểm chứng chỉ được phát hành (Unix timestamp)
        CertificateStatus status; // Trạng thái hiện tại của chứng chỉ
    }

    // ==================== STATE VARIABLES ====================

    address public admin; // Địa chỉ của quản trị viên hệ thống

    // Lưu trữ thông tin các tổ chức phát hành theo địa chỉ
    mapping(address => Issuer) public issuers;

    // Lưu trữ thông tin chứng chỉ theo hàm băm của chúng
    mapping(bytes32 => CertificateInfo) public certificates;

    // ==================== EVENTS ====================

    /// @dev Sự kiện khi một tổ chức phát hành được đăng ký
    /// @param account Địa chỉ của tổ chức
    /// @param name Tên của tổ chức
    event IssuerRegistered(address indexed account, string name);

    /// @dev Sự kiện khi một tổ chức phát hành bị hủy đăng ký
    /// @param account Địa chỉ của tổ chức
    event IssuerUnregistered(address indexed account);

    /// @dev Sự kiện khi một chứng chỉ được phát hành
    /// @param certificateHash Hàm băm của chứng chỉ
    /// @param issuer Địa chỉ của tổ chức phát hành
    /// @param timestamp Thời điểm phát hành
    event CertificateIssued(
        bytes32 indexed certificateHash,
        address indexed issuer,
        uint256 timestamp
    );

    /// @dev Sự kiện khi một chứng chỉ bị thu hồi
    /// @param certificateHash Hàm băm của chứng chỉ
    /// @param issuer Địa chỉ của tổ chức đã thu hồi
    /// @param timestamp Thời điểm thu hồi
    event CertificateRevoked(
        bytes32 indexed certificateHash,
        address indexed issuer,
        uint256 timestamp
    );

    /// @dev Sự kiện debug (optional)
    event Debug(address sender);

    /// @dev Modifier chỉ cho phép Admin thực hiện chức năng
    modifier onlyAdmin() {
        require(msg.sender == admin, "Chi Admin moi co quyen");
        _;
    }

    /// @dev Modifier chỉ cho phép các tài khoản đã đăng ký và đang hoạt động làm Issuer thực hiện chức năng
    modifier onlyIssuer() {
        require(
            issuers[msg.sender].isActive,
            "Ban khong phai Issuer hoac Issuer da bi vo hieu hoa"
        );
        _;
    }

    /// @dev Modifier đảm bảo chứng chỉ tồn tại trong hệ thống
    /// @param _certificateHash Hàm băm của chứng chỉ cần kiểm tra
    modifier certificateExists(bytes32 _certificateHash) {
        require(
            certificates[_certificateHash].issuerAddress != address(0),
            "Chung chi khong ton tai"
        );
        _;
    }

    // ==================== CONSTRUCTOR ====================

    /**
     * @dev Constructor khởi tạo hợp đồng, thiết lập người triển khai làm Admin.
     * Admin cũng tự động được đăng ký làm một Issuer hoạt động để tiện cho việc test hoặc phát hành ban đầu.
     */
    constructor() {
        admin = msg.sender;
        issuers[admin] = Issuer({
            account: admin,
            name: "Admin Issuer", // Admin có thể là một Issuer mặc định
            isActive: true
        });
        emit IssuerRegistered(admin, "Admin Issuer");
    }

    // ==================== ADMIN FUNCTIONS ====================

    /**
     * @dev Đăng ký một tổ chức phát hành chứng chỉ mới.
     * Chỉ Admin mới có thể thực hiện.
     * @param _issuerAddress Địa chỉ ví của tổ chức phát hành.
     * @param _name Tên của tổ chức phát hành.
     */
    function registerIssuer(
        address _issuerAddress,
        string memory _name
    ) public onlyAdmin {
        require(_issuerAddress != address(0), "Dia chi Issuer khong hop le");
        require(
            !issuers[_issuerAddress].isActive,
            "Issuer nay da ton tai hoac chua bi vo hieu hoa"
        );

        issuers[_issuerAddress] = Issuer({
            account: _issuerAddress,
            name: _name,
            isActive: true
        });
        emit IssuerRegistered(_issuerAddress, _name);
    }

    /**
     * @dev Hủy đăng ký (vô hiệu hóa) một tổ chức phát hành.
     * Tổ chức này sẽ không thể phát hành hay thu hồi chứng chỉ nữa.
     * Chỉ Admin mới có thể thực hiện.
     * @param _issuerAddress Địa chỉ ví của tổ chức phát hành cần hủy đăng ký.
     */
    function unregisterIssuer(address _issuerAddress) public onlyAdmin {
        require(
            issuers[_issuerAddress].isActive,
            "Issuer nay khong ton tai hoac da bi vo hieu hoa"
        );
        require(_issuerAddress != admin, "Khong the vo hieu hoa Admin"); // Không cho phép vô hiệu hóa Admin

        issuers[_issuerAddress].isActive = false;
        emit IssuerUnregistered(_issuerAddress);
    }

    /**
     * @dev Lấy thông tin chi tiết của một tổ chức phát hành.
     * @param _issuerAddress Địa chỉ ví của tổ chức phát hành.
     * @return name Tên của tổ chức.
     * @return isActive Trạng thái hoạt động của tổ chức.
     */
    function getIssuer(
        address _issuerAddress
    ) public view returns (string memory name, bool isActive) {
        Issuer memory issuer = issuers[_issuerAddress];
        return (issuer.name, issuer.isActive);
    }

    // ==================== ISSUER FUNCTIONS ====================

    /**
     * @dev Phát hành một chứng chỉ mới bằng cách lưu hàm băm của nó.
     * Chỉ các Issuer đã đăng ký và hoạt động mới có thể thực hiện.
     * @param _certificateHash Hàm băm (bytes32) của nội dung chứng chỉ.
     */
    function issueCertificate(bytes32 _certificateHash) public onlyIssuer {
        require(_certificateHash != bytes32(0), "Invalid hash");
        emit Debug(msg.sender);
        require(
            certificates[_certificateHash].issuerAddress == address(0),
            "Chung chi nay da duoc phat hanh"
        );

        certificates[_certificateHash] = CertificateInfo({
            certificateHash: _certificateHash,
            issuerAddress: msg.sender,
            issueTimestamp: block.timestamp,
            status: CertificateStatus.Issued
        });
        emit CertificateIssued(_certificateHash, msg.sender, block.timestamp);
    }

    /**
     * @dev Thu hồi một chứng chỉ đã được phát hành.
     * Chỉ Issuer đã phát hành chứng chỉ đó mới có thể thu hồi.
     * @param _certificateHash Hàm băm của chứng chỉ cần thu hồi.
     */
    function revokeCertificate(
        bytes32 _certificateHash
    ) public onlyIssuer certificateExists(_certificateHash) {
        require(_certificateHash != bytes32(0), "Invalid hash");
        emit Debug(msg.sender);
        CertificateInfo storage cert = certificates[_certificateHash];

        require(
            cert.issuerAddress == msg.sender,
            "Ban khong phai Issuer cua chung chi nay"
        );
        require(
            cert.status == CertificateStatus.Issued,
            "Chung chi chua duoc phat hanh hoac da bi thu hoi"
        );

        cert.status = CertificateStatus.Revoked;
        emit CertificateRevoked(_certificateHash, msg.sender, block.timestamp);
    }

    // ==================== VERIFICATION (PUBLIC VIEW) FUNCTIONS ====================

    /**
     * @dev Lấy trạng thái hiện tại của một chứng chỉ.
     * @param _certificateHash Hàm băm của chứng chỉ.
     * @return status Trạng thái của chứng chỉ (Issued hoặc Revoked).
     */
    function getCertificateStatus(
        bytes32 _certificateHash
    ) public view returns (CertificateStatus status) {
        require(
            certificates[_certificateHash].issuerAddress != address(0),
            "Chung chi khong ton tai"
        );
        return certificates[_certificateHash].status;
    }

    /**
     * @dev Lấy toàn bộ thông tin chi tiết của một chứng chỉ.
     * @param _certificateHash Hàm băm của chứng chỉ.
     * @return issuerAddress Địa chỉ của tổ chức phát hành.
     * @return issueTimestamp Thời điểm phát hành.
     * @return status Trạng thái của chứng chỉ.
     */
    function getCertificateDetails(
        bytes32 _certificateHash
    )
        public
        view
        certificateExists(_certificateHash)
        returns (
            address issuerAddress,
            uint256 issueTimestamp,
            CertificateStatus status
        )
    {
        CertificateInfo storage cert = certificates[_certificateHash];
        return (cert.issuerAddress, cert.issueTimestamp, cert.status);
    }

    /**
     * @dev Kiểm tra xem một chứng chỉ có hợp lệ hay không (đã được phát hành và chưa bị thu hồi).
     * @param _certificateHash Hàm băm của chứng chỉ.
     * @return bool True nếu chứng chỉ hợp lệ, False nếu không.
     */
    function isCertificateValid(
        bytes32 _certificateHash
    ) public view returns (bool) {
        // Kiểm tra xem chứng chỉ có tồn tại và đang ở trạng thái Issued không
        return
            certificates[_certificateHash].issuerAddress != address(0) &&
            certificates[_certificateHash].status == CertificateStatus.Issued;
    }
}
