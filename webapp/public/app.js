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
const reconnectBtn = document.getElementById('reconnectBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const authModal = document.getElementById('authModal');
const closeAuth = document.getElementById('closeAuth');
const authErrorDetails = document.getElementById('authErrorDetails');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const abortBtn = document.getElementById('abortBtn');
const messagesContainer = document.getElementById('messagesContainer');
const eventsContainer = document.getElementById('eventsContainer');
const logsContainer = document.getElementById('logsContainer');
const logCount = document.getElementById('logCount');
const refreshLogsBtn = document.getElementById('refreshLogs');
const agentSelect = document.getElementById('agentSelect');
const modelSelect = document.getElementById('modelSelect');
const secondaryModelSelect = document.getElementById('secondaryModelSelect');
const directoryInput = document.getElementById('directoryInput');
const createSessionBtn = document.getElementById('createSessionBtn');
const sessionSearch = document.getElementById('sessionSearch');
const qsAgentSelect = document.getElementById('qsAgentSelect');
const qsModelSelect = document.getElementById('qsModelSelect');
const sessionList = document.getElementById('sessionList');
const hideReasoningCheckbox = document.getElementById('hideReasoning');
const darkThemeCheckbox = document.getElementById('darkTheme');

// Tab switching (Main)
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(tab + 'Tab').classList.add('active');
    });
});

// Settings Tab switching
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.settingsTab;
        document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        // Match the ID in HTML: existingSessionsTab or newSessionTab
        const targetId = tab === 'existing' ? 'existingSessionsTab' : 'newSessionTab';
        document.getElementById(targetId).classList.add('active');
        if (tab === 'existing') loadExistingSessions();
    });
});

// Search debouncing
let searchTimeout = null;
if (sessionSearch) {
    sessionSearch.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadExistingSessions(sessionSearch.value);
        }, 300);
    });
}

// Modal controls
settingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('active');
    loadExistingSessions();
});

