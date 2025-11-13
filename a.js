// ==============================================
//   B402 AUTO LOGIN + AUTO DRIP (40 payload)
//   2 Recipient (recipient #2 hanya 3 drip)
//   ethers v6 + axios + proxy rotation + rpc rotation
// ==============================================

import axios from "axios";
import { ethers } from "ethers";
import readline from "readline-sync";
import { HttpsProxyAgent } from "https-proxy-agent";

// ==============================================
// CONFIG (FIXED)
// ==============================================

const RPC_LIST = [
    "https://binance.llamarpc.com",
    "https://bsc-rpc.publicnode.com",
    "https://bsc-dataseed.binance.org"
];

const PROXY_LIST = [
    "http://b8bebba8ee5e73301530:a9c14805be2ba4c7@gw.dataimpulse.com:823",
    "http://0bd36c9bb0239c4cab11:5f59cf967bad6875@gw.dataimpulse.com:823",
    "http://a70599c5dadd22debef3:c8db94f7357ea15c@gw.dataimpulse.com:823",
    "http://6840d66c9a39176cd7d8:f59d61692a149d19@gw.dataimpulse.com:823"
];

const LID = "cdd479f9-5469-425e-ab0b-24b59e82d8fd";
const CLIENT_ID = "b402-s7chg25x";
const CONNECTOR = "com.okex.wallet";

const RECIPIENT_2 = "0x85Be45eD24FA9695Ff540d8A5ff9dF7b5781a528";
const MAX_DRIP_FOR_RECIPIENT2 = 3;

const TURNSTILE_SITEKEY = "0x4AAAAAAB5QdBYvpAN8f8ZI"; // dummy utk 2captcha (tidak dipakai real)
const CAPTCHA_KEY = "4ed3fd1e0fe1191d63576ec0cd12c3cb"; // 2captcha API key kamu

// ==============================================
// RANDOM HELPERS
// ==============================================

function rotateRpc() {
    return RPC_LIST[Math.floor(Math.random() * RPC_LIST.length)];
}

