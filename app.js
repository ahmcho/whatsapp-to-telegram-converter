require('dotenv').config();

const BOT_TOKEN = process.env.BOT_TOKEN;
const TelegramImporterBot = require('./src/telegram-importer');

const importerBot = new TelegramImporterBot(BOT_TOKEN);

importerBot.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
