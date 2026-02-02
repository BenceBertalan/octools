// State management
let currentSession = null;
let ws = null;
let currentQuestion = null;
let agents = [];
let models = [];
let messageBuffer = new Map();

// Pagination state
let messagesCache = new Map(); // sessionID -> all messages
let oldestDisplayedIndex = new Map(); // sessionID -> index
let loadingMore = false;

// Reasoning state
let reasoningExpanded = new Map(); // messageID -> boolean

// Helper to get element by ID with error checking
const getEl = (id) => {
    const el = document.getElementById(id);
    if (!el) console.warn(`Element #${id} not found`);
    return el;
};

// DOM elements
const statusDot = getEl('statusDot');
const statusText = getEl('statusText');
const reconnectBtn = getEl('reconnectBtn');
const settingsBtn = getEl('settingsBtn');
const settingsModal = getEl('settingsModal');
const closeSettings = getEl('closeSettings');
const authModal = getEl('authModal');
const closeAuth = getEl('closeAuth');
const authErrorDetails = getEl('authErrorDetails');
const messageInput = getEl('messageInput');
const sendBtn = getEl('sendBtn');
const abortBtn = getEl('abortBtn');
const messagesContainer = getEl('messagesContainer');
const eventsContainer = getEl('eventsContainer');
const logsContainer = getEl('logsContainer');
const logCount = getEl('logCount');
const refreshLogsBtn = getEl('refreshLogs');
const agentSelect = getEl('agentSelect');
const modelSelect = getEl('modelSelect');
const secondaryModelSelect = getEl('secondaryModelSelect');
const directoryInput = getEl('directoryInput');
const createSessionBtn = getEl('createSessionBtn');
const sessionSearch = getEl('sessionSearch');
const qsAgentSelect = getEl('qsAgentSelect');
const qsModelSelect = getEl('qsModelSelect');
const sessionList = getEl('sessionList');
const hideReasoningCheckbox = getEl('hideReasoning');
const darkThemeCheckbox = getEl('darkTheme');

// Tab switching (Main)
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const target = getEl(tab + 'Tab');
        if (target) target.classList.add('active');
    });
});

// Settings Tab switching
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.settingsTab;
        document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const targetId = tab === 'existing' ? 'existingSessionsTab' : 'newSessionTab';
        const target = getEl(targetId);
        if (target) target.classList.add('active');
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
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('active');
        loadExistingSessions();
    });
}

if (closeSettings) {
    closeSettings.addEventListener('click', () => {
        settingsModal.classList.remove('active');
    });
}

if (closeAuth) {
    closeAuth.addEventListener('click', () => {
        authModal.classList.remove('active');
    });
}

function showAuthError(message) {
    if (authErrorDetails) authErrorDetails.textContent = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
    if (authModal) authModal.classList.add('active');
    updateStatus('error', 'Authentication Failed');
}

// Auto-resize textarea
if (messageInput) {
    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = messageInput.scrollHeight + 'px';
        if (sendBtn) sendBtn.disabled = !messageInput.value.trim();
    });
}

// Send message
if (sendBtn) sendBtn.addEventListener('click', sendMessage);
if (abortBtn) abortBtn.addEventListener('click', abortLastPrompt);
if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', fetchLogs);

if (messageInput) {
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
}

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
if (darkThemeCheckbox) {
    darkThemeCheckbox.addEventListener('change', (e) => {
        document.body.classList.toggle('dark', e.target.checked);
        setCookie('darkTheme', e.target.checked ? 'true' : 'false');
    });
}

if (hideReasoningCheckbox) {
    hideReasoningCheckbox.addEventListener('change', (e) => {
        document.body.classList.toggle('hide-reasoning', e.target.checked);
        setCookie('hideReasoning', e.target.checked ? 'true' : 'false');
    });
}

if (qsAgentSelect) {
    qsAgentSelect.addEventListener('change', (e) => {
        if (agentSelect) agentSelect.value = e.target.value;
        setCookie('favAgent', e.target.value);
    });
}

if (qsModelSelect) {
    qsModelSelect.addEventListener('change', (e) => {
        if (modelSelect) modelSelect.value = e.target.value;
        setCookie('favModel', e.target.value);
    });
}

function applyStoredPreferences() {
    if (getCookie('darkTheme') === 'true') {
        document.body.classList.add('dark');
        if (darkThemeCheckbox) darkThemeCheckbox.checked = true;
    }
    if (getCookie('hideReasoning') === 'true') {
        document.body.classList.add('hide-reasoning');
        if (hideReasoningCheckbox) hideReasoningCheckbox.checked = true;
    }
}

