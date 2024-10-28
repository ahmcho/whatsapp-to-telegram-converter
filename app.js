require('dotenv');
const { Telegraf } = require('telegraf');
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const moment = require('moment');
const BOT_TOKEN = process.env.BOT_TOKEN;

class ChatImporter {
    constructor(chatFolder, chatId, bot) {
        this.chatFolder = chatFolder;
        this.chatId = chatId;
        this.bot = bot;
        this.currentLine = this.loadProgress();
        this.txtFilePath = path.join(chatFolder, '_chat.txt');
    }

    loadProgress() {
        const progressPath = path.join(this.chatFolder, 'progress.json');
        return fs.existsSync(progressPath)
            ? JSON.parse(fs.readFileSync(progressPath, 'utf-8')).currentLine || 0
            : 0;
    }

    saveProgress() {
        const progressPath = path.join(this.chatFolder, 'progress.json');
        fs.writeFileSync(progressPath, JSON.stringify({ currentLine: this.currentLine }), 'utf-8');
    }

    formatDate(dateStr) {
        return moment(dateStr, 'MM/DD/YY').format('DD.MM.YYYY');
    }

    async importMessages() {
        if (!fs.existsSync(this.txtFilePath)) {
            console.error(`Chat file not found in ${this.chatFolder}`);
            return;
        }

        console.log(`Starting import for ${this.chatFolder}`);
        const fileStream = fs.createReadStream(this.txtFilePath, 'utf-8');        
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        let messageBuffer = '', currentSender = '', currentDate = '';
        let lineIndex = 0;

        try {
            for await (const line of rl) {            
                lineIndex++;
                if (lineIndex < this.currentLine) continue;

                const isNewMessage = /^\d{1,2}\/\d{1,2}\/\d{2},\s\d{1,2}:\d{2}\s[AP]M/.test(line.trim());
                
                if (isNewMessage) {
                    if (messageBuffer) {
                        await this.sendMessage(currentSender, currentDate, messageBuffer.trim());
                        messageBuffer = '';
                    }
                    const [timestamp, messageContent] = line.split(' - ');
                    if (!messageContent) continue;

                    const senderEndIdx = messageContent.indexOf(': ');
                    if (senderEndIdx === -1) continue;

                    currentSender = messageContent.slice(0, senderEndIdx);
                    const datePart = timestamp.split(',')[0];
                    currentDate = this.formatDate(datePart);
                    messageBuffer = messageContent.slice(senderEndIdx + 2);

                    if (messageBuffer.includes('(file attached)')) {
                        const fileName = this.getAttachmentFileName(messageBuffer);
                        if (fileName) {
                            await this.sendAttachment(fileName, currentSender, currentDate);
                            messageBuffer = '';
                            continue;
                        }
                    }
                } else {
                    messageBuffer += `\n${line}`;
                }

                this.currentLine = lineIndex;
                this.saveProgress();
            }

            if (messageBuffer) {
                await this.sendMessage(currentSender, currentDate, messageBuffer.trim());
            }

            console.log(`Completed import for ${this.chatFolder}`);
        } catch (error) {
            console.error(`Error during import: ${error.message}`);
        } finally {
            rl.close();
            fileStream.close();
        }
    }

    getAttachmentFileName(message) {
        const patterns = {
            sticker: /(STK-\d{8}-WA\d+\.webp)/,
            photo: /(IMG-\d{8}-WA\d+\.(jpg|jpeg|png))/, 
            video: /(VID-\d{8}-WA\d+\.mp4)/,
            audio: /(PTT-\d{8}-WA\d+\.opus)/
        };

        for (const [type, pattern] of Object.entries(patterns)) {
            const match = message.match(pattern);
            if (match) return { type, name: match[0] };
        }
        return null;
    }

    async sendAttachment(fileInfo, sender, date) {
        if (!fileInfo) return;

        const filePath = path.join(this.chatFolder, fileInfo.name);
        if (!fs.existsSync(filePath)) {
            console.error(`File not found: ${filePath}`);
            return;
        }

        const caption = `<b>${sender}</b> <pre>${date}</pre>`;
        const options = { caption, parse_mode: 'HTML' };

        try {
            switch (fileInfo.type) {
                case 'sticker':
                    await this.bot.telegram.sendSticker(this.chatId, { source: filePath });
                    break;
                case 'photo':
                    await this.bot.telegram.sendPhoto(this.chatId, { source: filePath }, options);
                    break;
                case 'video':
                    await this.bot.telegram.sendVideo(this.chatId, { source: filePath }, options);
                    break;
                case 'audio':
                    await this.bot.telegram.sendVoice(this.chatId, { source: filePath }, options);
                    break;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error(`Error sending attachment: ${error.message}`);
        }
    }

    async sendMessage(sender, date, message) {
        if (!message.trim()) return;
        
        try {
            await this.bot.telegram.sendMessage(
                this.chatId,
                `<b>${sender}</b> <pre>${date}</pre>\n${message}`,
                { parse_mode: 'HTML' }
            );
            console.log(`Sent message from ${sender} on ${date}`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error(`Error sending message: ${error.message}`);
        }
    }
}

class TelegramImporterBot {
    constructor(token) {
        this.bot = new Telegraf(token);
        this.importers = [];
    }

    async start() {
        try {
            await this.bot.telegram.getMe();
            console.log('Bot successfully connected to Telegram');

            const chatFolders = this.getChatFolders();
            if (chatFolders.length === 0) {
                console.log("No chat folders found.");
                return;
            }

            console.log("\nAvailable chat folders:");
            chatFolders.forEach((folder, idx) => console.log(`${idx + 1}. ${folder}`));
            console.log("\nEnter folder numbers (comma-separated) or 'a' for all:");

            const selectedFolders = await this.getUserInput();
            const foldersToProcess = selectedFolders.toLowerCase() === 'a' 
                ? chatFolders 
                : selectedFolders.split(',')
                    .map(num => chatFolders[parseInt(num.trim()) - 1])
                    .filter(Boolean);

            if (foldersToProcess.length === 0) {
                console.log("No valid folders selected.");
                return;
            }

            await this.setupImporters(foldersToProcess);
            await this.runImporters();
            
            console.log("\nFinished.");
            process.exit(0);
        } catch (error) {
            console.error('Error during execution:', error);
            process.exit(1);
        }
    }

    getChatFolders() {
        return fs.readdirSync('.')
            .filter(folder => {
                try {
                    const isDirectory = fs.lstatSync(folder).isDirectory();
                    const hasChatFile = fs.existsSync(path.join("chats/" + folder, '_chat.txt'));
                    return folder !== 'node_modules' && isDirectory && hasChatFile;
                } catch (error) {
                    return false;
                }
            });
    }

    async setupImporters(folders) {
        for (const folder of folders) {
            console.log(`\nEnter the chat ID for folder '${folder}':`);
            const chatId = await this.getUserInput();
            this.importers.push(new ChatImporter(folder, chatId, this.bot));
        }
    }

    async runImporters() {
        for (const importer of this.importers) {
            console.log(`\nProcessing folder: ${importer.chatFolder}`);
            await importer.importMessages();
        }
    }

    getUserInput() {
        const rl = readline.createInterface({ 
            input: process.stdin, 
            output: process.stdout 
        });

        return new Promise(resolve => {
            rl.question('> ', answer => {
                rl.close();
                resolve(answer.trim());
            });
        });
    }
}

const importerBot = new TelegramImporterBot(BOT_TOKEN);
importerBot.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});