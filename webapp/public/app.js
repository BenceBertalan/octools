// State management
let currentSession = null;
let currentSessionID = null;
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

// Progress bubbles state
const progressBubbles = new Map(); // Map<messageID, Map<partID, bubbleElement>>
const completedTools = new Map();  // Map<messageID, Array<toolName>>

// Session diff state
const sessionDiffs = new Map(); // Map<sessionID, Array<FileDiff>>
const expandedDiffs = new Set(); // Set<filename> for tracking expanded files
let currentDrawerSession = null;

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

// Diff drawer event listeners
const diffBtn = document.getElementById('diffBtn');
const diffDrawerClose = document.getElementById('diffDrawerClose');
const diffDrawerOverlay = document.getElementById('diffDrawerOverlay');
const clearDiffBtn = document.getElementById('clearDiffBtn');

if (diffBtn) {
    diffBtn.addEventListener('click', toggleDiffDrawer);
}
if (diffDrawerClose) {
    diffDrawerClose.addEventListener('click', toggleDiffDrawer);
}
if (diffDrawerOverlay) {
    diffDrawerOverlay.addEventListener('click', toggleDiffDrawer);
}
if (clearDiffBtn) {
    clearDiffBtn.addEventListener('click', () => {
        if (confirm('Clear all file changes for this session?')) {
            clearSessionDiffs();
        }
    });
}

// Edit Session Modal event listeners
const sessionNameDisplay = getEl('sessionNameDisplay');
const editSessionModal = getEl('editSessionModal');
const closeEditSession = getEl('closeEditSession');
const cancelEditSession = getEl('cancelEditSession');
const saveSessionNameBtn = getEl('saveSessionName');
const sessionNameInput = getEl('sessionNameInput');

if (sessionNameDisplay) {
    sessionNameDisplay.addEventListener('click', showEditSessionModal);
}

if (closeEditSession) {
    closeEditSession.addEventListener('click', hideEditSessionModal);
}

if (cancelEditSession) {
    cancelEditSession.addEventListener('click', hideEditSessionModal);
}

if (saveSessionNameBtn) {
    saveSessionNameBtn.addEventListener('click', saveSessionName);
}

if (sessionNameInput) {
    sessionNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveSessionName();
        } else if (e.key === 'Escape') {
            hideEditSessionModal();
        }
    });
}

