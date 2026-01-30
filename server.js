const fs = require('fs');
const express = require('express');
const wiegine = require('fca-mafiya');
const WebSocket = require('ws');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 22133;

// Store active tasks - Persistent storage simulation
const TASKS_FILE = 'active_tasks.json';
const COOKIES_DIR = 'cookies';

// Ensure directories exist
if (!fs.existsSync(COOKIES_DIR)) {
    fs.mkdirSync(COOKIES_DIR, { recursive: true });
}

// Load persistent tasks
function loadTasks() {
    try {
        if (fs.existsSync(TASKS_FILE)) {
            const data = fs.readFileSync(TASKS_FILE, 'utf8');
            const tasksData = JSON.parse(data);
            const tasks = new Map();

            for (let [taskId, taskData] of Object.entries(tasksData)) {
                const task = new Task(taskId, taskData.userData);
                task.config = taskData.config;
                task.messageData = taskData.messageData;
                task.stats = taskData.stats;
                task.logs = taskData.logs || [];
                task.config.running = true;
                tasks.set(taskId, task);

                console.log("🔥 Reloaded persistent task: " + taskId);

                setTimeout(() => {
                    if (task.config.running) {
                        task.start();
                    }
                }, 5000);
            }

            return tasks;
        }
    } catch (error) {
        console.error('Error loading tasks:', error);
    }
    return new Map();
}

// Save tasks persistently
function saveTasks() {
    try {
        const tasksData = {};
        for (let [taskId, task] of activeTasks.entries()) {
            if (task.config.running) {
                tasksData[taskId] = {
                    userData: task.userData,
                    config: { ...task.config, api: null },
                    messageData: task.messageData,
                    stats: task.stats,
                    logs: task.logs.slice(0, 50)
                };
            }
        }
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasksData, null, 2));
    } catch (error) {
        console.error('Error saving tasks:', error);
    }
}

setInterval(saveTasks, 30000);

function setupAutoRestart() {
    setInterval(() => {
        for (let [taskId, task] of activeTasks.entries()) {
            if (task.config.running && !task.healthCheck()) {
                console.log("🔥 Auto-restarting stuck task: " + taskId);
                task.restart();
            }
        }
    }, 60000);
}

let activeTasks = loadTasks();

class Task {
    constructor(taskId, userData) {
        this.taskId = taskId;
        this.userData = userData;
        this.config = {
            delay: userData.delay || 5,
            running: false,
            api: null,
            lastActivity: Date.now(),
            restartCount: 0,
            maxRestarts: 1000
        };
        this.messageData = {
            threadID: userData.threadID,
            messages: [],
            currentIndex: 0,
            loopCount: 0
        };
        this.stats = {
            sent: 0,
            failed: 0,
            activeCookies: 0,
            loops: 0,
            restarts: 0,
            lastSuccess: null
        };
        this.logs = [];
        this.retryCount = 0;
        this.maxRetries = 50;
        this.initializeMessages(userData.messageContent, userData.hatersName, userData.lastHereName);
    }

    initializeMessages(messageContent, hatersName, lastHereName) {
        this.messageData.messages = messageContent
            .split('\n')
            .map(line => line.replace(/\r/g, '').trim())
            .filter(line => line.length > 0)
            .map(message => hatersName + " " + message + " " + lastHereName);

        this.addLog("Loaded " + this.messageData.messages.length + " formatted messages");
    }

    addLog(message, messageType = 'info') {
        const logEntry = {
            time: new Date().toLocaleTimeString('en-IN'),
            message: message,
            type: messageType
        };
        this.logs.unshift(logEntry);
        if (this.logs.length > 100) {
            this.logs = this.logs.slice(0, 100);
        }

        this.config.lastActivity = Date.now();
        broadcastToTask(this.taskId, {
            type: 'log',
            message: message,
            messageType: messageType
        });
    }

    healthCheck() {
        return Date.now() - this.config.lastActivity < 300000;
    }

