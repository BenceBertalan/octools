const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { OctoolsClient, AuthError } = require('../dist/index.js');
const db = require('./database');

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
  autoConnect: true,
  livenessCheckInterval: 1000,  // Check every second
  sessionTimeout: 240000         // Timeout after 4 minutes (240 seconds)
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
    const agents = await octoolsClient.getAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get global config
app.get('/api/config', async (req, res) => {
  try {
    const agentRow = await db.get('SELECT value FROM config WHERE key = ?', ['agent']);
    const priorityRow = await db.get('SELECT value FROM config WHERE key = ?', ['model_priority']);
    
    res.json({
      agent: agentRow ? JSON.parse(agentRow.value) : {},
      model_priority: priorityRow ? JSON.parse(priorityRow.value) : { enabled: false, models: [] }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update global config
app.patch('/api/config', async (req, res) => {
  try {
    if (req.body.agent) {
       const row = await db.get('SELECT value FROM config WHERE key = ?', ['agent']);
       const current = row ? JSON.parse(row.value) : {};
       const updated = { ...current, ...req.body.agent };
       await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['agent', JSON.stringify(updated)]);
    }
    
    if (req.body.model_priority) {
       const row = await db.get('SELECT value FROM config WHERE key = ?', ['model_priority']);
       const current = row ? JSON.parse(row.value) : { enabled: false, models: [] };
       const updated = { ...current, ...req.body.model_priority };
       await db.run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', ['model_priority', JSON.stringify(updated)]);
    }
    
    // Return updated config
    const agentRow = await db.get('SELECT value FROM config WHERE key = ?', ['agent']);
    const priorityRow = await db.get('SELECT value FROM config WHERE key = ?', ['model_priority']);
    
    res.json({
        agent: agentRow ? JSON.parse(agentRow.value) : {},
        model_priority: priorityRow ? JSON.parse(priorityRow.value) : { enabled: false, models: [] }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Notes API endpoints
// Get notes (global or session-specific)
app.get('/api/notes', async (req, res) => {
  try {
    const { sessionID } = req.query;
    let notes;
    if (sessionID) {
      notes = await db.all('SELECT * FROM notes WHERE session_id = ? ORDER BY created_at DESC', [sessionID]);
    } else {
      notes = await db.all('SELECT * FROM notes WHERE session_id IS NULL ORDER BY created_at DESC');
    }
    
    // Map DB columns to API response format
    const response = notes.map(n => ({
        id: n.id,
        title: n.title,
        content: n.content,
        sessionID: n.session_id,
        created: n.created_at,
        updated: n.updated_at
    }));
    
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new note
app.post('/api/notes', async (req, res) => {
  try {
    const { title, content, sessionID } = req.body;
    const note = {
      id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: title || 'Untitled Note',
      content: content || '',
      sessionID: sessionID || null,
      created: Date.now(),
      updated: Date.now()
    };
    
    await db.run(
        'INSERT INTO notes (id, title, content, session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [note.id, note.title, note.content, note.sessionID, note.created, note.updated]
    );
    
    res.json(note);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update a note
app.patch('/api/notes/:noteID', async (req, res) => {
  try {
    const { noteID } = req.params;
    const { title, content } = req.body; // We don't update sessionID usually
    
    // First check if note exists
    const note = await db.get('SELECT * FROM notes WHERE id = ?', [noteID]);
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    const updates = [];
    const params = [];
    
    if (title !== undefined) {
        updates.push('title = ?');
        params.push(title);
    }
    if (content !== undefined) {
        updates.push('content = ?');
        params.push(content);
    }
    
    if (updates.length > 0) {
        updates.push('updated_at = ?');
        params.push(Date.now());
        params.push(noteID);
        
        await db.run(`UPDATE notes SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a note
app.delete('/api/notes/:noteID', async (req, res) => {
  try {
    const { noteID } = req.params;
    await db.run('DELETE FROM notes WHERE id = ?', [noteID]);
    res.json({ success: true });
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
    const { agent, model, secondaryModel, directory } = req.body;
    const options = { directory: directory || '/root' };
    if (agent) options.agent = agent;
    if (model) options.model = model;
    if (secondaryModel) options.secondaryModel = secondaryModel;
    
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

app.patch('/api/session/:sessionID', async (req, res) => {
  try {
    const { title, history_limit } = req.body;
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (history_limit !== undefined) updates.history_limit = history_limit;
    
    const session = await octoolsClient.updateSession(req.params.sessionID, updates);
    res.json(session);
  } catch (error) {
    if (error instanceof AuthError || error.statusCode === 401 || error.message.includes('Authentication failed')) {
      res.status(401).json({ error: 'Authentication failed', details: error.message });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/api/sessions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search;
    const start = req.query.start ? parseInt(req.query.start) : undefined;
    const sessions = await octoolsClient.listSessions({ limit, search, start });
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/session/:sessionID/messages', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
    const messages = await octoolsClient.getMessages(req.params.sessionID, { limit });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/:sessionID/message', async (req, res) => {
  console.log(`[API] Message to session ${req.params.sessionID}:`, req.body.text?.substring(0, 50));
  try {
    const { text, agent, model, system } = req.body;
    const options = { agent, model };
    
    // Include system prompt if provided
    if (system) {
      options.system = system;
      console.log(`[API] Using custom system prompt for agent ${agent}`);
    }
    
    const message = await octoolsClient.sendMessage(req.params.sessionID, text, options);
    
    // Update activity
    const monitor = sessions.get(req.params.sessionID);
    if (monitor) {
      monitor.lastActivity = Date.now();
    }
    
    console.log(`[API] Message response success:`, !!message);
    res.json(message);
  } catch (error) {
    console.error(`[API] Send message error:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get all diffs for a session (for Files tab)
app.get('/api/session/:sessionID/diff', async (req, res) => {
  try {
    const { sessionID } = req.params;
    
    // Call OpenCode API to get all diffs
    const response = await fetch(`${OPENCODE_URL}/session/${sessionID}/diff`);
    
    if (!response.ok) {
      throw new Error(`OpenCode API error: ${response.statusText}`);
    }
    
    const diffs = await response.json();
    
    // Return array of FileDiff objects
    res.json(diffs || []);
    
  } catch (error) {
    console.error('Error fetching session diffs:', error);
    res.status(500).json({ 
      error: 'Failed to fetch session diffs',
      details: error.message 
    });
  }
});

app.get('/api/session/:sessionID/diff/:file', async (req, res) => {
  try {
    const { sessionID, file } = req.params;
    const filename = decodeURIComponent(file);
    
    // Call OpenCode API to get all diffs
    const response = await fetch(`${OPENCODE_URL}/session/${sessionID}/diff`);
    if (!response.ok) throw new Error('Failed to fetch diff');
    
    const allDiffs = await response.json();
    const fileDiff = allDiffs.find(d => d.file === filename);
    
    if (!fileDiff) {
      return res.status(404).json({ error: 'File diff not found' });
    }
    
    // Return formatted diff info (full git integration would require git commands)
    const diffOutput = `@@ File: ${fileDiff.file} @@
Additions: +${fileDiff.additions}
Deletions: -${fileDiff.deletions}
Before: ${fileDiff.before || '(new file)'}
After: ${fileDiff.after}

Note: Full diff content requires git integration.
To see changes, use: git diff ${fileDiff.before || 'HEAD'} ${fileDiff.after} -- ${fileDiff.file}`;
    
    res.type('text/plain').send(diffOutput);
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/:sessionID/abort', async (req, res) => {
  try {
    await octoolsClient.abortSession(req.params.sessionID);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/:sessionID/liveness/pause', async (req, res) => {
  try {
    octoolsClient.pauseLivenessMonitoring(req.params.sessionID);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/session/:sessionID/liveness/resume', async (req, res) => {
  try {
    octoolsClient.resumeLivenessMonitoring(req.params.sessionID);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/question/:requestID/reply', async (req, res) => {
  console.log(`[API] Reply to question ${req.params.requestID}:`, JSON.stringify(req.body, null, 2));
  try {
    const { answers } = req.body;
    await octoolsClient.replyToQuestion(req.params.requestID, answers);
    res.json({ success: true });
  } catch (error) {
    console.error(`[API] Reply error:`, error);
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
        console.log(`[WS] Sending session.status (${data.status}) to client`);
        const monitor = sessions.get(data.sessionID);
        if (monitor) {
          const sessionStatus = (data.status && data.status.type) || data.status || data.type;
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
        console.log(`[WS] Sending message.delta to client`);
        ws.send(JSON.stringify({ type: 'message.delta', data }));
      } else {
        console.log(`[WS] Skipping message.delta: currentSessionID=${currentSessionID} vs eventSessionID=${data.sessionID}`);
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
    'session.model_switched': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.model_switched', data }));
      }
    },
    'session.retrying_alternative': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.retrying_alternative', data }));
      }
    },
    'session.diff': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.diff', data }));
      }
    },
    'session.updated': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.updated', data }));
      }
    },
    'session.liveness': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.liveness', data }));
      }
    },
    'session.retry.start': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.retry.start', data }));
      }
    },
    'session.retry.success': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.retry.success', data }));
      }
    },
    'session.retry.failed': (data) => {
      if (currentSessionID === data.sessionID) {
        ws.send(JSON.stringify({ type: 'session.retry.failed', data }));
      }
    },
    'session.sync.complete': (data) => {
      console.log(`[WS] Received session.sync.complete:`, data);
      if (currentSessionID === data.sessionID) {
        console.log(`[WS] Forwarding session.sync.complete to client`);
        ws.send(JSON.stringify({ type: 'session.sync.complete', data }));
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
        console.log(`[WS] Client subscribed to session: ${currentSessionID}`);
        
        // Trigger historical sync for this session
        octoolsClient.syncSession(currentSessionID).catch(err => {
          console.error(`[WS] Sync session error for ${currentSessionID}:`, err);
        });
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

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('HTTP/WS server closed.');
    // db is imported as module { db, run, get, all }
    // The sqlite3 instance is db.db
    if (db && db.db) {
        db.db.close((err) => {
            if (err) console.error('Error closing database:', err.message);
            else console.log('Database connection closed.');
            process.exit(0);
        });
    } else {
        process.exit(0);
    }
  });
  
  // Force close after 5s if active connections persist
  setTimeout(() => {
    console.error('Forcing shutdown...');
    process.exit(1);
  }, 5000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
