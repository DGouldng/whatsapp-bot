const { makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const fs = require("fs");

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth");
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        timeoutMs: 60000,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", ({ connection }) => {
        if (connection === "close") startBot();
    });

    // Load database (JSON file)
    const dbFile = "database.json";
    let db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile)) : { messages: [], users: {}, spamFilters: [] };

    // Define admin number
    const adminNumber = "2347040968349@s.whatsapp.net";

    // Store last message per chat
    let lastMessages = {};

    // ✅ Load muted users from file (Persistent Muting)
    const mutedUsersFile = "mutedUsers.json";
    let mutedUsers = new Set(fs.existsSync(mutedUsersFile) ? JSON.parse(fs.readFileSync(mutedUsersFile)) : []);

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderName = msg.pushName || sender.split("@")[0];

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        // ✅ Save last message before .tag
        if (text.toLowerCase() !== ".tag") {
            lastMessages[chatId] = text;
        }

        // ✅ Save messages to database
        db.messages.push({ sender, text, timestamp: Date.now() });
        fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

        // ✅ Check if user is muted
        if (mutedUsers.has(sender)) {
            console.log(`⛔ Muted user ${sender} sent a message, ignoring.`);
            return;
        }

        // ✅ Handle Greetings
        const greetings = ["hello", "hi", "hey"];
        if (greetings.includes(text.toLowerCase())) {
            await sock.sendMessage(chatId, { text: `Hi ${senderName}` });
            return;
        }

        // ✅ Auto-repeat last message with .tag
        if (text.toLowerCase() === ".tag") {
            if (!lastMessages[chatId]) {
                await sock.sendMessage(chatId, { text: "No previous message found." });
                return;
            }
            await sock.sendMessage(chatId, { text: lastMessages[chatId] });
            return;
        }

        // ✅ Unmute Command (Admin Only)
        if (text.toLowerCase().startsWith(".unmute")) {
            if (sender !== adminNumber) {
                await sock.sendMessage(chatId, { text: "❌ You don't have permission to unmute users!" });
                return;
            }

            const args = text.split(" ");
            if (args.length < 2) {
                await sock.sendMessage(chatId, { text: "❌ Please mention a user to unmute." });
                return;
            }

            const mentionedUser = msg.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || args[1] + "@s.whatsapp.net";

            if (mutedUsers.has(mentionedUser)) {
                mutedUsers.delete(mentionedUser);
                fs.writeFileSync(mutedUsersFile, JSON.stringify([...mutedUsers], null, 2));

                await sock.sendMessage(chatId, {
                    text: `✅ @${mentionedUser.split("@")[0]} has been unmuted.`,
                    mentions: [mentionedUser],
                });
            } else {
                await sock.sendMessage(chatId, {
                    text: `⚠️ @${mentionedUser.split("@")[0]} is not muted.`,
                    mentions: [mentionedUser],
                });
            }
            return;
        }

        // ✅ Custom spam filters
        if (text.toLowerCase().startsWith(".addspamfilter")) {
            await addSpamFilter(text, chatId, sender);
            return;
        }

        if (text.toLowerCase().startsWith(".removespamfilter")) {
            await removeSpamFilter(text, chatId, sender);
            return;
        }

        if (text.toLowerCase() === ".spamfilters") {
            await listSpamFilters(chatId);
            return;
        }

        // ✅ Detect Spam
        if (detectSpam(text, sender, chatId, senderName)) {
            return;
        }
    });

    /**
     * 🛑 Detect Spam Messages, Warn, and Auto-Mute 🛑
     */
    async function detectSpam(message, sender, chatId, senderName) {
        const spamKeywords = ["free money", "click this link", "lottery", "win big", "investment offer"];
        const customSpamFilters = db.spamFilters || [];

        if ([...spamKeywords, ...customSpamFilters].some(word => message.toLowerCase().includes(word))) {
            await handleSpam(sender, chatId, message, senderName);
            return true;
        }

        const linkRegex = /(https?:\/\/[^\s]+)/g;
        if (linkRegex.test(message)) {
            await handleSpam(sender, chatId, message, senderName);
            return true;
        }

        return false;
    }

    /**
     * 🚨 Handle Spam Warnings and Auto-Mute 🚨
     */
    async function handleSpam(sender, chatId, message, senderName) {
        if (!db.users[sender]) {
            db.users[sender] = { spamWarnings: 0 };
        }

        db.users[sender].spamWarnings += 1;
        fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

        const warnings = db.users[sender].spamWarnings;

        if (warnings >= 3) {
            await sock.sendMessage(chatId, { text: `⛔ ${senderName} has been muted for repeated spamming.` });

            // ✅ Add user to muted list
            mutedUsers.add(sender);
            fs.writeFileSync(mutedUsersFile, JSON.stringify([...mutedUsers], null, 2));
        }
    }

    console.log("🤖 Bot started!");
}

startBot();
