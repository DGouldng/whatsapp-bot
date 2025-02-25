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

    // Store last message
    let lastMessage = "";

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const chatId = msg.key.remoteJid;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const sender = msg.key.participant || msg.key.remoteJid;

        // ✅ Save messages to database
        db.messages.push({ sender, text, timestamp: Date.now() });
        fs.writeFileSync(dbFile, JSON.stringify(db, null, 2));

        // ✅ Auto-reply to messages
        if (text.toLowerCase() === "hello") {
            await sock.sendMessage(chatId, { text: `Hi @${sender.split("@")[0]}`, mentions: [sender] });
        }

        // ✅ Reject specific messages (example: blocking the word "spam")
        if (text.toLowerCase().includes("spam")) {
            await sock.sendMessage(chatId, { text: "❌ This message is not allowed!" });
            return;
        }

        // ✅ Store last message (excluding '.tag' command)
        if (text.toLowerCase() !== ".tag") {
            lastMessage = text;
        }

        // ✅ Check if user is an admin before allowing ".tag"
        if (text.toLowerCase() === ".tag") {
            const groupMeta = await sock.groupMetadata(chatId);
            const participants = groupMeta.participants;
            const admins = participants.filter(p => p.admin).map(p => p.id);

            if (!admins.includes(sender)) {
                await sock.sendMessage(chatId, { text: "❌ Only admins can use this command!" });
                return;
            }

            const mentions = participants.map(p => p.id);
            if (lastMessage) {
                await sock.sendMessage(chatId, { text: `${lastMessage}`, mentions });
            } else {
                await sock.sendMessage(chatId, { text: "No previous message to repeat." });
            }
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
}

startBot();