// Safe JSON helper
async function safeJson(response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error('Failed to parse JSON:', text);
        throw new Error('Invalid JSON response from server');
    }
}

// Reasoning section helper
function createReasoningSection(reasoningParts, messageID) {
    if (!reasoningParts || reasoningParts.length === 0) return null;
    
    const reasoningText = reasoningParts.map(p => p.text).filter(Boolean).join('\n\n');
    if (!reasoningText) return null;
    
    const section = document.createElement('div');
    section.className = 'reasoning-section';
    
    // Get default state from cookie or hideReasoning checkbox
    const hideByDefault = getCookie('hideReasoning') === 'true';
    const isExpanded = reasoningExpanded.get(messageID) ?? !hideByDefault;
    
    const toggle = document.createElement('button');
    toggle.className = 'reasoning-toggle' + (isExpanded ? ' expanded' : '');
    toggle.innerHTML = `<span class="reasoning-toggle-icon">▼</span> <span>${isExpanded ? 'Hide' : 'Show'} reasoning</span>`;
    
    const content = document.createElement('div');
    content.className = 'reasoning-content' + (isExpanded ? ' expanded' : '');
    
    try {
        content.innerHTML = typeof marked !== 'undefined' ? marked.parse(reasoningText) : reasoningText;
    } catch (e) {
        content.textContent = reasoningText;
    }
    
    toggle.onclick = (e) => {
        e.stopPropagation();
        const nowExpanded = !content.classList.contains('expanded');
        content.classList.toggle('expanded');
        toggle.classList.toggle('expanded');
        toggle.querySelector('span:last-child').textContent = nowExpanded ? 'Hide reasoning' : 'Show reasoning';
        reasoningExpanded.set(messageID, nowExpanded);
    };
    
    section.appendChild(toggle);
    section.appendChild(content);
    return section;
}

