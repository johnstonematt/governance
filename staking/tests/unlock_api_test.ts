import {
  ANCHOR_CONFIG_PATH,
  getPortNumber,
  readAnchorConfig,
  standardSetup,
} from "./utils/before";
import path from "path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { StakeConnection } from "../app";
import assert from "assert";
import { BN } from "@project-serum/anchor";
import { assertBalanceMatches, loadAndUnlock } from "./utils/api_utils";

const portNumber = getPortNumber(path.basename(__filename));

describe("unlock_api", async () => {
  const pythMintAccount = new Keypair();
  const pythMintAuthority = new Keypair();
  let EPOCH_DURATION: BN;

  let stakeConnection: StakeConnection;
  let controller: AbortController;

  let stakeAccountAddress;

  let owner: PublicKey;

  before(async () => {
    const config = readAnchorConfig(ANCHOR_CONFIG_PATH);
    ({ controller, stakeConnection } = await standardSetup(
      portNumber,
      config,
      pythMintAccount,
      pythMintAuthority
    ));

    EPOCH_DURATION = stakeConnection.config.epochDuration;
    owner = stakeConnection.program.provider.wallet.publicKey;
  });

  it("deposit, lock, unlock, same epoch", async () => {
    await stakeConnection.depositAndLockTokens(undefined, new BN(100));

    const res = await stakeConnection.getStakeAccounts(owner);
    assert.equal(res.length, 1);
    stakeAccountAddress = res[0].address;

    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked: {locking: new BN(100)} },
      await stakeConnection.getTime()
    );

    await loadAndUnlock(stakeConnection, owner, new BN(50));

    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked: {locking: new BN(50)}, withdrawable: new BN(50) },
      await stakeConnection.getTime()
    );

    await stakeConnection.program.methods
      .advanceClock(EPOCH_DURATION.mul(new BN(3)))
      .rpc();

    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked:{ locked: new BN(50)}, withdrawable: new BN(50) },
      await stakeConnection.getTime()
    );
  });

  it("deposit more, unlock first unlocks oldest position (FIFO)", async () => {
    const res = await stakeConnection.getStakeAccounts(owner);
    assert.equal(res.length, 1);

    await stakeConnection.depositAndLockTokens(res[0], new BN(100));

    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked: {locking: new BN(100), locked: new BN(50)}, withdrawable: new BN(50) },
      await stakeConnection.getTime()
    );

    await loadAndUnlock(stakeConnection, owner, new BN(50));

    // The tokens remain locked until the end of the epoch
    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked: {locking: new BN(100), locked: new BN(50)}, withdrawable: new BN(50) },
      await stakeConnection.getTime()
    );
    // That means that unlocking again is a no-op for that position
    // TODO: This seems very strange. Change this.
    await loadAndUnlock(stakeConnection, owner, new BN(100));

    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked: {locking: new BN(50), locked: new BN(50)}, withdrawable: new BN(100) },
      await stakeConnection.getTime()
    );
  });

  it("time passes, first position becomes unlocked, now unlock targets second position", async () => {
    await stakeConnection.program.methods
    .advanceClock(EPOCH_DURATION.mul(new BN(1)))
    .rpc();

    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked: {locked: new BN(50), unlocking: new BN(50)}, withdrawable: new BN(100) },
      await stakeConnection.getTime()
    );

    await stakeConnection.program.methods
      .advanceClock(EPOCH_DURATION.mul(new BN(3)))
      .rpc();

    await assertBalanceMatches(
      stakeConnection,
      owner,
      { locked:{locked: new BN(50)}, withdrawable: new BN(150) },
      await stakeConnection.getTime()
    );

    await loadAndUnlock(stakeConnection, owner, new BN(50));

    await assertBalanceMatches(
        stakeConnection,
        owner,
        { locked: {locked: new BN(50)}, withdrawable: new BN(150)},
        await stakeConnection.getTime()
      );

  });

  it("time passes, all is withdrawable now", async () => {
    await stakeConnection.program.methods
      .advanceClock(EPOCH_DURATION.mul(new BN(3)))
      .rpc();

    await assertBalanceMatches(
        stakeConnection,
        owner,
        { withdrawable: new BN(200) },
        await stakeConnection.getTime()
      );

  });


  after(async () => {
    controller.abort();
  });
});