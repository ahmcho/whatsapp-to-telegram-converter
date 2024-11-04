const { Telegraf } = require('telegraf');
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const moment = require('moment');

const ChatImporter = require('./importer');

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
                console.log("No chat folders found in 'chats' directory.");
                return;
            }

            console.log("\nAvailable chat folders:");
            chatFolders.forEach((folder, idx) => console.log(`${idx + 1}. ${folder}`));
            console.log("\nEnter folder numbers (comma-separated) or 'a' for all:");

            const selectedFolders = await TelegramImporterBot.getUserInput();
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
        const chatsDir = path.join('.', 'chats');
        if (!fs.existsSync(chatsDir)) {
            console.log("The 'chats' directory does not exist.");
            return [];
        }
        
        return fs.readdirSync(chatsDir)
            .filter(folder => {
                try {
                    const folderPath = path.join(chatsDir, folder);
                    const isDirectory = fs.lstatSync(folderPath).isDirectory();
                    const hasChatFile = fs.existsSync(path.join(folderPath, '_chat.txt'));
                    return isDirectory && hasChatFile;
                } catch (error) {
                    console.error(`Error reading folder ${folder}: ${error.message}`);
                    return false;
                }
            })
            .map(folder => path.join(chatsDir, folder));
    }

    async setupImporters(folders) {
        for (const folder of folders) {
            const importer = new ChatImporter(folder, this.bot);
            await importer.setChatId();
            this.importers.push(importer);
        }
    }

    async runImporters() {
        for (const importer of this.importers) {
            console.log(`\nProcessing folder: ${importer.chatFolder}`);
            const result = await importer.importMessages();
            
            if (result === "completed" && this.importers.length === 1) {
                console.log(`Chat '${importer.chatFolder}' already completed. Exiting.`);
                process.exit(0);
            }
        }
    }

    static getUserInput() {
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

module.exports = TelegramImporterBot;