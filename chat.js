// api/chat.js

const fs = require('fs');
const path = require('path');

const staticAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5000",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5000"
];

const CHAT_DATA_FILE = path.join('/tmp', 'chat-data.json');
const POLL_TIMEOUT = 30000; // 30 seconds long polling

// Initialize chat data structure
let chatData = {
  messages: [],
  users: [],
  typingUsers: {},
  pinnedMessage: '',
  activePoll: null,
  tempAdminState: {},
  kickedUsers: [],
  slowModeEnabled: false,
  slowModeInterval: 2000,
  tempDisableState: false,
  lastMessageTimestamps: {}
};

// Load data from file
function loadChatData() {
  try {
    if (fs.existsSync(CHAT_DATA_FILE)) {
      const data = fs.readFileSync(CHAT_DATA_FILE, 'utf8');
      chatData = JSON.parse(data);
    }
  } catch (e) {
    console.error('Error loading chat data:', e);
  }
}

// Save data to file
function saveChatData() {
  try {
    fs.writeFileSync(CHAT_DATA_FILE, JSON.stringify(chatData, null, 2));
  } catch (e) {
    console.error('Error saving chat data:', e);
  }
}

// Initialize
loadChatData();

// Helper to get current time
function getCurrentTime() {
  return new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: true });
}

// Helper to broadcast system message
function broadcastSystemMessage(text) {
  const message = {
    user: 'Server',
    text,
    color: '#000000',
    avatar: 'S',
    time: getCurrentTime(),
    id: Date.now() + '_' + Math.random()
  };
  chatData.messages.push(message);
  saveChatData();
  return message;
}

