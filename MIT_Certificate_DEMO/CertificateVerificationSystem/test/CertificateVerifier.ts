import { expect } from "chai";
import { network } from "hardhat";

let ethers: any;

describe("CertificateVerifier", function () {
  let certificateVerifier: any;
  let admin: any; // Signer for admin
  let issuer1: any; // Signer for issuer1
  let issuer2: any; // Signer for issuer2
  let addr1: any; // Other address

  let CERT_HASH_1: string;
  let CERT_HASH_2: string;
  let CERT_HASH_NON_EXISTENT: string;

  beforeEach(async function () {
    const connection = await network.getOrCreate();
    // @ts-ignore
    ethers = connection.ethers;

    [admin, issuer1, issuer2, addr1] = await ethers.getSigners();

    CERT_HASH_1 = ethers.encodeBytes32String("CERT_HASH_1"); // Example hash
    CERT_HASH_2 = ethers.encodeBytes32String("CERT_HASH_2"); // Example hash
    CERT_HASH_NON_EXISTENT = ethers.encodeBytes32String("NON_EXISTENT");

    const CertificateVerifierFactory = await ethers.getContractFactory(
      "CertificateVerifier",
    );
    certificateVerifier = await CertificateVerifierFactory.deploy();
    await certificateVerifier.waitForDeployment();

    // Admin is automatically registered as an issuer in the constructor
    // Register issuer1
    await certificateVerifier
      .connect(admin)
      .registerIssuer(issuer1.address, "Issuer One");
  });

  describe("Deployment", function () {
    it("Should set the right admin", async function () {
      expect(await certificateVerifier.admin()).to.equal(admin.address);
    });

    it("Admin should be an active issuer", async function () {
      const [name, isActive] = await certificateVerifier.getIssuer(
        admin.address,
      );
      expect(name).to.equal("Admin Issuer");
      expect(isActive).to.be.true;
    });
  });

  describe("Admin Functions", function () {
    it("Should allow admin to register a new issuer", async function () {
      await expect(
        certificateVerifier
          .connect(admin)
          .registerIssuer(issuer2.address, "Issuer Two"),
      )
        .to.emit(certificateVerifier, "IssuerRegistered")
        .withArgs(issuer2.address, "Issuer Two");

      const [name, isActive] = await certificateVerifier.getIssuer(
        issuer2.address,
      );
      expect(name).to.equal("Issuer Two");
      expect(isActive).to.be.true;
    });

    it("Should not allow non-admin to register an issuer", async function () {
      await expect(
        certificateVerifier
          .connect(issuer1)
          .registerIssuer(addr1.address, "New Issuer"),
      ).to.be.revertedWith("Chi Admin moi co quyen");
    });

    it("Should not allow registering an already active issuer", async function () {
      await expect(
        certificateVerifier
          .connect(admin)
          .registerIssuer(issuer1.address, "Issuer One Duplicate"),
      ).to.be.revertedWith("Issuer nay da ton tai hoac chua bi vo hieu hoa");
    });

    it("Should allow admin to unregister an issuer", async function () {
      await expect(
        certificateVerifier.connect(admin).unregisterIssuer(issuer1.address),
      )
        .to.emit(certificateVerifier, "IssuerUnregistered")
        .withArgs(issuer1.address);

      const [name, isActive] = await certificateVerifier.getIssuer(
        issuer1.address,
      );
      expect(isActive).to.be.false;
    });

    it("Should not allow unregistering a non-existent or inactive issuer", async function () {
      await expect(
        certificateVerifier.connect(admin).unregisterIssuer(addr1.address),
      ).to.be.revertedWith("Issuer nay khong ton tai hoac da bi vo hieu hoa");
    });

    it("Should not allow unregistering the admin", async function () {
      await expect(
        certificateVerifier.connect(admin).unregisterIssuer(admin.address),
      ).to.be.revertedWith("Khong the vo hieu hoa Admin");
    });
  });

  describe("Issuer Functions", function () {
    it("Should allow an active issuer to issue a certificate", async function () {
      await expect(
        certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_1),
      ).to.emit(certificateVerifier, "CertificateIssued");

      const [issuerAddr, issueTimestamp, status] =
        await certificateVerifier.getCertificateDetails(CERT_HASH_1);
      expect(issuerAddr).to.equal(issuer1.address);
      expect(status).to.equal(0); // Issued = 0
    });

    it("Should not allow a non-issuer to issue a certificate", async function () {
      await expect(
        certificateVerifier.connect(addr1).issueCertificate(CERT_HASH_1),
      ).to.be.revertedWith(
        "Ban khong phai Issuer hoac Issuer da bi vo hieu hoa",
      );
    });

    it("Should not allow an inactive issuer to issue a certificate", async function () {
      await certificateVerifier
        .connect(admin)
        .unregisterIssuer(issuer1.address);
      await expect(
        certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_2),
      ).to.be.revertedWith(
        "Ban khong phai Issuer hoac Issuer da bi vo hieu hoa",
      );
    });

    it("Should not allow issuing an already issued certificate", async function () {
      await certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_1);
      await expect(
        certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_1),
      ).to.be.revertedWith("Chung chi nay da duoc phat hanh");
    });

    it("Should allow an issuer to revoke their own certificate", async function () {
      await certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_1);
      await expect(
        certificateVerifier.connect(issuer1).revokeCertificate(CERT_HASH_1),
      ).to.emit(certificateVerifier, "CertificateRevoked");

      const [issuerAddr, issueTimestamp, status] =
        await certificateVerifier.getCertificateDetails(CERT_HASH_1);
      expect(status).to.equal(1); // Revoked = 1
    });

    it("Should not allow revoking a non-existent certificate", async function () {
      await expect(
        certificateVerifier
          .connect(issuer1)
          .revokeCertificate(CERT_HASH_NON_EXISTENT),
      ).to.be.revertedWith("Chung chi khong ton tai");
    });

    it("Should not allow revoking a certificate by a different issuer", async function () {
      await certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_1);
      await expect(
        certificateVerifier.connect(admin).revokeCertificate(CERT_HASH_1),
      ) // Admin is also an issuer, but not the original issuer of CERT_HASH_1
        .to.be.revertedWith("Ban khong phai Issuer cua chung chi nay");
    });

    it("Should not allow revoking an already revoked certificate", async function () {
      await certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_1);
      await certificateVerifier.connect(issuer1).revokeCertificate(CERT_HASH_1);
      await expect(
        certificateVerifier.connect(issuer1).revokeCertificate(CERT_HASH_1),
      ).to.be.revertedWith("Chung chi chua duoc phat hanh hoac da bi thu hoi");
    });
  });

  describe("Verification Functions", function () {
    beforeEach(async function () {
      // Issuer1 issues a certificate
      await certificateVerifier.connect(issuer1).issueCertificate(CERT_HASH_1);
    });

    it("Should return Issued status for an issued certificate", async function () {
      expect(
        await certificateVerifier.getCertificateStatus(CERT_HASH_1),
      ).to.equal(0); // Issued
    });

    it("Should return Revoked status for a revoked certificate", async function () {
      await certificateVerifier.connect(issuer1).revokeCertificate(CERT_HASH_1);
      expect(
        await certificateVerifier.getCertificateStatus(CERT_HASH_1),
      ).to.equal(1); // Revoked
    });

    it("Should revert when getting status for a non-existent certificate", async function () {
      await expect(
        certificateVerifier.getCertificateStatus(CERT_HASH_NON_EXISTENT),
      ).to.be.revertedWith("Chung chi khong ton tai");
    });

    it("Should return true for a valid certificate", async function () {
      expect(await certificateVerifier.isCertificateValid(CERT_HASH_1)).to.be
        .true;
    });

    it("Should return false for a revoked certificate", async function () {
      await certificateVerifier.connect(issuer1).revokeCertificate(CERT_HASH_1);
      expect(await certificateVerifier.isCertificateValid(CERT_HASH_1)).to.be
        .false;
    });

    it("Should return false for a non-existent certificate", async function () {
      expect(
        await certificateVerifier.isCertificateValid(CERT_HASH_NON_EXISTENT),
      ).to.be.false;
    });
  });
});
