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
    let db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile)) : { messages: [], users: {} };

    // Define the admin number (replace with actual admin's number)
    const adminNumber = "admin_number@s.whatsapp.net";

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const sender = msg.key.participant || msg.key.remoteJid;
        const senderName = msg.pushName || sender.split("@")[0];

        // ✅ Save messages to database
        db.messages.push({ sender, text, timestamp: Date.now() });
        fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

        // ✅ Check for greetings and reply
        const greetings = ["hello", "hi", "hey"];
        if (greetings.includes(text.toLowerCase())) {
            await sock.sendMessage(chatId, {
                text: `Hi @${sender.split("@")[0]}`,
                mentions: [sender],
            });
            return;
        }

        // ✅ Spam detection system
        if (detectSpam(text, sender)) {
            await sock.sendMessage(chatId, {
                text: `⚠️ Warning @${sender.split("@")[0]}, your message looks like spam!`,
                mentions: [sender],
            });

            // Notify admin
            await sock.sendMessage(adminNumber, {
                text: `🚨 *Spam Alert!* 🚨\n\nSender: @${sender.split("@")[0]}\nMessage: "${text}"`,
                mentions: [sender],
            });

            return;
        }

        // ✅ Auto-tag everyone (admin-only)
        if (text.toLowerCase() === ".tag") {
            const groupMeta = await sock.groupMetadata(chatId);
            const participants = groupMeta.participants;
            const admins = participants.filter(p => p.admin).map(p => p.id);

            if (!admins.includes(sender)) {
                await sock.sendMessage(chatId, { text: "❌ Only admins can use this command!" });
                return;
            }

            const mentions = participants.map(p => p.id);
            await sock.sendMessage(chatId, { text: `@${sender.split("@")[0]} tagged everyone!`, mentions });
        }
    });

    // ✅ Auto-welcome new members
    sock.ev.on("group-participants.update", async ({ id, participants, action }) => {
        if (action === "add") {
            for (const participant of participants) {
                await sock.sendMessage(id, {
                    text: `👋 Welcome @${participant.split("@")[0]} to the group!`,
                    mentions: [participant],
                });

                // ✅ Save new user in the database
                db.users[participant] = { joinedAt: Date.now() };
                fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));
            }
        }
    });

    /**
     * 🛑 Detect Spam Messages Function 🛑
     */
    function detectSpam(message, sender) {
        // ✅ Spam word detection
        const spamKeywords = ["free money", "click this link", "lottery", "win big", "investment offer"];
        if (spamKeywords.some(word => message.toLowerCase().includes(word))) return true;

        // ✅ Link detection
        const linkRegex = /(https?:\/\/[^\s]+)/g;
        if (linkRegex.test(message)) return true;

        // ✅ Repeated message detection
        if (!db.users[sender]) {
            db.users[sender] = { lastMessage: "", repeatCount: 0 };
        }

        if (db.users[sender].lastMessage === message) {
            db.users[sender].repeatCount += 1;
        } else {
            db.users[sender].repeatCount = 0;
        }
        db.users[sender].lastMessage = message;

        if (db.users[sender].repeatCount >= 3) return true;

        // ✅ Excessive emoji & symbols detection
        const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]+/g;
        const specialCharRegex = /[!@#$%^&*()_+={}\[\]:;"'<>,.?\/\\|`~]/g;
        const uppercaseRatio = (message.replace(/[^A-Z]/g, "").length / message.length) > 0.7;

        if ((message.match(emojiRegex) || []).length > 5 || // More than 5 emojis
            (message.match(specialCharRegex) || []).length > 10 || // More than 10 special characters
            uppercaseRatio) { // Too many uppercase letters
            return true;
        }

        return false;
    }
}

startBot();