async function sendMessage() {
    if (!currentSession) {
        alert('Please connect to a session first');
        if (settingsModal) settingsModal.classList.add('active');
        return;
    }
    
    const text = messageInput.value.trim();
    if (!text) return;

    messageInput.value = '';
    messageInput.style.height = 'auto';
    if (sendBtn) sendBtn.disabled = true;
    
    const agent = qsAgentSelect ? qsAgentSelect.value : undefined;
    const modelStr = qsModelSelect ? qsModelSelect.value : undefined;
    const model = (modelStr && modelStr !== "") ? JSON.parse(modelStr) : undefined;

    addMessage('user', text, false, false, false, false, { agent, modelID: model?.modelID, providerID: model?.providerID });
    addTypingIndicator('assistant-typing');
    
    try {
        const response = await fetch(`/api/session/${currentSession.id}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, agent, model })
        });
        
        if (!response.ok) {
            const error = await safeJson(response) || { error: response.statusText };
            if (response.status === 401) {
                showAuthError(error.details || error.error || 'Unauthorized');
            } else {
                throw new Error(error.error || response.statusText);
            }
        }
    } catch (error) {
        console.error('Send message error:', error);
        removeTypingIndicator('assistant-typing');
        addEvent('Error', 'Failed to send message: ' + error.message);
        alert('Failed to send message: ' + error.message);
    } finally {
        if (sendBtn) sendBtn.disabled = false;
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
        if (messagesContainer) messagesContainer.appendChild(streamMsg);
    }
    
    const content = streamMsg.querySelector('.message-content') || streamMsg;
    if (typeof marked !== 'undefined') {
        content.innerHTML = marked.parse(text);
    } else {
        content.textContent = text;
    }
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeStreamingMessage(messageID) {
    const streamMsg = document.getElementById('stream-' + messageID);
    if (streamMsg) streamMsg.remove();
}

function addMessage(role, text, isQuestion = false, isError = false, isWarning = false, isInfo = false, metadata = {}, questionData = null, reasoningParts = null) {
    if (!text && (!reasoningParts || reasoningParts.length === 0)) return;

    const msgID = metadata ? (metadata.id || metadata.messageID) : null;
    if (msgID && document.getElementById('msg-' + msgID)) return;

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
    
    // Add reasoning section if present
    if (reasoningParts && reasoningParts.length > 0 && msgID) {
        const reasoningSection = createReasoningSection(reasoningParts, msgID);
        if (reasoningSection) {
            bubble.appendChild(reasoningSection);
        }
    }
    
    if (messagesContainer) {
        messagesContainer.appendChild(bubble);
        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = new Date().toLocaleTimeString();
        messagesContainer.appendChild(time);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

async function abortLastPrompt() {
    if (!currentSession) return;
    try {
        if (abortBtn) abortBtn.disabled = true;
        const response = await fetch(`/api/session/${currentSession.id}/abort`, { method: 'POST' });
        if (!response.ok) throw new Error('Abort failed');
        addMessage('assistant', '🛑 Prompt aborted by user.', false, false, true);
    } catch (error) {
        addEvent('Error', 'Failed to abort: ' + error.message);
    } finally {
        if (abortBtn) abortBtn.disabled = false;
    }
}

function updateStatus(status, text) {
    if (statusDot) statusDot.className = 'status-dot ' + status;
    if (statusText) statusText.textContent = text || status.charAt(0).toUpperCase() + status.slice(1);
    if (abortBtn) abortBtn.style.display = (status === 'busy' || status === 'retry') ? 'flex' : 'none';
}

function addEvent(type, data) {
    if (!eventsContainer) return;
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `<div class="event-header">${type}</div><div class="event-body">${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}</div><div class="event-time">${new Date().toLocaleTimeString()}</div>`;
    eventsContainer.prepend(item);
}

function addTypingIndicator(id) {
    if (!messagesContainer || document.getElementById(id)) return;
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
        let target = document.getElementById('stream-' + messageID) || (messagesContainer ? messagesContainer.lastElementChild : null);
        if (target) target.after(progressEl);
        else if (messagesContainer) messagesContainer.appendChild(progressEl);
    }
    if (progressEl) {
        const icon = status === 'running' ? '⏳' : status === 'completed' ? '✅' : status === 'error' ? '❌' : '⚪';
        progressEl.innerHTML = `<span class="pill-icon ${status === 'running' ? 'spinning' : ''}">${icon}</span> <span class="pill-agent">${agent}</span>: <span class="pill-task">${task}</span>`;
        progressEl.className = `subagent-pill ${status}`;
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        addEvent('System', 'WebSocket connected');
        if (reconnectBtn) reconnectBtn.style.display = 'none';
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
                if (data.model && qsModelSelect && modelSelect) {
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
        if (reconnectBtn) reconnectBtn.style.display = 'inline-block';
    };
}

async function syncSessionState(sessionID) {
    if (!sessionID) return;
    try {
        const response = await fetch(`/api/session/${sessionID}/messages?limit=20`);
        if (!response.ok) throw new Error('Failed to fetch messages');
        const messages = await safeJson(response) || [];
        let added = 0;
        messages.forEach(msg => {
            if (!document.getElementById('msg-' + msg.info.id)) {
                const textParts = msg.parts.filter(p => p.type === 'text');
                const reasoningParts = msg.parts.filter(p => p.type === 'reasoning');
                const text = textParts.map(p => p.text).join('\n');
                if (text || reasoningParts.length > 0) { 
                    addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info, null, reasoningParts); 
                    added++; 
                }
            }
        });
        if (added > 0) addMessage('assistant', `✨ Synchronized ${added} messages.`, false, false, false, true);
    } catch (err) { console.error('Sync failed:', err); }
}

if (reconnectBtn) {
    reconnectBtn.addEventListener('click', () => {
        reconnectBtn.disabled = true;
        reconnectBtn.textContent = 'Connecting...';
        connectWebSocket();
        setTimeout(() => { 
            if (reconnectBtn) {
                reconnectBtn.disabled = false; 
                reconnectBtn.textContent = 'Reconnect'; 
            }
        }, 2000);
    });
}

async function loadAgentsAndModels() {
    try {
        const [agentsRes, modelsRes] = await Promise.all([fetch('/api/agents'), fetch('/api/models')]);
        agents = await safeJson(agentsRes) || [];
        models = await safeJson(modelsRes) || [];
        const populateSelect = (select, items, label, isModel = false) => {
            if (!select) return;
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
        if (favA && agentSelect && qsAgentSelect) { agentSelect.value = favA; qsAgentSelect.value = favA; }
        if (favM && modelSelect && qsModelSelect) { modelSelect.value = favM; qsModelSelect.value = favM; }
    } catch (e) { addEvent('Error', 'Failed to load config'); }
}

if (createSessionBtn) {
    createSessionBtn.addEventListener('click', async () => {
        const agent = agentSelect ? agentSelect.value : undefined;
        const modelStr = modelSelect ? modelSelect.value : undefined;
        const model = (modelStr && modelStr !== "") ? JSON.parse(modelStr) : undefined;
        const secondaryModelStr = secondaryModelSelect ? secondaryModelSelect.value : undefined;
        const secondaryModel = (secondaryModelStr && secondaryModelStr !== "") ? JSON.parse(secondaryModelStr) : undefined;
        const directory = directoryInput ? directoryInput.value : '/root';
        try {
            updateStatus('busy', 'Creating session...');
            const res = await fetch('/api/session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent, model, secondaryModel, directory })
            });
            if (!res.ok) throw new Error('Create failed');
            currentSession = await safeJson(res);
            if (!currentSession) throw new Error('Empty response from server');
            
            if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', sessionID: currentSession.id }));
            updateStatus('idle'); 
            if (settingsModal) settingsModal.classList.remove('active');
            if (messagesContainer) messagesContainer.innerHTML = '';
            addMessage('assistant', 'Session created!');
            loadSessionHistory(currentSession.id);
        } catch (e) { updateStatus('error', 'Failed'); }
    });
}

async function loadExistingSessions(search = '') {
    if (!sessionList) return;
    try {
        sessionList.innerHTML = '<div style="padding: 20px; text-align: center; color: #90949c;">Loading...</div>';
        const start = Date.now() - (7 * 24 * 60 * 60 * 1000);
        let url = `/api/sessions?limit=50&start=${start}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch sessions');
        const sessionsData = await safeJson(response) || [];
        
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
    } catch (e) { sessionList.innerHTML = 'Error: ' + e.message; }
}

async function connectToSession(session) {
    console.log('[UI] Connecting to session:', session.id);
    currentSession = session;
    try {
        const response = await fetch(`/api/session/${session.id}/messages?limit=20`);
        if (!response.ok) throw new Error('Failed to fetch messages');
        const messages = await safeJson(response) || [];
        
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', sessionID: session.id }));
        updateStatus('idle'); 
        if (settingsModal) settingsModal.classList.remove('active');
        if (messagesContainer) messagesContainer.innerHTML = '';
        messages.forEach(msg => {
            const textParts = msg.parts.filter(p => p.type === 'text');
            const reasoningParts = msg.parts.filter(p => p.type === 'reasoning');
            const text = textParts.map(p => p.text).join('\n');
            if (text || reasoningParts.length > 0) {
                addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info, null, reasoningParts);
            }
        });
    } catch (e) { addEvent('Error', 'Connect failed: ' + e.message); }
}

