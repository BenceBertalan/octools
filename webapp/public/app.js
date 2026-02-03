// State management
let currentSession = null;
let currentSessionID = null;
let ws = null;
let currentQuestion = null;
let isQuestionPaused = false; // Track if liveness is paused for question
let agents = [];
let models = [];
let messageBuffer = new Map();

// Pagination state
let messagesCache = new Map(); // sessionID -> all messages
let oldestDisplayedIndex = new Map(); // sessionID -> index
let loadingMore = false;

// Reasoning state
let reasoningExpanded = new Map(); // messageID -> boolean

// Tool/Agent outputs
let toolOutputs = new Map(); // progressID -> {agent, task, output}

// Progress bubbles state
const progressBubbles = new Map(); // Map<messageID, Map<partID, bubbleElement>>
const completedTools = new Map();  // Map<messageID, Array<toolName>>

// Tool Event Store - tracks all events for each tool/agent
const toolEventStore = new Map(); // Map<partID, ToolEventData>
let activeToolDrawerPartID = null; // Currently open drawer

// Session diff state
const sessionDiffs = new Map(); // Map<sessionID, Array<FileDiff>>
const expandedDiffs = new Set(); // Set<filename> for tracking expanded files
let currentDrawerSession = null;

// Session status tracking
const sessionStatuses = new Map(); // Map<sessionID, 'idle' | 'busy' | 'error'>

// History state
const historicalMessages = new Set(); // Set of message IDs already loaded via sync
const historicalParts = new Set();    // Set of part IDs already loaded via sync

// Historical event loading state
let isLoadingHistory = false;
let historicalEventQueue = [];
let expectedHistoricalEvents = 0;
let processedHistoricalEvents = 0;
let syncCompleteReceived = false;

// Liveness tracking
const sessionLiveness = new Map(); // Map<sessionID, {seconds: number, timerElement: HTMLElement}>
let retryNotification = null;

// Auto-reconnect state
let reconnectAttempts = 0;
let reconnectTimeout = null;
let maxReconnectDelay = 30000; // 30 seconds max
let isReconnecting = false;

// Rich editor state
let editorMode = 'simple';  // 'simple' | 'rich'
let richEditorInstance = null;
let editRichEditorInstance = null;
let originalMessageText = '';

// Favorites state
const favoriteMessages = new Map(); // messageID -> {text, role, timestamp}
let lastPromptTap = 0; // For double-tap detection

// Post-process marked.js output to fix list spacing issues
function cleanMarkedOutput(html) {
    if (!html) return html;
    
    // Remove newlines between list items to prevent spacing issues
    // This makes marked.js output similar to our custom function
    html = html.replace(/(<\/li>)\s*\n\s*(<li>)/g, '$1$2');
    
    // Remove newlines after opening <ul>/<ol> and before closing
    html = html.replace(/(<[uo]l>)\s*\n\s*/g, '$1');
    html = html.replace(/\s*\n\s*(<\/[uo]l>)/g, '$1');
    
    // Remove any remaining newlines within lists
    html = html.replace(/(<[uo]l>[\s\S]*?<\/[uo]l>)/g, function(match) {
        return match.replace(/\n/g, '');
    });
    
    return html;
}

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
const hamburgerBtn = getEl('hamburgerBtn');
const hamburgerMenu = getEl('hamburgerMenu');
const menuSettings = getEl('menuSettings');
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
const loadingModal = getEl('loadingModal');
const loadingText = getEl('loadingText');
const progressFill = getEl('progressFill');
const loadingStats = getEl('loadingStats');
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
const showReasoningCheckbox = getEl('showReasoning');
const showEventsTabCheckbox = getEl('showEventsTab');
const darkThemeCheckbox = getEl('darkTheme');
const livenessTimeoutInput = getEl('livenessTimeout');
const historyLimitInput = getEl('historyLimit');
const livenessRow = getEl('livenessRow');
const livenessCountdown = getEl('livenessCountdown');
const uiScaleInput = getEl('uiScale');
const uiScaleValue = getEl('uiScaleValue');
const favoritesModal = getEl('favoritesModal');
const closeFavorites = getEl('closeFavorites');
const favoritesList = getEl('favoritesList');

// Notes DOM elements
const notesModal = getEl('notesModal');
const closeNotes = getEl('closeNotes');
const notesList = getEl('notesList');
const newNoteBtn = getEl('newNoteBtn');
const noteTitle = getEl('noteTitle');
const noteEditor = getEl('noteEditor');
const noteSessionScope = getEl('noteSessionScope');
const saveNoteBtn = getEl('saveNoteBtn');
const sendNoteBtn = getEl('sendNoteBtn');
const deleteNoteBtn = getEl('deleteNoteBtn');
const saveToNotesBtn = getEl('saveToNotesBtn');
const saveToNotesRichBtn = getEl('saveToNotesRichBtn');

// Notes state
let currentNoteID = null;
let currentNotesScope = 'session'; // 'session' or 'global'
let notesCache = { global: [], session: [] };

// Rich editor DOM elements
const inputContainer = getEl('inputContainer');
const simpleInputWrapper = getEl('simpleInputWrapper');
const richInputWrapper = getEl('richInputWrapper');
const toggleRichBtn = getEl('toggleRichBtn');
const toggleSimpleBtn = getEl('toggleSimpleBtn');
const richEditor = getEl('richEditor');
const editMessageModal = getEl('editMessageModal');
const closeEditMessage = getEl('closeEditMessage');
const cancelEditMessage = getEl('cancelEditMessage');
const resendMessageBtn = getEl('resendMessageBtn');
const editRichEditor = getEl('editRichEditor');

// Tab switching (Main)
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab);
    });
});

// Add swipe gesture support for tab switching
const tabOrder = ['chat', 'files', 'tools'];
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

const container = document.querySelector('.container');
if (container) {
    container.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    container.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    }, { passive: true });
}

function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    
    // Only trigger if horizontal swipe is dominant
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
        const currentTab = document.querySelector('.tab-btn.active')?.dataset.tab;
        const currentIndex = tabOrder.indexOf(currentTab);
        
        if (currentIndex === -1) return;
        
        let newIndex;
        if (deltaX > 0) {
            // Swipe right - go to previous tab
            newIndex = Math.max(0, currentIndex - 1);
        } else {
            // Swipe left - go to next tab
            newIndex = Math.min(tabOrder.length - 1, currentIndex + 1);
        }
        
        if (newIndex !== currentIndex) {
            switchTab(tabOrder[newIndex]);
        }
    }
}

// Helper function to programmatically switch tabs
function switchTab(tabName) {
    // Update button states
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.classList.add('active');
    
    // Update active class on tab-content to show/hide
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const target = getEl(tabName + 'Tab');
    if (target) target.classList.add('active');
}

// Settings Tab switching
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.settingsTab;
        document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        
        let targetId;
        if (tab === 'existing') targetId = 'existingSessionsTab';
        else if (tab === 'new') targetId = 'newSessionTab';
        else if (tab === 'preferences') targetId = 'preferencesTab';
        
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
// Hamburger menu toggle - now opens menu modal
if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menuDrawer = document.getElementById('menuDrawer');
        const drawerOverlay = document.getElementById('drawerOverlay');
        if (menuDrawer && drawerOverlay) {
            menuDrawer.classList.add('active');
            drawerOverlay.classList.add('active');
        }
    });
}

// Close menu drawer
const closeMenu = document.getElementById('closeMenu');
const drawerOverlay = document.getElementById('drawerOverlay');

if (closeMenu) {
    closeMenu.addEventListener('click', () => {
        const menuDrawer = document.getElementById('menuDrawer');
        if (menuDrawer && drawerOverlay) {
            menuDrawer.classList.remove('active');
            drawerOverlay.classList.remove('active');
        }
    });
}

if (drawerOverlay) {
    drawerOverlay.addEventListener('click', () => {
        const menuDrawer = document.getElementById('menuDrawer');
        if (menuDrawer) {
            menuDrawer.classList.remove('active');
            drawerOverlay.classList.remove('active');
        }
    });
}

// Helper function to open a page
function openPage(pageId) {
    const page = document.getElementById(pageId);
    const menuDrawer = document.getElementById('menuDrawer');
    const drawerOverlay = document.getElementById('drawerOverlay');
    
    if (page) {
        page.classList.add('active');
        // Close drawer when opening page
        if (menuDrawer && drawerOverlay) {
            menuDrawer.classList.remove('active');
            drawerOverlay.classList.remove('active');
        }
    }
}

// Helper function to close a page
function closePage(pageId) {
    const page = document.getElementById(pageId);
    if (page) {
        page.classList.remove('active');
    }
}

// Menu item handlers
const menuSessionSettings = document.getElementById('menuSessionSettings');
const menuAgentSettings = document.getElementById('menuAgentSettings');
const menuModelPriority = document.getElementById('menuModelPriority');

if (menuSessionSettings) {
    menuSessionSettings.addEventListener('click', () => {
        openPage('pageSessionSettings');
        loadSessionSettingsPage();
    });
}

if (menuAgentSettings) {
    menuAgentSettings.addEventListener('click', () => {
        openPage('pageAgentSettings');
        loadAgentSettingsPage();
    });
}

if (menuModelPriority) {
    menuModelPriority.addEventListener('click', () => {
        openPage('pageModelPriority');
        loadModelPriorityPage();
    });
}

// Back button handlers
const backFromSessionSettings = document.getElementById('backFromSessionSettings');
const backFromAgentSettings = document.getElementById('backFromAgentSettings');
const backFromModelPriority = document.getElementById('backFromModelPriority');

if (backFromSessionSettings) {
    backFromSessionSettings.addEventListener('click', () => {
        closePage('pageSessionSettings');
    });
}

if (backFromAgentSettings) {
    backFromAgentSettings.addEventListener('click', () => {
        closePage('pageAgentSettings');
    });
}

if (backFromModelPriority) {
    backFromModelPriority.addEventListener('click', () => {
        closePage('pageModelPriority');
    });
}

// Tap on message background to collapse rich editor
if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
        if (editorMode === 'rich') {
            // Check if user clicked on interactive elements
            if (e.target.closest('.message-bubble') || 
                e.target.closest('.event-item') || 
                e.target.closest('button') || 
                e.target.closest('a') || 
                e.target.closest('input') || 
                e.target.closest('textarea') ||
                e.target.closest('.code-block-header')) {
                return;
            }
            
            // Check if selecting text
            const selection = window.getSelection();
            if (selection && selection.toString().length > 0) {
                return;
            }
            
            switchToSimpleMode();
        }
    });
}

// Page loader functions
function loadSessionSettingsPage() {
    const content = document.getElementById('sessionSettingsContent');
    if (!content) return;
    
    // Move existing session settings content to page
    content.innerHTML = `
        <div class="settings-section">
            <h3>Current Session</h3>
            <p id="currentSessionName">No session selected</p>
            <button class="btn-primary" id="openSettingsModal">Manage Sessions</button>
        </div>
    `;
    
    // Wire up the button
    const openSettingsBtn = document.getElementById('openSettingsModal');
    if (openSettingsBtn) {
        openSettingsBtn.addEventListener('click', () => {
            closePage('pageSessionSettings');
            settingsModal.classList.add('active');
            loadExistingSessions();
        });
    }
    
    // Update current session name
    const currentSessionNameEl = document.getElementById('currentSessionName');
    if (currentSessionNameEl && currentSession) {
        currentSessionNameEl.textContent = currentSession.title || currentSession.slug || currentSession.id;
    }
}

function loadAgentSettingsPage() {
    const content = document.getElementById('agentSettingsContent');
    if (!content) return;
    
    content.innerHTML = `
        <div class="settings-section">
            <h3>Agent & Model Configuration</h3>
            <p>Configure default models for specific agents.</p>
            <div class="form-group">
                <label>Agent Selection</label>
                <select id="pageAgentSelect" class="form-control">
                    <option value="">Loading...</option>
                </select>
            </div>
            <div class="form-group">
                <label>Default Model</label>
                <select id="pageModelSelect" class="form-control">
                    <option value="">Use agent default</option>
                </select>
            </div>
            <button class="btn-primary" id="saveAgentSettings">Save Settings</button>
        </div>
    `;
    
    // Load agents and models
    loadAgentsForPage().then(() => {
         // Default to first agent if available
         const select = document.getElementById('pageAgentSelect');
         if (select && select.options.length > 1) {
             select.selectedIndex = 1; // Skip "Select an agent..."
             select.dispatchEvent(new Event('change'));
         }
    });
    loadModelsForPage();
    
    // Wire events
    const agentSelect = document.getElementById('pageAgentSelect');
    const saveBtn = document.getElementById('saveAgentSettings');
    
    if (agentSelect) {
        agentSelect.addEventListener('change', async () => {
             const agentName = agentSelect.value;
             if (agentName) await loadPageAgentConfig(agentName);
        });
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', async () => {
             await savePageAgentConfig();
        });
    }
}

function loadModelPriorityPage() {
    const content = document.getElementById('modelPriorityContent');
    if (!content) return;
    
    content.innerHTML = `
        <div class="settings-section">
            <h3>Model Priority Configuration</h3>
            <p>Set priority order for model selection.</p>
            <div id="modelPriorityList">
                <p>Loading model priority settings...</p>
            </div>
        </div>
    `;
    
    // Load model priority (reuse existing function)
    loadModelPriorityInPage();
}

// Helper functions for loading data into pages
async function loadAgentsForPage() {
    const select = document.getElementById('pageAgentSelect');
    if (!select) return;
    
    try {
        const agents = await fetch('/api/agents').then(r => r.json());
        select.innerHTML = '<option value="">Select an agent...</option>';
        agents.forEach(agent => {
            const option = document.createElement('option');
            option.value = agent.name;
            option.textContent = agent.name;
            select.appendChild(option);
        });
    } catch (e) {
        select.innerHTML = '<option value="">Failed to load agents</option>';
    }
}

async function loadModelsForPage() {
    const select = document.getElementById('pageModelSelect');
    if (!select) return;
    
    try {
        const models = await fetch('/api/models').then(r => r.json());
        select.innerHTML = '<option value="">Use agent default</option>';
        
        // Group by provider
        const grouped = {};
        models.forEach(model => {
            const provider = model.providerID || 'Other';
            if (!grouped[provider]) grouped[provider] = [];
            grouped[provider].push(model);
        });
        
        Object.keys(grouped).sort().forEach(provider => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = provider;
            grouped[provider].forEach(model => {
                const option = document.createElement('option');
                option.value = JSON.stringify({ providerID: model.providerID, modelID: model.modelID });
                option.textContent = model.name || model.modelID;
                optgroup.appendChild(option);
            });
            select.appendChild(optgroup);
        });
    } catch (e) {
        select.innerHTML = '<option value="">Failed to load models</option>';
    }
}

async function loadPageAgentConfig(agentName) {
    try {
        const config = await fetch('/api/config').then(r => r.json());
        const agentConfig = config.agent || {};
        const settings = agentConfig[agentName] || {};
        
        const modelSelect = document.getElementById('pageModelSelect');
        if (modelSelect) {
            if (settings.model) {
                // Try direct match (if strict JSON string match works)
                const targetVal = JSON.stringify(settings.model);
                modelSelect.value = targetVal;
                
                // If direct match fails (e.g. key order), iterate to find match
                if (!modelSelect.value && modelSelect.options) {
                     for (let i = 0; i < modelSelect.options.length; i++) {
                         try {
                             const optVal = JSON.parse(modelSelect.options[i].value);
                             if (optVal && settings.model && 
                                 optVal.providerID === settings.model.providerID && 
                                 optVal.modelID === settings.model.modelID) {
                                 modelSelect.selectedIndex = i;
                                 break;
                             }
                         } catch (e) {}
                     }
                }
            } else {
                modelSelect.value = "";
            }
        }
    } catch (e) {
        console.error('Error loading agent config:', e);
    }
}

