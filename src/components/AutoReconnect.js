const BotComponent = require('../BotComponent');

class AutoReconnect extends BotComponent {
    constructor(bot, config, logger) {
        super('autoReconnect', bot, config, logger);
        this.retryCount = 0;
        this.maxRetries = this.config.get('features.autoReconnect.maxRetries', 10);
        this.delay = this.config.get('features.autoReconnect.delay', 5000);
        this.isReconnecting = false;
    }

    async onEnable() {
        this.setupEventListeners();
    }

    setupEventListeners() {
        if (this.bot) {
            this.bot.on('disconnect', this.handleDisconnect.bind(this));
            this.bot.on('error', this.handleError.bind(this));
            this.bot.on('spawn', this.handleLogin.bind(this));
        }
    }

    handleDisconnect(reason) {
        if (this.isReconnecting) return;
        const name = this.bot?.config?.get && this.bot.config.get('bot.username') || (this.bot?.client && this.bot.client.username) || 'unknown';
        this.logger.warn(`[${name}] Bot disconnected: ${reason || 'Unknown reason'}`);
        this.attemptReconnect(reason instanceof Error ? reason : new Error(reason || 'Unknown reason'));
    }

    // 小 helper：與 BedrockBot 同步的忽略規則
    shouldIgnoreError(error) {
        if (!error) return false;
        const msg = (error && (error.message || String(error))) || String(error);
        const patterns = [
            /Invalid tag/i,
            /SizeOf error/i,
            /Read error for undefined/i,
            /SizeOf error for undefined/i
        ];
        return patterns.some(re => re.test(msg));
    }

    // 修改：在偵測到錯誤時使用實例的 ipModule 切換 IP（若可用），並增加 debug 日誌
    handleError(error) {
        if (this.isReconnecting) return;

        const name = this.bot?.config?.get && this.bot.config.get('bot.username') || (this.bot?.client && this.bot.client.username) || 'unknown';

        // 先判斷是否忽略（若有相同規則）
        if (this.shouldIgnoreError && this.shouldIgnoreError(error)) {
            // 仍嘗試重連，但不輸出錯誤到終端
        } else {
            this.logger.error(`[${name}] Bot error detected by AutoReconnect: ${error && error.message ? error.message : String(error)}`);
        }

        // 若為可切換的錯誤（含 Ping timed out）則嘗試用該實例的 ipModule 切換 IP
        try {
            const msg = error && (error.message || String(error)) || '';
            if (msg.toLowerCase().includes('ping timed out') || msg.includes('Connect timed out') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
                const ipm = this.bot && this.bot.ipModule;
                if (ipm && typeof ipm.switchToNextHost === 'function') {
                    const oldHost = (typeof ipm.getCurrentHost === 'function') ? ipm.getCurrentHost() : 'unknown';
                    const newHost = ipm.switchToNextHost();
                    this.logger.warn(`[${name}] AutoReconnect: connection error detected (${msg}), switching server IP ${oldHost} -> ${newHost}`);
                } else {
                    this.logger.debug && this.logger.debug(`[${name}] AutoReconnect: ipModule not available to switch host`);
                }
            }
        } catch (e) {
            this.logger.debug && this.logger.debug(`[${name}] AutoReconnect ip switch failed: ${e && e.message ? e.message : e}`);
        }

        // 只有在非已連線狀態下才嘗試 reconnect
        if (!this.bot.isConnected && (
            (error && error.message && (
                error.message.includes('Connect timed out') ||
                error.message.includes('ETIMEDOUT') ||
                error.message.includes('ECONNREFUSED') ||
                error.message.includes('Connection failed')
            )) || (error && error.message && error.message.toLowerCase().includes('ping timed out'))
        )) {
            this.attemptReconnect(error);
        }
    }

    handleLogin() {
        const name = this.bot?.config?.get && this.bot.config.get('bot.username') || (this.bot?.client && this.bot.client.username) || 'unknown';
        this.logger.info(`[${name}] Bot successfully spawned/connected`);
        this.retryCount = 0; // Reset retry count on successful connection
        this.isReconnecting = false;
    }

    // 修改：在 attemptReconnect 增加 username, 更清楚記錄，並 emit 帶上實例名稱
    attemptReconnect(lastError = null) {
        const name = this.bot?.config?.get && this.bot.config.get('bot.username') || (this.bot?.client && this.bot.client.username) || 'unknown';

        if (this.retryCount >= this.maxRetries) {
            this.logger.error(`[${name}] Maximum retry attempts (${this.maxRetries}) reached. Stopping reconnect attempts.`);
            this.isReconnecting = false;
            this.emit('maxRetriesReached', name);
            return;
        }

        this.isReconnecting = true;
        this.retryCount++;

        this.logger.info(`[${name}] Attempting to reconnect (${this.retryCount}/${this.maxRetries}) in ${this.delay}ms...`);

        this.createTimeout(() => {
            try {
                // emit 帶上實例 name，BedrockBot 會接收並以該實例為主處理
                this.emit('reconnectAttempt', this.retryCount, lastError, name);
            } catch (error) {
                this.logger.error(`[${name}] Reconnect attempt ${this.retryCount} failed to start: ${error && error.message ? error.message : error}`);
                // 安全地 schedule 下一次嘗試
                setTimeout(() => {
                    this.attemptReconnect(error);
                }, this.delay);
            }
        }, this.delay);
    }

    resetRetryCount() {
        this.retryCount = 0;
        this.isReconnecting = false;
    }

    isCurrentlyReconnecting() {
        return this.isReconnecting;
    }

    getCurrentRetryCount() {
        return this.retryCount;
    }

    async onDisable() {
        this.isReconnecting = false;
        this.retryCount = 0;
        this.logger.debug('Auto reconnect disabled');
    }
}

module.exports = AutoReconnect;
