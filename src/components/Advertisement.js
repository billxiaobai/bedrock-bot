const BotComponent = require('../BotComponent');

class Advertisement extends BotComponent {
    constructor(bot, config, logger) {
        super('advertisement', bot, config, logger);
        this.activeIntervals = new Map();
        const msgs = this.getConfigValue('advertisement.messages') ||
                     this.getConfigValue('features.advertisement.messages') ||
                     this.getConfigValue('advertisement')?.messages ||
                     [];
        this.messages = Array.isArray(msgs) ? msgs : [];
    }
    getConfigValue(path) {
        if (!this.config || typeof this.config.get !== 'function') return undefined;
        try {
            const direct = this.config.get(path);
            if (direct !== undefined) return direct;
        } catch (e) {
        }
        const parts = path.split('.');
        try {
            let val = this.config.get(parts[0]);
            if (val === undefined) return undefined;
            for (let i = 1; i < parts.length; i++) {
                if (val && typeof val === 'object' && parts[i] in val) {
                    val = val[parts[i]];
                } else {
                    return undefined;
                }
            }
            return val;
        } catch (e) {
            return undefined;
        }
    }

    async onEnable() {
        if (!this.bot) {
            this.logger.error('Bot instance not available for advertisement component');
            return;
        }

        try {
            const msgs = this.getConfigValue('advertisement.messages') ||
                         this.getConfigValue('features.advertisement.messages') ||
                         this.getConfigValue('advertisement')?.messages ||
                         [];
            this.messages = Array.isArray(msgs) ? msgs : [];

            this.validateMessages();
            this.setupAdvertisements();
            this.logger.info(`Advertisement component started with ${this.messages.length} messages`);
        } catch (err) {
            this.logger.error(`Advertisement onEnable failed: ${err.message}\n${err.stack}`);
        }
    }

    validateMessages() {
        if (!Array.isArray(this.messages)) {
            this.logger.warn('Advertisement messages is not an array — defaulting to empty list');
            this.messages = [];
            return;
        }

        this.messages = this.messages.filter(msg => {
            if (!msg || typeof msg !== 'object') {
                this.logger.warn('Invalid advertisement message: not an object');
                return false;
            }
            if (!msg.text || typeof msg.text !== 'string') {
                this.logger.warn('Invalid advertisement message: missing or invalid text');
                return false;
            }
            if (!msg.interval || typeof msg.interval !== 'number' || msg.interval < 1000) {
                this.logger.warn(`Invalid interval for message "${msg.text}": ${msg.interval}`);
                return false;
            }
            return true;
        });
    }

    setupAdvertisements() {
        // 先清掉舊的再建立新的（避免重覆）
        this.clearAllIntervals();
        this.messages.forEach((message, index) => {
            this.createAdvertisementInterval(message, index);
        });
    }

    createAdvertisementInterval(message, index) {
        const intervalId = this.createInterval(() => {
            this.sendAdvertisement(message.text, index);
        }, message.interval);

        this.activeIntervals.set(index, intervalId);
        this.logger.debug(`Created advertisement interval for message ${index}: "${message.text}" every ${message.interval}ms`);
    }

    async sendAdvertisement(text, index) {
        try {
            if (!this.bot || !this.bot.chat) {
                this.logger.error('Bot chat function not available');
                return;
            }

            await this.bot.chat(text);
            this.logger.info(`Sent advertisement ${index}: ${text}`);
            this.emit('advertisementSent', { text, index });
        } catch (error) {
            this.logger.error(`Failed to send advertisement ${index}: ${error.message}`);
            this.emit('advertisementError', { text, index, error });
        }
    }

    addMessage(text, interval) {
        if (!text || typeof text !== 'string') {
            throw new Error('Message text must be a non-empty string');
        }
        if (!interval || typeof interval !== 'number' || interval < 1000) {
            throw new Error('Interval must be a number >= 1000');
        }

        const newMessage = { text, interval };
        const index = this.messages.length;
        this.messages.push(newMessage);

        if (this.enabled) {
            this.createAdvertisementInterval(newMessage, index);
        }

        this.logger.info(`Added new advertisement message: "${text}" every ${interval}ms`);
    }

    removeMessage(index) {
        if (index < 0 || index >= this.messages.length) {
            throw new Error('Invalid message index');
        }

        const message = this.messages[index];
        if (this.activeIntervals.has(index)) {
            clearInterval(this.activeIntervals.get(index));
            this.activeIntervals.delete(index);
        }

        this.messages.splice(index, 1);
        this.logger.info(`Removed advertisement message: "${message.text}"`);
    }

    updateMessage(index, text, interval) {
        if (index < 0 || index >= this.messages.length) {
            throw new Error('Invalid message index');
        }

        this.removeMessage(index);
        this.messages.splice(index, 0, { text, interval });

        if (this.enabled) {
            this.createAdvertisementInterval(this.messages[index], index);
        }

        this.logger.info(`Updated advertisement message ${index}: "${text}" every ${interval}ms`);
    }

    getMessages() {
        return [...this.messages];
    }

    clearAllIntervals() {
        this.activeIntervals.forEach(intervalId => {
            clearInterval(intervalId);
        });
        this.activeIntervals.clear();
    }

    async onDisable() {
        this.clearAllIntervals();
        this.logger.debug('Advertisement component disabled');
    }

    async sendImmediateAdvertisement(index) {
        if (index < 0 || index >= this.messages.length) {
            throw new Error('Invalid message index');
        }

        const message = this.messages[index];
        await this.sendAdvertisement(message.text, index);
    }
}

module.exports = Advertisement;
