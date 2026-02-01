const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { OctoolsClient, AuthError } = require('../dist/index.js');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = 8081;
const OPENCODE_URL = 'http://localhost:4096';
const SESSION_TIMEOUT = 2 * 60 * 1000; // 2 minutes

// Store active sessions and their clients
const sessions = new Map();
const octoolsClient = new OctoolsClient({
  baseUrl: OPENCODE_URL,
  autoConnect: true
});

// Session monitoring
function createSessionMonitor(sessionID) {
  return {
    sessionID,
    lastActivity: Date.now(),
    status: 'idle',
    octoolsClient: null,
    checkInterval: null
  };
}

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.get('/api/agents', async (req, res) => {
  try {
    const response = await fetch(`${OPENCODE_URL}/config`);
    const config = await response.json();
    const agents = config.agent ? Object.keys(config.agent) : [];
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(`${OPENCODE_URL}/provider`);
    const data = await response.json();
    const models = [];
    
    const connectedIDs = new Set(data.connected || []);
    
    if (data.all && Array.isArray(data.all)) {
      data.all.forEach(provider => {
        // Only include models from connected providers
        if (connectedIDs.has(provider.id) && provider.models) {
          Object.values(provider.models).forEach(model => {
            models.push({ 
              providerID: provider.id, 
              modelID: model.id,
              name: model.name || model.id
            });
          });
        }
      });
    }

    // Order by name
    models.sort((a, b) => a.name.localeCompare(b.name));
    
    res.json(models);
  } catch (error) {
    console.error('Failed to fetch models:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session', async (req, res) => {
  try {
    const { agent, secondaryAgent, model, directory } = req.body;
    const options = { directory: directory || '/root' };
    if (agent) options.agent = agent;
    if (secondaryAgent) options.secondaryAgent = secondaryAgent;
    if (model) options.model = model;
    
    const session = await octoolsClient.createSession(options);
    
    // Create session monitor
    const monitor = createSessionMonitor(session.id);
    sessions.set(session.id, monitor);
    
    res.json(session);
  } catch (error) {
    if (error instanceof AuthError || error.statusCode === 401 || error.message.includes('Authentication failed')) {
      res.status(401).json({ error: 'Authentication failed', details: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/api/session/:sessionID', async (req, res) => {
  try {
    const session = await octoolsClient.loadSession(req.params.sessionID);
    res.json(session);
  } catch (error) {
    if (error instanceof AuthError || error.statusCode === 401 || error.message.includes('Authentication failed')) {
      res.status(401).json({ error: 'Authentication failed', details: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/api/session/:sessionID/messages', async (req, res) => {
  try {
    const messages = await octoolsClient.getMessages(req.params.sessionID);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/:sessionID/message', async (req, res) => {
  try {
    const { text, agent, model } = req.body;
    
    // We need to support passing agent/model to sendMessage if the library supports it
    // Looking at src/client.ts, sendMessage only takes sessionID and text.
    // However, the OpenCode API supports parts or session-level overrides.
    
    // Let's modify sendMessage in client.ts to accept options
    const message = await octoolsClient.sendMessage(req.params.sessionID, text, { agent, model });
    
    // Update activity
    const monitor = sessions.get(req.params.sessionID);
    if (monitor) {
      monitor.lastActivity = Date.now();
    }
    
    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/question/:requestID/reply', async (req, res) => {
  try {
    const { sessionID, answers } = req.body;
    await octoolsClient.replyToQuestion(req.params.requestID, sessionID, answers);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket handling
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  let currentSessionID = null;
  
  // Forward octools events to WebSocket client
  const eventHandlers = {
    'session.status': (data) => {
      if (currentSessionID === data.sessionID) {
        const monitor = sessions.get(data.sessionID);
        if (monitor) {
          const sessionStatus = data.status || data.type;
          monitor.status = sessionStatus;
          if (sessionStatus === 'busy' || sessionStatus === 'idle') {
            monitor.lastActivity = Date.now();
          }
        }
        ws.send(JSON.stringify({ type: 'session.status', data }));
      }
    },
    'message.new': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'message.new', data }));
      }
    },
    'message.delta': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'message.delta', data }));
      }
    },
    'message.part': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'message.part', data }));
      }
    },
    'message.complete': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'message.complete', data }));
      }
    },
    'question': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'question', data }));
      }
    },
    'permission': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'permission', data }));
      }
    },
    'subagent.progress': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'subagent.progress', data }));
      }
    },
    'session.error': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.error', data }));
      }
    },
    'session.error.auth': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.error.auth', data }));
      }
    },
    'session.agent_switched': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.agent_switched', data }));
      }
    },
    'error': (error) => {
      ws.send(JSON.stringify({ type: 'error', data: { message: error.message } }));
    }
  };
  
  // Register all event handlers
  Object.entries(eventHandlers).forEach(([event, handler]) => {
    octoolsClient.on(event, handler);
  });
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'subscribe') {
        currentSessionID = data.sessionID;
        console.log(`Client subscribed to session: ${currentSessionID}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    // Remove event handlers
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      octoolsClient.off(event, handler);
    });
  });
});

// Session monitoring loop
app.get('/api/logs', (req, res) => {
  const sessionID = req.query.sessionID;
  if (sessionID) {
    const logs = octoolsClient.rawEvents.filter(e => {
      return e.payload && e.payload.properties && e.payload.properties.sessionID === sessionID;
    });
    res.json(logs);
  } else {
    res.json(octoolsClient.rawEvents);
  }
});

setInterval(() => {
  const now = Date.now();
  
  sessions.forEach((monitor, sessionID) => {
    if (monitor.status === 'busy') {
      const idleTime = now - monitor.lastActivity;
      
      if (idleTime > SESSION_TIMEOUT) {
        console.log(`Session ${sessionID} timed out. Killing...`);
        
        // Notify all clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'session.timeout',
              data: { sessionID, message: 'Session timed out and will be restarted' }
            }));
          }
        });
        
        // Remove from monitor
        sessions.delete(sessionID);
      }
    }
  });
}, 10000); // Check every 10 seconds

// Start server
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Chat webapp running on http://${HOST}:${PORT}`);
  console.log(`Connecting to OpenCode at ${OPENCODE_URL}`);
});