async function savePageAgentConfig() {
    const agentSelect = document.getElementById('pageAgentSelect');
    const modelSelect = document.getElementById('pageModelSelect');
    
    if (!agentSelect || !agentSelect.value) {
        alert('Please select an agent');
        return;
    }
    
    const agentName = agentSelect.value;
    let model = null;
    if (modelSelect.value) {
        try {
            model = JSON.parse(modelSelect.value);
        } catch (e) {}
    }
    
    try {
        const update = {
            agent: {
                [agentName]: {
                    model: model
                }
            }
        };
        
        const res = await fetch('/api/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update)
        });
        
        if (res.ok) {
            const btn = document.getElementById('saveAgentSettings');
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = 'Saved!';
                setTimeout(() => btn.textContent = originalText, 2000);
            }
        } else {
            alert('Failed to save settings');
        }
    } catch (e) {
        console.error('Error saving config:', e);
        alert('Error saving settings');
    }
}

function loadModelPriorityInPage() {
    const container = document.getElementById('modelPriorityList');
    if (!container) return;
    
    // This will be implemented similar to existing model priority modal
    container.innerHTML = '<p>Model priority configuration coming soon...</p>';
}

// Close hamburger menu when clicking outside (legacy - can be removed later)
document.addEventListener('click', (e) => {
    if (hamburgerMenu && !hamburgerMenu.contains(e.target) && e.target !== hamburgerBtn) {
        hamburgerMenu.style.display = 'none';
    }
});

// Settings menu item (legacy dropdown - kept for backward compatibility)
if (menuSettings) {
    menuSettings.addEventListener('click', () => {
        hamburgerMenu.style.display = 'none';
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

// Close modals when clicking on background
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal') && e.target.classList.contains('active')) {
        e.target.classList.remove('active');
    }
});

// ==========================
// Agent Settings Modal
// ==========================

const agentSettingsModal = document.getElementById('agentSettingsModal');
const closeAgentSettings = document.getElementById('closeAgentSettings');
const agentSettingsSelect = document.getElementById('agentSettingsSelect');
const agentModelSelect = document.getElementById('agentModelSelect');
const agentTemperature = document.getElementById('agentTemperature');
const agentTemperatureValue = document.getElementById('agentTemperatureValue');
const agentTopP = document.getElementById('agentTopP');
const agentTopPValue = document.getElementById('agentTopPValue');
const agentPrompt = document.getElementById('agentPrompt');
const saveAgentSettings = document.getElementById('saveAgentSettings');
const resetAgentSettings = document.getElementById('resetAgentSettings');

let currentAgentDefaults = {};

// ==========================
// Model Priority Modal Elements
// ==========================

const modelPriorityModal = document.getElementById('modelPriorityModal');
const closeModelPriority = document.getElementById('closeModelPriority');

// ==========================
// Cost Warning Modal Elements
// ==========================

const costWarningModal = document.getElementById('costWarningModal');
const cwCurrentModel = document.getElementById('cwCurrentModel');
const modelChoices = document.getElementById('modelChoices');
const cwUseSelected = document.getElementById('cwUseSelected');
const cwContinue = document.getElementById('cwContinue');
const cwDontAskAgain = document.getElementById('cwDontAskAgain');

// ==========================
// Agent Settings Modal Handlers
// ==========================

// Close modal
if (closeAgentSettings) {
    closeAgentSettings.addEventListener('click', () => {
        agentSettingsModal.classList.remove('active');
    });
}

// Update slider values
if (agentTemperature) {
    agentTemperature.addEventListener('input', (e) => {
        agentTemperatureValue.textContent = e.target.value;
    });
}

if (agentTopP) {
    agentTopP.addEventListener('input', (e) => {
        agentTopPValue.textContent = e.target.value;
    });
}

// Load agents and populate form
async function loadAgentSettings() {
    try {
        // Load agents and config
        const [agents, config, models] = await Promise.all([
            fetch('/api/agents').then(r => r.json()),
            fetch('/api/config').then(r => r.json()),
            fetch('/api/models').then(r => r.json())
        ]);

        // Populate agent dropdown
        agentSettingsSelect.innerHTML = agents.map(agent => 
            `<option value="${agent.name}">${agent.name}</option>`
        ).join('');

        // Populate model dropdown
        agentModelSelect.innerHTML = '<option value="">Use agent default</option>' +
            models.map(m => 
                `<option value="${m.providerID}/${m.modelID}">${m.name}</option>`
            ).join('');

        // Load settings for first agent
        if (agents.length > 0) {
            await loadAgentConfig(agents[0].name, agents, config);
        }

        // Listen for agent selection changes
        agentSettingsSelect.addEventListener('change', async (e) => {
            const selectedAgent = agents.find(a => a.name === e.target.value);
            if (selectedAgent) {
                await loadAgentConfig(selectedAgent.name, agents, config);
            }
        });

    } catch (error) {
        console.error('Failed to load agent settings:', error);
        showToast('Failed to load agent settings', 'error');
    }
}

async function loadAgentConfig(agentName, agents, config) {
    const agent = agents.find(a => a.name === agentName);
    if (!agent) return;

    // Store defaults
    currentAgentDefaults = {
        model: agent.model ? `${agent.model.providerID}/${agent.model.modelID}` : '',
        temperature: agent.temperature || 0.7,
        topP: agent.topP || 1.0,
        prompt: agent.prompt || ''
    };

    // Get user overrides
    const overrides = config.agent && config.agent[agentName] ? config.agent[agentName] : {};

    // Populate form with overrides or defaults
    agentModelSelect.value = overrides.model || '';
    agentTemperature.value = overrides.temperature !== undefined ? overrides.temperature : currentAgentDefaults.temperature;
    agentTemperatureValue.textContent = agentTemperature.value;
    agentTopP.value = overrides.top_p !== undefined ? overrides.top_p : currentAgentDefaults.topP;
    agentTopPValue.textContent = agentTopP.value;
    agentPrompt.value = overrides.prompt || '';
}

// Save agent settings
if (saveAgentSettings) {
    saveAgentSettings.addEventListener('click', async () => {
        const agentName = agentSettingsSelect.value;
        if (!agentName) return;

        try {
            const settings = {
                agent: {
                    [agentName]: {
                        model: agentModelSelect.value || undefined,
                        temperature: parseFloat(agentTemperature.value),
                        top_p: parseFloat(agentTopP.value),
                        prompt: agentPrompt.value || undefined
                    }
                }
            };

            await fetch('/api/config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settings)
            });

            showToast(`Settings saved for ${agentName}`, 'success');
            agentSettingsModal.classList.remove('active');
        } catch (error) {
            console.error('Failed to save agent settings:', error);
            showToast('Failed to save settings', 'error');
        }
    });
}

// Reset to defaults
if (resetAgentSettings) {
    resetAgentSettings.addEventListener('click', () => {
        agentModelSelect.value = '';
        agentTemperature.value = currentAgentDefaults.temperature;
        agentTemperatureValue.textContent = currentAgentDefaults.temperature;
        agentTopP.value = currentAgentDefaults.topP;
        agentTopPValue.textContent = currentAgentDefaults.topP;
        agentPrompt.value = '';
    });
}

// ==========================
// Model Priority Modal
// ==========================

if (modelPriorityModal && closeModelPriority && menuModelPriority) {
    // Close modal
    closeModelPriority.addEventListener('click', () => {
        modelPriorityModal.classList.remove('active');
    });

    // Close on background click
    modelPriorityModal.addEventListener('click', (e) => {
        if (e.target === modelPriorityModal) {
            modelPriorityModal.classList.remove('active');
        }
    });

    // Save button
    const saveModelPriority = document.getElementById('saveModelPriority');
    if (saveModelPriority) {
        saveModelPriority.addEventListener('click', async () => {
            try {
                const enabled = document.getElementById('enableCostWarnings').checked;
                const models = getCurrentPriorityList();

                const response = await fetch('/api/config', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model_priority: { enabled, models }
                    })
                });

                if (!response.ok) throw new Error('Failed to save');

                showToast('Model priority saved', 'success');
                modelPriorityModal.classList.remove('active');
            } catch (error) {
                console.error('Failed to save model priority:', error);
                showToast('Failed to save priority', 'error');
            }
        });
    }

    // Add model button
    const addModelBtn = document.getElementById('addModelBtn');
    if (addModelBtn) {
        addModelBtn.addEventListener('click', () => {
            const select = document.getElementById('addModelSelect');
            const model = select.value;

            if (!model) {
                showToast('Please select a model', 'error');
                return;
            }

            const models = getCurrentPriorityList();
            models.push(model);
            renderPriorityList(models);

            // Remove from dropdown
            const option = select.querySelector(`option[value="${model}"]`);
            if (option) option.remove();
            select.value = '';
        });
    }
}

async function loadModelPriority() {
    try {
        // Fetch both config and models
        const [configRes, modelsRes] = await Promise.all([
            fetch('/api/config'),
            fetch('/api/models')
        ]);
        
        const config = await safeJson(configRes) || {};
        const allModels = await safeJson(modelsRes) || [];
        
        const priority = config.model_priority || { enabled: false, models: [] };

        // Update checkbox
        const enableCostWarnings = document.getElementById('enableCostWarnings');
        if (enableCostWarnings) {
            enableCostWarnings.checked = priority.enabled;
        }

        // Render priority list
        renderPriorityList(priority.models);

        // Populate add model dropdown (exclude already added)
        const addModelSelect = document.getElementById('addModelSelect');
        if (addModelSelect) {
            const availableModels = allModels.filter(m =>
                !priority.models.includes(`${m.providerID}/${m.modelID}`)
            );

            // Clear and add default option
            addModelSelect.innerHTML = '<option value="">Select a model...</option>';
            
            // Group models by provider
            const groups = {};
            availableModels.forEach(m => {
                if (!groups[m.providerID]) groups[m.providerID] = [];
                groups[m.providerID].push(m);
            });
            
            // Create optgroups
            Object.entries(groups).forEach(([providerID, providerModels]) => {
                const group = document.createElement('optgroup');
                group.label = providerID;
                
                providerModels.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = `${m.providerID}/${m.modelID}`;
                    opt.textContent = m.name || m.modelID;
                    group.appendChild(opt);
                });
                
                addModelSelect.appendChild(group);
            });
        }
    } catch (error) {
        console.error('Failed to load model priority:', error);
        showToast('Failed to load model priority', 'error');
    }
}

function renderPriorityList(models) {
    const priorityList = document.getElementById('priorityList');
    if (!priorityList) return;

    if (!models || models.length === 0) {
        priorityList.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">No models added yet. Add models below.</div>';
        return;
    }

    priorityList.innerHTML = models.map((model, index) => `
        <div class="priority-item" data-model="${model}">
            <span class="priority-rank">${index + 1}.</span>
            <span class="priority-handle">≡</span>
            <span class="priority-model">${model}</span>
            <div class="priority-controls">
                <button class="btn-icon" data-action="up" ${index === 0 ? 'disabled' : ''}>↑</button>
                <button class="btn-icon" data-action="down" ${index === models.length - 1 ? 'disabled' : ''}>↓</button>
                <button class="btn-icon" data-action="remove">✕</button>
            </div>
        </div>
    `).join('');

    // Add event listeners to all buttons
    priorityList.querySelectorAll('.btn-icon').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const item = e.target.closest('.priority-item');
            if (!item) return;

            const model = item.dataset.model;
            handlePriorityAction(action, model);
        });
    });
}

function handlePriorityAction(action, model) {
    const models = getCurrentPriorityList();
    const index = models.indexOf(model);

    if (index === -1) return;

    if (action === 'up' && index > 0) {
        // Swap with previous
        [models[index], models[index - 1]] = [models[index - 1], models[index]];
    } else if (action === 'down' && index < models.length - 1) {
        // Swap with next
        [models[index], models[index + 1]] = [models[index + 1], models[index]];
    } else if (action === 'remove') {
        // Remove from list
        models.splice(index, 1);

        // Add back to dropdown in the correct optgroup
        const addModelSelect = document.getElementById('addModelSelect');
        if (addModelSelect) {
            // Parse provider and model from the format "provider/model"
            const [providerID, modelID] = model.split('/');
            
            // Find or create the optgroup
            let group = addModelSelect.querySelector(`optgroup[label="${providerID}"]`);
            if (!group) {
                group = document.createElement('optgroup');
                group.label = providerID;
                addModelSelect.appendChild(group);
            }
            
            // Add the option to the group
            const option = document.createElement('option');
            option.value = model;
            option.textContent = modelID; // Use just the model ID for display
            group.appendChild(option);
        }
    }

    renderPriorityList(models);
}

function getCurrentPriorityList() {
    const priorityList = document.getElementById('priorityList');
    if (!priorityList) return [];

    return Array.from(priorityList.querySelectorAll('.priority-item'))
        .map(item => item.dataset.model);
}

function showAuthError(message) {
    if (authErrorDetails) authErrorDetails.textContent = typeof message === 'object' ? JSON.stringify(message, null, 2) : message;
    if (authModal) authModal.classList.add('active');
    updateStatus('error', 'Authentication Failed');
}

// ==========================
// Cost Warning Modal
// ==========================

async function checkModelPriority(model) {
    // Check if warnings are disabled for this session
    if (sessionStorage.getItem('skipModelWarning') === 'true') {
        return true;
    }

    try {
        const config = await fetch('/api/config').then(r => r.json());
        const priority = config.model_priority;

        // If priority is not enabled or empty, allow all models
        if (!priority?.enabled || !priority.models || priority.models.length === 0) {
            return true;
        }

        const currentModel = `${model.providerID}/${model.modelID}`;

        // If current model is in priority list, allow it
        if (priority.models.includes(currentModel)) {
            return true;
        }

        // Show warning modal and wait for user decision
        return await showCostWarningModal(currentModel, priority.models);
    } catch (error) {
        console.error('Failed to check model priority:', error);
        // On error, allow the request to proceed
        return true;
    }
}

function showCostWarningModal(currentModel, priorityModels) {
    return new Promise((resolve) => {
        if (!costWarningModal || !cwCurrentModel || !modelChoices) {
            resolve(true);
            return;
        }

        // Set current model name
        cwCurrentModel.textContent = currentModel;

        // Render priority model choices
        modelChoices.innerHTML = priorityModels.map((model, index) => `
            <div class="model-choice ${index === 0 ? 'selected' : ''}" onclick="selectModelChoice(this)">
                <input type="radio" name="modelChoice" value="${model}" ${index === 0 ? 'checked' : ''} id="choice_${index}">
                <label for="choice_${index}">${model}</label>
            </div>
        `).join('');

        // Reset checkbox
        if (cwDontAskAgain) cwDontAskAgain.checked = false;

        // Show modal
        costWarningModal.classList.add('active');

        // Handle "Use Selected Model" button
        const useSelectedHandler = () => {
            const selected = modelChoices.querySelector('input[name="modelChoice"]:checked');
            if (selected && qsModelSelect) {
                // Switch to selected model
                const selectedModel = selected.value;
                qsModelSelect.value = JSON.stringify({
                    providerID: selectedModel.split('/')[0],
                    modelID: selectedModel.split('/')[1]
                });
            }

            if (cwDontAskAgain?.checked) {
                sessionStorage.setItem('skipModelWarning', 'true');
            }

            cleanup();
            resolve(true);
        };

        // Handle "Continue with Current" button
        const continueHandler = () => {
            if (cwDontAskAgain?.checked) {
                sessionStorage.setItem('skipModelWarning', 'true');
            }

            cleanup();
            resolve(true);
        };

        // Cleanup function
        const cleanup = () => {
            costWarningModal.classList.remove('active');
            if (cwUseSelected) cwUseSelected.removeEventListener('click', useSelectedHandler);
            if (cwContinue) cwContinue.removeEventListener('click', continueHandler);
        };

        // Add event listeners
        if (cwUseSelected) cwUseSelected.addEventListener('click', useSelectedHandler);
        if (cwContinue) cwContinue.addEventListener('click', continueHandler);
    });
}

