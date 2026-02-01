// State management
let currentSession = null;
let ws = null;
let currentQuestion = null;
let agents = [];
let models = [];
let messageBuffer = new Map(); // Store streaming message parts

// DOM elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const questionModal = document.getElementById('questionModal');
const closeQuestion = document.getElementById('closeQuestion');
const authModal = document.getElementById('authModal');
const closeAuth = document.getElementById('closeAuth');
const authErrorDetails = document.getElementById('authErrorDetails');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const messagesContainer = document.getElementById('messagesContainer');
const eventsContainer = document.getElementById('eventsContainer');
const logsContainer = document.getElementById('logsContainer');
const logCount = document.getElementById('logCount');
const refreshLogsBtn = document.getElementById('refreshLogs');
const agentSelect = document.getElementById('agentSelect');
const modelSelect = document.getElementById('modelSelect');
const directoryInput = document.getElementById('directoryInput');
const createSessionBtn = document.getElementById('createSessionBtn');
const qsAgentSelect = document.getElementById('qsAgentSelect');
const qsModelSelect = document.getElementById('qsModelSelect');
const hideReasoningCheckbox = document.getElementById('hideReasoning');
const darkThemeCheckbox = document.getElementById('darkTheme');
const submitAnswer = document.getElementById('submitAnswer');
const questionTitle = document.getElementById('questionTitle');
const questionText = document.getElementById('questionText');
const questionOptions = document.getElementById('questionOptions');

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(tab + 'Tab').classList.add('active');
    });
});

// Modal controls
settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('active');
});

closeSettings.addEventListener('click', () => {
    settingsModal.classList.remove('active');
});

closeQuestion.addEventListener('click', () => {
    questionModal.classList.remove('active');
});

closeAuth.addEventListener('click', () => {
    authModal.classList.remove('active');
});

function showAuthError(message) {
    authErrorDetails.textContent = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
    authModal.classList.add('active');
    updateStatus('error', 'Authentication Failed');
}

// Auto-resize textarea
messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
    sendBtn.disabled = !messageInput.value.trim();
});

// Send message
sendBtn.addEventListener('click', sendMessage);
refreshLogsBtn.addEventListener('click', fetchLogs);
messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Cookie helpers
function setCookie(name, value, days = 30) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = name + "=" + value + ";" + expires + ";path=/";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i=0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0)==' ') c = c.substring(1,c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
    }
    return null;
}

// Dark theme toggle
darkThemeCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
        document.body.classList.add('dark');
        setCookie('darkTheme', 'true');
    } else {
        document.body.classList.remove('dark');
        setCookie('darkTheme', 'false');
    }
});

// Hide reasoning toggle
hideReasoningCheckbox.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if (isChecked) {
        document.body.classList.add('hide-reasoning');
    } else {
        document.body.classList.remove('hide-reasoning');
    }
    setCookie('hideReasoning', isChecked ? 'true' : 'false');
});

// Sync bottom bar with modal and store preferences
qsAgentSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    agentSelect.value = val;
    setCookie('favAgent', val);
});

qsModelSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    modelSelect.value = val;
    setCookie('favModel', val);
});

// Apply stored preferences on load
function applyStoredPreferences() {
    const dark = getCookie('darkTheme');
    if (dark === 'true') {
        document.body.classList.add('dark');
        darkThemeCheckbox.checked = true;
    }

    const hide = getCookie('hideReasoning');
    if (hide === 'true') {
        document.body.classList.add('hide-reasoning');
        hideReasoningCheckbox.checked = true;
    }
}