function rotateProxy() {
    const proxy = PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
    return HttpsProxyAgent(proxy);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ==============================================
// SOLVE TURNSTILE VIA 2CAPTCHA
// ==============================================

async function solveTurnstile() {
    console.log("🔄 Solve Turnstile via CapMonster...");

    // 1) Create task
    const create = await axios.post("https://api.capmonster.cloud/createTask", {
        clientKey: "9fc295a983d6447d74a88e515ba55cd5",
        task: {
            type: "TurnstileTaskProxyless",
            websiteURL: "https://www.b402.ai/experience-b402",
            websiteKey: "0x4AAAAAAB5QdBYvpAN8f8ZI"
        }
    });

    const taskId = create.data.taskId;
    console.log("📝 CapMonster Task ID:", taskId);

    // 2) Fetch result until ready
    while (true) {
        await new Promise(r => setTimeout(r, 3000));

        const res = await axios.post("https://api.capmonster.cloud/getTaskResult", {
            clientKey: "9fc295a983d6447d74a88e515ba55cd5",
            taskId
        });

        if (res.data.status === "ready") {
            console.log("✅ Captcha solved (CapMonster)!");
            return res.data.solution.token;
        }

        console.log("… waiting CapMonster result …");
    }
}

// ==============================================
// LOGIN — challenge → sign → verify → JWT
// ==============================================

async function login(wallet) {
    const address = wallet.address;
    const turnstileToken = await solveTurnstile();

    const challengePayload = {
        walletType: "evm",
        walletAddress: address,
        turnstileToken,
        lid: LID,
        clientId: CLIENT_ID
    };

    const challenge = await axios.post(
        "https://www.b402.ai/api/api/v1/auth/web3/challenge",
        challengePayload,
        { headers: { "Content-Type": "application/json" } }
    );

    const nonce = challenge.data.nonce;
    const message = challenge.data.message;

    console.log("🔐 Signing challenge nonce...");

    const signature = await wallet.signMessage(message);

    const verifyPayload = {
        walletType: "evm",
        walletAddress: address,
        signature,
        lid: LID,
        clientId: CLIENT_ID
    };

    const verify = await axios.post(
        "https://www.b402.ai/api/api/v1/auth/web3/verify",
        verifyPayload,
        { headers: { "Content-Type": "application/json" } }
    );

    console.log("🎉 Login success!");
    return verify.data.jwt;
}

// ==============================================
// BUILD EIP-712 PAYLOADS (40 base)
// ==============================================

async function buildPayloads(wallet, mainRecipient, recipient2) {
    const provider = new ethers.JsonRpcProvider(rotateRpc());
    const chainId = 56;

    const TOKEN = "0x55d398326f99059fF775485246999027B3197955"; // USDT
    const RELAYER = "0xE1Af7DaEa624bA3B5073f24A6Ea5531434D82d88";

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

    const now = Math.floor(Date.now() / 1000);
    const value = ethers.parseUnits("0.1", 18);

    let payloads = [];
    let idx = 1;

    for (let i = 0; i < 40; i++) {
        const nonce = ethers.hexlify(ethers.randomBytes(32));

        const message = {
            token: TOKEN,
            from: mainRecipient,
            to: mainRecipient,
            value,
            validAfter: 0,
            validBefore: now + 3600,
            nonce
        };

        const signature = await wallet.signTypedData(domain, types, message);

        // Recipient #1 (full 40)
        payloads.push({
            idx: idx++,
            recipient: mainRecipient,
            body: {
                recipientAddress: mainRecipient,
                paymentPayload: {
                    token: TOKEN,
                    payload: {
                        authorization: {
                            from: mainRecipient,
                            to: mainRecipient,
                            value: value.toString(),
                            validAfter: 0,
                            validBefore: now + 3600,
                            nonce
                        },
                        signature
                    }
                },
                paymentRequirements: {
                    network: "mainnet",
                    relayerContract: RELAYER
                }
            }
        });

        // Recipient #2 (only 3 allowed)
        payloads.push({
            idx: idx++,
            recipient: recipient2,
            body: {
                recipientAddress: recipient2,
                paymentPayload: {
                    token: TOKEN,
                    payload: {
                        authorization: {
                            from: mainRecipient,
                            to: mainRecipient,
                            value: value.toString(),
                            validAfter: 0,
                            validBefore: now + 3600,
                            nonce
                        },
                        signature
                    }
                },
                paymentRequirements: {
                    network: "mainnet",
                    relayerContract: RELAYER
                }
            }
        });
    }

    return payloads;
}

// ==============================================
// SEND DRIP (proxy rotation + 3 limit rule)
// ==============================================

async function sendDrip(jwt, payloads) {
    let dripCountRecipient2 = 0;

    for (const p of payloads) {

        // Rule: Recipient #2 max 3 drip
        if (p.recipient.toLowerCase() === RECIPIENT_2.toLowerCase()) {
            if (dripCountRecipient2 >= MAX_DRIP_FOR_RECIPIENT2) {
                console.log(`⏭ Skip payload #${p.idx} (recipient #2 limit reached)`);
                continue;
            }
            dripCountRecipient2++;
        }

        const proxy = rotateProxy();

        try {
            const res = await axios.post(
                "https://www.b402.ai/api/api/v1/faucet/drip",
                p.body,
                {
                    httpsAgent: proxy,
                    headers: {
                        "Authorization": `Bearer ${jwt}`,
                        "Content-Type": "application/json"
                    },
                    timeout: 20000
                }
            );

            console.log(`[#${p.idx}] → ${p.recipient} → Status: ${res.status}`);
        } catch (e) {
            console.log(`[#${p.idx}] ERROR:`, e.message);
        }
    }
}

// ==============================================
// MAIN
// ==============================================

(async () => {
    console.clear();
    console.log("=== B402 AUTO LOGIN + DRIP 40 PAYLOAD ===\n");

    const pk = readline.question("🔐 Masukkan PRIVATE KEY: ");
    const wallet = new ethers.Wallet(pk);

    const mainRecipient = wallet.address;

    console.log("👤 Wallet detected:", mainRecipient);

    console.log("\n🔄 Login ke B402...");
    const jwt = await login(wallet);

    console.log("\n🧱 Build payloads...");
    const payloads = await buildPayloads(wallet, mainRecipient, RECIPIENT_2);

    console.log(`📦 Total payload built: ${payloads.length}`);
    console.log(`⚠ Recipient #2 hanya akan dikirim 3 drip`);

    console.log("\n🚀 Sending Drip...");
    await sendDrip(jwt, payloads);

    console.log("\n🎉 DONE");
})();