async function loadSessionHistory(id) {
    try {
        const response = await fetch(`/api/session/${id}/messages?limit=20`);
        if (!response.ok) throw new Error('Failed to fetch history');
        const msgs = await safeJson(response) || [];
        msgs.forEach(msg => {
            const textParts = msg.parts.filter(p => p.type === 'text');
            const reasoningParts = msg.parts.filter(p => p.type === 'reasoning');
            const text = textParts.map(p => p.text).join('\n');
            if (text || reasoningParts.length > 0) {
                addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info, null, reasoningParts);
            }
        });
    } catch (e) { console.error('History load failed:', e); }
}

async function fetchLogs() {
    if (!logsContainer) return;
    try {
        const url = currentSession ? `/api/logs?sessionID=${currentSession.id}` : '/api/logs';
        const response = await fetch(url);
        const logs = await safeJson(response) || [];
        if (logCount) logCount.textContent = `${logs.length} events`;
        logsContainer.innerHTML = '';
        if (logs.length === 0) { logsContainer.innerHTML = '<div class="log-item">No events found.</div>'; return; }
        logs.reverse().forEach(log => {
            const item = document.createElement('div');
            item.style.marginBottom = '8px'; item.style.padding = '8px';
            item.style.background = 'var(--bg-light)'; item.style.borderRadius = '4px';
            item.style.borderLeft = '3px solid #ccc';
            const time = new Date(log.timestamp).toLocaleTimeString() + '.' + (log.timestamp % 1000);
            item.innerHTML = `<div style="font-weight: bold; color: var(--primary-color); margin-bottom: 4px;">[${time}] ${log.payload.type}</div><pre style="margin: 0; white-space: pre-wrap; word-break: break-all;">${JSON.stringify(log.payload.properties, null, 2)}</pre>`;
            logsContainer.appendChild(item);
        });
    } catch (e) {}
}

async function init() {
    console.log('[System] Initializing app...');
    applyStoredPreferences();
    
    // Show modal immediately if no session
    if (!currentSession && settingsModal) {
        console.log('[System] No session, showing settings modal');
        settingsModal.classList.add('active');
        loadExistingSessions();
    }

    try {
        connectWebSocket();
        await loadAgentsAndModels();
    } catch (e) { 
        console.error('Init error:', e); 
        addEvent('Error', 'Initialization error: ' + e.message);
    }
}

init();