// Helper function for selecting model choice
function selectModelChoice(element) {
    // Remove selected class from all choices
    const choices = document.querySelectorAll('.model-choice');
    choices.forEach(c => c.classList.remove('selected'));

    // Add selected class to clicked element
    element.classList.add('selected');

    // Check the radio button
    const radio = element.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
}

// ==========================
// Agent Auto-Selection
// ==========================

async function autoSelectModelForAgent(agentName) {
    if (!agentName || !qsModelSelect) return;

    try {
        const [config, agents] = await Promise.all([
            fetch('/api/config').then(r => r.json()),
            fetch('/api/agents').then(r => r.json())
        ]);

        // Check for user override first
        const override = config.agent?.[agentName]?.model;
        if (override) {
            // Find matching model in the select dropdown
            const options = Array.from(qsModelSelect.options);
            const matchingOption = options.find(opt => {
                if (!opt.value) return false;
                try {
                    const model = JSON.parse(opt.value);
                    return `${model.providerID}/${model.modelID}` === override;
                } catch {
                    return false;
                }
            });

            if (matchingOption) {
                qsModelSelect.value = matchingOption.value;
                if (modelSelect) modelSelect.value = matchingOption.value;
                showToast(`Using ${override} for ${agentName}`, 'info');
            }
            return;
        }

        // Check agent's native default (agents from /api/agents don't have model info yet)
        // This will work once the OpenCode API provides model defaults per agent
        const agent = agents.find(a => a.name === agentName);
        if (agent?.model) {
            const modelId = `${agent.model.providerID}/${agent.model.modelID}`;
            const options = Array.from(qsModelSelect.options);
            const matchingOption = options.find(opt => {
                if (!opt.value) return false;
                try {
                    const model = JSON.parse(opt.value);
                    return `${model.providerID}/${model.modelID}` === modelId;
                } catch {
                    return false;
                }
            });

            if (matchingOption) {
                qsModelSelect.value = matchingOption.value;
                if (modelSelect) modelSelect.value = matchingOption.value;
                showToast(`Using ${modelId} for ${agentName}`, 'info');
            }
        }
    } catch (error) {
        console.error('Failed to auto-select model:', error);
        // Silently fail - don't interrupt user flow
    }
}

// ==========================
// Rich Editor Functions
// ==========================

// Mode Switching
function switchToRichMode() {
    if (editorMode === 'rich') return;
    
    editorMode = 'rich';
    const simpleText = messageInput ? messageInput.value : '';
    
    if (simpleInputWrapper) simpleInputWrapper.style.display = 'none';
    if (richInputWrapper) richInputWrapper.style.display = 'flex';
    if (inputContainer) inputContainer.classList.add('rich-mode');
    
    if (richEditor) {
        // Show selectively formatted markdown (code blocks & headings only)
        richEditor.innerHTML = typeof marked !== 'undefined' ? cleanMarkedOutput(marked.parse(simpleText || '')) : (simpleText || '');
        richEditor.focus();
        // Update button state for rich mode
        const hasContent = richEditor.textContent.trim().length > 0;
        if (sendBtn) sendBtn.disabled = !hasContent;
    }
}

function switchToSimpleMode() {
    if (editorMode === 'simple') return;
    
    editorMode = 'simple';
    const richHTML = richEditor ? richEditor.innerHTML : '';
    
    if (richInputWrapper) richInputWrapper.style.display = 'none';
    if (simpleInputWrapper) simpleInputWrapper.style.display = 'flex';
    if (inputContainer) inputContainer.classList.remove('rich-mode');
    
    if (messageInput) {
        // Convert HTML to Markdown
        messageInput.value = htmlToMarkdown(richHTML);
        messageInput.focus();
        // Trigger resize
        messageInput.style.height = 'auto';
        messageInput.style.height = messageInput.scrollHeight + 'px';
        // Update button state for simple mode
        const hasContent = messageInput.value.trim().length > 0;
        if (sendBtn) sendBtn.disabled = !hasContent;
    }
}

// HTML to Markdown Converter
function htmlToMarkdown(html) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    return nodeToMarkdown(tempDiv);
}

function nodeToMarkdown(node) {
    let markdown = '';
    
    for (let child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            markdown += child.textContent;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            const tag = child.tagName.toLowerCase();
            const content = nodeToMarkdown(child);
            
            switch (tag) {
                case 'strong':
                case 'b':
                    markdown += `**${content}**`;
                    break;
                case 'em':
                case 'i':
                    markdown += `*${content}*`;
                    break;
                case 'code':
                    markdown += `\`${content}\``;
                    break;
                case 'pre':
                    const codeContent = child.querySelector('code');
                    markdown += `\n\`\`\`\n${codeContent ? codeContent.textContent : content}\n\`\`\`\n`;
                    break;
                case 'h1':
                    markdown += `\n# ${content}\n`;
                    break;
                case 'h2':
                    markdown += `\n## ${content}\n`;
                    break;
                case 'h3':
                    markdown += `\n### ${content}\n`;
                    break;
                case 'ul':
                    markdown += '\n' + Array.from(child.children).map(li => `- ${nodeToMarkdown(li)}`).join('\n') + '\n';
                    break;
                case 'ol':
                    markdown += '\n' + Array.from(child.children).map((li, i) => `${i+1}. ${nodeToMarkdown(li)}`).join('\n') + '\n';
                    break;
                case 'li':
                    markdown += content;
                    break;
                case 'br':
                    markdown += '\n';
                    break;
                case 'p':
                    markdown += content + '\n';
                    break;
                default:
                    markdown += content;
            }
        }
    }
    
    return markdown;
}

// Get content from active editor
function getEditorContent() {
    let content = '';
    if (editorMode === 'rich' && richEditor) {
        content = htmlToMarkdown(richEditor.innerHTML).trim();
    } else if (messageInput) {
        content = messageInput.value.trim();
    }
    console.log('[DEBUG] getEditorContent - editorMode:', editorMode, 'content:', content);
    return content;
}

// Clear active editor
function clearEditorContent() {
    if (editorMode === 'rich' && richEditor) {
        richEditor.innerHTML = '';
    } else if (messageInput) {
        messageInput.value = '';
        messageInput.style.height = 'auto';
    }
}

// Formatting Functions
function applyRichFormat(format, editor) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    
    switch (format) {
        case 'bold':
            document.execCommand('bold', false, null);
            break;
        case 'italic':
            document.execCommand('italic', false, null);
            break;
        case 'code':
            insertMarkdownCode(range, editor);
            break;
        case 'codeblock':
            insertCodeBlock(range, editor);
            break;
        case 'heading':
            insertHeading(range, editor);
            break;
        case 'list':
            document.execCommand('insertUnorderedList', false, null);
            break;
        case 'indent':
            document.execCommand('indent', false, null);
            break;
        case 'outdent':
            document.execCommand('outdent', false, null);
            break;
    }
    
    editor.focus();
}

function insertMarkdownCode(range, editor) {
    const selectedText = range.toString();
    const codeEl = document.createElement('code');
    codeEl.textContent = selectedText || 'code';
    
    range.deleteContents();
    range.insertNode(codeEl);
    
    // Move cursor after the code element
    range.setStartAfter(codeEl);
    range.setEndAfter(codeEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
}

function insertCodeBlock(range, editor) {
    const selectedText = range.toString();
    const preEl = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.textContent = selectedText || 'code block';
    preEl.appendChild(codeEl);
    
    range.deleteContents();
    range.insertNode(preEl);
    
    // Move cursor after the pre element
    range.setStartAfter(preEl);
    range.setEndAfter(preEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
}

function insertHeading(range, editor) {
    const selectedText = range.toString();
    const h2El = document.createElement('h2');
    h2El.textContent = selectedText || 'Heading';
    
    range.deleteContents();
    range.insertNode(h2El);
    
    // Move cursor after the heading
    range.setStartAfter(h2El);
    range.setEndAfter(h2El);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
}

// Toolbar Initialization
function initMainToolbar() {
    const toolbar = document.getElementById('markdownToolbar');
    if (!toolbar) return;
    
    toolbar.querySelectorAll('.md-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const format = btn.dataset.format;
            applyRichFormat(format, richEditor);
        });
    });
}

function initEditToolbar() {
    const toolbar = document.getElementById('editMarkdownToolbar');
    if (!toolbar) return;
    
    toolbar.querySelectorAll('.md-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const format = btn.dataset.format;
            applyRichFormat(format, editRichEditor);
        });
    });
}

// Edit & Resend Functions
function addEditButton(bubble, messageText) {
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-message-btn';
    editBtn.textContent = '✏️ Edit & Send';
    editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showEditMessageModal(messageText);
    });
    bubble.appendChild(editBtn);
}

function showEditMessageModal(messageText) {
    originalMessageText = messageText;
    
    if (editRichEditor) {
        // Show selectively formatted markdown (code blocks & headings only)
        editRichEditor.innerHTML = typeof marked !== 'undefined' ? cleanMarkedOutput(marked.parse(messageText)) : messageText;
    }
    
    if (editMessageModal) {
        editMessageModal.classList.add('active');
    }
}

function hideEditMessageModal() {
    if (editMessageModal) {
        editMessageModal.classList.remove('active');
    }
    if (editRichEditor) {
        editRichEditor.innerHTML = '';
    }
    originalMessageText = '';
}

function resendEditedMessage() {
    const editedContent = editRichEditor ? htmlToMarkdown(editRichEditor.innerHTML).trim() : '';
    
    if (!editedContent) {
        alert('Message cannot be empty');
        return;
    }
    
    hideEditMessageModal();
    
    // Send as new message using current settings
    const message = {
        role: 'user',
        content: editedContent
    };
    
    // Get current settings from quick settings
    const currentAgent = qsAgentSelect ? qsAgentSelect.value : '';
    const currentModel = qsModelSelect ? qsModelSelect.value : '';
    
    sendMessage(editedContent, currentAgent, currentModel);
}

// Auto-resize textarea and update send button state
if (messageInput) {
    messageInput.addEventListener('input', () => {
        // Always update button state when messageInput changes
        const hasContent = messageInput.value.trim().length > 0;
        console.log('[DEBUG] Input event - hasContent:', hasContent, 'editorMode:', editorMode);
        if (sendBtn) {
            sendBtn.disabled = !hasContent;
            console.log('[DEBUG] Button disabled state:', sendBtn.disabled);
        }
        
        // Auto-resize only in simple mode (rich editor handles its own sizing)
        if (editorMode === 'simple') {
            messageInput.style.height = 'auto';
            messageInput.style.height = messageInput.scrollHeight + 'px';
        }
    });
}

// Send message
if (sendBtn) {
    sendBtn.addEventListener('click', () => {
        console.log('[DEBUG] Send button clicked');
        sendMessage();
    });
}
if (abortBtn) abortBtn.addEventListener('click', abortLastPrompt);
if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', fetchLogs);

