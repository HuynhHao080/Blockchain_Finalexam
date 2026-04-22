import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const CertificateVerifierModule = buildModule("CertificateVerifierModule", (m) => {
  const certificateVerifier = m.contract("CertificateVerifier");

  return { certificateVerifier };
});

export default CertificateVerifierModule;
