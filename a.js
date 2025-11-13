// =======================================================
//   B402 FINAL AUTO LOGIN + APPROVE + PARALLEL DRIP
//   Silent skip for recipient2 — NO console spam
//   CapMonster + Ethers v6 — Clean, Fast, No Proxy
// =======================================================

import axios from "axios";
import { ethers } from "ethers";
import readline from "readline-sync";

// ======== CONFIG ========
const RPC_LIST = [
    "https://binance.llamarpc.com",
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed.binance.org"
];

const TOKEN = "0x55d398326f99059fF775485246999027B3197955"; // USDT
const RELAYER = "0xE1Af7DaEa624bA3B5073f24A6Ea5531434D82d88"; // B402 Faucet

const LID = "cdd479f9-5469-425e-ab0b-24b59e82d8fd";
const CLIENT_ID = "b402-s7chg25x";

// recipient2 = cuma 3 drip, tapi silent skip
const RECIPIENT_2 = "0x85Be45eD24FA9695Ff540d8A5ff9dF7b5781a528";
const MAX_RECIPIENT2 = 3;

// capmonster
const CAP_KEY = "9fc295a983d6447d74a88e515ba55cd5";
const SITEKEY = "0x4AAAAAAB5QdBYvpAN8f8ZI";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const rpc = () => RPC_LIST[Math.floor(Math.random() * RPC_LIST.length)];


// =======================================================
//   CAPMONSTER → Solve Turnstile
// =======================================================
async function solveCaptcha() {
    console.log("🔄 Creating CapMonster Task...");

    const create = await axios.post("https://api.capmonster.cloud/createTask", {
        clientKey: CAP_KEY,
        task: {
            type: "TurnstileTaskProxyless",
            websiteURL: "https://www.b402.ai/experience-b402",
            websiteKey: SITEKEY
        }
    });

    const taskId = create.data.taskId;
    console.log("📝 TaskID:", taskId);

    while (true) {
        await sleep(2500);

        const res = await axios.post("https://api.capmonster.cloud/getTaskResult", {
            clientKey: CAP_KEY,
            taskId
        });

        if (res.data.status === "ready") {
            console.log("✅ Captcha solved!");
            return res.data.solution.token;
        }

        console.log("… waiting …");
    }
}


// =======================================================
//   LOGIN
// =======================================================
async function login(wallet) {
    const token = await solveCaptcha();

    const challengePayload = {
        walletType: "evm",
        walletAddress: wallet.address,
        turnstileToken: token,
        lid: LID,
        clientId: CLIENT_ID
    };

    const challenge = await axios.post(
        "https://www.b402.ai/api/api/v1/auth/web3/challenge",
        challengePayload
    );

    const message = challenge.data.message;

    console.log("🔐 Signing challenge nonce...");
    const signature = await wallet.signMessage(message);

    const verifyPayload = {
        walletType: "evm",
        walletAddress: wallet.address,
        signature,
        lid: LID,
        clientId: CLIENT_ID
    };

    const verify = await axios.post(
        "https://www.b402.ai/api/api/v1/auth/web3/verify",
        verifyPayload
    );

    console.log("🎉 Login success!");
    return verify.data.jwt;
}


// =======================================================
//   APPROVE USDT
// =======================================================
async function approveUSDT(wallet) {
    console.log("\n🟦 Approving USDT for B402...");

    const provider = new ethers.JsonRpcProvider(rpc());
    const token = new ethers.Contract(
        TOKEN,
        ["function approve(address,uint256) returns(bool)"],
        wallet.connect(provider)
    );

    try {
        const tx = await token.approve(RELAYER, ethers.MaxUint256);
        console.log("⏳ Approve TX:", tx.hash);
        await tx.wait();
        console.log("✅ Approve confirmed!");
    } catch (err) {
        console.log("⚠ Approve error:", err.message);
    }
}


// =======================================================
//   BUILD PAYLOADS (40 base → 80)
// =======================================================
async function buildPayloads(wallet, self, rec2) {
    const chainId = 56;
    const now = Math.floor(Date.now() / 1000);
    const value = ethers.parseUnits("0.1", 18);

    const domain = {
        name: "B402",
        version: "1",
        chainId,
        verifyingContract: RELAYER
    };

    const types = {
        TransferWithAuthorization: [
            { name: "token", type: "address" },
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" }
        ]
    };

    let arr = [];
    let idx = 1;

    for (let i = 0; i < 40; i++) {

        const nonce = ethers.hexlify(ethers.randomBytes(32));

        // untuk signing
        const signMsg = {
            token: TOKEN,
            from: self,
            to: self,
            value,
            validAfter: 0,
            validBefore: now + 3600,
            nonce
        };

        // untuk payload API (tanpa BigInt)
        const safeMsg = {
            token: TOKEN,
            from: self,
            to: self,
            value: value.toString(),
            validAfter: Number(0),
            validBefore: Number(now + 3600),
            nonce
        };

        const signature = await wallet.signTypedData(domain, types, signMsg);

        // recipient #1
        arr.push({
            idx: idx++,
            recipient: self,
            body: {
                recipientAddress: self,
                paymentPayload: {
                    token: TOKEN,
                    payload: { authorization: safeMsg, signature }
                },
                paymentRequirements: {
                    network: "mainnet",
                    relayerContract: RELAYER
                }
            }
        });

        // recipient #2
        arr.push({
            idx: idx++,
            recipient: rec2,
            body: {
                recipientAddress: rec2,
                paymentPayload: {
                    token: TOKEN,
                    payload: { authorization: safeMsg, signature }
                },
                paymentRequirements: {
                    network: "mainnet",
                    relayerContract: RELAYER
                }
            }
        });

    }

    return arr;
}


// =======================================================
//   PARALLEL DRIP — silent skip for recipient2
// =======================================================
async function sendDrip(jwt, payloads) {
    let drip2 = 0;

    const jobs = payloads.map(async (p) => {

        // handle limit untuk recipient2 (silent)
        if (p.recipient.toLowerCase() === RECIPIENT_2.toLowerCase()) {
            if (drip2 >= MAX_RECIPIENT2) return;
            drip2++;
        }

        try {
            const res = await axios.post(
                "https://www.b402.ai/api/api/v1/faucet/drip",
                p.body,
                {
                    headers: {
                        Authorization: `Bearer ${jwt}`,
                        "Content-Type": "application/json"
                    }
                }
            );

            console.log(`[#${p.idx}] → ${p.recipient} → ${res.status}`);

        } catch (err) {
            console.log(`[#${p.idx}] ERROR →`, err.response?.status || err.message);
        }

    });

    await Promise.all(jobs);
}


// =======================================================
//   MAIN
// =======================================================
(async () => {
    console.clear();
    console.log("=== B402 AUTO LOGIN + APPROVE + DRIP (FINAL) ===\n");

    const pk = readline.question("🔐 Private Key: ");
    const wallet = new ethers.Wallet(pk);

    console.log("👤 Wallet:", wallet.address);

    console.log("\n🔄 Login...");
    const jwt = await login(wallet);

    console.log("\n🟦 Approving token...");
    await approveUSDT(wallet);

    console.log("\n🧱 Building payloads...");
    const payloads = await buildPayloads(wallet, wallet.address, RECIPIENT_2);

    console.log(`📦 Payloads total: ${payloads.length}`);
    console.log(`⚠ Recipient #2 drip limit = ${MAX_RECIPIENT2} (silent skip)`);

    console.log("\n🚀 Sending DRIP BARANGAN...");
    await sendDrip(jwt, payloads);

    console.log("\n🎉 DONE!");
})();