module.exports = async function chatHandler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Vary", "Origin");

  // Fetch dynamic allowed origins
  let dynamicOrigins = [];
  try {
    const fetchMod = await import('node-fetch');
    const fetch = fetchMod.default;
    const resp = await fetch("http://157.245.112.163:9000/domains");
    if (resp.ok) {
      const text = await resp.text();
      dynamicOrigins = text
        .split("<br>")
        .map(domain => domain.trim())
        .filter(Boolean)
        .map(domain => `https://${domain}`);
    }
  } catch (e) {
    dynamicOrigins = [];
  }

  const allowedOrigins = [...staticAllowedOrigins, ...dynamicOrigins];

  // Check if origin matches atari-embeds pattern or is in allowed list
  const isAtariEmbed = origin.includes('atari-embeds.googleusercontent.com');
  const isAllowedOrigin = allowedOrigins.includes(origin);

  // Handle preflight
  if (req.method === "OPTIONS") {
    if (isAllowedOrigin || isAtariEmbed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.status(204).end();
    } else {
      return res.status(403).end("Forbidden");
    }
  }

  // Enforce allowed origins
  if (!isAllowedOrigin && !isAtariEmbed) {
    return res.status(403).send("Forbidden");
  }

  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const action = (req.query && req.query.action) ? String(req.query.action).trim() : null;

  try {
    // GET /api/chat?action=poll - Long polling for updates
    if (req.method === 'GET' && action === 'poll') {
      const lastUpdate = parseInt(req.query.lastUpdate || '0');
      const startTime = Date.now();

      // Long polling - wait for new data
      const checkForUpdates = () => {
        return new Promise((resolve) => {
          const interval = setInterval(() => {
            const latestTimestamp = Math.max(
              ...chatData.messages.map(m => m.timestamp || 0),
              ...Object.values(chatData.typingUsers).map(t => t.timestamp || 0),
              chatData.lastStateChange || 0
            );

            if (latestTimestamp > lastUpdate || Date.now() - startTime > POLL_TIMEOUT) {
              clearInterval(interval);
              resolve();
            }
          }, 100);
        });
      };

      await checkForUpdates();

      return res.status(200).json({
        messages: chatData.messages,
        users: chatData.users.map(u => ({
          username: u.displayName || u.username,
          color: u.color,
          avatar: u.avatar,
          isIdle: u.isIdle
        })),
        typingUsers: Object.keys(chatData.typingUsers).filter(k => chatData.typingUsers[k].isTyping),
        pinnedMessage: chatData.pinnedMessage,
        activePoll: chatData.activePoll,
        tempDisableState: chatData.tempDisableState,
        slowModeEnabled: chatData.slowModeEnabled,
        timestamp: Date.now()
      });
    }

    // GET /api/chat?action=init - Get initial state
    if (req.method === 'GET' && action === 'init') {
      return res.status(200).json({
        messages: chatData.messages,
        users: chatData.users.map(u => ({
          username: u.displayName || u.username,
          color: u.color,
          avatar: u.avatar,
          isIdle: u.isIdle
        })),
        pinnedMessage: chatData.pinnedMessage,
        tempDisableState: chatData.tempDisableState,
        timestamp: Date.now()
      });
    }

    // POST /api/chat?action=join - Join chat
    if (req.method === 'POST' && action === 'join') {
      const { username, color, avatar, userId } = req.body;

      if (!username || !userId) {
        return res.status(400).json({ error: 'Missing username or userId' });
      }

      if (chatData.tempDisableState) {
        return res.status(403).json({ error: 'Chat is temporarily disabled' });
      }

      // Check if Eli
      if (username === 'Eli') {
        const eliExists = chatData.users.find(u => u.originalName === 'Eli');
        if (eliExists) {
          return res.status(403).json({ error: 'Username "Eli" is already in use' });
        }
        return res.status(200).json({ needsPassword: true });
      }

      // Generate unique username
      let uniqueUsername = username;
      let suffix = 2;
      const existingNames = chatData.users.map(u => u.originalName.toLowerCase());
      while (existingNames.includes(uniqueUsername.toLowerCase())) {
        uniqueUsername = `${username}${suffix}`;
        suffix++;
      }

      const user = {
        userId,
        originalName: uniqueUsername,
        displayName: uniqueUsername,
        color: username === 'Eli' ? '#f59611' : color,
        avatar,
        lastActivity: Date.now(),
        isIdle: false
      };

      chatData.users.push(user);
      const joinMessage = broadcastSystemMessage(`${uniqueUsername} has joined the chat.`);
      chatData.lastStateChange = Date.now();

      return res.status(200).json({
        success: true,
        username: uniqueUsername,
        joinMessage,
        users: chatData.users.map(u => ({
          username: u.displayName || u.username,
          color: u.color,
          avatar: u.avatar,
          isIdle: u.isIdle
        }))
      });
    }

    // POST /api/chat?action=verify-eli - Verify Eli password
    if (req.method === 'POST' && action === 'verify-eli') {
      const { password, color, avatar, userId } = req.body;
      const correctPassword = Buffer.from('ZWxpYWRtaW4xMjM=', 'base64').toString('utf8');

      if (password !== correctPassword) {
        return res.status(401).json({ error: 'Incorrect password' });
      }

      chatData.tempAdminState[userId] = { firstInitTime: Date.now(), tempAdminGranted: true };

      const user = {
        userId,
        originalName: 'Eli',
        displayName: 'Eli',
        color: '#f59611',
        avatar,
        lastActivity: Date.now(),
        isIdle: false
      };

      chatData.users.push(user);
      const joinMessage = broadcastSystemMessage('Eli has joined the chat.');
      chatData.lastStateChange = Date.now();

      return res.status(200).json({
        success: true,
        username: 'Eli',
        joinMessage,
        users: chatData.users.map(u => ({
          username: u.displayName || u.username,
          color: u.color,
          avatar: u.avatar,
          isIdle: u.isIdle
        }))
      });
    }

    // POST /api/chat?action=message - Send message
    if (req.method === 'POST' && action === 'message') {
      const { userId, message, privateRecipient } = req.body;
      const user = chatData.users.find(u => u.userId === userId);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      const now = Date.now();
      const trimmed = message.trim().toLowerCase();

      // Check if kicked
      if (chatData.kickedUsers.includes(userId)) {
        return res.status(403).json({
          error: 'You have been kicked',
          privateMessage: '❌ You have been kicked and cannot send messages.'
        });
      }

      // Check temp disable
      if (chatData.tempDisableState && !trimmed.startsWith('server init')) {
        return res.status(403).json({
          error: 'Chat disabled',
          privateMessage: '❌ Admin has enabled temp chat disable. You cannot send messages.'
        });
      }

      // Check slow mode
      if (chatData.slowModeEnabled && !trimmed.startsWith('server init')) {
        const lastMsg = chatData.lastMessageTimestamps[userId] || 0;
        if (now - lastMsg < chatData.slowModeInterval) {
          return res.status(429).json({
            error: 'Slow mode',
            privateMessage: '⏳ Slow mode is enabled. Please wait.'
          });
        }
      }

      chatData.lastMessageTimestamps[userId] = now;
      user.lastActivity = now;

      // Handle admin commands
      const adminResponse = handleAdminCommand(message, user, userId);
      if (adminResponse) {
        chatData.lastStateChange = Date.now();
        return res.status(200).json(adminResponse);
      }

      // Regular message
      const msg = {
        user: user.displayName,
        text: message,
        color: user.color,
        avatar: user.avatar,
        time: getCurrentTime(),
        id: Date.now() + '_' + Math.random(),
        timestamp: now,
        privateRecipient: privateRecipient || null
      };

      chatData.messages.push(msg);
      
      // Keep last 500 messages
      if (chatData.messages.length > 500) {
        chatData.messages = chatData.messages.slice(-500);
      }

      saveChatData();
      chatData.lastStateChange = Date.now();

      return res.status(200).json({
        success: true,
        message: msg
      });
    }

    // POST /api/chat?action=typing - Update typing status
    if (req.method === 'POST' && action === 'typing') {
      const { userId, username, isTyping } = req.body;
      
      if (isTyping) {
        chatData.typingUsers[userId] = { username, isTyping: true, timestamp: Date.now() };
      } else {
        delete chatData.typingUsers[userId];
      }

      // Clean old typing indicators (>5 seconds)
      const now = Date.now();
      Object.keys(chatData.typingUsers).forEach(uid => {
        if (now - chatData.typingUsers[uid].timestamp > 5000) {
          delete chatData.typingUsers[uid];
        }
      });

      return res.status(200).json({ success: true });
    }

    // POST /api/chat?action=leave - Leave chat
    if (req.method === 'POST' && action === 'leave') {
      const { userId } = req.body;
      const userIndex = chatData.users.findIndex(u => u.userId === userId);
      
      if (userIndex !== -1) {
        const user = chatData.users[userIndex];
        chatData.users.splice(userIndex, 1);
        broadcastSystemMessage(`${user.originalName} has left the chat.`);
        delete chatData.typingUsers[userId];
        chatData.lastStateChange = Date.now();
        saveChatData();
      }

      return res.status(200).json({ success: true });
    }

    // POST /api/chat?action=update-activity - Update user activity
    if (req.method === 'POST' && action === 'update-activity') {
      const { userId, isIdle } = req.body;
      const user = chatData.users.find(u => u.userId === userId);
      
      if (user) {
        user.lastActivity = Date.now();
        user.isIdle = isIdle || false;
        if (user.isIdle) {
          user.displayName = `${user.originalName} (idle)`;
        } else {
          user.displayName = user.originalName;
        }
      }

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action or method' });

  } catch (err) {
    console.error("Error in /api/chat:", err);
    return res.status(500).json({ error: 'Internal server error', detail: err.message });
  }
};

