const BotComponent = require('../BotComponent');

class Teleport extends BotComponent {
    constructor(bot, config, logger) {
        super('teleport', bot, config, logger);
        this.acceptTpa = this.config.get('features.teleport.enabled', true);
        this.pattern = /^\[系統\] (\w+) 想要你傳送到 該玩家 的位置|^\[系統\] (\w+) 想要傳送到 你 的位置/

        this.commands = {
            tok: '/tok',
            tno: '/tno'
        };
    }

    async onEnable() {
        if (!this.bot) {
            this.logger.error('Bot instance not available for teleport component');
            return;
        }

        this.setupMessageListener();
        this.logger.info('Teleport component enabled');
    }

    setupMessageListener() {
        if (this.bot.on) {
            this.bot.on('message', this.handleMessage.bind(this));
        }
    }

    async handleMessage(message) {
        if (!message || !message.toString) return;

        const messageText = message.toString();

        try {
        // tpa
            if (this.acceptTpa) {
                const tpaPlayer = this.extractPlayerFromMessage(messageText, this.pattern);
                if (tpaPlayer) {
                    await this.handleTpaRequest(tpaPlayer);
                    return;
                }

                const tpaHerePlayer = this.extractPlayerFromMessage(messageText, this.pattern);
                if (tpaHerePlayer) {
                    await this.handleTpaHereRequest(tpaHerePlayer);
                    return;
                }
            }
        } catch (error) {
            this.logger.error(`Error handling message: ${error.message}`);
        }
    }

    extractPlayerFromMessage(message, pattern) {
        const match = message.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
        return null;
    }

    async handleTpaRequest(playerName) {
        try {
            await this.sendCommand(this.commands.tok);
            this.logger.info(`Auto-accepted TPA request from: ${playerName}`);
            this.emit('tpaAccepted', { player: playerName, type: 'tpa' });
        } catch (error) {
            this.logger.error(`Failed to accept TPA from ${playerName}: ${error.message}`);
            this.emit('tpaError', { player: playerName, error });
        }
    }

    async handleTpaHereRequest(playerName) {
        try {
            await this.sendCommand(this.commands.tok);
            this.logger.info(`Auto-accepted TPA here request from: ${playerName}`);
            this.emit('tpaAccepted', { player: playerName, type: 'tpahere' });
        } catch (error) {
            this.logger.error(`Failed to accept TPA here from ${playerName}: ${error.message}`);
            this.emit('tpaError', { player: playerName, error });
        }
    }

    async sendCommand(command) {
        if (!this.bot || !this.bot.chat) {
            throw new Error('Bot chat function not available');
        }

        await this.bot.chat(command);
        this.logger.debug(`Sent command: ${command}`);
    }

    updateConfig(newConfig) {
        if (typeof newConfig.tpa === 'boolean') {
            this.acceptTpa = newConfig.tpa;
        }

        this.logger.info('Teleport configuration updated');
    }

    async onDisable() {
        this.logger.debug('Teleport component disabled');
    }
}

module.exports = Teleport;
