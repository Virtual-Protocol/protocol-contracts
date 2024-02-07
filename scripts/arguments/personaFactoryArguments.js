module.exports = [
  process.env.VIRTUAL_TOKEN_IMPL,
  process.env.VIRTUAL_DAO_IMPL,
  process.env.TBA,
  process.env.ASSET_TOKEN,
  process.env.VIRTUAL_NFT,
  process.env.PROTOCOL_DAO,
  ethers.parseEther(process.env.VIRTUAL_PROPOSAL_THRESHOLD),
  process.env.MATURITY_DURATION,
];