function handleAdminCommand(message, user, userId) {
  const trimmed = message.trim().toLowerCase();
  const record = chatData.tempAdminState[userId];
  const now = Date.now();

  // Admin init2
  if (trimmed === 'server init2') {
    if (!record || now - record.firstInitTime > 10000) {
      chatData.tempAdminState[userId] = { firstInitTime: now, tempAdminGranted: false };
      return { privateMessage: 'Ok', updates: {} };
    }
    if (!record.tempAdminGranted) {
      record.tempAdminGranted = true;
      return { privateMessage: 'Temp Admin Granted', updates: {} };
    }
  }

  // Check authorization
  if (trimmed.startsWith('server init') && (!record || !record.tempAdminGranted)) {
    return { privateMessage: '❌ You are not authorized to use admin commands.', updates: {} };
  }

  // Broadcast
  if (trimmed.startsWith('server init broadcast ')) {
    const text = message.slice('server init broadcast '.length).trim();
    const msg = broadcastSystemMessage(`📢 Admin Broadcast: ${text}`);
    return { success: true, broadcastMessage: msg };
  }

  // Slow mode
  if (trimmed === 'server init slowmode on') {
    chatData.slowModeEnabled = true;
    const msg = broadcastSystemMessage('⚙️ Admin has enabled slow mode.');
    return { success: true, broadcastMessage: msg };
  }

  if (trimmed === 'server init slowmode off') {
    chatData.slowModeEnabled = false;
    const msg = broadcastSystemMessage('⚙️ Admin has disabled slow mode.');
    return { success: true, broadcastMessage: msg };
  }

  if (trimmed.startsWith('server init slowmode ')) {
    const time = parseFloat(trimmed.split(' ')[3]);
    if (!isNaN(time) && time > 0) {
      chatData.slowModeInterval = time * 1000;
      return { privateMessage: `⏳ Slowmode delay changed to ${time} seconds.` };
    }
  }

  // Clear history
  if (trimmed === 'server init clear history') {
    chatData.messages = [];
    saveChatData();
    const msg = broadcastSystemMessage('🧹 Chat history has been cleared.');
    return { success: true, broadcastMessage: msg, clearHistory: true };
  }

  // Kick user
  if (trimmed.startsWith('server init kick ')) {
    const targetName = trimmed.replace('server init kick ', '').trim();
    const targetUser = chatData.users.find(u =>
      u.originalName.toLowerCase() === targetName.toLowerCase()
    );
    if (targetUser) {
      chatData.kickedUsers.push(targetUser.userId);
      const msg = broadcastSystemMessage(`${targetUser.originalName} was kicked by ${user.originalName}.`);
      saveChatData();
      return { success: true, broadcastMessage: msg };
    }
    return { privateMessage: `❌ Could not find user "${targetName}".` };
  }

  // Pin message
  if (trimmed.startsWith('server init pin ')) {
    const pinMessage = message.slice('server init pin '.length).trim();
    chatData.pinnedMessage = pinMessage;
    saveChatData();
    const msg = broadcastSystemMessage(`📌 Message pinned: ${pinMessage}`);
    return { success: true, broadcastMessage: msg, pinnedMessage: pinMessage };
  }

  if (trimmed === 'server init pinoff') {
    chatData.pinnedMessage = '';
    saveChatData();
    return { success: true, pinnedMessage: '' };
  }

  // Poll
  if (trimmed.startsWith('server init poll ')) {
    if (chatData.activePoll) {
      return { privateMessage: '❌ A poll is already running.' };
    }
    const pollArgs = trimmed.replace('server init poll ', '').trim().split(' ');
    if (pollArgs.length < 2) {
      return { privateMessage: '❌ Please provide two options' };
    }
    chatData.activePoll = {
      options: [pollArgs[0], pollArgs[1]],
      votes: {}
    };
    const msg = broadcastSystemMessage(`Poll started!\nOption 1: ${pollArgs[0]}\nOption 2: ${pollArgs[1]}\nVote: !vote 1 or !vote 2`);
    saveChatData();
    return { success: true, broadcastMessage: msg, activePoll: chatData.activePoll };
  }

  if (trimmed.startsWith('!vote')) {
    if (!chatData.activePoll) {
      return { privateMessage: '❌ No active poll.' };
    }
    const voteNum = parseInt(trimmed.replace('!vote', '').trim());
    if (![1, 2].includes(voteNum)) {
      return { privateMessage: '❌ Invalid vote.' };
    }
    chatData.activePoll.votes[userId] = voteNum - 1;
    const counts = [0, 0];
    Object.values(chatData.activePoll.votes).forEach(v => counts[v]++);
    const msg = broadcastSystemMessage(`Poll results:\n${chatData.activePoll.options[0]}: ${counts[0]}\n${chatData.activePoll.options[1]}: ${counts[1]}`);
    saveChatData();
    return { success: true, broadcastMessage: msg };
  }

  if (trimmed === 'server init endpoll') {
    if (!chatData.activePoll) {
      return { privateMessage: '❌ No poll active.' };
    }
    const counts = [0, 0];
    Object.values(chatData.activePoll.votes).forEach(v => counts[v]++);
    const msg = broadcastSystemMessage(`Poll ended:\n${chatData.activePoll.options[0]}: ${counts[0]}\n${chatData.activePoll.options[1]}: ${counts[1]}`);
    chatData.activePoll = null;
    saveChatData();
    return { success: true, broadcastMessage: msg, activePoll: null };
  }

  return null;
}
