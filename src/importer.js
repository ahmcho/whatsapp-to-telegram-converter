const moment = require('moment');
const path = require("path");
const fs = require("fs");
const readline = require("readline");


class ChatImporter {
    constructor(chatFolder, bot) {
        this.chatFolder = chatFolder;
        this.bot = bot;
        const progressData = this.loadProgress();
        this.currentLine = progressData.currentLine;
        this.completed = progressData.completed;
        this.chatId = progressData.chatId;
        this.txtFilePath = path.join(chatFolder, '_chat.txt');
    }

    loadProgress() {
        const progressPath = path.join(this.chatFolder, 'progress.json');
        if (fs.existsSync(progressPath)) {
            const data = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
            return {
                currentLine: data.currentLine || 0,
                completed: data.completed || false,
                chatId: data.chatId || null
            };
        }
        return { currentLine: 0, completed: false, chatId: null };
    }

    saveProgress() {
        const progressPath = path.join(this.chatFolder, 'progress.json');
        fs.writeFileSync(progressPath, JSON.stringify({
            currentLine: this.currentLine,
            completed: this.completed,
            chatId: this.chatId
        }), 'utf-8');
    }

    markAsCompleted() {
        this.completed = true;
        this.saveProgress();
    }

    async setChatId() {
        if (!this.chatId) {
            console.log(`Enter the chat ID for folder '${this.chatFolder}':`);
            const chatId = await TelegramImporterBot.getUserInput();
            this.chatId = chatId;
            this.saveProgress();
        }
    }

    formatDate(dateStr) {
        return moment(dateStr, 'MM/DD/YY, hh:mm').format('DD.MM.YYYY HH:mm');
    }

    async importMessages() {
        await this.setChatId();
        if (this.completed) {
            console.log(`Skipping '${this.chatFolder}' as it is already imported.`);
            return "completed";
        }

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
                    currentDate = this.formatDate(timestamp);
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
            this.markAsCompleted();
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
            audio: /(PTT-\d{8}-WA\d+\.opus)/,
            document: /([A-Z]+-\d{8}-WA\d+\.[^\/\\]+$)/,
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
        
        const options = { 
            caption, 
            parse_mode: 'HTML',
            show_caption_above_media: true
        };

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
                case 'document':
                    await this.bot.telegram.sendDocument(this.chatId, { source: filePath }, options);
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error(`Error sending attachment: ${error.message}`);
        }
    }

    async sendMessage(sender, date, message) {
        if (!message.trim()) return;

        if (message.includes('<Media omitted>')) return;

        if(message.includes('<This message was edited>'))
        {
            message = message.replace('<This message was edited>', '');
            message = `<i>${message}</i>`
        }
        
        try {
            await this.bot.telegram.sendMessage(
                this.chatId,
                `<b>${sender}</b>\n${message}\n\n<pre>${date}</pre>`,
                { parse_mode: 'HTML' }
            );
            console.log(`Sent message from ${sender} on ${date}`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (error) {
            console.error(`Error sending message: ${error.message}`);
            console.log(message);
        }
    }
}

module.exports = ChatImporter;