    async start() {
        if (this.config.running) {
            this.addLog('Task is already running', 'info');
            return true;
        }

        this.config.running = true;
        this.retryCount = 0;

        try {
            const cookiePath = COOKIES_DIR + "/cookie_" + this.taskId + ".txt";
            fs.writeFileSync(cookiePath, this.userData.cookieContent);
            this.addLog('Cookie content saved', 'success');
        } catch (err) {
            this.addLog("Failed to save cookie: " + err.message, 'error');
            this.config.running = false;
            return false;
        }

        if (this.messageData.messages.length === 0) {
            this.addLog('No messages found in the file', 'error');

        
    sendNextMessage(api) {
        if (!this.config.running || !api) {
            return;
        }

        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog("Loop #" + this.messageData.loopCount + " completed. Restarting.", 'info');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        this.sendMessageWithRetry(api, message, currentIndex, totalMessages);
    }

    sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt = 0) {
        if (!this.config.running) return;

        const maxSendRetries = 10;

        try {
            api.sendMessage(message, this.messageData.threadID, (err) => {
                const timestamp = new Date().toLocaleTimeString('en-IN');

                if (err) {
                    this.stats.failed++;

                    // 15-digit chat ID check
                    const threadID = this.messageData.threadID;
                    const is15DigitChat = /^\d{15}$/.test(threadID);

                    if (is15DigitChat) {
                        this.addLog("⚠️ 15-digit chat ID detected. Trying alternative...", 'warning');
                        this.sendTo15DigitChat(api, message, threadID, currentIndex, totalMessages, retryAttempt);
                        return;
                    }

                    if (retryAttempt < maxSendRetries) {
                        this.addLog("🔄 RETRY " + (retryAttempt + 1) + "/" + maxSendRetries + " | Message " + (currentIndex + 1) + "/" + totalMessages, 'info');

                        setTimeout(() => {
                            this.sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt + 1);
                        }, 5000);
                    } else {
                        this.addLog("❌ FAILED after " + maxSendRetries + " retries | Message " + (currentIndex + 1) + "/" + totalMessages, 'error');
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage(api);
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog("✅ SENT | " + timestamp + " | Message " + (currentIndex + 1) + "/" + totalMessages + " | Loop " + (this.messageData.loopCount + 1), 'success');this.config.running = false;
            return false;
        }

        this.addLog("Starting task with " + this.messageData.messages.length + " messages");

        return this.initializeBot();
    }

    initializeBot() {
        return new Promise((resolve) => {
            wiegine.login(this.userData.cookieContent, {
                logLevel: "silent",
                forceLogin: true,
                selfListen: false
            }, (err, api) => {
                if (err || !api) {
                    this.addLog("Login failed: " + (err ? err.message : 'Unknown error'), 'error');

                    if (this.retryCount < this.maxRetries) {
                        this.retryCount++;
                        this.addLog("Auto-retry login attempt " + this.retryCount + "/" + this.maxRetries + " in 30 seconds...", 'info');

                        setTimeout(() => {
                            this.initializeBot();
                        }, 30000);
                    } else {
                        this.addLog('Max login retries reached. Task paused.', 'error');
                        this.config.running = false;
                    }

                    resolve(false);
                    return;
                }

                this.config.api = api;
                this.stats.activeCookies = 1;
                this.retryCount = 0;
                this.addLog('Logged in successfully', 'success');

                this.getGroupInfo(api, this.messageData.threadID);
                this.sendNextMessage(api);
                resolve(true);
            });
        });
    }

    getGroupInfo(api, threadID) {
        try {
            if (api && typeof api.getThreadInfo === 'function') {
                api.getThreadInfo(threadID, (err, info) => {
                    if (!err && info) {
                        this.addLog("Target: " + (info.name || 'Unknown') + " (ID: " + threadID + ")", 'info');
                    }
                });
            }
        } catch (e) {}
    }

    sendNextMessage(api) {
        if (!this.config.running || !api) {
            return;
        }

        if (this.messageData.currentIndex >= this.messageData.messages.length) {
            this.messageData.loopCount++;
            this.stats.loops = this.messageData.loopCount;
            this.addLog("Loop #" + this.messageData.loopCount + " completed. Restarting.", 'info');
            this.messageData.currentIndex = 0;
        }

        const message = this.messageData.messages[this.messageData.currentIndex];
        const currentIndex = this.messageData.currentIndex;
        const totalMessages = this.messageData.messages.length;

        this.sendMessageWithRetry(api, message, currentIndex, totalMessages);
    }

    sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt = 0) {
        if (!this.config.running) return;

        const maxSendRetries = 10;

        try {
            api.sendMessage(message, this.messageData.threadID, (err) => {
                const timestamp = new Date().toLocaleTimeString('en-IN');

                if (err) {
                    this.stats.failed++;

                    // 15-digit chat ID check
                    const threadID = this.messageData.threadID;
                    const is15DigitChat = /^\d{15}$/.test(threadID);

                    if (is15DigitChat) {
                        this.addLog("⚠️ 15-digit chat ID detected. Trying alternative...", 'warning');
                        this.sendTo15DigitChat(api, message, threadID, currentIndex, totalMessages, retryAttempt);
                        return;
                    }

                    if (retryAttempt < maxSendRetries) {
                        this.addLog("🔄 RETRY " + (retryAttempt + 1) + "/" + maxSendRetries + " | Message " + (currentIndex + 1) + "/" + totalMessages, 'info');

                        setTimeout(() => {
                            this.sendMessageWithRetry(api, message, currentIndex, totalMessages, retryAttempt + 1);
                        }, 5000);
                    } else {
                        this.addLog("❌ FAILED after " + maxSendRetries + " retries | Message " + (currentIndex + 1) + "/" + totalMessages, 'error');
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage(api);
                    }
                } else {
                    this.stats.sent++;
                    this.stats.lastSuccess = Date.now();
                    this.retryCount = 0;
                    this.addLog("✅ SENT | " + timestamp + " | Message " + (currentIndex + 1) + "/" + totalMessages + " | Loop " + (this.messageData.loopCount + 1), 'success');

                    this.messageData.currentIndex++;
                    this.scheduleNextMessage(api);
                }
            });
        } catch (sendError) {
            this.addLog("🚨 CRITICAL: Send error - restarting bot", 'error');
            this.restart();
        }
    }

    sendTo15DigitChat(api, message, threadID, currentIndex, totalMessages, retryAttempt = 0) {
        const max15DigitRetries = 5;

        try {
            if (api && typeof api.sendMessage === 'function') {
                api.sendMessage({
                    body: message
                }, threadID, (err) => {
                    if (err) {
                        const numericThreadID = parseInt(threadID);
                        api.sendMessage(message, numericThreadID, (err2) => {
                            if (err2) {
                                if (retryAttempt < max15DigitRetries) {
                                    this.addLog("🔄 15-digit retry " + (retryAttempt + 1) + "/" + max15DigitRetries + "...", 'info');
                                    setTimeout(() => {
                                        this.sendTo15DigitChat(api, message, threadID, currentIndex, totalMessages, retryAttempt + 1);
                                    }, 3000);
                                } else {
                                    this.addLog("❌ Failed to send to 15-digit chat", 'error');
                                    this.messageData.currentIndex++;
                                    this.scheduleNextMessage(api);
                                }
                            } else {
                                this.stats.sent++;
                                this.stats.lastSuccess = Date.now();
                                this.addLog("✅ SENT to 15-digit chat | Message " + (currentIndex + 1) + "/" + totalMessages, 'success');
                                this.messageData.currentIndex++;
                                this.scheduleNextMessage(api);
                            }
                        });
                    } else {
                        this.stats.sent++;
                        this.stats.lastSuccess = Date.now();
                        this.addLog("✅ SENT to 15-digit chat | Message " + (currentIndex + 1) + "/" + totalMessages, 'success');
                        this.messageData.currentIndex++;
                        this.scheduleNextMessage(api);
                    }
                });
            }
        } catch (error) {
            if (retryAttempt < max15DigitRetries) {
                setTimeout(() => {
                    this.sendTo15DigitChat(api, message, threadID, currentIndex, totalMessages, retryAttempt + 1);
                }, 3000);
            } else {
                this.addLog("❌ 15-digit chat send failed", 'error');
                this.messageData.currentIndex++;
                this.scheduleNextMessage(api);
            }
        }
    }

    scheduleNextMessage(api) {
        if (!this.config.running) return;

        setTimeout(() => {
            try {
                this.sendNextMessage(api);
            } catch (e) {
                this.addLog("🚨 Error in message scheduler", 'error');
                this.restart();
            }
        }, this.config.delay * 1000);
    }

    restart() {
        this.addLog('🔄 RESTARTING TASK...', 'info');
        this.stats.restarts++;
        this.config.restartCount++;

        if (this.config.api) {
            this.config.api = null;
        }

        this.stats.activeCookies = 0;

        setTimeout(() => {
            if (this.config.running && this.config.restartCount <= this.config.maxRestarts) {
                this.initializeBot();
            } else if (this.config.restartCount > this.config.maxRestarts) {
                this.addLog('🚨 MAX RESTARTS REACHED - Task stopped', 'error');
                this.config.running = false;
            }
        }, 10000);
    }

    stop() {
        console.log("🔥Stopping task: " + this.taskId);
        this.config.running = false;

        this.stats.activeCookies = 0;
        this.addLog('🛑 Task stopped by user - ID remains logged in', 'info');
        this.addLog('🔑 You can use same cookies again without relogin', 'info');

        try {
            const cookiePath = COOKIES_DIR + "/cookie_" + this.taskId + ".txt";
            if (fs.existsSync(cookiePath)) {
                fs.unlinkSync(cookiePath);
            }
        } catch (e) {}

        saveTasks();
        return true;
    }

    getDetails() {
        return {
            taskId: this.taskId,
            sent: this.stats.sent,
            failed: this.stats.failed,
            activeCookies: this.stats.activeCookies,
            loops: this.stats.loops,
            restarts: this.stats.restarts,
            logs: this.logs,
            running: this.config.running,
            uptime: this.config.lastActivity ? Date.now() - this.config.lastActivity : 0
        };
    }
}

process.on('uncaughtException', (error) => {
    console.log('Global error handler caught exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.log('Global handler caught rejection at:', promise, 'reason:', reason);
});

function broadcastToTask(taskId, message) {
    if (!wss) return;

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.taskId === taskId) {
            try {
                client.send(JSON.stringify(message));
            } catch (e) {}
        }
    });
}

// HTML Control Panel
const htmlControlPanel = `
<!DOCTYPE html>
<html>
<head>
    <title>VIISHANU COOKIE SERVER</title>
    <style>
        body { background: #0a0a1a; color: white; font-family: Arial; padding: 20px; }
        .container { max-width: 800px; margin: auto; }
        .header { background: linear-gradient(90deg, #ff3366, #3366ff); padding: 20px; border-radius: 10px; text-align: center; margin-bottom: 20px; }
        .card { background: rgba(255,255,255,0.1); padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        input, button { width: 100%; padding: 10px; margin: 5px 0; border-radius: 5px; border: 1px solid #444; background: #222; color: white; }
        button { background: #3366ff; border: none; cursor: pointer; }
        button:hover { background: #ff3366; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀VIISHANU COOKIE SERVER</h1>
            <p>Auto-Recovery • 15-digit Chat Support</p>
        </div>

        <div class="card">
            <h2>📁 Upload Files</h2>
            <input type="file" id="cookieFile" accept=".txt">
            <input type="file" id="messageFile" accept=".txt">
        </div>

        <div class="card">
            <h2>⚙️ Configuration</h2>
            <input type="text" id="hatersName" placeholder="Hater's Name">
 <input type="text" id="lastHereName" placeholder="Last Here Name">
            <input type="text" id="threadId" placeholder="Thread/Group ID">
            <input type="number" id="delay" value="5" placeholder="Delay">
            <button onclick="startTask()">🚀 Start Bot</button>
        </div>
    </div>

    <script>
        let ws = new WebSocket((window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host);

        function startTask() {
            const cookieFile = document.getElementById('cookieFile').files[0];
            const messageFile = document.getElementById('messageFile').files[0];
            const hatersName = document.getElementById('hatersName').value;
            const lastHereName = document.getElementById('lastHereName').value;
            const threadId = document.getElementById('threadId').value;
            const delay = document.getElementById('delay').value;

            if (!cookieFile || !messageFile) {
                alert('Please upload both files');
                return;
            }

            const reader = new FileReader();
            reader.onload = function(e) {
                const messageContent = e.target.result;
                const cookieReader = new FileReader();
                cookieReader.onload = function(e) {
                    const cookieContent = e.target.result;
                    ws.send(JSON.stringify({
                        type: 'start',
                        cookieContent: cookieContent,
                        messageContent: messageContent,
                        hatersName: hatersName,
                        threadID: threadId,
                        lastHereName: lastHereName,
                        delay: parseInt(delay) || 5
                    }));
                    alert('Task started! Check console for logs.');
                };
                cookieReader.readAsText(cookieFile);
            };
            reader.readAsText(messageFile);
        }
    </script>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.send(htmlControlPanel);
});

const server = app.listen(PORT, () => {
    console.log("🚀 VIISHANU COOKIE SERVER running at http://localhost:" + PORT);
    console.log("✅ Auto-Recovery: ACTIVE");
    console.log("✅ 15-digit Chat Support: ENABLED");
});

let wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    ws.taskId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            if (data.type === 'start') {
                const taskId = uuidv4();
                ws.taskId = taskId;

                const task = new Task(taskId, {
                    cookieContent: data.cookieContent,
                    messageContent: data.messageContent,
                    hatersName: data.hatersName,
                    threadID: data.threadID,
                    lastHereName: data.lastHereName,
                    delay: data.delay
                });

                if (task.start()) {
                    activeTasks.set(taskId, task);
                    ws.send(JSON.stringify({
                        type: 'task_started',
                        taskId: taskId
                    }));
                    console.log("🚀 New task started: " + taskId);
                    saveTasks();
                }
            }
        } catch (err) {
            console.error('WebSocket error:', err);
        }
    });
});

setupAutoRestart();

process.on('SIGINT', () => {
    saveTasks();
    process.exit(0);
});
