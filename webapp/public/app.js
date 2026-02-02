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

// Settings Tab switching
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.settingsTab;
        
        document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        
        btn.classList.add('active');
        document.getElementById(tab + 'SessionsTab').classList.add('active');
        
        if (tab === 'existing') {
            loadExistingSessions();
        }
    });
});

// Search debouncing
let searchTimeout = null;
sessionSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        loadExistingSessions(sessionSearch.value);
    }, 300);
});

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
    
    const agent = qsAgentSelect.value || undefined;
    const modelStr = qsModelSelect.value;
    const model = modelStr ? JSON.parse(modelStr) : undefined;

    // Add user message to UI
    addMessage('user', text, false, false, false, false, { agent, modelID: model?.modelID, providerID: model?.providerID });
    
    // Show typing indicator
    addTypingIndicator('assistant-typing');
    
    try {
        console.log(`Sending message to session ${currentSession.id}...`);
        
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

function updateStreamingMessage(messageID, text, isReasoning = false, metadata = {}) {
    let streamMsg = document.getElementById('stream-' + messageID);
    if (!streamMsg) {
        streamMsg = document.createElement('div');
        streamMsg.id = 'stream-' + messageID;
        streamMsg.className = 'message-bubble assistant';
        if (isReasoning) streamMsg.classList.add('reasoning');
        
        if (metadata.agent || metadata.modelID) {
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
    console.log(`[UI] addMessage: role=${role}, isQuestion=${isQuestion}, text="${text?.substring(0, 30)}..."`);
    
    if (!text) {
        console.warn('[UI] addMessage: No text provided');
        return;
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role}`;
    
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
        console.error('Marked parse error:', e);
        content.textContent = text;
    }
    bubble.appendChild(content);

    if (isQuestion) {
        console.log('[UI] addMessage: Handling as question-inline');
        bubble.classList.add('question-inline');
        const qData = questionData || currentQuestion;
        
        if (qData) {
            const questions = qData.questions || (qData.properties && qData.properties.questions);
            console.log('[UI] Question data found:', !!questions);
            if (questions && questions.length > 0) {
                // Shared state for all questions in this bubble
                const allAnswers = questions.map(() => new Set());
                
                const submitBtn = document.createElement('button');
                submitBtn.className = 'submit-question-inline';
                submitBtn.textContent = 'Submit Answer';
                submitBtn.disabled = true;

                const updateSubmitState = () => {
                    // Enable if at least one option is selected in ANY question (or maybe ALL?)
                    // Let's require all questions to have at least one selection if they are there
                    const allAnswered = allAnswers.every(ans => ans.size > 0);
                    submitBtn.disabled = !allAnswered;
                };

                if (questions.length > 1) {
                    // Create Tabs
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
                        
                        // Question Text
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
                    // Single question logic (keep it simple)
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
                        
                        console.log(`[UI] Submitting answers for ID ${requestID}:`, finalAnswers);
                        const body = { sessionID: currentSession.id, answers: finalAnswers };
                        
                        const res = await fetch(`/api/question/${requestID}/reply`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body)
                        });
                        
                        if (!res.ok) {
                            const errorData = await res.json().catch(() => ({ error: res.statusText }));
                            throw new Error(errorData.error || 'Server rejected reply');
                        }

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
        } else {
            console.warn('[UI] No qData for question bubble');
        }
    }
    
    if (isError) bubble.classList.add('error');
    if (isWarning) bubble.classList.add('warning');
    if (isInfo) bubble.classList.add('info-blue');
    
    messagesContainer.appendChild(bubble);
    console.log('[UI] Bubble appended to container');
    
    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = new Date().toLocaleTimeString();
    messagesContainer.appendChild(time);
    
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

async function abortLastPrompt() {
    if (!currentSession) return;
    
    try {
        console.log(`Aborting prompt for session ${currentSession.id}...`);
        abortBtn.disabled = true;
        
        const response = await fetch(`/api/session/${currentSession.id}/abort`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || response.statusText);
        }
        
        console.log('Abort successful');
        addMessage('assistant', '🛑 Prompt aborted by user.', false, false, true);
    } catch (error) {
        console.error('Abort error:', error);
        addEvent('Error', 'Failed to abort: ' + error.message);
    } finally {
        abortBtn.disabled = false;
    }
}

function updateStatus(status, text) {
    statusDot.className = 'status-dot ' + status;
    statusText.textContent = text || status.charAt(0).toUpperCase() + status.slice(1);
    
    // Show/hide abort button based on status
    if (status === 'busy' || status === 'retry') {
        abortBtn.style.display = 'flex';
    } else {
        abortBtn.style.display = 'none';
    }
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
        console.log(`[WS] Event received: ${type}`, data);
        addEvent(type, data);
        
        switch (type) {
            case 'session.status':
                const sessionStatus = (data.status && data.status.type) || data.status || data.type;
                updateStatus(sessionStatus, `Session: ${data.sessionID.substring(0, 8)} (${sessionStatus})`);
                if (sessionStatus === 'busy') addTypingIndicator('assistant-typing');
                else if (sessionStatus === 'idle') removeTypingIndicator('assistant-typing');
                else if (sessionStatus === 'retry') {
                    const details = data.status || data.details || {};
                    const retryMsg = details.message || data.message || 'Retrying...';
                    const attempt = details.attempt || data.attempt ? ` (Attempt ${details.attempt || data.attempt})` : '';
                    const next = details.next || data.next ? ` Next try at ${new Date(details.next || data.next).toLocaleTimeString()}` : '';
                    addMessage('assistant', `⚠️ **Retry**: ${retryMsg}${attempt}${next}`, false, false, true);
                }
                break;
            case 'message.delta':
            case 'message.part':
                const msgID = data.messageID || data.id;
                
                // Special handling for reasoning parts
                const part = data.part || (data.parts && data.parts[0]);
                const isReasoning = part?.type === 'reasoning';
                
                // Try to get metadata from message info if available
                const msgMeta = data.message || {};
                
                let fullText = messageBuffer.get(msgID) || '';
                fullText += (data.delta || data.text || '');
                messageBuffer.set(msgID, fullText);
                updateStreamingMessage(msgID, fullText, isReasoning, msgMeta);
                break;
            case 'message.complete':
                const finalID = data.messageID || data.id;
                let finalContent = messageBuffer.get(finalID);
                
                // If we don't have it in buffer, maybe it's in the message object
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

                addMessage('assistant', finalContent || '(No content)', false, isError, false, false, data.message || {});
                
                messageBuffer.delete(finalID);
                removeTypingIndicator('assistant-typing');
                break;
            case 'question':
                currentQuestion = data;
                const qText = (data.questions && data.questions[0] && data.questions[0].question) || 
                              (data.properties && data.properties.questions && data.properties.questions[0] && data.properties.questions[0].question) ||
                              '🤔 I have a question for you:';
                addMessage('assistant', qText, true, false, false, false, {}, data);
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
            case 'session.model_switched':
                const modelName = data.model?.modelID || 'unknown model';
                addMessage('assistant', `🔄 **Model Switched**: Now using **${modelName}** (Reason: ${data.reason})`, false, false, false, true);
                
                // Update dropdowns
                if (data.model) {
                    const modelVal = JSON.stringify({ providerID: data.model.providerID, modelID: data.model.modelID });
                    qsModelSelect.value = modelVal;
                    modelSelect.value = modelVal;
                }
                break;
            case 'session.retrying_alternative':
                const altModelName = data.model?.modelID || 'unknown model';
                addMessage('assistant', `♻️ **Auto-Retry**: Retrying last prompt with **${altModelName}**...`, false, false, false, true);
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

        const populateModels = (select, label = "Model: Default") => {
            select.innerHTML = `<option value="">${label}</option>`;
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
        populateModels(secondaryModelSelect, "Secondary Model: None");

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
    const secondaryModelStr = secondaryModelSelect.value;
    const secondaryModel = secondaryModelStr ? JSON.parse(secondaryModelStr) : undefined;
    const directory = directoryInput.value || '/root';
    
    try {
        updateStatus('busy', 'Creating session...');
        const response = await fetch('/api/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent, model, secondaryModel, directory })
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

async function loadExistingSessions(search = '') {
    try {
        sessionList.innerHTML = '<div style="padding: 20px; text-align: center; color: #90949c;">Loading sessions...</div>';
        
        // Load sessions from the last week
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        let url = `/api/sessions?limit=50&start=${oneWeekAgo}`;
        if (search) {
            url += `&search=${encodeURIComponent(search)}`;
        }
        
        const response = await fetch(url);
        const sessions = await response.json();
        
        sessionList.innerHTML = '';
        if (sessions.length === 0) {
            sessionList.innerHTML = '<div style="padding: 20px; text-align: center; color: #90949c;">No sessions found</div>';
            return;
        }

        // Grouping logic
        const groups = {};
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();

        sessions.forEach(session => {
            const date = new Date(session.time.updated);
            let groupName = date.toDateString();
            
            if (groupName === today) groupName = 'Today';
            else if (groupName === yesterday) groupName = 'Yesterday';
            else groupName = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

            if (!groups[groupName]) groups[groupName] = [];
            groups[groupName].push(session);
        });

        Object.keys(groups).forEach(groupName => {
            const header = document.createElement('div');
            header.className = 'session-group-header';
            header.textContent = groupName;
            sessionList.appendChild(header);

            groups[groupName].forEach(session => {
                const item = document.createElement('div');
                item.className = 'session-item';
                
                const title = session.title || session.id.substring(0, 12);
                const timeStr = new Date(session.time.updated).toLocaleTimeString(undefined, { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                });

                item.innerHTML = `
                    <div class="session-item-title">${title}</div>
                    <div class="session-item-date">${timeStr}</div>
                `;

                item.onclick = () => connectToSession(session);
                sessionList.appendChild(item);
            });
        });
    } catch (error) {
        console.error('List sessions error:', error);
        sessionList.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--error-color);">Failed to load sessions</div>';
    }
}

async function connectToSession(session) {
    console.log('Connecting to session:', session);
    currentSession = session;
    
    // Apply session state to UI
    try {
        const messages = await fetch(`/api/session/${session.id}/messages?limit=20`).then(r => r.json());
        
        // Find last user message to restore agent/model state
        let lastUserMsg = null;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].info.role === 'user') {
                lastUserMsg = messages[i];
                break;
            }
        }

        if (lastUserMsg) {
            const info = lastUserMsg.info;
            if (info.agent) {
                qsAgentSelect.value = info.agent;
                agentSelect.value = info.agent;
            }
            if (info.modelID) {
                const modelVal = JSON.stringify({ providerID: info.providerID, modelID: info.modelID });
                qsModelSelect.value = modelVal;
                modelSelect.value = modelVal;
            }
        }
        
        // Re-connect WebSocket
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionID: session.id }));
        }
        
        updateStatus('idle', `Session: ${session.id.substring(0, 8)}`);
        settingsModal.classList.remove('active');
        messagesContainer.innerHTML = '';
        addMessage('assistant', `Connected to session: **${session.title || session.id}**`);
        
        // Load last 20 messages
        if (Array.isArray(messages) && messages.length > 0) {
            messages.forEach(msg => {
                const text = msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
                if (text) addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info);
            });
        }
    } catch (err) {
        console.error('Connection failed:', err);
        addEvent('Error', 'Failed to connect: ' + err.message);
    }
}

async function loadSessionHistory(sessionID, limit = 100) {
    try {
        const response = await fetch(`/api/session/${sessionID}/messages?limit=${limit}`);
        const messages = await response.json();
        if (Array.isArray(messages) && messages.length > 0) {
            messagesContainer.innerHTML = '';
            messages.forEach(msg => {
                const text = msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n');
                if (text) addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info);
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
            if (!currentSession) {
                settingsModal.classList.add('active');
                loadExistingSessions();
            }
        }, 500);
    } catch (err) {
        addEvent('Error', 'Init failed: ' + err.message);
    }
}

init();