// Close modal on backdrop click
if (editSessionModal) {
    editSessionModal.addEventListener('click', (e) => {
        if (e.target === editSessionModal) {
            hideEditSessionModal();
        }
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

// Session Name Management
function updateSessionNameDisplay() {
    const sessionNameDisplay = getEl('sessionNameDisplay');
    if (!sessionNameDisplay || !currentSession) return;
    
    const displayName = currentSession.title || `ses_${currentSession.id.slice(-8)}`;
    sessionNameDisplay.textContent = displayName;
    sessionNameDisplay.style.display = 'block';
}

function showEditSessionModal() {
    const modal = getEl('editSessionModal');
    const input = getEl('sessionNameInput');
    const hint = getEl('sessionIdHint');
    
    if (!modal || !input || !currentSession) return;
    
    input.value = currentSession.title || '';
    hint.textContent = `Session ID: ${currentSession.id}`;
    modal.classList.add('active');
    
    setTimeout(() => {
        input.focus();
        input.select();
    }, 100);
}

function hideEditSessionModal() {
    const modal = getEl('editSessionModal');
    if (modal) modal.classList.remove('active');
}

async function saveSessionName() {
    const input = getEl('sessionNameInput');
    if (!input || !currentSessionID) return;
    
    const newName = input.value.trim();
    
    if (!newName) {
        alert('Session name cannot be empty');
        return;
    }
    
    try {
        const response = await fetch(`/api/session/${currentSessionID}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: newName })
        });
        
        if (!response.ok) throw new Error('Failed to update session name');
        
        const updatedSession = await safeJson(response);
        currentSession = updatedSession;
        
        updateSessionNameDisplay();
        hideEditSessionModal();
        showToast(`Session renamed to: ${newName}`, 'success');
        
    } catch (error) {
        console.error('Error updating session name:', error);
        alert('Failed to update session name: ' + error.message);
    }
}

function showToast(message, type = 'info', duration = 3000) {
    const container = getEl('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

function handleSessionUpdated(data) {
    if (!data.session || !currentSession || data.sessionID !== currentSessionID) return;
    
    const oldTitle = currentSession.title;
    const newTitle = data.session.title;
    
    currentSession = data.session;
    updateSessionNameDisplay();
    
    if (oldTitle !== newTitle && newTitle) {
        showToast(`Session renamed to: ${newTitle}`, 'info');
    }
}

function handleSessionError(data) {
    if (!data.error) return;
    
    const error = data.error;
    const errorName = error.name || 'Error';
    const errorMessage = error.message || 'An unknown error occurred';
    const errorDetails = error.details || error.stack;
    
    // Build error message
    let displayMessage = `❌ **${errorName}**: ${errorMessage}`;
    
    // Add details if available (but keep it concise)
    if (errorDetails && typeof errorDetails === 'string' && errorDetails !== errorMessage) {
        const detailsPreview = errorDetails.split('\n')[0].substring(0, 150);
        if (detailsPreview) {
            displayMessage += `\n\n\`${detailsPreview}${errorDetails.length > 150 ? '...' : ''}\``;
        }
    }
    
    // Add error message to chat with error styling
    addMessage('assistant', displayMessage, false, true, false, false, {});
    
    // Also update status to show error state
    updateStatus('error', `Error: ${errorName}`);
    
    console.error('[Session Error]', error);
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

// Load more messages helper
async function loadMoreMessages() {
    if (!currentSession || loadingMore) return;
    
    const sessionID = currentSession.id;
    let allMessages = messagesCache.get(sessionID);
    
    // If not cached, fetch all messages
    if (!allMessages) {
        loadingMore = true;
        updateLoadMoreButton(true);
        
        try {
            const response = await fetch(`/api/session/${sessionID}/messages`);
            if (!response.ok) throw new Error('Failed to fetch messages');
            allMessages = await safeJson(response) || [];
            messagesCache.set(sessionID, allMessages);
        } catch (e) {
            console.error('Load more failed:', e);
            addEvent('Error', 'Failed to load older messages: ' + e.message);
            loadingMore = false;
            updateLoadMoreButton(false);
            return;
        }
    }
    
    // Get current oldest displayed index
    let currentOldest = oldestDisplayedIndex.get(sessionID) ?? allMessages.length;
    
    // Calculate new oldest index (load 20 more)
    const newOldest = Math.max(0, currentOldest - 20);
    
    if (newOldest === currentOldest) {
        // No more messages to load
        loadingMore = false;
        updateLoadMoreButton(false);
        return;
    }
    
    // Get the messages to add
    const messagesToAdd = allMessages.slice(newOldest, currentOldest);
    
    // Preserve scroll position
    const oldScrollHeight = messagesContainer.scrollHeight;
    const oldScrollTop = messagesContainer.scrollTop;
    
    // Add messages at the top (in reverse order since we're prepending)
    const loadMoreBtn = document.querySelector('.load-more-container');
    const insertPoint = loadMoreBtn ? loadMoreBtn.nextSibling : messagesContainer.firstChild;
    
    messagesToAdd.reverse().forEach(msg => {
        const textParts = msg.parts.filter(p => p.type === 'text');
        const reasoningParts = msg.parts.filter(p => p.type === 'reasoning');
        const text = textParts.map(p => p.text).join('\n');
        
        // Log all messages to Events tab
        addEvent('Load Message', {
            source: 'loadMoreMessages',
            messageID: msg.info.id,
            role: msg.info.role,
            totalParts: msg.parts.length,
            textParts: textParts.length,
            reasoningParts: reasoningParts.length,
            hasText: !!text,
            partTypes: msg.parts.map(p => p.type),
            modelID: msg.info.modelID,
            agent: msg.info.agent
        });
        
        if (text || reasoningParts.length > 0) {
            // Create message bubble
            const msgID = msg.info.id;
            if (document.getElementById('msg-' + msgID)) return; // Skip if already exists
            
            const bubble = document.createElement('div');
            bubble.className = `message-bubble ${msg.info.role}`;
            bubble.id = 'msg-' + msgID;
            
            if (msg.info.agent || msg.info.modelID) {
                const infoBar = document.createElement('div');
                infoBar.className = 'message-info-bar';
                const agentName = msg.info.agent || 'Default';
                const modelName = msg.info.modelID ? `${msg.info.providerID ? msg.info.providerID + '/' : ''}${msg.info.modelID}` : '';
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
            
            if (msg.info.error) bubble.classList.add('error');
            
            // Add reasoning section if present
            if (reasoningParts.length > 0) {
                const reasoningSection = createReasoningSection(reasoningParts, msgID);
                if (reasoningSection) bubble.appendChild(reasoningSection);
            }
            
            // Insert at the right position
            messagesContainer.insertBefore(bubble, insertPoint);
            
            // Add timestamp
            const time = document.createElement('div');
            time.className = 'message-time';
            time.textContent = new Date(msg.info.time.created).toLocaleTimeString();
            messagesContainer.insertBefore(time, insertPoint);
        }
    });
    
    // Restore scroll position
    const newScrollHeight = messagesContainer.scrollHeight;
    messagesContainer.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    
    // Update state
    oldestDisplayedIndex.set(sessionID, newOldest);
    loadingMore = false;
    
    // Update button
    updateLoadMoreButton(false, newOldest > 0);
}

function updateLoadMoreButton(loading, hasMore = true) {
    let loadMoreContainer = document.querySelector('.load-more-container');
    
    if (!hasMore && loadMoreContainer) {
        loadMoreContainer.remove();
        return;
    }
    
    if (!loadMoreContainer) {
        loadMoreContainer = document.createElement('div');
        loadMoreContainer.className = 'load-more-container';
        
        const btn = document.createElement('button');
        btn.className = 'load-more-btn';
        btn.onclick = loadMoreMessages;
        
        loadMoreContainer.appendChild(btn);
        
        // Insert at the top of messages container
        if (messagesContainer.firstChild) {
            messagesContainer.insertBefore(loadMoreContainer, messagesContainer.firstChild);
        } else {
            messagesContainer.appendChild(loadMoreContainer);
        }
    }
    
    const btn = loadMoreContainer.querySelector('.load-more-btn');
    if (loading) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Loading earlier messages...';
    } else {
        btn.disabled = false;
        btn.innerHTML = '📜 Load Earlier Messages (20)';
    }
}

// Subagent Progress Functions
function handleSubagentProgress(data) {
    const { messageID, partID, agent, task, status } = data;
    
    // Get or create progress container for this message
    let messageProgressMap = progressBubbles.get(messageID);
    if (!messageProgressMap) {
        messageProgressMap = new Map();
        progressBubbles.set(messageID, messageProgressMap);
    }
    
    // Check if bubble exists for this part
    let bubble = messageProgressMap.get(partID);
    
    if (status === 'completed') {
        // Collapse logic: remove individual bubble, update summary
        if (bubble) {
            bubble.remove();
            messageProgressMap.delete(partID);
        }
        
        // Add to completed tools list
        let completed = completedTools.get(messageID) || [];
        completed.push(agent);
        completedTools.set(messageID, completed);
        
        // Update or create collapsed summary badge
        updateCompletedToolsSummary(messageID);
        
    } else if (status === 'error') {
        // Show error state
        if (!bubble) {
            bubble = createProgressBubble(messageID, partID);
            messageProgressMap.set(partID, bubble);
        }
        updateProgressBubble(bubble, agent, task, status);
        
    } else {
        // pending or running - show/update bubble
        if (!bubble) {
            bubble = createProgressBubble(messageID, partID);
            messageProgressMap.set(partID, bubble);
        }
        updateProgressBubble(bubble, agent, task, status);
    }
}

function createProgressBubble(messageID, partID) {
    const container = document.getElementById('messagesContainer');
    const bubble = document.createElement('div');
    bubble.id = `progress-${messageID}-${partID}`;
    bubble.className = 'progress-bubble';
    bubble.dataset.messageId = messageID;
    bubble.dataset.partId = partID;
    bubble.dataset.startTime = Date.now();
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
}

function updateProgressBubble(bubble, agent, task, status) {
    const startTime = parseInt(bubble.dataset.startTime);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    
    const icons = {
        pending: '⏳',
        running: '🔄',
        error: '❌'
    };
    
    const icon = icons[status] || '🔄';
    const statusText = status.charAt(0).toUpperCase() + status.slice(1);
    
    bubble.innerHTML = `
        <div class="progress-header">
            <span class="progress-icon">${icon}</span>
            <span class="progress-status">${statusText}: ${agent}</span>
            ${status === 'running' ? `<span class="progress-timer">⏱️ ${elapsed}s</span>` : ''}
        </div>
        <div class="progress-task">${escapeHtml(task)}</div>
    `;
    
    bubble.className = `progress-bubble progress-${status}`;
    
    // Update timer for running tasks
    if (status === 'running' && !bubble.dataset.timerInterval) {
        const intervalId = setInterval(() => {
            if (!document.contains(bubble)) {
                clearInterval(intervalId);
                return;
            }
            const timer = bubble.querySelector('.progress-timer');
            if (timer) {
                const newElapsed = Math.floor((Date.now() - startTime) / 1000);
                timer.textContent = `⏱️ ${newElapsed}s`;
            }
        }, 1000);
        bubble.dataset.timerInterval = intervalId;
    }
}

function updateCompletedToolsSummary(messageID) {
    const completed = completedTools.get(messageID) || [];
    if (completed.length === 0) return;
    
    // Remove existing summary
    const existingSummary = document.getElementById(`completed-summary-${messageID}`);
    if (existingSummary) existingSummary.remove();
    
    // Create new summary badge
    const container = document.getElementById('messagesContainer');
    const summary = document.createElement('div');
    summary.id = `completed-summary-${messageID}`;
    summary.className = 'progress-completed-summary';
    
    const displayCount = 3;
    const displayTools = completed.slice(-displayCount).join(' · ');
    const moreCount = completed.length > displayCount ? completed.length - displayCount : 0;
    const moreText = moreCount > 0 ? ` · ${moreCount} more` : '';
    
    summary.innerHTML = `✅ ${displayTools}${moreText} completed`;
    
    container.appendChild(summary);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Session Diff Functions
function handleSessionDiff(data) {
    const { sessionID, diff } = data;
    
    // Store diffs for this session
    let existingDiffs = sessionDiffs.get(sessionID) || [];
    
    // Merge new diffs with existing (update if file already exists)
    diff.forEach(newDiff => {
        const existingIndex = existingDiffs.findIndex(d => d.file === newDiff.file);
        if (existingIndex >= 0) {
            existingDiffs[existingIndex] = newDiff;
        } else {
            existingDiffs.push(newDiff);
        }
    });
    
    sessionDiffs.set(sessionID, existingDiffs);
    
    // Update UI if this is the current session
    if (sessionID === currentSessionID) {
        updateDiffButton(existingDiffs.length);
        if (isDiffDrawerOpen()) {
            renderDiffDrawer(existingDiffs);
        }
    }
}

function updateDiffButton(count) {
    const diffBtn = document.getElementById('diffBtn');
    const diffBadge = document.getElementById('diffBadge');
    const diffBtnText = document.getElementById('diffBtnText');
    
    if (count > 0) {
        diffBtn.style.display = 'inline-flex';
        diffBadge.textContent = count;
        diffBadge.style.display = 'inline';
        diffBtnText.textContent = `📄 Files (${count})`;
    } else {
        diffBtn.style.display = 'none';
    }
}

function isDiffDrawerOpen() {
    const drawer = document.getElementById('diffDrawer');
    return drawer && drawer.classList.contains('open');
}

function toggleDiffDrawer() {
    const drawer = document.getElementById('diffDrawer');
    const overlay = document.getElementById('diffDrawerOverlay');
    if (!drawer || !overlay) return;
    
    const isOpen = drawer.classList.contains('open');
    
    if (isOpen) {
        drawer.classList.remove('open');
        overlay.classList.remove('visible');
    } else {
        drawer.classList.add('open');
        overlay.classList.add('visible');
        const diffs = sessionDiffs.get(currentSessionID) || [];
        renderDiffDrawer(diffs);
    }
}

function renderDiffDrawer(diffs) {
    const content = document.getElementById('diffDrawerContent');
    const title = document.getElementById('diffDrawerTitle');
    if (!content || !title) return;
    
    title.textContent = `Files Changed (${diffs.length})`;
    
    if (diffs.length === 0) {
        content.innerHTML = '<div class="diff-empty-state">No file changes yet</div>';
        return;
    }
    
    content.innerHTML = diffs.map(diff => {
        const isExpanded = expandedDiffs.has(diff.file);
        const safeFile = escapeHtml(diff.file);
        const fileId = btoa(diff.file).replace(/=/g, '');
        return `
            <div class="diff-file-item" data-file="${safeFile}">
                <div class="diff-file-header" onclick="toggleFileDiff('${safeFile}')">
                    <span class="diff-file-toggle">${isExpanded ? '▼' : '▶'}</span>
                    <span class="diff-file-name">${safeFile}</span>
                    <span class="diff-file-stats">
                        <span class="diff-additions">+${diff.additions}</span>
                        <span class="diff-deletions">-${diff.deletions}</span>
                    </span>
                </div>
                ${isExpanded ? `
                    <div class="diff-file-content" id="diff-content-${fileId}">
                        <div class="diff-loading">Loading diff...</div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
    
    // Load expanded diffs
    diffs.forEach(diff => {
        if (expandedDiffs.has(diff.file)) {
            loadFileDiff(diff);
        }
    });
}

function toggleFileDiff(filename) {
    if (expandedDiffs.has(filename)) {
        expandedDiffs.delete(filename);
    } else {
        expandedDiffs.add(filename);
    }
    
    const diffs = sessionDiffs.get(currentSessionID) || [];
    renderDiffDrawer(diffs);
}

async function loadFileDiff(diff) {
    const fileId = btoa(diff.file).replace(/=/g, '');
    const contentId = `diff-content-${fileId}`;
    const contentDiv = document.getElementById(contentId);
    if (!contentDiv) return;
    
    try {
        const response = await fetch(`/api/session/${currentSessionID}/diff/${encodeURIComponent(diff.file)}`);
        
        if (!response.ok) {
            throw new Error('Failed to load diff');
        }
        
        const diffText = await response.text();
        contentDiv.innerHTML = formatDiffText(diffText);
        
    } catch (error) {
        contentDiv.innerHTML = `
            <div class="diff-error">
                ❌ Failed to load diff: ${error.message}
                <br><small>before: ${diff.before || 'none'}</small>
                <br><small>after: ${diff.after}</small>
            </div>
        `;
    }
}

function formatDiffText(diffText) {
    if (!diffText || diffText.trim() === '') {
        return '<div class="diff-no-content">No diff content available</div>';
    }
    
    const lines = diffText.split('\n');
    return lines.map(line => {
        const escaped = escapeHtml(line);
        if (line.startsWith('+') && !line.startsWith('+++')) {
            return `<div class="diff-line diff-line-add">${escaped}</div>`;
        } else if (line.startsWith('-') && !line.startsWith('---')) {
            return `<div class="diff-line diff-line-remove">${escaped}</div>`;
        } else if (line.startsWith('@@')) {
            return `<div class="diff-line diff-line-header">${escaped}</div>`;
        } else {
            return `<div class="diff-line diff-line-context">${escaped}</div>`;
        }
    }).join('');
}

function clearSessionDiffs() {
    if (!currentSessionID) return;
    
    sessionDiffs.delete(currentSessionID);
    expandedDiffs.clear();
    updateDiffButton(0);
    renderDiffDrawer([]);
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
        updateStatus('idle', 'Connected');
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
                
                // Clean up progress bubbles for this message
                const progressMap = progressBubbles.get(finalID);
                if (progressMap) {
                    progressMap.forEach(bubble => bubble.remove());
                    progressBubbles.delete(finalID);
                }
                
                // Fade completed summary
                const summary = document.getElementById(`completed-summary-${finalID}`);
                if (summary) {
                    summary.style.opacity = '0.7';
                }
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
            case 'subagent.progress':
                handleSubagentProgress(data);
                break;
            case 'session.diff':
                handleSessionDiff(data);
                break;
            case 'session.updated':
                handleSessionUpdated(data);
                break;
            case 'session.error':
                handleSessionError(data);
                break;
            case 'session.error.auth':
                showAuthError(data.error?.message || 'Authentication failed');
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
            // Log all messages to Events tab
            addEvent('Load Message', {
                source: 'syncSessionState',
                messageID: msg.info.id,
                role: msg.info.role,
                totalParts: msg.parts.length,
                textParts: msg.parts.filter(p => p.type === 'text').length,
                reasoningParts: msg.parts.filter(p => p.type === 'reasoning').length,
                hasText: !!msg.parts.filter(p => p.type === 'text').map(p => p.text).join('\n'),
                partTypes: msg.parts.map(p => p.type),
                modelID: msg.info.modelID,
                agent: msg.info.agent,
                alreadyDisplayed: !!document.getElementById('msg-' + msg.info.id)
            });
            
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
    currentSessionID = session.id;
    currentDrawerSession = session.id;
    
    // Update session name display
    updateSessionNameDisplay();
    
    // Reset diff drawer for new session
    expandedDiffs.clear();
    const diffs = sessionDiffs.get(session.id) || [];
    updateDiffButton(diffs.length);
    if (isDiffDrawerOpen()) {
        renderDiffDrawer(diffs);
    }
    
    try {
        // Fetch all messages without limit
        const response = await fetch(`/api/session/${session.id}/messages`);
        if (!response.ok) throw new Error('Failed to fetch messages');
        const allMessages = await safeJson(response) || [];
        
        // Cache messages
        messagesCache.set(session.id, allMessages);
        
        // Determine how many to show initially (last 20)
        const initialCount = Math.min(20, allMessages.length);
        const startIndex = allMessages.length - initialCount;
        const messagesToShow = allMessages.slice(startIndex);
        
        // Store oldest displayed index
        oldestDisplayedIndex.set(session.id, startIndex);
        
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', sessionID: session.id }));
        updateStatus('idle'); 
        if (settingsModal) settingsModal.classList.remove('active');
        if (messagesContainer) messagesContainer.innerHTML = '';
        
        // Add "Load More" button if there are more messages
        if (startIndex > 0) {
            updateLoadMoreButton(false, true);
        }
        
        messagesToShow.forEach(msg => {
            const textParts = msg.parts.filter(p => p.type === 'text');
            const reasoningParts = msg.parts.filter(p => p.type === 'reasoning');
            const text = textParts.map(p => p.text).join('\n');
            
            // Log all messages to Events tab
            addEvent('Load Message', {
                source: 'connectToSession',
                messageID: msg.info.id,
                role: msg.info.role,
                totalParts: msg.parts.length,
                textParts: textParts.length,
                reasoningParts: reasoningParts.length,
                hasText: !!text,
                partTypes: msg.parts.map(p => p.type),
                modelID: msg.info.modelID,
                agent: msg.info.agent
            });
            
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
            
            // Log all messages to Events tab
            addEvent('Load Message', {
                source: 'loadSessionHistory',
                messageID: msg.info.id,
                role: msg.info.role,
                totalParts: msg.parts.length,
                textParts: textParts.length,
                reasoningParts: reasoningParts.length,
                hasText: !!text,
                partTypes: msg.parts.map(p => p.type),
                modelID: msg.info.modelID,
                agent: msg.info.agent
            });
            
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

// Auto-reconnect when page becomes visible
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // Check if websocket is disconnected
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            console.log('[System] Page visible and WebSocket disconnected, reconnecting...');
            connectWebSocket();
        }
    }
});

init();
