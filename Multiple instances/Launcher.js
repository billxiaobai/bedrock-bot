const path = require('path');
const fs = require('fs');
const BedrockBot = require('../src/BedrockBot');
const { EventEmitter } = require('events');
const statusServer = require('./statusServer');
if (global.__XI_MULTI_LAUNCHER_STARTED) {
	console.warn('Launcher already started in this process — skipping duplicate start');
	return;
}
global.__XI_MULTI_LAUNCHER_STARTED = true;
statusServer.start('0.0.0.0', 8080);

(async () => {
    const configPath = path.resolve(__dirname, '..', 'config.json');
    let raw;
    try {
        raw = fs.readFileSync(configPath, 'utf8');
    } catch (err) {
        console.error('Cannot read config.json:', err.message);
        process.exit(1);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        console.error('Invalid JSON in config.json:', err.message);
        process.exit(1);
    }

    const instances = [];

    if (Array.isArray(parsed)) {
        console.log(`Detected ${parsed.length} bot configs — launching ${parsed.length} instances...`);
        parsed.forEach((botConfig, idx) => {
            try {
                const bot = new BedrockBot(botConfig);
                const logEmitter = new EventEmitter();
                const origLogger = bot.logger || console;
                function isChatArgs(arr) {
                    try {
                        return arr.some(a => typeof a === 'string' && a.includes('[CHAT]'));
                    } catch (e) { return false; }
                }

                bot.logger = {
                    info: (...args) => {
                        try { origLogger.info && origLogger.info(...args); } catch (e) {}
                        if (!isChatArgs(args)) {
                            logEmitter.emit('log', { id: `instance-${idx}`, text: formatArgs('INFO', args) });
                        }
                    },
                    warn: (...args) => {
                        try { origLogger.warn && origLogger.warn(...args); } catch (e) {}
                        if (!isChatArgs(args)) {
                            logEmitter.emit('log', { id: `instance-${idx}`, text: formatArgs('WARN', args) });
                        }
                    },
                    error: (...args) => {
                        try { origLogger.error && origLogger.error(...args); } catch (e) {}
                        if (!isChatArgs(args)) {
                            logEmitter.emit('log', { id: `instance-${idx}`, text: formatArgs('ERROR', args) });
                        }
                    },
                    debug: (...args) => {
                        try { origLogger.debug && origLogger.debug(...args); } catch (e) {}
                        if (!isChatArgs(args)) {
                            logEmitter.emit('log', { id: `instance-${idx}`, text: formatArgs('DEBUG', args) });
                        }
                    }
                };
                function formatArgs(level, arr) {
                    const txt = arr.map(a => {
                        if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
                        try { return typeof a === 'string' ? a : JSON.stringify(a); } catch { return String(a); }
                    }).join(' ');
                    return `[${level}] ${txt}`;
                }
                try {
                  if (typeof bot.on === 'function') {
                    onMessage = (data) => { try { logEmitter.emit('log', { id: `instance-${idx}`, text: `[CHAT] ${data && data.text ? data.text : JSON.stringify(data)}` }); } catch (e) {} };
                    onSpawn = () => { try { logEmitter.emit('log', { id: `instance-${idx}`, text: '[INFO] Bot spawned' }); logEmitter.emit('spawn'); } catch (e) {} };
                    onDisconnect = (reason) => { try { logEmitter.emit('log', { id: `instance-${idx}`, text: `[WARN] Bot disconnected: ${reason}` }); logEmitter.emit('disconnect', reason); } catch (e) {} };
                    onError = (err) => { try { logEmitter.emit('log', { id: `instance-${idx}`, text: `[ERROR] ${err && err.message ? err.message : err}` }); logEmitter.emit('error', err); } catch (e) {} };
                    onKick = (reason) => { try { logEmitter.emit('log', { id: `instance-${idx}`, text: `[WARN] Bot kicked: ${reason}` }); logEmitter.emit('kick', reason); } catch (e) {} };

                    bot.on('message', onMessage);
                    bot.on('spawn', onSpawn);
                    bot.on('disconnect', onDisconnect);
                    bot.on('error', onError);
                    bot.on('kick', onKick);
                    bot._forwardListeners = { onMessage, onSpawn, onDisconnect, onError, onKick };
                  } else {
                    logEmitter.emit('log', { id: `instance-${idx}`, text: '[WARN] bot.on not available, skipping event forwarders' });
                  }
                } catch (e) {
                  logEmitter.emit('log', { id: `instance-${idx}`, text: `[ERROR] attaching event forwarders failed: ${e && e.message ? e.message : e}` });
                }
                const id = `instance-${idx}`;
                const meta = { bot: { username: bot.config.get('bot.username') || `bot${idx}` } };
                const sendFn = async (message) => {
                  if (!message) throw new Error('empty message');
                  try {
                    await bot.chat(String(message));
                  } catch (err) {
                    logEmitter.emit('log', { id: `instance-${idx}`, text: `[ERROR] failed to send: ${err && err.message ? err.message : err}` });
                    throw err;
                  }
                };
                statusServer.registerInstance(id, logEmitter, meta, sendFn);
                bot._statusId = id;
                bot._logEmitter = logEmitter;

                instances.push(bot);
                bot.start().catch(err => {
                    const msg = err && err.message ? err.message : String(err);
                    console.error(`[Instance ${idx}] start error:`, msg);
                    logEmitter.emit('log', `[ERROR] start error: ${msg}`);
                });
            } catch (err) {
                console.error(`Failed to create instance ${idx}:`, err.message || err);
            }
        });
    } else if (parsed && typeof parsed === 'object') {
        console.log('Single bot config detected — launching one instance...');
        const bot = new BedrockBot(parsed);
        const logEmitter = new EventEmitter();
        const origLogger = bot.logger || console;
        bot.logger = {
            info: (...args) => { try { origLogger.info && origLogger.info(...args); } catch (e) {} ; logEmitter.emit('log', `[INFO] ${args.join(' ')}`); },
            warn: (...args) => { try { origLogger.warn && origLogger.warn(...args); } catch (e) {} ; logEmitter.emit('log', `[WARN] ${args.join(' ')}`); },
            error: (...args) => { try { origLogger.error && origLogger.error(...args); } catch (e) {} ; logEmitter.emit('log', `[ERROR] ${args.join(' ')}`); },
            debug: (...args) => { try { origLogger.debug && origLogger.debug(...args); } catch (e) {} ; logEmitter.emit('log', `[DEBUG] ${args.join(' ')}`); }
        };
        const id = 'instance-0';
        const meta = { bot: { username: bot.config.get('bot.username') || 'bot0' } };
        try {
          if (typeof bot.on === 'function') {
            const onMessage = (data) => { try { logEmitter.emit('log', `[CHAT] ${data && data.text ? data.text : JSON.stringify(data)}`); } catch (e) {} };
            const onSpawn = () => { try { logEmitter.emit('log', '[INFO] Bot spawned'); logEmitter.emit('spawn'); } catch (e) {} };
            const onDisconnect = (reason) => { try { logEmitter.emit('log', `[WARN] Bot disconnected: ${reason}`); logEmitter.emit('disconnect', reason); } catch (e) {} };
            const onError = (err) => { try { logEmitter.emit('log', `[ERROR] ${err && err.message ? err.message : err}`); logEmitter.emit('error', err); } catch (e) {} };
            const onKick = (reason) => { try { logEmitter.emit('log', `[WARN] Bot kicked: ${reason}`); logEmitter.emit('kick', reason); } catch (e) {} };
            bot.on('message', onMessage);
            bot.on('spawn', onSpawn);
            bot.on('disconnect', onDisconnect);
            bot.on('error', onError);
            bot.on('kick', onKick);
            bot._forwardListeners = { onMessage, onSpawn, onDisconnect, onError, onKick };
          } else {
            logEmitter.emit('log', '[WARN] bot.on not available for single instance, skipping forwarders');
          }
        } catch (e) {
          logEmitter.emit('log', `[ERROR] single instance attaching forwarders failed: ${e && e.message ? e.message : e}`);
        }
        statusServer.registerInstance(id, logEmitter, meta, async (message) => {
          if (!message) throw new Error('empty message');
          try {
            await bot.chat(String(message));
          } catch (err) {
            logEmitter.emit('log', `[ERROR] failed to send: ${err && err.message ? err.message : err}`);
            throw err;
          }
        });
        bot._statusId = id;
        bot._logEmitter = logEmitter;

        instances.push(bot);
        bot.start().catch(err => {
            const msg = err && err.message ? err.message : String(err);
            console.error('Bot start error:', msg);
            logEmitter.emit('log', `[ERROR] start error: ${msg}`);
        });
    } else {
        console.error('config.json must be an object or an array of bot config objects');
        process.exit(1);
    }

    const shutdown = async () => {
        console.log('Shutting down instances...');
        for (let i = 0; i < instances.length; i++) {
            const b = instances[i];
            try {
                await b.stop();
                console.log(`[Instance ${i}] stopped`);
            } catch (e) {
                console.error(`[Instance ${i}] stop error:`, e.message || e);
            }

            if (b._statusId) statusServer.unregisterInstance(b._statusId);

            if (b._forwardListeners && typeof b.removeListener === 'function') {
              try {
                b.removeListener('message', b._forwardListeners.onMessage);
                b.removeListener('spawn', b._forwardListeners.onSpawn);
                b.removeListener('disconnect', b._forwardListeners.onDisconnect);
                b.removeListener('error', b._forwardListeners.onError);
                b.removeListener('kick', b._forwardListeners.onKick);
              } catch (e) {}
            }
        }
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
})();
