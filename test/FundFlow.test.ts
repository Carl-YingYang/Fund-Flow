import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";

describe("FundFlow", function () {
  let fundFlow: Contract;
  let admin: any;
  let member: any;
  let treasurer: any;
  let adviser: any;
  let recipient: any;

  const oneEth = ethers.parseEther("1");

  beforeEach(async function () {
    [admin, member, treasurer, adviser, recipient] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("FundFlow", admin);
    fundFlow = await factory.deploy();
    await fundFlow.waitForDeployment();
    await fundFlow.addMember("Demo Member", member.address, 1);
    await fundFlow.addMember("Demo Treasurer", treasurer.address, 2);
    await fundFlow.addMember("Demo Adviser", adviser.address, 3);
  });

  it("registers the deployer as the only contract admin", async function () {
    expect(await fundFlow.admin()).to.equal(admin.address);
    expect(await fundFlow.memberCount()).to.equal(4n);
    expect((await fundFlow.getMember(admin.address)).role).to.equal(4n);
  });

  it("prevents a non-admin from registering a member", async function () {
    await expect(fundFlow.connect(member).addMember("Intruder", recipient.address, 1))
      .to.be.revertedWith("Only admin can perform this action");
  });

  it("prevents another member from being assigned the Admin role", async function () {
    await expect(fundFlow.addMember("Pretend Admin", recipient.address, 4))
      .to.be.revertedWith("Invalid member role");
  });

  it("requires a Treasurer and Adviser for a large request before release", async function () {
    await admin.sendTransaction({ to: await fundFlow.getAddress(), value: ethers.parseEther("5") });
    await fundFlow.connect(member).createFundRequest(
      recipient.address, ethers.parseEther("1.5"), "Large equipment", "Equipment"
    );

    expect((await fundFlow.getFundRequest(1)).status).to.equal(0n);
    await fundFlow.connect(treasurer).approveAsTreasurer(1);
    expect((await fundFlow.getFundRequest(1)).status).to.equal(1n);
    await expect(fundFlow.connect(treasurer).releaseFunds(1)).to.be.revertedWith("Request is not approved");

    await fundFlow.connect(adviser).approveAsAdviser(1);
    expect((await fundFlow.getFundRequest(1)).status).to.equal(2n);
    await fundFlow.connect(treasurer).releaseFunds(1);
    const request = await fundFlow.getFundRequest(1);
    expect(request.status).to.equal(4n);
    expect(request.releasedAt).to.be.greaterThan(0n);
  });

  it("allows a Treasurer to approve and release a small request", async function () {
    await admin.sendTransaction({ to: await fundFlow.getAddress(), value: ethers.parseEther("2") });
    await fundFlow.connect(member).createFundRequest(
      recipient.address, ethers.parseEther("0.25"), "Stationery", "Supplies"
    );
    await fundFlow.connect(treasurer).approveAsTreasurer(1);
    expect((await fundFlow.getFundRequest(1)).status).to.equal(2n);
    await fundFlow.connect(treasurer).releaseFunds(1);
    expect((await fundFlow.getFundRequest(1)).status).to.equal(4n);
  });

  it("records rejection reasons and allows the requester to cancel a pending request", async function () {
    await fundFlow.connect(member).createFundRequest(recipient.address, oneEth / 10n, "Taxi", "Transport");
    await fundFlow.connect(treasurer).rejectRequest(1, "Outside approved budget");
    expect((await fundFlow.getFundRequest(1)).status).to.equal(3n);
    expect((await fundFlow.getFundRequest(1)).rejectionReason).to.equal("Outside approved budget");

    await fundFlow.connect(member).createFundRequest(recipient.address, oneEth / 10n, "Duplicate", "Other");
    await fundFlow.connect(member).cancelRequest(2);
    expect((await fundFlow.getFundRequest(2)).status).to.equal(5n);
  });

  it("rejects writes from inactive members", async function () {
    await fundFlow.setMemberStatus(member.address, false);
    await expect(fundFlow.connect(member).createFundRequest(recipient.address, oneEth / 10n, "Taxi", "Transport"))
      .to.be.revertedWith("Account is inactive");
  });
});