closeSettings.addEventListener('click', () => {
    settingsModal.classList.remove('active');
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
abortBtn.addEventListener('click', abortLastPrompt);
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

// Preference Toggles
darkThemeCheckbox.addEventListener('change', (e) => {
    document.body.classList.toggle('dark', e.target.checked);
    setCookie('darkTheme', e.target.checked ? 'true' : 'false');
});

hideReasoningCheckbox.addEventListener('change', (e) => {
    document.body.classList.toggle('hide-reasoning', e.target.checked);
    setCookie('hideReasoning', e.target.checked ? 'true' : 'false');
});

qsAgentSelect.addEventListener('change', (e) => {
    agentSelect.value = e.target.value;
    setCookie('favAgent', e.target.value);
});

qsModelSelect.addEventListener('change', (e) => {
    modelSelect.value = e.target.value;
    setCookie('favModel', e.target.value);
});

function applyStoredPreferences() {
    if (getCookie('darkTheme') === 'true') {
        document.body.classList.add('dark');
        darkThemeCheckbox.checked = true;
    }
    if (getCookie('hideReasoning') === 'true') {
        document.body.classList.add('hide-reasoning');
        hideReasoningCheckbox.checked = true;
    }
}

async function sendMessage() {
    if (!currentSession) {
        alert('Please connect to a session first');
        settingsModal.classList.add('active');
        return;
    }
    
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';
    sendBtn.disabled = true;
    
    const agent = qsAgentSelect.value || undefined;
    const modelStr = qsModelSelect.value;
    const model = modelStr ? JSON.parse(modelStr) : undefined;

    addMessage('user', text, false, false, false, false, { agent, modelID: model?.modelID, providerID: model?.providerID });
    addTypingIndicator('assistant-typing');
    
    try {
        const response = await fetch(`/api/session/${currentSession.id}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, agent, model })
        });
        
        if (!response.ok) {
            if (response.status === 401) {
                const error = await response.json();
                showAuthError(error.details || error.error || 'Unauthorized');
            } else {
                const error = await response.json();
                throw new Error(error.error || response.statusText);
            }
        }
    } catch (error) {
        console.error('Send message error:', error);
        removeTypingIndicator('assistant-typing');
        addEvent('Error', 'Failed to send message: ' + error.message);
        alert('Failed to send message: ' + error.message);
    } finally {
        sendBtn.disabled = false;
    }
}

function updateStreamingMessage(messageID, text, isReasoning = false, metadata = {}) {
    let streamMsg = document.getElementById('stream-' + messageID);
    if (!streamMsg) {
        streamMsg = document.createElement('div');
        streamMsg.id = 'stream-' + messageID;
        streamMsg.className = 'message-bubble assistant';
        if (isReasoning) streamMsg.classList.add('reasoning');
        
        if (metadata && (metadata.agent || metadata.modelID)) {
            const infoBar = document.createElement('div');
            infoBar.className = 'message-info-bar';
            const agentName = metadata.agent || 'Default';
            const modelName = metadata.modelID ? `${metadata.providerID ? metadata.providerID + '/' : ''}${metadata.modelID}` : '';
            infoBar.innerHTML = `<span>🤖 ${agentName}</span>${modelName ? `<span class="model-tag">🧠 ${modelName}</span>` : ''}`;
            streamMsg.appendChild(infoBar);
        }

        const content = document.createElement('div');
        content.className = 'message-content';
        streamMsg.appendChild(content);
        messagesContainer.appendChild(streamMsg);
    }
    
    const content = streamMsg.querySelector('.message-content') || streamMsg;
    content.innerHTML = marked.parse(text);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeStreamingMessage(messageID) {
    const streamMsg = document.getElementById('stream-' + messageID);
    if (streamMsg) streamMsg.remove();
}

function addMessage(role, text, isQuestion = false, isError = false, isWarning = false, isInfo = false, metadata = {}, questionData = null) {
    if (!text) return;

    const msgID = metadata ? (metadata.id || metadata.messageID) : null;
    if (msgID && document.getElementById('msg-' + msgID)) return; // Avoid duplicates

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role}`;
    if (msgID) bubble.id = 'msg-' + msgID;
    
    if (metadata && (metadata.agent || metadata.modelID)) {
        const infoBar = document.createElement('div');
        infoBar.className = 'message-info-bar';
        const agentName = metadata.agent || 'Default';
        const modelName = metadata.modelID ? `${metadata.providerID ? metadata.providerID + '/' : ''}${metadata.modelID}` : '';
        infoBar.innerHTML = `<span>🤖 ${agentName}</span>${modelName ? `<span class="model-tag">🧠 ${modelName}</span>` : ''}`;
        bubble.appendChild(infoBar);
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    try {
        content.innerHTML = typeof marked !== 'undefined' ? marked.parse(text) : text;
    } catch (e) {
        content.textContent = text;
    }
    bubble.appendChild(content);

    if (isQuestion) {
        bubble.classList.add('question-inline');
        const qData = questionData || currentQuestion;
        if (qData) {
            const questions = qData.questions || (qData.properties && qData.properties.questions);
            if (questions && questions.length > 0) {
                const allAnswers = questions.map(() => new Set());
                const submitBtn = document.createElement('button');
                submitBtn.className = 'submit-question-inline';
                submitBtn.textContent = 'Submit Answer';
                submitBtn.disabled = true;

                const updateSubmitState = () => {
                    submitBtn.disabled = !allAnswers.every(ans => ans.size > 0);
                };

                if (questions.length > 1) {
                    const tabsContainer = document.createElement('div');
                    tabsContainer.className = 'question-tabs';
                    const contentsContainer = document.createElement('div');
                    contentsContainer.className = 'question-contents';

                    questions.forEach((q, qIdx) => {
                        const tabBtn = document.createElement('button');
                        tabBtn.className = 'question-tab-btn' + (qIdx === 0 ? ' active' : '');
                        tabBtn.textContent = q.header || `Q${qIdx + 1}`;
                        const qContent = document.createElement('div');
                        qContent.className = 'question-tab-content' + (qIdx === 0 ? ' active' : '');
                        const qText = document.createElement('p');
                        qText.style.fontWeight = 'bold';
                        qText.style.marginBottom = '8px';
                        qText.textContent = q.question;
                        qContent.appendChild(qText);

                        const optionsDiv = document.createElement('div');
                        optionsDiv.className = 'question-options-inline';
                        q.options.forEach(option => {
                            const optItem = document.createElement('div');
                            optItem.className = 'option-item-inline';
                            optItem.innerHTML = `<strong>${option.label}</strong><div style="font-size: 12px; opacity: 0.8">${option.description}</div>`;
                            optItem.onclick = (e) => {
                                e.stopPropagation();
                                if (optItem.classList.contains('disabled')) return;
                                if (q.multiple) {
                                    if (allAnswers[qIdx].has(option.label)) {
                                        allAnswers[qIdx].delete(option.label);
                                        optItem.classList.remove('selected');
                                    } else {
                                        allAnswers[qIdx].add(option.label);
                                        optItem.classList.add('selected');
                                    }
                                } else {
                                    optionsDiv.querySelectorAll('.option-item-inline').forEach(i => i.classList.remove('selected'));
                                    allAnswers[qIdx].clear();
                                    allAnswers[qIdx].add(option.label);
                                    optItem.classList.add('selected');
                                }
                                updateSubmitState();
                            };
                            optionsDiv.appendChild(optItem);
                        });
                        qContent.appendChild(optionsDiv);
                        contentsContainer.appendChild(qContent);
                        tabBtn.onclick = (e) => {
                            e.stopPropagation();
                            tabsContainer.querySelectorAll('.question-tab-btn').forEach(b => b.classList.remove('active'));
                            contentsContainer.querySelectorAll('.question-tab-content').forEach(c => c.classList.remove('active'));
                            tabBtn.classList.add('active');
                            qContent.classList.add('active');
                        };
                        tabsContainer.appendChild(tabBtn);
                    });
                    content.appendChild(tabsContainer);
                    content.appendChild(contentsContainer);
                } else {
                    const q = questions[0];
                    const optionsDiv = document.createElement('div');
                    optionsDiv.className = 'question-options-inline';
                    q.options.forEach(option => {
                        const optItem = document.createElement('div');
                        optItem.className = 'option-item-inline';
                        optItem.innerHTML = `<strong>${option.label}</strong><div style="font-size: 12px; opacity: 0.8">${option.description}</div>`;
                        optItem.onclick = (e) => {
                            e.stopPropagation();
                            if (optItem.classList.contains('disabled')) return;
                            if (q.multiple) {
                                if (allAnswers[0].has(option.label)) {
                                    allAnswers[0].delete(option.label);
                                    optItem.classList.remove('selected');
                                } else {
                                    allAnswers[0].add(option.label);
                                    optItem.classList.add('selected');
                                }
                            } else {
                                optionsDiv.querySelectorAll('.option-item-inline').forEach(i => i.classList.remove('selected'));
                                allAnswers[0].clear();
                                allAnswers[0].add(option.label);
                                optItem.classList.add('selected');
                            }
                            updateSubmitState();
                        };
                        optionsDiv.appendChild(optItem);
                    });
                    content.appendChild(optionsDiv);
                }

                submitBtn.onclick = async (e) => {
                    e.stopPropagation();
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Submitting...';
                    try {
                        const requestID = qData.id || qData.requestID || (qData.properties && qData.properties.id);
                        const finalAnswers = allAnswers.map(set => Array.from(set));
                        const res = await fetch(`/api/question/${requestID}/reply`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessionID: currentSession.id, answers: finalAnswers })
                        });
                        if (!res.ok) throw new Error('Reply failed');
                        submitBtn.textContent = 'Answered ✅';
                        bubble.querySelectorAll('.option-item-inline').forEach(i => i.classList.add('disabled'));
                        bubble.querySelectorAll('.question-tab-btn').forEach(b => b.classList.add('disabled'));
                    } catch (error) {
                        console.error('Submit answer error:', error);
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Retry Submission';
                        alert(`Failed to submit: ${error.message}`);
                    }
                };
                content.appendChild(submitBtn);
            }
        }
    }
    
    if (isError) bubble.classList.add('error');
    if (isWarning) bubble.classList.add('warning');
    if (isInfo) bubble.classList.add('info-blue');
    
    messagesContainer.appendChild(bubble);
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString();
    messagesContainer.appendChild(time);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function abortLastPrompt() {
    if (!currentSession) return;
    try {
        abortBtn.disabled = true;
        const response = await fetch(`/api/session/${currentSession.id}/abort`, { method: 'POST' });
        if (!response.ok) throw new Error('Abort failed');
        addMessage('assistant', '🛑 Prompt aborted by user.', false, false, true);
    } catch (error) {
        addEvent('Error', 'Failed to abort: ' + error.message);
    } finally {
        abortBtn.disabled = false;
    }
}

function updateStatus(status, text) {
    statusDot.className = 'status-dot ' + status;
    statusText.textContent = text || status.charAt(0).toUpperCase() + status.slice(1);
    abortBtn.style.display = (status === 'busy' || status === 'retry') ? 'flex' : 'none';
}

function addEvent(type, data) {
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `<div class="event-header">${type}</div><div class="event-body">${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}</div><div class="event-time">${new Date().toLocaleTimeString()}</div>`;
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
        let target = document.getElementById('stream-' + messageID) || messagesContainer.lastElementChild;
        if (target) target.after(progressEl);
        else messagesContainer.appendChild(progressEl);
    }
    const icon = status === 'running' ? '⏳' : status === 'completed' ? '✅' : status === 'error' ? '❌' : '⚪';
    progressEl.innerHTML = `<span class="pill-icon ${status === 'running' ? 'spinning' : ''}">${icon}</span> <span class="pill-agent">${agent}</span>: <span class="pill-task">${task}</span>`;
    progressEl.className = `subagent-pill ${status}`;
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        addEvent('System', 'WebSocket connected');
        reconnectBtn.style.display = 'none';
        if (currentSession) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionID: currentSession.id }));
            syncSessionState(currentSession.id);
        }
    };
    
    ws.onmessage = (event) => {
        const { type, data } = JSON.parse(event.data);
        addEvent(type, data);
        switch (type) {
            case 'session.status':
                const sessionStatus = (data.status && data.status.type) || data.status || data.type;
                updateStatus(sessionStatus);
                if (sessionStatus === 'busy') addTypingIndicator('assistant-typing');
                else if (sessionStatus === 'idle') removeTypingIndicator('assistant-typing');
                break;
            case 'message.delta':
            case 'message.part':
                const msgID = data.messageID || data.id;
                const part = data.part || (data.parts && data.parts[0]);
                let fullText = messageBuffer.get(msgID) || '';
                fullText += (data.delta || data.text || '');
                messageBuffer.set(msgID, fullText);
                updateStreamingMessage(msgID, fullText, part?.type === 'reasoning', data.message || {});
                break;
            case 'message.complete':
                const finalID = data.messageID || data.id;
                let finalContent = messageBuffer.get(finalID) || (data.message && data.message.text);
                removeStreamingMessage(finalID);
                if (document.getElementById('msg-' + finalID)) { messageBuffer.delete(finalID); return; }
                const msgError = data.message?.error;
                addMessage('assistant', finalContent || (msgError ? `❌ Error: ${msgError.message}` : '(No content)'), false, !!msgError, false, false, data.message || {});
                messageBuffer.delete(finalID);
                removeTypingIndicator('assistant-typing');
                break;
            case 'question':
                currentQuestion = data;
                const q = (data.questions || (data.properties && data.properties.questions))?.[0];
                addMessage('assistant', q?.question || '🤔 I have a question for you:', true, false, false, false, {}, data);
                break;
            case 'session.model_switched':
                addMessage('assistant', `🔄 **Model Switched**: Now using **${data.model?.modelID}**`, false, false, false, true);
                if (data.model) {
                    const val = JSON.stringify({ providerID: data.model.providerID, modelID: data.model.modelID });
                    qsModelSelect.value = val; modelSelect.value = val;
                }
                break;
            case 'session.retrying_alternative':
                addMessage('assistant', `♻️ **Auto-Retry**: Retrying with **${data.model?.modelID}**...`, false, false, false, true);
                break;
        }
    };
    
    ws.onclose = () => {
        updateStatus('error', 'Disconnected');
        reconnectBtn.style.display = 'inline-block';
    };
}

