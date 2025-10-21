const BedrockBot = require('./src/BedrockBot');
const readline = require('readline');
const path = require('path');
class BotApplication {
    constructor() {
        this.bot = null;
        this.rl = null;
        this.connected = false;
        this.setupGracefulShutdown();
        this.setupCommandInterface();
    }

    setupGracefulShutdown() {
        const gracefulShutdown = async (signal) => {
            console.log(`\nReceived ${signal}, shutting down gracefully...`);

            if (this.rl) {
                this.rl.close();
            }

            if (this.bot) {
                await this.bot.stop();
            }

            process.exit(0);
        };

        process.on('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGUSR2', gracefulShutdown);
    }

    setupCommandInterface() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        this.rl.on('line', this.handleCommand.bind(this));
        this.rl.on('close', () => {
            console.log('\nCommand interface closed');
        });
    }

    stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, '');
    }

    renderStatusBar() {
        try {
            const cols = process.stdout.columns || 80;
            const connected = !!this.connected;
            const square = connected ? '\x1b[32m■\x1b[0m' : '\x1b[31m■\x1b[0m';
            const text = connected ? '\x1b[32monline\x1b[0m' : '\x1b[31mstop\x1b[0m';
            const content = `${square} ${text}`;
            const visibleLen = this.stripAnsi(content).length;
            const pad = Math.max(0, Math.floor((cols - visibleLen) / 2));
            const line = ' '.repeat(pad) + content + ' '.repeat(Math.max(0, cols - pad - visibleLen));
            process.stdout.write('\x1b[s');
            process.stdout.write('\x1b[1;1H');
            process.stdout.write(line + '\x1b[K');
            process.stdout.write('\x1b[u');
        } catch (e) {}
    }

    updateStatus(isConnected) {
        this.connected = !!isConnected;
        this.renderStatusBar();
        if (this.rl && typeof this.rl.prompt === 'function') {
            try { this.rl.prompt(true); } catch (e) {}
        }
    }

    async handleCommand(input) {
        const command = input.trim();

        if (!command) {
            this.rl.prompt();
            return;
        }

        try {
            await this.handleChatMessage(command);
        } catch (error) {
            console.error(`Command error: ${error.message}`);
        }

        this.rl.prompt();
        this.renderStatusBar();
    }

    async handleChatMessage(message) {
        if (this.bot && this.bot.isConnected) {
            await this.bot.chat(message);
        } else {
            console.log('Bot is not connected. Cannot send chat message.');
        }
    }
    async start() {
        try {
            console.log('Starting Bedrock Bot Application...');

            this.bot = new BedrockBot('./config.json');

            this.setupBotEventListeners();

            await this.bot.start();

            this.updateStatus(this.bot && this.bot.isConnected);

            this.rl.prompt();

        } catch (error) {
            console.error(`Failed to start bot application: ${error.message}`);
            process.exit(1);
        }
    }
    setupBotEventListeners() {
        if (!this.bot) return;

        this.bot.on('spawn', () => {
            console.log('✅ Bot spawned successfully');
            this.updateStatus(true);
            this.rl.prompt();
        });

        this.bot.on('disconnect', (reason) => {
            console.log(`❌ Bot disconnected: ${reason}`);
            this.updateStatus(false);
            this.rl.prompt();
        });

        this.bot.on('error', (error) => {
            console.log(`❌ Bot error: ${error.message}`);
            if (this.bot && this.bot.isConnected === false) {
                this.updateStatus(false);
            }
            this.rl.prompt();
        });

        this.bot.on('reconnectAttempt', (attempt) => {
            console.log(`🔄 Reconnect attempt ${attempt}`);
            this.updateStatus(false);
            this.rl.prompt();
        });

        this.bot.on('message', (data) => {
            this.rl.prompt();
        });
    }
}

if (require.main === module) {
    const app = new BotApplication();
    app.start().catch(console.error);
}

module.exports = BotApplication;
try {
  require('./Multiple instances/Launcher.js');
} catch (err) {
  console.error('Failed to start launcher:', err && err.message ? err.message : err);
  process.exit(1);
}
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});