if (messageInput) {
    messageInput.addEventListener('keydown', (e) => {
        if (editorMode === 'simple' && e.key === 'Enter' && !e.shiftKey) {
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

if (showReasoningCheckbox) {
    showReasoningCheckbox.addEventListener('change', (e) => {
        // When checked, SHOW reasoning (remove hide class)
        // When unchecked, HIDE reasoning (add hide class)
        document.body.classList.toggle('hide-reasoning', !e.target.checked);
        setCookie('showReasoning', e.target.checked ? 'true' : 'false');
    });
}

if (showEventsTabCheckbox) {
    showEventsTabCheckbox.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        localStorage.setItem('showEventsTab', enabled.toString());
        toggleEventsTab(enabled);
    });
}

if (livenessTimeoutInput) {
    livenessTimeoutInput.addEventListener('change', (e) => {
        const timeout = parseInt(e.target.value);
        if (timeout >= 10 && timeout <= 300) {
            setCookie('livenessTimeout', timeout.toString());
        } else {
            e.target.value = getCookie('livenessTimeout') || '240';
        }
    });
}

if (historyLimitInput) {
    historyLimitInput.addEventListener('change', async (e) => {
        const limit = parseInt(e.target.value);
        if (limit >= 10 && limit <= 2000 && currentSessionID) {
            try {
                // Update the session's history_limit in the backend
                await fetch(`/api/session/${currentSessionID}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ history_limit: limit })
                });
                console.log(`[Settings] Updated history limit to ${limit} for session ${currentSessionID}`);
            } catch (err) {
                console.error('[Settings] Failed to update history limit:', err);
            }
        } else if (limit < 10 || limit > 2000) {
            e.target.value = currentSession?.history_limit || 200;
        }
    });
}

if (uiScaleInput) {
    uiScaleInput.addEventListener('input', (e) => {
        const scale = parseInt(e.target.value);
        if (uiScaleValue) uiScaleValue.textContent = scale + '%';
        document.documentElement.style.setProperty('--ui-scale', scale / 100);
        setCookie('uiScale', scale.toString());
    });
}

if (closeFavorites) {
    closeFavorites.addEventListener('click', () => {
        if (favoritesModal) favoritesModal.classList.remove('active');
    });
}

// Double-tap on messages area (empty space) to open favorites
if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
        // Only trigger if clicking the container itself (empty space), not message bubbles
        if (e.target === messagesContainer || e.target.classList.contains('welcome-message')) {
            const now = Date.now();
            if (now - lastPromptTap < 300) {
                // Double tap detected
                showFavoritesModal();
            }
            lastPromptTap = now;
        }
    });
}

if (qsAgentSelect) {
    qsAgentSelect.addEventListener('change', async (e) => {
        const agentName = e.target.value;
        if (agentSelect) agentSelect.value = agentName;
        setCookie('favAgent', agentName);
        
        // Auto-select model for this agent
        await autoSelectModelForAgent(agentName);
    });
}

if (qsModelSelect) {
    qsModelSelect.addEventListener('change', (e) => {
        if (modelSelect) modelSelect.value = e.target.value;
        setCookie('favModel', e.target.value);
    });
}

// Diff drawer event listeners
// Files tab event listeners
const loadPastChangesBtn = document.getElementById('loadPastChangesBtn');
const clearFilesBtn = document.getElementById('clearFilesBtn');

if (loadPastChangesBtn) {
    loadPastChangesBtn.addEventListener('click', loadPastChanges);
}
if (clearFilesBtn) {
    clearFilesBtn.addEventListener('click', () => {
        if (confirm('Clear all file changes for this session?')) {
            clearSessionDiffs();
        }
    });
}

// Tool Drawer event listeners

// Tools Tab event listeners
const clearToolsBtn = document.getElementById('clearToolsBtn');
if (clearToolsBtn) {
    clearToolsBtn.addEventListener('click', () => {
        if (confirm('Clear all tool history?')) {
            toolEventStore.clear();
            renderToolsList();
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

// ==========================
// Rich Editor Event Listeners
// ==========================

// Mode toggle buttons
if (toggleRichBtn) {
    toggleRichBtn.addEventListener('click', switchToRichMode);
}

if (toggleSimpleBtn) {
    toggleSimpleBtn.addEventListener('click', switchToSimpleMode);
}

// Edit message modal controls
if (closeEditMessage) {
    closeEditMessage.addEventListener('click', hideEditMessageModal);
}

if (cancelEditMessage) {
    cancelEditMessage.addEventListener('click', hideEditMessageModal);
}

if (resendMessageBtn) {
    resendMessageBtn.addEventListener('click', resendEditedMessage);
}

// Close edit modal on backdrop click
if (editMessageModal) {
    editMessageModal.addEventListener('click', (e) => {
        if (e.target === editMessageModal) {
            hideEditMessageModal();
        }
    });
}

// Initialize toolbars
initMainToolbar();
initEditToolbar();

// Rich editor input handling
if (richEditor) {
    richEditor.addEventListener('input', () => {
        const hasContent = richEditor.textContent.trim().length > 0;
        if (sendBtn) sendBtn.disabled = !hasContent;
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
    
    // Show reasoning is now the toggle (opposite of hideReasoning)
    const showReasoning = getCookie('showReasoning');
    if (showReasoning === 'false') {
        // User explicitly turned OFF show reasoning, so hide it
        document.body.classList.add('hide-reasoning');
        if (showReasoningCheckbox) showReasoningCheckbox.checked = false;
    } else if (showReasoning === 'true') {
        // User explicitly turned ON show reasoning
        document.body.classList.remove('hide-reasoning');
        if (showReasoningCheckbox) showReasoningCheckbox.checked = true;
    } else {
        // Default: hide reasoning (show checkbox unchecked)
        document.body.classList.add('hide-reasoning');
        if (showReasoningCheckbox) showReasoningCheckbox.checked = false;
    }
    
    // Load liveness timeout
    const livenessTimeout = getCookie('livenessTimeout') || '240';
    if (livenessTimeoutInput) {
        livenessTimeoutInput.value = livenessTimeout;
    }
    
    // Load history limit from current session
    if (historyLimitInput && currentSession) {
        historyLimitInput.value = currentSession.history_limit || 200;
    } else if (historyLimitInput) {
        historyLimitInput.value = 200; // Default
    }
    
    // Load UI scale
    const uiScale = getCookie('uiScale') || '100';
    if (uiScaleInput) {
        uiScaleInput.value = uiScale;
        if (uiScaleValue) uiScaleValue.textContent = uiScale + '%';
        document.documentElement.style.setProperty('--ui-scale', parseInt(uiScale) / 100);
    }
    
    // Load Events tab preference
    const showEventsTab = localStorage.getItem('showEventsTab') === 'true';
    if (showEventsTabCheckbox) {
        showEventsTabCheckbox.checked = showEventsTab;
    }
    toggleEventsTab(showEventsTab);
    
    // Load favorites from localStorage
    try {
        const stored = localStorage.getItem('favoriteMessages');
        if (stored) {
            const favorites = JSON.parse(stored);
            favorites.forEach(fav => favoriteMessages.set(fav.id, fav));
        }
    } catch (e) {
        console.error('Failed to load favorites:', e);
    }
}

// Events Tab Management
function toggleEventsTab(enabled) {
    const eventsTabBtn = document.getElementById('eventsTabBtn');
    const eventsTab = document.getElementById('eventsTab');
    const filesTab = document.getElementById('filesTab');
    const toolsTab = document.getElementById('toolsTab');
    
    if (enabled) {
        // Show Events tab
        if (eventsTabBtn) eventsTabBtn.style.display = '';
        if (eventsTab) {
            eventsTab.style.display = '';
            eventsTab.dataset.tabIndex = '1';
        }
        // Update Files and Tools tab indices
        if (filesTab) filesTab.dataset.tabIndex = '2';
        if (toolsTab) toolsTab.dataset.tabIndex = '3';
    } else {
        // Hide Events tab
        if (eventsTabBtn) eventsTabBtn.style.display = 'none';
        if (eventsTab) eventsTab.style.display = 'none';
        // Update Files and Tools tab indices (shift down)
        if (filesTab) filesTab.dataset.tabIndex = '1';
        if (toolsTab) toolsTab.dataset.tabIndex = '2';
    }
}

// Session Name Management
function updateSessionNameDisplay() {
    const sessionNameDisplay = getEl('sessionNameDisplay');
    if (!sessionNameDisplay) return;
    
    if (currentSession) {
        const displayName = currentSession.title || `ses_${currentSession.id.slice(-8)}`;
        sessionNameDisplay.textContent = displayName;
    } else {
        sessionNameDisplay.textContent = 'No Session';
    }
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
    
    if (oldTitle !== newTitle && newTitle && !data.historical) {
        showToast(`Session renamed to: ${newTitle}`, 'info');
    }
}

function handleSessionError(data) {
    if (!data.error) return;
    
    const error = data.error;
    const errorName = error.name || 'Error';
    const errorMessage = error.message || 'An unknown error occurred';
    const errorDetails = error.details || error.stack;
    
    // Show idle state on error
    updateLivenessDisplay('idle');
    
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

// Update liveness display based on current state
function updateLivenessDisplay(state, countdown = null) {
    if (!livenessRow || !livenessCountdown) return;
    
    // Always show the liveness row
    livenessRow.style.display = 'flex';
    
    switch(state) {
        case 'idle':
            livenessCountdown.textContent = 'Session not working';
            livenessCountdown.style.color = '#6b7280'; // Gray
            livenessCountdown.style.background = 'rgba(107, 114, 128, 0.1)';
            break;
            
        case 'paused':
            livenessCountdown.textContent = 'Waiting for question, paused';
            livenessCountdown.style.color = '#8b5cf6'; // Purple
            livenessCountdown.style.background = 'rgba(139, 92, 246, 0.1)';
            break;
            
        case 'busy':
            if (countdown !== null) {
                livenessCountdown.textContent = `${countdown}s`;
                // Color code based on remaining time
                if (countdown > 10) {
                    livenessCountdown.style.color = 'var(--success-color)';
                    livenessCountdown.style.background = 'rgba(40, 167, 69, 0.1)';
                } else if (countdown > 5) {
                    livenessCountdown.style.color = 'var(--warning-color)';
                    livenessCountdown.style.background = 'rgba(255, 193, 7, 0.1)';
                } else {
                    livenessCountdown.style.color = 'var(--error-color)';
                    livenessCountdown.style.background = 'rgba(220, 53, 69, 0.1)';
                }
            }
            break;
    }
}

// Liveness monitoring handlers
function handleSessionLiveness(data) {
    const { sessionID, secondsSinceLastEvent, isStale } = data;
    
    // Get liveness timeout from preferences (default 240 seconds)
    const livenessTimeout = parseInt(getCookie('livenessTimeout') || '240');
    
    // Calculate countdown (timeout - elapsed time)
    const countdown = Math.max(0, livenessTimeout - secondsSinceLastEvent);
    
    // Update display - if question is paused, show paused state, otherwise show countdown
    if (isQuestionPaused) {
        updateLivenessDisplay('paused');
    } else {
        updateLivenessDisplay('busy', countdown);
    }
    
    // Store reference
    sessionLiveness.set(sessionID, {
        seconds: secondsSinceLastEvent,
        countdown: countdown
    });
}

function handleRetryStart(data) {
    const { sessionID, reason, attemptNumber } = data;
    
    // Show retry notification
    showRetryNotification(`🔄 Retrying session (attempt ${attemptNumber || 1}) due to ${reason}...`);
    
    // Don't hide liveness row, just update the display
    updateLivenessDisplay('busy', 0);
    sessionLiveness.delete(sessionID);
}

function handleRetrySuccess(data) {
    const { sessionID } = data;
    
    // Hide retry notification
    hideRetryNotification();
    
    // Keep liveness row visible but clear it (will be updated when busy again)
    updateLivenessDisplay('idle');
    
    // Add success message
    addMessage('system', '✅ Session retry successful!', false, false, false, true);
}

function handleRetryFailed(data) {
    const { sessionID, error } = data;
    
    // Hide retry notification
    hideRetryNotification();
    
    // Keep liveness row visible but show idle state
    updateLivenessDisplay('idle');
    
    // Add error message
    addMessage('system', `❌ Session retry failed: ${error}`, true, true, false, true);
}

function handleSyncComplete(data) {
    const { sessionID, totalMessages, rehydratedMessages, totalDiffs, rehydratedDiffs } = data;
    
    console.log(`[SyncComplete] Session ${sessionID}: ${rehydratedMessages}/${totalMessages} messages, ${rehydratedDiffs}/${totalDiffs} diffs`);
    
    // Mark sync as complete and start processing queued events
    syncCompleteReceived = true;
    expectedHistoricalEvents = historicalEventQueue.length;
    
    console.log(`[History] Received sync complete. ${expectedHistoricalEvents} events queued for processing`);
    
    // Process all queued historical events in order
    processHistoricalEvents();
    
    // Initialize oldestDisplayedIndex based on what was rehydrated
    if (rehydratedMessages < totalMessages) {
        // We have older messages available
        const oldestIndex = totalMessages - rehydratedMessages;
        oldestDisplayedIndex.set(sessionID, oldestIndex);
        console.log(`[SyncComplete] Oldest displayed index set to ${oldestIndex}, ${totalMessages - oldestIndex} more messages available`);
        updateLoadMoreButton(false, true); // Show "Load More" button
    } else {
        // All messages were loaded
        oldestDisplayedIndex.set(sessionID, 0);
        console.log(`[SyncComplete] All messages loaded, hiding Load More button`);
        updateLoadMoreButton(false, false); // Hide button
    }
}

function updateLoadingProgress() {
    if (!isLoadingHistory) return;
    
    const total = expectedHistoricalEvents || processedHistoricalEvents || 1;
    const processed = syncCompleteReceived ? 
        (historicalEventQueue.length > 0 ? (expectedHistoricalEvents - historicalEventQueue.length) : expectedHistoricalEvents) :
        processedHistoricalEvents;
    
    const percentage = Math.min(100, Math.floor((processed / total) * 100));
    
    if (progressFill) progressFill.style.width = `${percentage}%`;
    if (loadingStats) loadingStats.textContent = `${processed} / ${total}`;
    
    // Update text based on stage
    if (!syncCompleteReceived) {
        if (loadingText) loadingText.textContent = 'Loading historical data...';
    } else if (historicalEventQueue.length > 0) {
        if (loadingText) loadingText.textContent = `Processing events: ${processed}/${total}`;
    } else {
        if (loadingText) loadingText.textContent = 'Finalizing...';
    }
}

async function processHistoricalEvents() {
    if (historicalEventQueue.length === 0) {
        console.log('[History] No events to process');
        finishHistoryLoading();
        return;
    }
    
    console.log(`[History] Processing ${historicalEventQueue.length} queued events in order`);
    
    // Disable user input
    disableUserInput();
    
    // Process events in batches to avoid blocking UI
    const batchSize = 10;
    let processedCount = 0;
    
    while (historicalEventQueue.length > 0) {
        const batch = historicalEventQueue.splice(0, batchSize);
        
        for (const { type, data } of batch) {
            // Add to Events tab
            addEvent(type, data);
            
            // Track historical IDs
            const msgID = data.messageID || data.id;
            const partID = data.part?.id || data.partID;
            if (msgID) historicalMessages.add(msgID);
            if (partID) historicalParts.add(partID);
            
            // Process the event through appropriate handlers
            switch (type) {
                case 'session.diff':
                    handleSessionDiff(data);
                    break;
                case 'session.updated':
                    handleSessionUpdated(data);
                    break;
                case 'subagent.progress':
                    handleSubagentProgress(data);
                    break;
                case 'message.delta':
                case 'message.part':
                    // For historical events, accumulate in buffer
                    const msgId = data.messageID || data.id;
                    const part = data.part || (data.parts && data.parts[0]);
                    
                    // Store tool output in event store
                    if (part && (part.type === 'tool' || part.type === 'subtask')) {
                        const partId = part.id;
                        if (!toolEventStore.has(partId)) {
                            storeToolEvent(partId, {
                                type: 'tool_init',
                                timestamp: Date.now(),
                                messageID: msgId,
                                tool: part.tool,
                                agent: part.metadata?.subagent_type || part.state?.agent || part.tool,
                                task: part.metadata?.description || part.state?.title || 'Processing...',
                                status: part.state?.status || 'completed'  // Historical tools are completed
                            });
                        }
                        
                        if (data.delta || part.text) {
                            const toolData = toolEventStore.get(partId);
                            if (toolData) {
                                toolData.output += (data.delta || part.text || '');
                            }
                        }
                    }
                    
                    // Accumulate text for message
                    let fullText = messageBuffer.get(msgId) || '';
                    fullText += (data.delta || data.text || '');
                    messageBuffer.set(msgId, fullText);
                    break;
                case 'message.complete':
                    // Render the complete message
                    const finalID = data.messageID || data.id;
                    const finalContent = messageBuffer.get(finalID) || (data.message && data.message.text);
                    
                    // Check if message already exists
                    if (!document.getElementById('msg-' + finalID)) {
                        // Use parts from event data if available (avoids API call)
                        if (data.parts && Array.isArray(data.parts)) {
                            const textParts = data.parts.filter(p => p.type === 'text');
                            const reasoningParts = data.parts.filter(p => p.type === 'reasoning');
                            const todoParts = data.parts.filter(p => p.type === 'tool' && p.tool === 'todowrite');
                            const text = textParts.map(p => p.text).join('\n');
                            
                            if (text || reasoningParts.length > 0 || todoParts.length > 0) {
                                addMessage(data.message.role, text, false, !!data.message.error, false, false, data.message, null, reasoningParts, todoParts);
                            }
                        } else {
                            // Fallback: fetch from API if parts not included (backwards compatibility)
                            console.warn('[History] Parts not included in event, falling back to API fetch');
                            if (currentSession) {
                                try {
                                    const response = await fetch(`/api/session/${currentSession.id}/messages?limit=300`);
                                    const messages = await response.json();
                                    const fullMsg = messages.find(m => m.info.id === finalID);
                                    
                                    if (fullMsg) {
                                        const textParts = fullMsg.parts.filter(p => p.type === 'text');
                                        const reasoningParts = fullMsg.parts.filter(p => p.type === 'reasoning');
                                        const todoParts = fullMsg.parts.filter(p => p.type === 'tool' && p.tool === 'todowrite');
                                        const text = textParts.map(p => p.text).join('\n');
                                        
                                        if (text || reasoningParts.length > 0 || todoParts.length > 0) {
                                            addMessage(fullMsg.info.role, text, false, !!fullMsg.info.error, false, false, fullMsg.info, null, reasoningParts, todoParts);
                                        }
                                    }
                                } catch (err) {
                                    console.error('Failed to fetch full message:', err);
                                }
                            }
                        }
                    }
                    
                    messageBuffer.delete(finalID);
                    break;
            }
            
            processedCount++;
            
            // Update progress
            updateLoadingProgress();
        }
        
        // Yield to UI thread
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    console.log(`[History] Processed ${processedCount} historical events`);
    
    // Finish loading
    finishHistoryLoading();
}

function finishHistoryLoading() {
    isLoadingHistory = false;
    historicalEventQueue = [];
    processedHistoricalEvents = 0;
    expectedHistoricalEvents = 0;
    syncCompleteReceived = false;
    
    // Clear deduplication sets to allow new messages
    historicalMessages.clear();
    historicalParts.clear();
    console.log('[History] Cleared deduplication sets, ready for new messages');
    
    // Render tools list after historical events are processed
    renderToolsList();
    console.log('[History] Rendered tools list with historical data');
    
    // Re-enable user input
    enableUserInput();
    
    // Hide loading modal
    setTimeout(() => {
        if (loadingModal) loadingModal.style.display = 'none';
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 500);
    
    console.log('[History] Loading complete');
}

function disableUserInput() {
    if (messageInput) messageInput.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    const richEditor = document.getElementById('richEditor');
    if (richEditor) richEditor.style.pointerEvents = 'none';
}

function enableUserInput() {
    if (messageInput) messageInput.disabled = false;
    if (sendBtn) sendBtn.disabled = false;
    const richEditor = document.getElementById('richEditor');
    if (richEditor) richEditor.style.pointerEvents = '';
}

function showRetryNotification(message) {
    // Remove existing notification if any
    hideRetryNotification();
    
    // Create notification
    retryNotification = document.createElement('div');
    retryNotification.className = 'retry-notification';
    retryNotification.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: #ffc107;
        color: #000;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        font-size: 14px;
        font-weight: 600;
        animation: slideIn 0.3s ease-out;
    `;
    retryNotification.textContent = message;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(retryNotification);
}

function hideRetryNotification() {
    if (retryNotification) {
        retryNotification.remove();
        retryNotification = null;
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
    
    // Check if reasoning should be shown based on settings
    const showReasoning = getCookie('showReasoning');
    if (showReasoning === 'false') {
        // User has explicitly turned off reasoning, don't create the section at all
        return null;
    }
    
    const reasoningText = reasoningParts.map(p => p.text).filter(Boolean).join('\n\n');
    if (!reasoningText) return null;
    
    const section = document.createElement('div');
    section.className = 'reasoning-section';
    
    // Get default state from cookie - show reasoning is now the preference
    const showByDefault = showReasoning === 'true'; // Default is false (hidden)
    const isExpanded = reasoningExpanded.get(messageID) ?? showByDefault;
    
    const toggle = document.createElement('button');
    toggle.className = 'reasoning-toggle' + (isExpanded ? ' expanded' : '');
    toggle.innerHTML = `<span class="reasoning-toggle-icon">▼</span> <span>${isExpanded ? 'Hide' : 'Show'} reasoning</span>`;
    
    const content = document.createElement('div');
    content.className = 'reasoning-content' + (isExpanded ? ' expanded' : '');
    
    // Show selectively formatted markdown (code blocks & headings only)
    content.innerHTML = typeof marked !== 'undefined' ? cleanMarkedOutput(marked.parse(reasoningText)) : reasoningText;
    
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

// Todo section helper
function createTodoSection(todoParts, messageID) {
    if (!todoParts || todoParts.length === 0) return null;
    
    const section = document.createElement('div');
    section.className = 'todo-section';
    section.id = `todo-section-${messageID}`;
    
    todoParts.forEach((todoPart, idx) => {
        try {
            const todoData = todoPart.tool === 'todowrite' && todoPart.state?.input?.todos 
                ? todoPart.state.input.todos 
                : (typeof todoPart.text === 'string' ? JSON.parse(todoPart.text) : todoPart.text);
            
            if (!todoData || !Array.isArray(todoData)) return;
            
            todoData.forEach(todo => {
                const todoItem = document.createElement('div');
                todoItem.className = `todo-item todo-${todo.status} todo-priority-${todo.priority}`;
                
                const statusIcon = {
                    'pending': '⏸️',
                    'in_progress': '▶️',
                    'completed': '✅',
                    'cancelled': '❌'
                }[todo.status] || '⏸️';
                
                const priorityClass = todo.priority === 'high' ? 'todo-priority-high' : 
                                     todo.priority === 'low' ? 'todo-priority-low' : '';
                
                todoItem.innerHTML = `
                    <div class="todo-icon">${statusIcon}</div>
                    <div class="todo-content ${priorityClass}">
                        <div class="todo-text">${escapeHtml(todo.content)}</div>
                        ${todo.status === 'in_progress' ? '<div class="todo-spinner"></div>' : ''}
                    </div>
                `;
                
                section.appendChild(todoItem);
            });
        } catch (e) {
            console.error('Error parsing todo:', e, todoPart);
        }
    });
    
    return section.children.length > 0 ? section : null;
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
            
            // Sort messages by creation time (oldest first)
            allMessages.sort((a, b) => {
                const timeA = a.info?.time?.created || 0;
                const timeB = b.info?.time?.created || 0;
                return timeA - timeB;
            });
            
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
            
            // Add double-tap to favorite on message bubbles
            if (msgID && text) {
                let lastBubbleTap = 0;
                bubble.addEventListener('click', (e) => {
                    // Don't trigger if clicking the favorite button or edit button
                    if (e.target.classList.contains('favorite-btn') || 
                        e.target.classList.contains('edit-message-btn') ||
                        e.target.closest('.edit-message-btn')) {
                        return;
                    }
                    
                    const now = Date.now();
                    if (now - lastBubbleTap < 300) {
                        // Double tap detected - toggle favorite
                        toggleFavorite(msgID, text, msg.info.role);
                    }
                    lastBubbleTap = now;
                });
            }
            
            // Add favorite button
            if (msgID && text) {
                const favoriteBtn = document.createElement('button');
                favoriteBtn.className = 'favorite-btn';
                favoriteBtn.textContent = favoriteMessages.has(msgID) ? '⭐' : '☆';
                if (favoriteMessages.has(msgID)) favoriteBtn.classList.add('favorited');
                favoriteBtn.onclick = (e) => {
                    e.stopPropagation();
                    toggleFavorite(msgID, text, msg.info.role);
                };
                bubble.appendChild(favoriteBtn);
            }
            
            if (msg.info.agent || msg.info.modelID || msg.info.role === 'user') {
                const infoBar = document.createElement('div');
                infoBar.className = 'message-info-bar';
                const agentName = msg.info.agent || (msg.info.role === 'user' ? 'User' : 'Assistant');
                const modelName = msg.info.modelID ? `${msg.info.providerID ? msg.info.providerID + '/' : ''}${msg.info.modelID}` : '';
                
                // First row: agent and model
                const firstRow = document.createElement('div');
                firstRow.className = 'message-info-row';
                firstRow.innerHTML = `<span class="agent-tag">${msg.info.role === 'user' ? '👤' : '🤖'} ${agentName}</span>${modelName ? `<span class="model-tag">${modelName}</span>` : ''}`;
                infoBar.appendChild(firstRow);
                
                // Second row: timestamp
                if (msg.info.time && msg.info.time.created) {
                    const secondRow = document.createElement('div');
                    secondRow.className = 'message-info-row message-timestamp';
                    const timestamp = new Date(msg.info.time.created);
                    secondRow.textContent = timestamp.toLocaleString();
                    infoBar.appendChild(secondRow);
                }
                
                bubble.appendChild(infoBar);
            }
            
            const content = document.createElement('div');
            content.className = 'message-content';
            // Show selectively formatted markdown (code blocks & headings only)
            content.innerHTML = typeof marked !== 'undefined' ? cleanMarkedOutput(marked.parse(text)) : text;
            bubble.appendChild(content);
            
            if (msg.info.error) bubble.classList.add('error');
            
            // Add reasoning section if present
            if (reasoningParts.length > 0) {
                const reasoningSection = createReasoningSection(reasoningParts, msgID);
                if (reasoningSection) bubble.appendChild(reasoningSection);
            }
            
            // Insert at the right position
            messagesContainer.insertBefore(bubble, insertPoint);
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
    
    // Store event in tool event store
    storeToolEvent(partID, {
        type: 'progress',
        timestamp: Date.now(),
        messageID,
        agent,
        task,
        status,
        data
    });
    
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
            bubble = createProgressBubble(messageID, partID, data.historical);
            messageProgressMap.set(partID, bubble);
        }
        updateProgressBubble(bubble, agent, task, status);
        
    } else {
        // pending or running - show/update bubble
        if (!bubble) {
            bubble = createProgressBubble(messageID, partID, data.historical);
            messageProgressMap.set(partID, bubble);
        }
        updateProgressBubble(bubble, agent, task, status);
    }
    
    // Update tools list if not viewing a specific tool detail
    if (!activeToolDrawerPartID && !data.historical) {
        renderToolsList();
    }
}

// Tool Event Store Management
function storeToolEvent(partID, event) {
    if (!toolEventStore.has(partID)) {
        toolEventStore.set(partID, {
            partID,
            events: [],
            metadata: {},
            output: '',
            startTime: Date.now(),
            currentStatus: 'pending'
        });
    }
    
    const toolData = toolEventStore.get(partID);
    toolData.events.push(event);
    
    // Update current status
    if (event.status) {
        toolData.currentStatus = event.status;
    }
    
    // Update metadata
    if (event.agent) toolData.metadata.agent = event.agent;
    if (event.task) toolData.metadata.task = event.task;
    if (event.tool) toolData.metadata.tool = event.tool;
    if (event.messageID) toolData.metadata.messageID = event.messageID;
    
    // If drawer is open for this tool, update it
    if (activeToolDrawerPartID === partID) {
        updateToolDrawerLive(partID);
    }
}

function createProgressBubble(messageID, partID, isHistorical = false) {
    const container = document.getElementById('messagesContainer');
    if (!container) return null;
    
    const bubble = document.createElement('div');
    bubble.id = `progress-${messageID}-${partID}`;
    bubble.className = 'progress-bubble';
    bubble.dataset.messageId = messageID;
    bubble.dataset.partId = partID;
    bubble.dataset.startTime = Date.now();
    container.appendChild(bubble);
    
    if (!isHistorical) {
        container.scrollTop = container.scrollHeight;
    }
    return bubble;
}

function updateProgressBubble(bubble, agent, task, status) {
    const startTime = parseInt(bubble.dataset.startTime);
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const partID = bubble.dataset.partId;
    
    const icons = {
        pending: '⏳',
        running: '🔄',
        error: '❌'
    };
    
    const icon = icons[status] || '🔄';
    const statusText = status.charAt(0).toUpperCase() + status.slice(1);
    
    // Check if this is a supported agent type (bash or explore)
    const isSupportedAgent = agent === 'bash' || agent === 'explore' || agent.toLowerCase() === 'bash' || agent.toLowerCase().includes('explore');
    
    bubble.innerHTML = `
        <div class="progress-header">
            <span class="progress-icon">${icon}</span>
            <span class="progress-status">${statusText}: ${agent}</span>
            ${status === 'running' ? `<span class="progress-timer">⏱️ ${elapsed}s</span>` : ''}
            ${isSupportedAgent ? '<span class="progress-clickable-hint">👁️</span>' : ''}
        </div>
        <div class="progress-task">${escapeHtml(task)}</div>
    `;
    
    bubble.className = `progress-bubble progress-${status}`;
    
    // Make clickable if supported agent
    if (isSupportedAgent) {
        bubble.classList.add('progress-clickable');
        bubble.style.cursor = 'pointer';
        bubble.onclick = () => openToolDetail(partID);
    }
    
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
    
    // Show agent names in the summary
    const agentText = completed.length === 1 ? completed[0] : `${completed.length} agents`;
    summary.innerHTML = `✅ ${agentText}${completed.length === 1 ? '' : ` (${displayTools}${moreText})`} completed`;
    summary.style.cursor = 'pointer';
    summary.title = 'Click to view completed tools';
    
    // Make clickable - show list of completed tools with their partIDs
    summary.onclick = () => showCompletedToolsList(messageID);
    
    container.appendChild(summary);
}

function showCompletedToolsList(messageID) {
    // Find all tool events for this message
    const toolsForMessage = [];
    toolEventStore.forEach((toolData, partID) => {
        if (toolData.metadata.messageID === messageID && toolData.currentStatus === 'completed') {
            toolsForMessage.push({ partID, ...toolData.metadata });
        }
    });
    
    if (toolsForMessage.length === 0) {
        return; // Nothing to show
    }
    
    // If only one tool, open it directly
    if (toolsForMessage.length === 1) {
        openToolDetail(toolsForMessage[0].partID);
        return;
    }
    
    // Multiple tools - show selection modal
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-content';
    modalContent.style.maxWidth = '500px';
    
    modalContent.innerHTML = `
        <div class="modal-header">
            <h3>Completed Tools</h3>
            <button class="modal-close">✕</button>
        </div>
        <div class="modal-body">
            <div style="display: flex; flex-direction: column; gap: 8px;">
                ${toolsForMessage.map(tool => `
                    <div class="completed-tool-item" data-partid="${tool.partID}" style="
                        padding: 12px;
                        border: 1px solid #e0e0e0;
                        border-radius: 6px;
                        cursor: pointer;
                        transition: background 0.2s;
                    ">
                        <div style="font-weight: 600; color: #28a745;">✅ ${tool.agent || 'Tool'}</div>
                        <div style="font-size: 12px; color: #666; margin-top: 4px;">${escapeHtml(tool.task || 'Completed')}</div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Close handlers
    modal.querySelector('.modal-close').onclick = () => modal.remove();
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    // Tool item click handlers
    modalContent.querySelectorAll('.completed-tool-item').forEach(item => {
        item.onmouseover = () => item.style.background = '#f0f0f0';
        item.onmouseout = () => item.style.background = '';
        item.onclick = () => {
            const partID = item.dataset.partid;
            modal.remove();
            openToolDetail(partID);
        };
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Tool Tab Functions
function openToolDetail(partID) {
    const toolData = toolEventStore.get(partID);
    if (!toolData) {
        console.warn('No tool data found for partID:', partID);
        return;
    }
    
    activeToolDrawerPartID = partID;
    
    // Switch to tools tab
    switchTab('tools');
    
    // Render tool detail view
    renderToolDetail(toolData, partID);
}

function renderToolDetail(toolData, partID) {
    const container = document.getElementById('toolsContainer');
    if (!container) return;
    
    const agent = toolData.metadata.agent || 'Tool';
    const task = toolData.metadata.task || 'Processing...';
    const status = toolData.currentStatus;
    
    // Calculate elapsed time
    const elapsed = Math.floor((Date.now() - toolData.startTime) / 1000);
    const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
    
    // Status badge
    const statusIcons = {
        pending: '⏳',
        running: '🔄',
        completed: '✅',
        error: '❌'
    };
    const icon = statusIcons[status] || '🔄';
    
    container.innerHTML = `
        <div class="tool-detail-view">
            <button class="tool-detail-back" onclick="renderToolsList()">← Back to Tools</button>
            
            <div style="margin-bottom: 20px;">
                <h2 style="margin: 0 0 8px 0; font-size: 20px;">${agent}</h2>
                <div style="color: #666; font-size: 14px;">${escapeHtml(task)}</div>
            </div>
            
            <div class="tool-status-badge status-${status}" id="toolDetailStatus">
                ${icon} ${status.charAt(0).toUpperCase() + status.slice(1)}
                ${status === 'running' ? `<span style="margin-left: 8px;">⏱️ ${elapsedStr}</span>` : ''}
            </div>
            
            ${toolData.metadata.tool ? `
                <div class="tool-section">
                    <div class="tool-section-title">Tool Information</div>
                    <div class="tool-metadata-grid">
                        <div class="tool-metadata-label">Type:</div>
                        <div class="tool-metadata-value">${toolData.metadata.tool}</div>
                        <div class="tool-metadata-label">Part ID:</div>
                        <div class="tool-metadata-value" style="font-family: monospace; font-size: 11px;">${partID}</div>
                        <div class="tool-metadata-label">Duration:</div>
                        <div class="tool-metadata-value" id="toolDetailDuration">${elapsedStr}</div>
                    </div>
                </div>
            ` : ''}
            
            <div class="tool-section">
                <div class="tool-section-title">Event Timeline</div>
                <div class="tool-timeline" id="toolTimeline">
                    ${renderToolTimeline(toolData.events)}
                </div>
            </div>
            
            ${toolData.output ? `
                <div class="tool-section">
                    <div class="tool-section-title">Output</div>
                    <div class="tool-output-box" id="toolOutputBox">${escapeHtml(toolData.output)}</div>
                </div>
            ` : ''}
        </div>
    `;
    
    // Update timer for running tasks
    if (status === 'running' && !toolData.timerInterval) {
        toolData.timerInterval = setInterval(() => {
            if (activeToolDrawerPartID === partID) {
                const newElapsed = Math.floor((Date.now() - toolData.startTime) / 1000);
                const newElapsedStr = newElapsed < 60 ? `${newElapsed}s` : `${Math.floor(newElapsed / 60)}m ${newElapsed % 60}s`;
                
                const statusBadge = document.getElementById('toolDetailStatus');
                const duration = document.getElementById('toolDetailDuration');
                
                if (statusBadge) {
                    const timerSpan = statusBadge.querySelector('span');
                    if (timerSpan) {
                        timerSpan.textContent = `⏱️ ${newElapsedStr}`;
                    }
                }
                if (duration) {
                    duration.textContent = newElapsedStr;
                }
            } else {
                clearInterval(toolData.timerInterval);
                delete toolData.timerInterval;
            }
        }, 1000);
    }
}

function renderToolsList() {
    const container = document.getElementById('toolsContainer');
    if (!container) return;
    
    activeToolDrawerPartID = null;
    
    const tools = Array.from(toolEventStore.entries()).map(([partID, data]) => ({
        partID,
        ...data
    }));
    
    // Sort: running first, then by most recent
    tools.sort((a, b) => {
        if (a.currentStatus === 'running' && b.currentStatus !== 'running') return -1;
        if (a.currentStatus !== 'running' && b.currentStatus === 'running') return 1;
        return b.startTime - a.startTime;
    });
    
    // Update counts
    const activeCount = tools.filter(t => t.currentStatus === 'running' || t.currentStatus === 'pending').length;
    const completedCount = tools.filter(t => t.currentStatus === 'completed').length;
    
    document.getElementById('toolsActiveCount').textContent = `${activeCount} active`;
    document.getElementById('toolsCompletedCount').textContent = `${completedCount} completed`;
    
    // Update tab indicator
    updateToolsTabIndicator(activeCount);
    
    if (tools.length === 0) {
        container.innerHTML = `
            <div class="tools-empty-state">
                <div style="font-size: 48px; margin-bottom: 16px;">🔧</div>
                <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">No Tools Running</div>
                <div style="font-size: 13px; color: #666;">Agent and tool activity will appear here</div>
            </div>
        `;
        return;
    }
    
    container.innerHTML = tools.map(tool => {
        const elapsed = Math.floor((Date.now() - tool.startTime) / 1000);
        const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
        
        const statusIcons = {
            pending: '⏳',
            running: '🔄',
            completed: '✅',
            error: '❌'
        };
        const icon = statusIcons[tool.currentStatus] || '🔄';
        
        return `
            <div class="tool-card" onclick="openToolDetail('${tool.partID}')">
                <div class="tool-card-header">
                    <div class="tool-card-title">
                        <span>${icon}</span>
                        <span>${tool.metadata.agent || 'Tool'}</span>
                    </div>
                    <div class="tool-card-status ${tool.currentStatus}">
                        ${tool.currentStatus}
                    </div>
                </div>
                <div class="tool-card-task">${escapeHtml(tool.metadata.task || 'Processing...')}</div>
                <div class="tool-card-meta">
                    <span>⏱️ ${elapsedStr}</span>
                    ${tool.metadata.tool ? `<span>🔧 ${tool.metadata.tool}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function updateToolsTabIndicator(activeCount) {
    const indicator = document.getElementById('toolsTabIndicator');
    if (indicator) {
        if (activeCount > 0) {
            indicator.style.display = 'inline-block';
        } else {
            indicator.style.display = 'none';
        }
    }
}

function renderToolTimeline(events) {
    if (!events || events.length === 0) {
        return '<div style="color: #999; font-size: 12px;">No events yet</div>';
    }
    
    return events.map(event => {
        const time = new Date(event.timestamp);
        const timeStr = time.toLocaleTimeString();
        
        let icon = '⚫';
        let title = 'Event';
        let desc = '';
        
        if (event.type === 'progress') {
            if (event.status === 'pending') {
                icon = '⏳';
                title = 'Task Queued';
            } else if (event.status === 'running') {
                icon = '🔄';
                title = 'Task Started';
                desc = event.task;
            } else if (event.status === 'completed') {
                icon = '✅';
                title = 'Task Completed';
            } else if (event.status === 'error') {
                icon = '❌';
                title = 'Task Failed';
                desc = event.data?.error || '';
            }
        }
        
        return `
            <div class="tool-timeline-item">
                <div class="tool-timeline-icon">${icon}</div>
                <div class="tool-timeline-content">
                    <div class="tool-timeline-title">${title}</div>
                    <div class="tool-timeline-time">${timeStr}</div>
                    ${desc ? `<div class="tool-timeline-desc">${escapeHtml(desc)}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function updateToolDetailLive(partID) {
    // If viewing detail for this tool, update it
    if (activeToolDrawerPartID === partID) {
        const toolData = toolEventStore.get(partID);
        if (!toolData) return;
        
        // Re-render the timeline
        const timelineContainer = document.getElementById('toolTimeline');
        if (timelineContainer) {
            timelineContainer.innerHTML = renderToolTimeline(toolData.events);
        }
        
        // Update status badge
        const statusBadge = document.getElementById('toolDetailStatus');
        if (statusBadge) {
            const status = toolData.currentStatus;
            const statusIcons = {
                pending: '⏳',
                running: '🔄',
                completed: '✅',
                error: '❌'
            };
            const icon = statusIcons[status] || '🔄';
            const elapsed = Math.floor((Date.now() - toolData.startTime) / 1000);
            const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
            
            statusBadge.className = `tool-status-badge status-${status}`;
            statusBadge.innerHTML = `
                ${icon} ${status.charAt(0).toUpperCase() + status.slice(1)}
                ${status === 'running' ? `<span style="margin-left: 8px;">⏱️ ${elapsedStr}</span>` : ''}
            `;
        }
        
        // Update output if present
        if (toolData.output) {
            let outputBox = document.getElementById('toolOutputBox');
            if (!outputBox) {
                // Create output section if it doesn't exist
                const container = document.querySelector('.tool-detail-view');
                if (container) {
                    const outputSection = document.createElement('div');
                    outputSection.className = 'tool-section';
                    outputSection.innerHTML = `
                        <div class="tool-section-title">Output</div>
                        <div class="tool-output-box" id="toolOutputBox">${escapeHtml(toolData.output)}</div>
                    `;
                    container.appendChild(outputSection);
                }
            } else {
                outputBox.textContent = toolData.output;
            }
        }
    }
    
    // Always update the tools list if we're on that view
    const toolsContainer = document.getElementById('toolsContainer');
    if (toolsContainer && !activeToolDrawerPartID) {
        renderToolsList();
    }
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
        updateFilesBadge(existingDiffs.length);
        if (isFilesTabActive()) {
            renderFilesTab(existingDiffs);
        }
    }
}

function updateFilesBadge(count) {
    const filesBadge = document.getElementById('filesBadge');
    const filesCount = document.getElementById('filesCount');
    
    if (filesBadge) {
        filesBadge.textContent = count;
        filesBadge.style.display = count > 0 ? 'inline' : 'none';
    }
    
    if (filesCount) {
        filesCount.textContent = count;
    }
}

function isFilesTabActive() {
    const filesTab = document.getElementById('filesTab');
    return filesTab && filesTab.classList.contains('active');
}

function renderFilesTab(diffs) {
    const content = document.getElementById('filesContent');
    const filesCount = document.getElementById('filesCount');
    const filesStats = document.getElementById('filesStats');
    
    if (!content) return;
    
    if (filesCount) {
        filesCount.textContent = diffs.length;
    }
    
    // Update stats
    if (filesStats && diffs.length > 0) {
        const totalAdditions = diffs.reduce((sum, d) => sum + d.additions, 0);
        const totalDeletions = diffs.reduce((sum, d) => sum + d.deletions, 0);
        filesStats.textContent = `+${totalAdditions}/-${totalDeletions} lines`;
    } else if (filesStats) {
        filesStats.textContent = 'No changes yet';
    }
    
    if (diffs.length === 0) {
        content.innerHTML = `
            <div class="files-empty-state">
                <div style="font-size: 48px; margin-bottom: 16px;">📁</div>
                <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">No File Changes Yet</div>
                <div style="font-size: 13px; color: #666; margin-bottom: 24px;">File changes will appear here as you work</div>
                <button class="btn-primary" id="emptyStateLoadBtn" onclick="loadPastChanges()">Load Past Changes</button>
            </div>
        `;
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
    renderFilesTab(diffs);
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
    updateFilesBadge(0);
    renderFilesTab([]);
}

async function loadPastChanges() {
    if (!currentSessionID) {
        showToast('No session selected', 'error');
        return;
    }
    
    const loadBtn = document.getElementById('loadPastChangesBtn');
    const emptyBtn = document.getElementById('emptyStateLoadBtn');
    
    // Disable buttons and show loading state
    const originalText = loadBtn ? loadBtn.textContent : '';
    if (loadBtn) {
        loadBtn.disabled = true;
        loadBtn.textContent = 'Loading...';
    }
    if (emptyBtn) {
        emptyBtn.disabled = true;
        emptyBtn.textContent = 'Loading...';
    }
    
    try {
        // Fetch diffs from API
        const response = await fetch(`/api/session/${currentSessionID}/diff`);
        
        if (!response.ok) {
            throw new Error(`Failed to load diffs: ${response.statusText}`);
        }
        
        const diffs = await response.json();
        
        if (!Array.isArray(diffs)) {
            throw new Error('Invalid diff response format');
        }
        
        // Store diffs
        sessionDiffs.set(currentSessionID, diffs);
        
        // Update UI
        updateFilesBadge(diffs.length);
        renderFilesTab(diffs);
        
        // Show success message
        if (diffs.length === 0) {
            showToast('No file changes found', 'info');
        } else {
            showToast(`Loaded ${diffs.length} file change(s)`, 'success');
        }
        
    } catch (error) {
        console.error('Failed to load past changes:', error);
        showToast(`Failed to load changes: ${error.message}`, 'error');
        
    } finally {
        // Re-enable buttons
        if (loadBtn) {
            loadBtn.disabled = false;
            loadBtn.textContent = originalText;
        }
        if (emptyBtn) {
            emptyBtn.disabled = false;
            emptyBtn.textContent = 'Load Past Changes';
        }
    }
}

async function sendMessage(customText = null, customAgent = null, customModel = null) {
    console.log('[DEBUG] sendMessage called with:', {customText, customAgent, customModel, currentSession, editorMode});
    
    if (!currentSession) {
        alert('Please connect to a session first');
        if (settingsModal) settingsModal.classList.add('active');
        return;
    }
    
    const text = customText || getEditorContent();
    console.log('[DEBUG] Text to send:', text);
    if (!text) {
        console.log('[DEBUG] No text to send, returning early');
        return;
    }

    clearEditorContent();
    if (sendBtn) sendBtn.disabled = true;
    
    const agent = customAgent !== null ? customAgent : (qsAgentSelect ? qsAgentSelect.value : undefined);
    const modelStr = customModel !== null ? customModel : (qsModelSelect ? qsModelSelect.value : undefined);
    const model = (modelStr && modelStr !== "") ? JSON.parse(modelStr) : undefined;

    // Check model priority before sending
    if (model) {
        const shouldContinue = await checkModelPriority(model);
        if (!shouldContinue) {
            if (sendBtn) sendBtn.disabled = false;
            return;
        }
    }

    // Get agent's custom system prompt if configured
    let systemPrompt = undefined;
    if (agent) {
        try {
            const config = await fetch('/api/config').then(r => r.json());
            if (config.agent && config.agent[agent] && config.agent[agent].prompt) {
                systemPrompt = config.agent[agent].prompt;
                console.log('[DEBUG] Using custom system prompt for agent:', agent);
            }
        } catch (error) {
            console.error('Failed to fetch agent config:', error);
        }
    }

    addMessage('user', text, false, false, false, false, { agent, modelID: model?.modelID, providerID: model?.providerID });
    addTypingIndicator('assistant-typing');
    
    try {
        const payload = { text, agent, model };
        if (systemPrompt) {
            payload.system = systemPrompt;
        }
        
        const response = await fetch(`/api/session/${currentSession.id}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
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
    // Don't show bubble until there's at least one word
    if (!text || text.trim().split(/\s+/).length === 0) return;
    
    let streamMsg = document.getElementById('stream-' + messageID);
    if (!streamMsg) {
        streamMsg = document.createElement('div');
        streamMsg.id = 'stream-' + messageID;
        streamMsg.className = 'message-bubble assistant';
        if (isReasoning) streamMsg.classList.add('reasoning');
        
        if (metadata && (metadata.agent || metadata.modelID)) {
            const infoBar = document.createElement('div');
            infoBar.className = 'message-info-bar';
            const agentName = metadata.agent || 'Assistant';
            const modelName = metadata.modelID ? `${metadata.providerID ? metadata.providerID + '/' : ''}${metadata.modelID}` : '';
            infoBar.innerHTML = `<span class="agent-tag">🤖 ${agentName}</span>${modelName ? `<span class="model-tag">${modelName}</span>` : ''}`;
            streamMsg.appendChild(infoBar);
        }

        const content = document.createElement('div');
        content.className = 'message-content';
        streamMsg.appendChild(content);
        if (messagesContainer) messagesContainer.appendChild(streamMsg);
    }
    
    const content = streamMsg.querySelector('.message-content') || streamMsg;
    content.innerHTML = typeof marked !== 'undefined' ? cleanMarkedOutput(marked.parse(text)) : text;
    
    // Silence scrolling for historical messages
    if (messagesContainer && !metadata.historical) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function removeStreamingMessage(messageID) {
    const streamMsg = document.getElementById('stream-' + messageID);
    if (streamMsg) streamMsg.remove();
}

function addEvent(type, data) {
    if (!eventsContainer) return;
    
    // Check if Events tab is enabled
    const showEventsTab = localStorage.getItem('showEventsTab') === 'true';
    if (!showEventsTab) return;
    
    // Filter out events with delta property (incremental text updates)
    if (typeof data === 'object' && data !== null && 'delta' in data) {
        return;
    }
    
    const item = document.createElement('div');
    item.className = 'event-item';
    item.innerHTML = `<div class="event-header">${type}</div><div class="event-body">${typeof data === 'object' ? JSON.stringify(data, null, 2) : data}</div><div class="event-time">${new Date().toLocaleTimeString()}</div>`;
    eventsContainer.prepend(item);
}

function addMessage(role, text, isQuestion = false, isError = false, isWarning = false, isInfo = false, metadata = {}, questionData = null, reasoningParts = null, todoParts = null) {
    // Check if there's actual content (at least one word in text or has reasoning/todo parts)
    const hasTextContent = text && text.trim().split(/\s+/).length > 0;
    if (!hasTextContent && (!reasoningParts || reasoningParts.length === 0) && (!todoParts || todoParts.length === 0)) return;

    const msgID = metadata ? (metadata.id || metadata.messageID) : null;
    if (msgID && document.getElementById('msg-' + msgID)) return;

    // Track historical messages for deduplication
    if (metadata?.historical && msgID) {
        historicalMessages.add(msgID);
    }

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${role}`;
    if (msgID) bubble.id = 'msg-' + msgID;
    
    // Add double-tap to favorite on message bubbles
    if (msgID && text) {
        let lastBubbleTap = 0;
        bubble.addEventListener('click', (e) => {
            // Don't trigger if clicking the favorite button or edit button
            if (e.target.classList.contains('favorite-btn') || 
                e.target.classList.contains('edit-message-btn') ||
                e.target.closest('.edit-message-btn')) {
                return;
            }
            
            const now = Date.now();
            if (now - lastBubbleTap < 300) {
                // Double tap detected - toggle favorite
                toggleFavorite(msgID, text, role);
            }
            lastBubbleTap = now;
        });
    }
    
    // Add favorite button
    if (msgID && text) {
        const favoriteBtn = document.createElement('button');
        favoriteBtn.className = 'favorite-btn';
        favoriteBtn.textContent = favoriteMessages.has(msgID) ? '⭐' : '☆';
        if (favoriteMessages.has(msgID)) favoriteBtn.classList.add('favorited');
        favoriteBtn.onclick = (e) => {
            e.stopPropagation();
            toggleFavorite(msgID, text, role);
        };
        bubble.appendChild(favoriteBtn);
    }
    
    if (metadata && (metadata.agent || metadata.modelID || role === 'user')) {
        const infoBar = document.createElement('div');
        infoBar.className = 'message-info-bar';
        const agentName = metadata.agent || (role === 'user' ? 'User' : 'Assistant');
        const modelName = metadata.modelID ? `${metadata.providerID ? metadata.providerID + '/' : ''}${metadata.modelID}` : '';
        
        // First row: agent and model
        const firstRow = document.createElement('div');
        firstRow.className = 'message-info-row';
        firstRow.innerHTML = `<span class="agent-tag">${role === 'user' ? '👤' : '🤖'} ${agentName}</span>${modelName ? `<span class="model-tag">${modelName}</span>` : ''}`;
        infoBar.appendChild(firstRow);
        
        // Second row: timestamp
        if (metadata.time && metadata.time.created) {
            const secondRow = document.createElement('div');
            secondRow.className = 'message-info-row message-timestamp';
            const timestamp = new Date(metadata.time.created);
            secondRow.textContent = timestamp.toLocaleString();
            infoBar.appendChild(secondRow);
        }
        
        bubble.appendChild(infoBar);
    }

    const content = document.createElement('div');
    content.className = 'message-content';
    // Show selectively formatted markdown (code blocks & headings only)
    content.innerHTML = typeof marked !== 'undefined' ? cleanMarkedOutput(marked.parse(text)) : text;
    bubble.appendChild(content);

    // Add edit button for user messages
    if (role === 'user') {
        addEditButton(bubble, text);
    }

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
                        
                        // Clear paused flag and resume liveness monitoring after question is answered
                        isQuestionPaused = false;
                        if (currentSession && currentSession.id) {
                            fetch(`/api/session/${currentSession.id}/liveness/resume`, { method: 'POST' })
                                .catch(err => console.error('Failed to resume liveness:', err));
                        }
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
    
    // Add todo section if present
    if (todoParts && todoParts.length > 0 && msgID) {
        const todoSection = createTodoSection(todoParts, msgID);
        if (todoSection) {
            bubble.appendChild(todoSection);
        }
    }
    
    // Add reasoning section if present
    if (reasoningParts && reasoningParts.length > 0 && msgID) {
        const reasoningSection = createReasoningSection(reasoningParts, msgID);
        if (reasoningSection) {
            bubble.appendChild(reasoningSection);
        }
    }
    
    if (messagesContainer) {
        messagesContainer.appendChild(bubble);
        
        // Only add separate time display if there's no metadata with timestamp
        if (!metadata || !metadata.time || !metadata.time.created) {
            const time = document.createElement('div');
            time.className = 'message-time';
            time.textContent = new Date().toLocaleTimeString();
            messagesContainer.appendChild(time);
        }
        
        // Silence scrolling for historical messages
        if (!metadata.historical) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
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

function addTypingIndicator(id) {
    const typingArea = document.getElementById('typingIndicatorArea');
    console.log('[DEBUG] addTypingIndicator called:', id, 'typingArea:', typingArea);
    if (!typingArea) {
        console.error('[DEBUG] Typing area not found!');
        return;
    }
    
    // Check if indicator already exists
    if (document.getElementById(id)) {
        console.log('[DEBUG] Indicator already exists:', id);
        return;
    }
    
    // Show the typing area
    typingArea.style.display = 'block';
    console.log('[DEBUG] Set display to block, current display:', typingArea.style.display);
    
    // Add class to messages container for padding
    if (messagesContainer) messagesContainer.classList.add('with-typing');
    
    const indicator = document.createElement('div');
    indicator.id = id;
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<span></span><span></span><span></span>';
    typingArea.appendChild(indicator);
    console.log('[DEBUG] Appended indicator, children count:', typingArea.children.length);
    
    // Scroll messages to bottom
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function removeTypingIndicator(id) {
    console.log('[DEBUG] removeTypingIndicator called:', id);
    const indicator = document.getElementById(id);
    if (indicator) {
        indicator.remove();
        console.log('[DEBUG] Removed indicator:', id);
    }
    
    // Hide typing area if no more indicators
    const typingArea = document.getElementById('typingIndicatorArea');
    if (typingArea && typingArea.children.length === 0) {
        typingArea.style.display = 'none';
        console.log('[DEBUG] Hiding typing area');
        if (messagesContainer) messagesContainer.classList.remove('with-typing');
    }
}

function updateSubagentProgress(data) {
    const { messageID, partID, agent, task, status, output } = data;
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
        const toolName = agent || 'Tool';
        progressEl.innerHTML = `<span class="pill-icon ${status === 'running' ? 'spinning' : ''}">${icon}</span> <span class="pill-agent">${toolName}</span>: <span class="pill-task">${task}</span>`;
        progressEl.className = `subagent-pill ${status}`;
        
        // Store output if available
        if (output && (status === 'completed' || status === 'error')) {
            toolOutputs.set(progressID, { agent: toolName, task, output, status });
            
            // Add click handler for completed/error states
            progressEl.style.cursor = 'pointer';
            progressEl.onclick = () => showToolOutput(progressID);
        }
        
        if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

function showToolOutput(progressID) {
    const data = toolOutputs.get(progressID);
    if (!data) return;
    
    const modal = document.getElementById('toolOutputModal');
    const title = document.getElementById('toolOutputTitle');
    const content = document.getElementById('toolOutputContent');
    
    if (modal && title && content) {
        title.textContent = `${data.agent}: ${data.task}`;
        content.textContent = typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2);
        modal.style.display = 'flex';
    }
}

function connectWebSocket() {
    // Clear any existing reconnect timeout
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);
    
    ws.onopen = () => {
        // Reset reconnection state on successful connection
        reconnectAttempts = 0;
        isReconnecting = false;
        
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
        
        // Queue historical events for ordered processing
        if (data.historical && isLoadingHistory) {
            historicalEventQueue.push({ type, data });
            processedHistoricalEvents++;
            updateLoadingProgress();
            return; // Don't process immediately
        }
        
        addEvent(type, data);

        // Deduplication: if not historical but we already have it in historical sets, ignore
        if (!data.historical) {
            const msgID = data.messageID || data.id;
            const partID = data.part?.id || data.partID;
            if (msgID && historicalMessages.has(msgID)) {
                console.log('[WS] Blocked duplicate message:', msgID);
                return;
            }
            if (partID && historicalParts.has(partID)) {
                console.log('[WS] Blocked duplicate part:', partID);
                return;
            }
        } else {
            // Track historical IDs
            const msgID = data.messageID || data.id;
            const partID = data.part?.id || data.partID;
            if (msgID) historicalMessages.add(msgID);
            if (partID) historicalParts.add(partID);
        }

        switch (type) {
            case 'session.status':
                const sessionStatus = (data.status && data.status.type) || data.status || data.type;
                const sessionID = data.sessionID || currentSessionID;
                
                // Track status for session list indicator
                if (sessionID) {
                    sessionStatuses.set(sessionID, sessionStatus);
                    // Refresh session list if Settings tab is open to update indicators
                    const settingsTab = document.querySelector('.tab-button[data-tab="settings"]');
                    if (settingsTab && settingsTab.classList.contains('active')) {
                        loadExistingSessions();
                    }
                }
                
                updateStatus(sessionStatus);
                if (sessionStatus === 'busy') {
                    addTypingIndicator('assistant-typing');
                } else if (sessionStatus === 'idle') {
                    removeTypingIndicator('assistant-typing');
                    // Show idle state in liveness row
                    updateLivenessDisplay('idle');
                    sessionLiveness.delete(sessionID);
                }
                break;
            case 'message.delta':
            case 'message.part':
                const msgID = data.messageID || data.id;
                const part = data.part || (data.parts && data.parts[0]);
                
                // Store tool output in event store
                if (part && (part.type === 'tool' || part.type === 'subtask')) {
                    const partID = part.id;
                    
                    // Initialize tool event if not exists
                    if (!toolEventStore.has(partID)) {
                        storeToolEvent(partID, {
                            type: 'tool_init',
                            timestamp: Date.now(),
                            messageID: msgID,
                            tool: part.tool,
                            agent: part.metadata?.subagent_type || part.state?.agent || part.tool,
                            task: part.metadata?.description || part.state?.title || 'Processing...'
                        });
                    }
                    
                    // Capture output from delta or text
                    if (data.delta || part.text) {
                        const toolData = toolEventStore.get(partID);
                        if (toolData) {
                            toolData.output += (data.delta || part.text || '');
                        }
                    }
                }
                
                // Handle tool parts (like todowrite) separately
                if (part && part.type === 'tool' && part.tool === 'todowrite') {
                    // Tool part detected - will be rendered when message completes
                    addEvent('Todo Tool Part Received', {
                        messageID: msgID,
                        tool: part.tool,
                        hasState: !!part.state,
                        hasInput: !!(part.state && part.state.input)
                    });
                    // Update streaming message to show that todos are being processed
                    let fullText = messageBuffer.get(msgID) || '';
                    updateStreamingMessage(msgID, fullText, part?.type === 'reasoning', data.message || {});
                } else {
                    // Regular text/reasoning parts
                    let fullText = messageBuffer.get(msgID) || '';
                    fullText += (data.delta || data.text || '');
                    messageBuffer.set(msgID, fullText);
                    updateStreamingMessage(msgID, fullText, part?.type === 'reasoning', data.message || {});
                }
                break;
            case 'message.complete':
                const finalID = data.messageID || data.id;
                let finalContent = messageBuffer.get(finalID) || (data.message && data.message.text);
                removeStreamingMessage(finalID);
                if (document.getElementById('msg-' + finalID)) { messageBuffer.delete(finalID); return; }
                
                // Fetch full message with all parts (including todos, reasoning, etc.)
                if (currentSession) {
                    fetch(`/api/session/${currentSession.id}/messages?limit=10`)
                        .then(res => res.json())
                        .then(messages => {
                            const fullMsg = messages.find(m => m.info.id === finalID);
                            if (fullMsg) {
                                const textParts = fullMsg.parts.filter(p => p.type === 'text');
                                const reasoningParts = fullMsg.parts.filter(p => p.type === 'reasoning');
                                const todoParts = fullMsg.parts.filter(p => p.type === 'tool' && p.tool === 'todowrite');
                                const text = textParts.map(p => p.text).join('\n');
                                
                                addEvent('Message Complete with Parts', {
                                    messageID: finalID,
                                    textParts: textParts.length,
                                    reasoningParts: reasoningParts.length,
                                    todoParts: todoParts.length,
                                    partTypes: fullMsg.parts.map(p => p.type)
                                });
                                
                                if (text || reasoningParts.length > 0 || todoParts.length > 0) {
                                    addMessage(fullMsg.info.role, text, false, !!fullMsg.info.error, false, false, fullMsg.info, null, reasoningParts, todoParts);
                                }
                            } else {
                                // Fallback to text-only message
                                const msgError = data.message?.error;
                                addMessage('assistant', finalContent || (msgError ? `❌ Error: ${msgError.message}` : '(No content)'), false, !!msgError, false, false, data.message || {});
                            }
                        })
                        .catch(err => {
                            console.error('Failed to fetch full message:', err);
                            const msgError = data.message?.error;
                            addMessage('assistant', finalContent || (msgError ? `❌ Error: ${msgError.message}` : '(No content)'), false, !!msgError, false, false, data.message || {});
                        });
                } else {
                    const msgError = data.message?.error;
                    addMessage('assistant', finalContent || (msgError ? `❌ Error: ${msgError.message}` : '(No content)'), false, !!msgError, false, false, data.message || {});
                }
                
                messageBuffer.delete(finalID);
                removeTypingIndicator('assistant-typing');
                
                // Don't hide liveness row - it will update based on session status
                // (The session.status event will handle showing idle state)
                
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
                
                // Set paused flag and update display
                isQuestionPaused = true;
                updateLivenessDisplay('paused');
                
                // Pause liveness monitoring while waiting for user answer
                if (currentSession && currentSession.id) {
                    fetch(`/api/session/${currentSession.id}/liveness/pause`, { method: 'POST' })
                        .catch(err => console.error('Failed to pause liveness:', err));
                }
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
            case 'session.liveness':
                handleSessionLiveness(data);
                break;
            case 'session.retry.start':
                handleRetryStart(data);
                break;
            case 'session.retry.success':
                handleRetrySuccess(data);
                break;
            case 'session.retry.failed':
                handleRetryFailed(data);
                break;
            case 'session.sync.complete':
                handleSyncComplete(data);
                break;
        }
    };
    
    ws.onclose = () => {
        // Don't alarm the user, just start reconnection loop
        console.log('[WebSocket] Connection closed, attempting to reconnect...');
        
        if (isReconnecting) {
            // Already in reconnection loop, don't start another
            return;
        }
        
        isReconnecting = true;
        attemptReconnect();
    };
    
    ws.onerror = (error) => {
        console.error('[WebSocket] Error occurred:', error);
        // Don't show error to user, auto-reconnect will handle it
    };
}

function attemptReconnect() {
    if (!isReconnecting) return;
    
    // Calculate delay with exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
    const baseDelay = 1000;
    const delay = Math.min(baseDelay * Math.pow(2, reconnectAttempts), maxReconnectDelay);
    
    reconnectAttempts++;
    
    console.log(`[WebSocket] Reconnect attempt ${reconnectAttempts} in ${delay}ms...`);
    updateStatus('warning', `Reconnecting (attempt ${reconnectAttempts})...`);
    
    reconnectTimeout = setTimeout(() => {
        if (!isReconnecting) return;
        
        console.log(`[WebSocket] Executing reconnect attempt ${reconnectAttempts}...`);
        connectWebSocket();
    }, delay);
}

async function syncSessionState(sessionID) {
    if (!sessionID) return;
    try {
        const response = await fetch(`/api/session/${sessionID}/messages?limit=20`);
        if (!response.ok) throw new Error('Failed to fetch messages');
        const messages = await safeJson(response) || [];
        
        // Sort messages by creation time (oldest first)
        messages.sort((a, b) => {
            const timeA = a.info?.time?.created || 0;
            const timeB = b.info?.time?.created || 0;
            return timeA - timeB;
        });
        
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
        
        // Reset reconnection state and attempt immediate connection
        isReconnecting = false;
        reconnectAttempts = 0;
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
        
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
                items.forEach(a => { const opt = document.createElement('option'); opt.value = a.name; opt.textContent = a.name; select.appendChild(opt); });
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
            // loadSessionHistory(currentSession.id); - No longer needed with WebSocket rehydration
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
        
        // Filter out tool/subagent sessions
        const filteredSessions = sessionsData.filter(s => {
            // Keep sessions with a projectID (user sessions)
            // Filter out sessions with agent names indicating subagent/tool sessions
            const subagentNames = ['task', 'explore', 'general', 'sentinel', 'janos', 'sculptor', 'kofi', 'architect'];
            const isSubagent = s.agent && subagentNames.some(name => s.agent.toLowerCase().includes(name.toLowerCase()));
            const hasNoProject = !s.projectID && !s.directory;
            
            // Keep session if it has a project OR if it's not a subagent
            return s.projectID || s.directory || !isSubagent;
        });
        
        sessionList.innerHTML = '';
        if (filteredSessions.length === 0) { sessionList.innerHTML = '<div style="padding: 20px; text-align: center; color: #90949c;">No sessions found</div>'; return; }
        
        // Sort sessions by time.updated descending (most recent first)
        filteredSessions.sort((a, b) => {
            const timeA = a.time?.updated || a.time?.created || 0;
            const timeB = b.time?.updated || b.time?.created || 0;
            return timeB - timeA;
        });
        
        const groups = {};
        filteredSessions.forEach(s => {
            const d = new Date(s.time.updated).toDateString();
            if (!groups[d]) groups[d] = []; groups[d].push(s);
        });
        
        // Sort date groups by most recent first
        const sortedDates = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));
        
        sortedDates.forEach(d => {
            const ss = groups[d];
            const h = document.createElement('div'); h.className = 'session-group-header'; h.textContent = d; sessionList.appendChild(h);
            ss.forEach(s => {
                const item = document.createElement('div'); item.className = 'session-item';
                const status = sessionStatuses.get(s.id) || 'idle';
                
                // Status indicator with color
                let statusIndicator = '';
                let statusText = '';
                if (status === 'busy') {
                    statusIndicator = '<span class="session-busy-indicator">●</span>';
                    statusText = '<span class="session-status-text" style="color: #3b82f6;">busy</span>';
                } else if (status === 'error') {
                    statusIndicator = '<span class="session-busy-indicator" style="color: #ef4444;">●</span>';
                    statusText = '<span class="session-status-text" style="color: #ef4444;">error</span>';
                } else {
                    statusText = '<span class="session-status-text" style="color: #10b981;">idle</span>';
                }
                
                // Format last updated time
                const updatedDate = new Date(s.time.updated);
                const now = new Date();
                const diffMs = now - updatedDate;
                const diffMins = Math.floor(diffMs / 60000);
                const diffHours = Math.floor(diffMs / 3600000);
                const diffDays = Math.floor(diffMs / 86400000);
                
                let lastUpdated = '';
                if (diffMins < 1) lastUpdated = 'just now';
                else if (diffMins < 60) lastUpdated = `${diffMins}m ago`;
                else if (diffHours < 24) lastUpdated = `${diffHours}h ago`;
                else if (diffDays === 1) lastUpdated = 'yesterday';
                else lastUpdated = updatedDate.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
                
                // Build session item with enhanced info
                item.innerHTML = `
                    <div class="session-item-title">${statusIndicator}${s.title || s.id.substring(0, 12)}</div>
                    <div class="session-item-meta">
                        ${statusText} • ${lastUpdated}
                    </div>
                `;
                item.onclick = () => connectToSession(s); sessionList.appendChild(item);
            });
        });
    } catch (e) { sessionList.innerHTML = 'Error: ' + e.message; }
}

async function connectToSession(session) {
    console.log('[UI] Connecting to session:', session.id);
    
    // Enable history loading mode
    isLoadingHistory = true;
    historicalEventQueue = [];
    processedHistoricalEvents = 0;
    expectedHistoricalEvents = 0;
    syncCompleteReceived = false;
    
    // Show loading modal
    if (loadingModal) loadingModal.style.display = 'block';
    if (loadingText) loadingText.textContent = 'Connecting to session...';
    if (progressFill) progressFill.style.width = '0%';
    if (loadingStats) loadingStats.textContent = '0 / 0';
    
    // Disable user input during loading
    disableUserInput();
    
    currentSession = session;
    currentSessionID = session.id;
    currentDrawerSession = session.id;

    // Reset historical tracking
    historicalMessages.clear();
    historicalParts.clear();
    
    // Update session name display
    updateSessionNameDisplay();
    
    // Reset Files tab for new session
    expandedDiffs.clear();
    const diffs = sessionDiffs.get(session.id) || [];
    updateFilesBadge(diffs.length);
    if (isFilesTabActive()) {
        renderFilesTab(diffs);
    }
    
    // Clear messages container
    if (messagesContainer) messagesContainer.innerHTML = '';
    
    try {
        // Subscribe to WebSocket updates - this triggers server-side sync (rehydration)
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe', sessionID: session.id }));
        } else {
            // If socket not open, connect and it will subscribe on open
            connectWebSocket();
        }
        
        updateStatus('idle'); 
        if (settingsModal) settingsModal.classList.remove('active');
        
        // Don't hide loading modal - will be hidden after processing events
        
    } catch (e) { 
        addEvent('Error', 'Connect failed: ' + e.message);
        if (loadingText) loadingText.textContent = 'Error: ' + e.message;
        setTimeout(() => {
            if (loadingModal) loadingModal.style.display = 'none';
            enableUserInput();
            isLoadingHistory = false;
        }, 2000);
    }
}

async function loadSessionHistory(id) {
    try {
        const response = await fetch(`/api/session/${id}/messages?limit=20`);
        if (!response.ok) throw new Error('Failed to fetch history');
        const msgs = await safeJson(response) || [];
        
        // Sort messages by creation time (oldest first)
        msgs.sort((a, b) => {
            const timeA = a.info?.time?.created || 0;
            const timeB = b.info?.time?.created || 0;
            return timeA - timeB;
        });
        
        msgs.forEach(msg => {
            const textParts = msg.parts.filter(p => p.type === 'text');
            const reasoningParts = msg.parts.filter(p => p.type === 'reasoning');
            const todoParts = msg.parts.filter(p => p.type === 'tool' && p.tool === 'todowrite');
            const text = textParts.map(p => p.text).join('\n');
            
            // Log all messages to Events tab
            addEvent('Load Message', {
                source: 'loadSessionHistory',
                messageID: msg.info.id,
                role: msg.info.role,
                totalParts: msg.parts.length,
                textParts: textParts.length,
                reasoningParts: reasoningParts.length,
                todoParts: todoParts.length,
                hasText: !!text,
                partTypes: msg.parts.map(p => p.type),
                modelID: msg.info.modelID,
                agent: msg.info.agent
            });
            
            if (text || reasoningParts.length > 0 || todoParts.length > 0) {
                addMessage(msg.info.role, text, false, !!msg.info.error, false, false, msg.info, null, reasoningParts, todoParts);
            }
        });
    } catch (e) { console.error('History load failed:', e); }
}

// Favorites Management
function toggleFavorite(messageID, text, role) {
    if (favoriteMessages.has(messageID)) {
        favoriteMessages.delete(messageID);
    } else {
        favoriteMessages.set(messageID, {
            id: messageID,
            text: text,
            role: role,
            timestamp: Date.now()
        });
    }
    
    // Save to localStorage
    try {
        localStorage.setItem('favoriteMessages', JSON.stringify(Array.from(favoriteMessages.values())));
    } catch (e) {
        console.error('Failed to save favorites:', e);
    }
    
    // Update UI
    updateFavoriteButton(messageID);
}

function updateFavoriteButton(messageID) {
    const btn = document.querySelector(`#msg-${messageID} .favorite-btn`);
    if (btn) {
        btn.textContent = favoriteMessages.has(messageID) ? '⭐' : '☆';
        btn.classList.toggle('favorited', favoriteMessages.has(messageID));
    }
}

function showFavoritesModal() {
    if (!favoritesModal || !favoritesList) return;
    
    favoritesList.innerHTML = '';
    
    if (favoriteMessages.size === 0) {
        favoritesList.innerHTML = '<div class="favorites-empty">No favorite messages yet. Star messages to save them here!</div>';
    } else {
        const favorites = Array.from(favoriteMessages.values()).sort((a, b) => b.timestamp - a.timestamp);
        favorites.forEach(fav => {
            const item = document.createElement('div');
            item.className = 'favorite-item';
            
            const header = document.createElement('div');
            header.className = 'favorite-item-header';
            header.innerHTML = `
                <span>${fav.role === 'user' ? '👤 User' : '🤖 Assistant'}</span>
                <button class="favorite-item-remove" onclick="event.stopPropagation(); removeFavorite('${fav.id}')">✕</button>
            `;
            
            const content = document.createElement('div');
            content.className = 'favorite-item-content';
            content.textContent = fav.text;
            
            item.appendChild(header);
            item.appendChild(content);
            
            item.addEventListener('click', () => {
                sendFavoriteMessage(fav.text);
            });
            
            favoritesList.appendChild(item);
        });
    }
    
    // Load notes when modal opens
    loadNotes('session');
    loadNotes('global');
    
    favoritesModal.classList.add('active');
}

function removeFavorite(messageID) {
    favoriteMessages.delete(messageID);
    try {
        localStorage.setItem('favoriteMessages', JSON.stringify(Array.from(favoriteMessages.values())));
    } catch (e) {
        console.error('Failed to save favorites:', e);
    }
    updateFavoriteButton(messageID);
    showFavoritesModal(); // Refresh the modal
}

async function sendFavoriteMessage(text) {
    if (favoritesModal) favoritesModal.classList.remove('active');
    if (messageInput) messageInput.value = text;
    await sendMessage();
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

// ============================================================================
// NOTES FUNCTIONALITY
// ============================================================================

// Load notes from server
async function loadNotes(scope = 'session') {
    try {
        const sessionID = scope === 'session' ? currentSession?.id : null;
        const params = sessionID ? `?sessionID=${sessionID}` : '';
        const response = await fetch(`/api/notes${params}`);
        if (!response.ok) throw new Error('Failed to load notes');
        const notes = await safeJson(response) || [];
        
        if (scope === 'session') {
            notesCache.session = notes;
        } else {
            notesCache.global = notes;
        }
        
        renderNotesList();
    } catch (error) {
        console.error('Failed to load notes:', error);
        showToast('Failed to load notes', 'error');
    }
}

// Render notes list
function renderNotesList() {
    if (!notesList) return;
    
    const notes = currentNotesScope === 'session' ? notesCache.session : notesCache.global;
    
    if (notes.length === 0) {
        notesList.innerHTML = '<div class="notes-empty">No notes yet. Create your first note!</div>';
        return;
    }
    
    notesList.innerHTML = '';
    notes.sort((a, b) => b.updated - a.updated).forEach(note => {
        const item = document.createElement('div');
        item.className = 'note-item';
        
        const header = document.createElement('div');
        header.className = 'note-item-header';
        
        const title = document.createElement('div');
        title.className = 'note-item-title';
        title.textContent = note.title || 'Untitled Note';
        
        const scope = document.createElement('span');
        scope.className = 'note-item-scope';
        scope.textContent = note.sessionID ? '📌 Session' : '🌐 Global';
        
        header.appendChild(title);
        header.appendChild(scope);
        
        const content = document.createElement('div');
        content.className = 'note-item-content';
        const plainText = stripHtml(note.content);
        content.textContent = plainText || 'Empty note';
        
        const footer = document.createElement('div');
        footer.className = 'note-item-footer';
        const date = document.createElement('span');
        date.className = 'note-item-date';
        date.textContent = formatNoteDate(note.updated);
        footer.appendChild(date);
        
        item.appendChild(header);
        item.appendChild(content);
        item.appendChild(footer);
        
        item.addEventListener('click', () => openNote(note));
        notesList.appendChild(item);
    });
}

// Format note date
function formatNoteDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

// Strip HTML tags for preview
function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
}

// Open note for editing
function openNote(note) {
    currentNoteID = note.id;
    
    if (noteTitle) noteTitle.value = note.title || '';
    if (noteEditor) noteEditor.innerHTML = note.content || '';
    if (noteSessionScope) noteSessionScope.checked = !!note.sessionID;
    
    if (notesModal) {
        notesModal.classList.add('active');
        const modalTitle = document.getElementById('notesModalTitle');
        if (modalTitle) modalTitle.textContent = '📝 Edit Note';
        if (deleteNoteBtn) deleteNoteBtn.style.display = 'block';
    }
    
    // Close favorites modal
    if (favoritesModal) favoritesModal.classList.remove('active');
}

// Create new note
function createNewNote() {
    currentNoteID = null;
    
    if (noteTitle) noteTitle.value = '';
    if (noteEditor) noteEditor.innerHTML = '';
    if (noteSessionScope) noteSessionScope.checked = currentNotesScope === 'session';
    
    if (notesModal) {
        notesModal.classList.add('active');
        const modalTitle = document.getElementById('notesModalTitle');
        if (modalTitle) modalTitle.textContent = '📝 New Note';
        if (deleteNoteBtn) deleteNoteBtn.style.display = 'none';
    }
    
    // Focus title input
    if (noteTitle) noteTitle.focus();
}

// Save note
async function saveNote() {
    try {
        const title = noteTitle?.value?.trim() || 'Untitled Note';
        const content = noteEditor?.innerHTML || '';
        const sessionID = noteSessionScope?.checked ? currentSession?.id : null;
        
        if (!content.trim()) {
            showToast('Note content cannot be empty', 'error');
            return;
        }
        
        if (currentNoteID) {
            // Update existing note
            const response = await fetch(`/api/notes/${currentNoteID}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content })
            });
            
            if (!response.ok) throw new Error('Failed to update note');
            showToast('Note updated!', 'success');
        } else {
            // Create new note
            const response = await fetch('/api/notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, content, sessionID })
            });
            
            if (!response.ok) throw new Error('Failed to create note');
            showToast('Note saved!', 'success');
        }
        
        // Reload notes
        await loadNotes('session');
        await loadNotes('global');
        
        // Close modal
        if (notesModal) notesModal.classList.remove('active');
    } catch (error) {
        console.error('Failed to save note:', error);
        showToast('Failed to save note', 'error');
    }
}

// Delete note
async function deleteNote() {
    if (!currentNoteID) return;
    
    if (!confirm('Are you sure you want to delete this note?')) return;
    
    try {
        const response = await fetch(`/api/notes/${currentNoteID}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Failed to delete note');
        
        showToast('Note deleted', 'success');
        
        // Reload notes
        await loadNotes('session');
        await loadNotes('global');
        
        // Close modal
        if (notesModal) notesModal.classList.remove('active');
    } catch (error) {
        console.error('Failed to delete note:', error);
        showToast('Failed to delete note', 'error');
    }
}

// Send note as prompt
async function sendNoteAsPrompt() {
    const content = noteEditor?.innerHTML || '';
    const plainText = stripHtml(content);
    
    if (!plainText.trim()) {
        showToast('Note is empty', 'error');
        return;
    }
    
    // Close notes modal
    if (notesModal) notesModal.classList.remove('active');
    
    // Set the content in the message input
    if (editorMode === 'rich') {
        if (richEditor) richEditor.innerHTML = content;
    } else {
        if (messageInput) messageInput.value = plainText;
    }
    
    // Send the message
    await sendMessage();
}

// Save current prompt to notes
async function savePromptToNotes() {
    const content = editorMode === 'rich' 
        ? (richEditor?.innerHTML || '') 
        : (messageInput?.value || '');
    
    if (!content.trim()) {
        showToast('Nothing to save', 'error');
        return;
    }
    
    // Set the content in note editor
    if (noteEditor) noteEditor.innerHTML = editorMode === 'rich' ? content : content;
    if (noteTitle) noteTitle.value = '';
    if (noteSessionScope) noteSessionScope.checked = true;
    
    currentNoteID = null;
    
    if (notesModal) {
        notesModal.classList.add('active');
        const modalTitle = document.getElementById('notesModalTitle');
        if (modalTitle) modalTitle.textContent = '📝 Save to Notes';
        if (deleteNoteBtn) deleteNoteBtn.style.display = 'none';
    }
    
    // Focus title input
    if (noteTitle) noteTitle.focus();
}

// Notes modal event listeners
if (closeNotes) {
    closeNotes.addEventListener('click', () => {
        if (notesModal) notesModal.classList.remove('active');
    });
}

if (newNoteBtn) {
    newNoteBtn.addEventListener('click', createNewNote);
}

if (saveNoteBtn) {
    saveNoteBtn.addEventListener('click', saveNote);
}

if (sendNoteBtn) {
    sendNoteBtn.addEventListener('click', sendNoteAsPrompt);
}

if (deleteNoteBtn) {
    deleteNoteBtn.addEventListener('click', deleteNote);
}

if (saveToNotesBtn) {
    saveToNotesBtn.addEventListener('click', savePromptToNotes);
}

if (saveToNotesRichBtn) {
    saveToNotesRichBtn.addEventListener('click', savePromptToNotes);
}

// Notes scope toggle
document.querySelectorAll('.scope-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const scope = btn.dataset.scope;
        if (scope && (scope === 'session' || scope === 'global')) {
            currentNotesScope = scope;
            document.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            loadNotes(scope);
        }
    });
});

// Favorites modal tabs
document.querySelectorAll('[data-favorites-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.favoritesTab;
        
        // Update tab buttons
        document.querySelectorAll('[data-favorites-tab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update tab content
        document.querySelectorAll('.favorites-tab-content').forEach(content => {
            content.classList.remove('active');
            content.style.display = 'none';
        });
        
        if (tab === 'favorites') {
            const favTab = document.getElementById('favoritesTab');
            if (favTab) {
                favTab.classList.add('active');
                favTab.style.display = 'block';
            }
        } else if (tab === 'notes') {
            const notesTab = document.getElementById('notesListTab');
            if (notesTab) {
                notesTab.classList.add('active');
                notesTab.style.display = 'block';
            }
            // Load notes when switching to notes tab
            loadNotes(currentNotesScope);
        }
    });
});

// Markdown formatting for note editor
if (noteEditor) {
    const noteToolbar = document.getElementById('noteMarkdownToolbar');
    if (noteToolbar) {
        noteToolbar.querySelectorAll('.md-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const format = btn.dataset.format;
                applyRichFormat(format, noteEditor);
            });
        });
    }
}

async function init() {
    console.log('[System] Initializing app...');
    applyStoredPreferences();
    
    // Initialize tools tab
    renderToolsList();
    
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