async function sendMessage() {
    console.log('sendMessage called. Current session:', currentSession);
    if (!currentSession) {
        alert('Please create a session first (click the gear icon)');
        settingsModal.classList.add('active');
        return;
    }
    
    if (!messageInput.value.trim()) return;
    
    const text = messageInput.value.trim();
    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    
    // Add user message to UI
    addMessage('user', text);
    
    // Show typing indicator
    addTypingIndicator('assistant-typing');
    
    try {
        console.log(`Sending message to session ${currentSession.id}...`);
        
        const agent = qsAgentSelect.value || undefined;
        const modelStr = qsModelSelect.value;
        const model = modelStr ? JSON.parse(modelStr) : undefined;

        const response = await fetch(`/api/session/${currentSession.id}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, agent, model })
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                const error = await response.json();
                showAuthError(error.details || error.error || 'Unauthorized');
                removeTypingIndicator('assistant-typing');
                sendBtn.disabled = false;
                return;
            }
            const error = await response.json();
            throw new Error(error.error || response.statusText);
        }
        
        console.log('Message sent successfully');
    } catch (error) {
        console.error('Send message error:', error);
        removeTypingIndicator('assistant-typing');
        addEvent('Error', 'Failed to send message: ' + error.message);
        alert('Failed to send message: ' + error.message);
        sendBtn.disabled = false;
    }
}

function addMessage(role, text, isQuestion = false, isError = false, isWarning = false) {
    console.log(`[UI] addMessage: role=${role}, text=${text?.substring(0, 30)}...`);
    
    if (!text) return;

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role}`;
    if (isQuestion) {
        bubble.classList.add('question');
        bubble.onclick = () => openQuestionModal(currentQuestion);
    }
    if (isError) {
        bubble.classList.add('error');
    }
    if (isWarning) {
        bubble.classList.add('warning');
    }
    
    bubble.innerHTML = marked.parse(text);
    messagesContainer.appendChild(bubble);
    
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString();
    messagesContainer.appendChild(time);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function updateStreamingMessage(messageID, text, isReasoning = false) {
    let streamMsg = document.getElementById('stream-' + messageID);
    if (!streamMsg) {
        streamMsg = document.createElement('div');
        streamMsg.id = 'stream-' + messageID;
        streamMsg.className = 'message-bubble assistant';
        if (isReasoning) streamMsg.classList.add('reasoning');
        messagesContainer.appendChild(streamMsg);
    }
    
    streamMsg.innerHTML = marked.parse(text);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeStreamingMessage(messageID) {
    const streamMsg = document.getElementById('stream-' + messageID);
    if (streamMsg) streamMsg.remove();
}

function showQuestionNotification(data) {
    addMessage('assistant', '🤔 I have a question for you. Click to answer.', true);
}

function openQuestionModal(data) {
    if (!data) return;
    
    questionTitle.textContent = data.header || 'Question';
    questionText.textContent = data.question;
    questionOptions.innerHTML = '';
    
    if (data.questions && data.questions[0]) {
        const q = data.questions[0];
        q.options.forEach((option, idx) => {
            const optDiv = document.createElement('div');
            optDiv.className = 'question-option';
            
            if (q.multiple) {
                optDiv.innerHTML = `
                    <input type="checkbox" id="opt-${idx}" value="${option.label}">
                    <label for="opt-${idx}">${option.label}</label>
                    <div style="font-size: 12px; color: #65676b; margin-top: 4px;">${option.description}</div>
                `;
            } else {
                optDiv.innerHTML = `
                    <strong>${option.label}</strong>
                    <div style="font-size: 12px; color: #65676b; margin-top: 4px;">${option.description}</div>
                `;
                optDiv.onclick = () => {
                    document.querySelectorAll('.question-option').forEach(o => o.classList.remove('selected'));
                    optDiv.classList.add('selected');
                    optDiv.dataset.value = option.label;
                };
            }
            questionOptions.appendChild(optDiv);
        });
    }
    questionModal.classList.add('active');
}

submitAnswer.addEventListener('click', async () => {
    if (!currentQuestion) return;
    
    const q = currentQuestion.questions[0];
    let answers = [];
    
    if (q.multiple) {
        answers = Array.from(questionOptions.querySelectorAll('input:checked')).map(cb => cb.value);
    } else {
        const selected = questionOptions.querySelector('.question-option.selected');
        if (selected) answers = [selected.dataset.value];
    }
    
    if (answers.length === 0) {
        alert('Please select an answer');
        return;
    }
    
    try {
        await fetch(`/api/question/${currentQuestion.requestID}/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionID: currentSession.id, answers })
        });
        
        questionModal.classList.remove('active');
        currentQuestion = null;
        addMessage('user', '✅ Answer submitted: ' + answers.join(', '));
    } catch (error) {
        console.error('Submit answer error:', error);
        alert('Failed to submit answer');
    }
});

function updateStatus(status, text) {
    statusDot.className = 'status-dot ' + status;
    statusText.textContent = text || status.charAt(0).toUpperCase() + status.slice(1);
}

function addEvent(type, data) {
    const item = document.createElement('div');
    item.className = 'event-item';
    
    const header = document.createElement('div');
    header.className = 'event-header';
    header.textContent = type;
    
    const body = document.createElement('div');
    body.className = 'event-body';
    body.textContent = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
    
    const time = document.createElement('div');
    time.className = 'event-time';
    time.textContent = new Date().toLocaleTimeString();
    
    item.appendChild(header);
    item.appendChild(body);
    item.appendChild(time);
    
    eventsContainer.prepend(item);
}

function addTypingIndicator(id) {
    if (document.getElementById(id)) return;
    const indicator = document.createElement('div');
    indicator.id = id;
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    messagesContainer.appendChild(indicator);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeTypingIndicator(id) {
    const indicator = document.getElementById(id);
    if (indicator) indicator.remove();
}

function updateSubagentProgress(data) {
    const { messageID, partID, agent, task, status } = data;
    const progressID = `progress-${messageID}-${partID}`;
    let progressEl = document.getElementById(progressID);
    
    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.id = progressID;
        progressEl.className = 'subagent-pill';
        
        // Find the assistant message or streaming message to attach to
        let target = document.getElementById('stream-' + messageID);
        if (!target) {
            // If message is complete, it might not have an ID on the bubble yet
            // We'll append to container for now or find the last bubble
            target = messagesContainer.lastElementChild;
        }
        
        if (target) {
            target.after(progressEl);
        } else {
            messagesContainer.appendChild(progressEl);
        }
    }
    
    const icon = status === 'running' ? '⏳' : status === 'completed' ? '✅' : status === 'error' ? '❌' : '⚪';
    const statusClass = status === 'running' ? 'spinning' : '';
    
    progressEl.innerHTML = `
        <span class="pill-icon ${statusClass}">${icon}</span>
        <span class="pill-agent">${agent}</span>: 
        <span class="pill-task">${task}</span>
    `;
    progressEl.className = `subagent-pill ${status}`;
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        addEvent('System', 'WebSocket connected');
        if (currentSession) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionID: currentSession.id }));
        }
    };
    
    ws.onmessage = (event) => {
        const { type, data } = JSON.parse(event.data);
        addEvent(type, data);
        
        switch (type) {
            case 'session.status':
                updateStatus(data.type, `Session: ${data.sessionID.substring(0, 8)} (${data.type})`);
                if (data.type === 'busy') addTypingIndicator('assistant-typing');
                else if (data.type === 'idle') removeTypingIndicator('assistant-typing');
                else if (data.type === 'retry') {
                    const retryMsg = data.message || 'Retrying...';
                    const attempt = data.attempt ? ` (Attempt ${data.attempt})` : '';
                    const next = data.next ? ` Next try at ${new Date(data.next).toLocaleTimeString()}` : '';
                    addMessage('assistant', `⚠️ **Retry**: ${retryMsg}${attempt}${next}`, false, false, true);
                }
                break;
            case 'message.delta':
            case 'message.part':
                const msgID = data.messageID || data.id;
                
                // Special handling for reasoning parts
                // The part info might be in data.part (from message.part.updated) or data.parts (from message.updated)
                const part = data.part || (data.parts && data.parts[0]);
                const isReasoning = part?.type === 'reasoning';
                
                let fullText = messageBuffer.get(msgID) || '';
                fullText += (data.delta || data.text || '');
                messageBuffer.set(msgID, fullText);
                updateStreamingMessage(msgID, fullText, isReasoning);
                break;
            case 'message.complete':
                const finalID = data.messageID || data.id;
                let finalContent = messageBuffer.get(finalID);
                
                // If we don't have it in buffer, maybe it's in the message object (re-load or non-streaming)
                if (!finalContent && data.message && data.message.text) {
                    finalContent = data.message.text;
                }
                
                removeStreamingMessage(finalID);
                
                // If the message has an error flag or special error prefix, we can handle it
                const msgError = data.message?.error;
                const isError = data.isError || (finalContent && finalContent.startsWith('Error:')) || !!msgError;
                
                if (msgError && !finalContent) {
                    finalContent = `❌ **Error**: ${msgError.message || 'Unknown error'}`;
                    if (msgError.data?.message) {
                        finalContent += `\n\n\`\`\`json\n${msgError.data.message}\n\`\`\``;
                    }
                }

                addMessage('assistant', finalContent || '(No content)', false, isError);
                
                messageBuffer.delete(finalID);
                removeTypingIndicator('assistant-typing');
                break;
            case 'question':
                currentQuestion = data;
                showQuestionNotification(data);
                break;
            case 'permission':
                addMessage('assistant', '⚠️ Permission required. Check events.', true);
                break;
            case 'subagent.progress':
                updateSubagentProgress(data);
                break;
            case 'session.error.auth':
                showAuthError(data.error?.message || 'Authentication failed');
                break;
            case 'session.error':
                // Fallback if not caught by specific event but has 401 status
                if (data.error?.statusCode === 401 || data.isAuthError) {
                    showAuthError(data.error?.message || 'Authentication failed');
                } else {
                    addEvent('Error', data);
                    const errorMsg = data.error?.message || 'An unknown error occurred';
                    let details = '';
                    if (data.error?.data?.message) {
                        details = data.error.data.message;
                    } else if (data.error?.data) {
                        details = JSON.stringify(data.error.data, null, 2);
                    }
                    
                    addMessage('assistant', `❌ **API Error**\n\n${errorMsg}${details ? `\n\n\`\`\`json\n${details}\n\`\`\`` : ''}`, false, true);
                }
                break;
            case 'session.timeout':
                updateStatus('error', 'Session timed out');
                alert('Session timed out. Please create a new one.');
                currentSession = null;
                break;
        }
    };
    
    ws.onclose = () => {
        addEvent('System', 'WebSocket disconnected, retrying...');
        updateStatus('error', 'Disconnected');
        setTimeout(connectWebSocket, 3000);
    };
}

async function loadAgentsAndModels() {
    try {
        const [agentsRes, modelsRes] = await Promise.all([
            fetch('/api/agents'),
            fetch('/api/models')
        ]);
        agents = await agentsRes.json();
        models = await modelsRes.json();
        
        const populateAgents = (select) => {
            select.innerHTML = '<option value="">Agent: Default</option>';
            if (Array.isArray(agents)) {
                agents.forEach(agent => {
                    const option = document.createElement('option');
                    option.value = agent;
                    option.textContent = agent;
                    select.appendChild(option);
                });
            }
        };

        const populateModels = (select) => {
            select.innerHTML = '<option value="">Model: Default</option>';
            if (Array.isArray(models)) {
                // Group by provider
                const providers = {};
                models.forEach(model => {
                    if (!providers[model.providerID]) providers[model.providerID] = [];
                    providers[model.providerID].push(model);
                });

                Object.keys(providers).forEach(providerID => {
                    const group = document.createElement('optgroup');
                    group.label = providerID;
                    providers[providerID].forEach(model => {
                    const option = document.createElement('option');
                    option.value = JSON.stringify({ providerID: model.providerID, modelID: model.modelID });
                    option.textContent = model.name;
                    group.appendChild(option);
                });
                select.appendChild(group);
            });
        }
    };

        populateAgents(agentSelect);
        populateAgents(qsAgentSelect);
        populateModels(modelSelect);
        populateModels(qsModelSelect);

        // Apply favorite agent/model from cookies after they are populated
        const favAgent = getCookie('favAgent');
        if (favAgent) {
            agentSelect.value = favAgent;
            qsAgentSelect.value = favAgent;
        }

        const favModel = getCookie('favModel');
        if (favModel) {
            modelSelect.value = favModel;
            qsModelSelect.value = favModel;
        }

    } catch (error) {
        addEvent('Error', 'Failed to load config: ' + error.message);
    }
}

createSessionBtn.addEventListener('click', async () => {
    const agent = agentSelect.value || undefined;
    const modelStr = modelSelect.value;
    const model = modelStr ? JSON.parse(modelStr) : undefined;
    const directory = directoryInput.value || '/root';
    
    try {
        updateStatus('busy', 'Creating session...');
        const response = await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent, model, directory })
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                const error = await response.json();
                showAuthError(error.details || error.error || 'Unauthorized');
                settingsModal.classList.remove('active');
                return;
            }
            const error = await response.json();
            throw new Error(error.error || response.statusText);
        }

        currentSession = await response.json();
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionID: currentSession.id }));
        }
        updateStatus('idle', `Session: ${currentSession.id.substring(0, 8)}`);
        settingsModal.classList.remove('active');
        messagesContainer.innerHTML = '';
        addMessage('assistant', `Session created! ${agent ? `Using agent: ${agent}` : ''}`);
        loadSessionHistory(currentSession.id);
    } catch (error) {
        updateStatus('error', 'Failed to create session');
        addEvent('Error', error.message);
    }
});

async function loadSessionHistory(sessionID) {
    try {
        const response = await fetch(`/api/session/${sessionID}/messages`);
        const messages = await response.json();
        if (Array.isArray(messages) && messages.length > 0) {
            messagesContainer.innerHTML = '';
            messages.forEach(msg => {
                const text = msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
                if (text) addMessage(msg.info.role, text);
            });
        }
    } catch (error) {
        console.error('History error:', error);
    }
}

async function fetchLogs() {
    try {
        const url = currentSession ? `/api/logs?sessionID=${currentSession.id}` : '/api/logs';
        const response = await fetch(url);
        const logs = await response.json();
        
        logCount.textContent = `${logs.length} events`;
        logsContainer.innerHTML = '';
        
        if (logs.length === 0) {
            logsContainer.innerHTML = '<div class="log-item">No events found.</div>';
            return;
        }

        logs.reverse().forEach(log => {
            const item = document.createElement('div');
            item.style.marginBottom = '8px';
            item.style.padding = '8px';
            item.style.background = 'var(--bg-light)';
            item.style.borderRadius = '4px';
            item.style.borderLeft = '3px solid #ccc';
            
            const time = new Date(log.timestamp).toLocaleTimeString() + '.' + (log.timestamp % 1000);
            const type = log.payload.type;
            
            item.innerHTML = `
                <div style="font-weight: bold; color: var(--primary-color); margin-bottom: 4px;">[${time}] ${type}</div>
                <pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(log.payload.properties, null, 2)}</pre>
            `;
            logsContainer.appendChild(item);
        });
    } catch (error) {
        console.error('Fetch logs error:', error);
    }
}

async function init() {
    updateStatus('idle', 'Ready');
    applyStoredPreferences();
    const initialTime = document.getElementById('initialEventTime');
    if (initialTime) initialTime.textContent = new Date().toLocaleTimeString();
    
    try {
        connectWebSocket();
        await loadAgentsAndModels();
        setTimeout(() => {
            if (!currentSession) settingsModal.classList.add('active');
        }, 500);
    } catch (err) {
        addEvent('Error', 'Init failed: ' + err.message);
    }
}

init();