async function syncSessionState(sessionID) {
    if (!sessionID) return;
    try {
        const messages = await fetch(`/api/session/${sessionID}/messages?limit=20`).then(r => r.json());
        let added = 0;
        messages.forEach(msg => {
            if (!document.getElementById('msg-' + msg.info.id)) {
                const text = msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
                if (text) { addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info); added++; }
            }
        });
        if (added > 0) addMessage('assistant', `✨ Synchronized ${added} messages.`, false, false, false, true);
    } catch (err) { console.error('Sync failed:', err); }
}

reconnectBtn.addEventListener('click', () => {
    reconnectBtn.disabled = true;
    reconnectBtn.textContent = 'Connecting...';
    connectWebSocket();
    setTimeout(() => { reconnectBtn.disabled = false; reconnectBtn.textContent = 'Reconnect'; }, 2000);
});

async function loadAgentsAndModels() {
    try {
        const [agentsRes, modelsRes] = await Promise.all([fetch('/api/agents'), fetch('/api/models')]);
        agents = await agentsRes.json();
        models = await modelsRes.json();
        const populateSelect = (select, items, label, isModel = false) => {
            select.innerHTML = `<option value="">${label}</option>`;
            if (isModel) {
                const groups = {};
                items.forEach(m => { if (!groups[m.providerID]) groups[m.providerID] = []; groups[m.providerID].push(m); });
                Object.entries(groups).forEach(([pID, ms]) => {
                    const group = document.createElement('optgroup'); group.label = pID;
                    ms.forEach(m => {
                        const opt = document.createElement('option');
                        opt.value = JSON.stringify({ providerID: m.providerID, modelID: m.modelID });
                        opt.textContent = m.name; group.appendChild(opt);
                    });
                    select.appendChild(group);
                });
            } else {
                items.forEach(a => { const opt = document.createElement('option'); opt.value = a; opt.textContent = a; select.appendChild(opt); });
            }
        };
        populateSelect(agentSelect, agents, 'Default Agent');
        populateSelect(qsAgentSelect, agents, 'Agent: Default');
        populateSelect(modelSelect, models, 'Default Model', true);
        populateSelect(qsModelSelect, models, 'Model: Default', true);
        populateSelect(secondaryModelSelect, models, 'None', true);
        const favA = getCookie('favAgent'), favM = getCookie('favModel');
        if (favA) { agentSelect.value = favA; qsAgentSelect.value = favA; }
        if (favM) { modelSelect.value = favM; qsModelSelect.value = favM; }
    } catch (e) { addEvent('Error', 'Failed to load config'); }
}

