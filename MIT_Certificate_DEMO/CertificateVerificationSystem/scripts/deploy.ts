import hre from "hardhat";

async function main() {
  console.log("🚀 Đang deploy CertificateVerifier smart contract...");

  // ✅ Hardhat 3 chuẩn: lấy ethers từ network
  const connection = await hre.network.connect();
  const ethers = connection.ethers;

  // ✅ Log thông tin deploy
  const [deployer] = await ethers.getSigners();
  console.log("👛 Deployer:", deployer.address);

  const CertificateVerifier = await ethers.getContractFactory(
    "CertificateVerifier",
  );
  const certificateVerifier = await CertificateVerifier.deploy();

  await certificateVerifier.waitForDeployment();

  const contractAddress = await certificateVerifier.getAddress();

  console.log(`✅ Smart Contract đã deploy thành công tại:`);
  console.log(`📜 Địa chỉ: ${contractAddress}`);
  console.log(
    `\n⚠️  Hãy copy địa chỉ này vào file .env với key CONTRACT_ADDRESS`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