createSessionBtn.addEventListener('click', async () => {
    const agent = agentSelect.value || undefined, modelStr = modelSelect.value;
    const model = modelStr ? JSON.parse(modelStr) : undefined;
    const secondaryModelStr = secondaryModelSelect.value;
    const secondaryModel = secondaryModelStr ? JSON.parse(secondaryModelStr) : undefined;
    const directory = directoryInput.value || '/root';
    try {
        updateStatus('busy', 'Creating session...');
        const res = await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent, model, secondaryModel, directory })
        });
        if (!res.ok) throw new Error('Create failed');
        currentSession = await res.json();
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', sessionID: currentSession.id }));
        updateStatus('idle'); settingsModal.classList.remove('active');
        messagesContainer.innerHTML = '';
        addMessage('assistant', 'Session created!');
        loadSessionHistory(currentSession.id);
    } catch (e) { updateStatus('error', 'Failed'); }
});

async function loadExistingSessions(search = '') {
    try {
        sessionList.innerHTML = '<div style="padding: 20px; text-align: center; color: #90949c;">Loading...</div>';
        const start = Date.now() - (7 * 24 * 60 * 60 * 1000);
        let url = `/api/sessions?limit=50&start=${start}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        const sessionsData = await fetch(url).then(r => r.json());
        sessionList.innerHTML = '';
        if (sessionsData.length === 0) { sessionList.innerHTML = '<div style="padding: 20px; text-align: center; color: #90949c;">No sessions found</div>'; return; }
        const groups = {};
        sessionsData.forEach(s => {
            const d = new Date(s.time.updated).toDateString();
            if (!groups[d]) groups[d] = []; groups[d].push(s);
        });
        Object.entries(groups).forEach(([d, ss]) => {
            const h = document.createElement('div'); h.className = 'session-group-header'; h.textContent = d; sessionList.appendChild(h);
            ss.forEach(s => {
                const item = document.createElement('div'); item.className = 'session-item';
                item.innerHTML = `<div class="session-item-title">${s.title || s.id.substring(0, 12)}</div><div class="session-item-date">${new Date(s.time.updated).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>`;
                item.onclick = () => connectToSession(s); sessionList.appendChild(item);
            });
        });
    } catch (e) { sessionList.innerHTML = 'Error'; }
}

async function connectToSession(session) {
    currentSession = session;
    try {
        const messages = await fetch(`/api/session/${session.id}/messages?limit=20`).then(r => r.json());
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', sessionID: session.id }));
        updateStatus('idle'); settingsModal.classList.remove('active');
        messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            const text = msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
            if (text) addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info);
        });
    } catch (e) { addEvent('Error', 'Connect failed'); }
}

async function loadSessionHistory(id) {
    try {
        const msgs = await fetch(`/api/session/${id}/messages?limit=20`).then(r => r.json());
        msgs.forEach(msg => {
            const text = msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
            if (text) addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info);
        });
    } catch (e) {}
}

async function init() {
    applyStoredPreferences();
    try {
        connectWebSocket();
        await loadAgentsAndModels();
        setTimeout(() => { if (!currentSession) { settingsModal.classList.add('active'); loadExistingSessions(); } }, 500);
    } catch (e) {}
}

init();
