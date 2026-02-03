import { EventEmitter } from 'events';
const { EventSource } = require('eventsource');

import { 
  ClientConfig, 
  Session, 
  SessionStatus, 
  SessionStatusType,
  Message, 
  BusEvent,
  AuthError,
  SessionErrorEvent,
  AgentInfo,
  GlobalConfig,
  ModelPriorityConfig,
  ProviderListResponse,
  ModelInfo,
  SessionSyncCompleteEvent
} from './types';

export class OctoolsClient extends EventEmitter {
  private config: ClientConfig;
  private es: EventSource | null = null;
  private lastServerHeartbeat: number = 0;
  private lastAIActivity: Map<string, number> = new Map();
  private sessionStatuses: Map<string, SessionStatusType> = new Map();
  private sessionModels: Map<string, { primary: any; secondary?: any; current: any }> = new Map();
  private lastUserPrompts: Map<string, { text: string; options?: any }> = new Map();
  public rawEvents: { timestamp: number; payload: any }[] = [];
  private static MAX_LOGS = 2000;
  
  // Liveness monitoring
  private livenessTimers: Map<string, any> = new Map();  // Use 'any' to avoid Timer type issues
  private sessionRetryAttempts: Map<string, number> = new Map();
  private readonly DEFAULT_LIVENESS_INTERVAL = 1000;  // 1 second
  private readonly DEFAULT_SESSION_TIMEOUT = 240000;  // 4 minutes (240 seconds)

  constructor(config: ClientConfig) {
    super();
    this.config = config;
    if (config.autoConnect) {
      this.connect();
    }
  }

  public async connect(): Promise<void> {
    if (this.es) return;

    const url = `${this.config.baseUrl}/event`;
    const headers: any = {};
    if (this.config.password) {
      const auth = Buffer.from(`opencode:${this.config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    return new Promise((resolve, reject) => {
      const es = new EventSource(url, { headers });
      this.es = es;

      es.onopen = () => {
        this.emit('connected');
        this.lastServerHeartbeat = Date.now();
        resolve();
      };

      es.onerror = (err: any) => {
        this.emit('error', err);
      };

      es.onmessage = (event: MessageEvent) => {
        this.handleEvent(event);
      };
    });
  }

  public disconnect(): void {
    if (this.es) {
      this.es.close();
      this.es = null;
      this.emit('disconnected');
    }
  }

  private handleEvent(event: MessageEvent) {
    this.lastServerHeartbeat = Date.now();
    
    try {
      const data = JSON.parse(event.data);
      // OpenCode returns { directory, payload: { type, properties } }
      const payload: BusEvent = data.payload || data;
      
      const sessionID = payload.properties?.sessionID || payload.properties?.info?.sessionID || payload.properties?.part?.sessionID;
      console.log(`[Octools] SSE Event: ${payload.type} (Session: ${sessionID}) - Raw: ${JSON.stringify(data).substring(0, 200)}`);
      
      // Raw logging
      this.rawEvents.push({ timestamp: Date.now(), payload });
      if (this.rawEvents.length > OctoolsClient.MAX_LOGS) {
        this.rawEvents.shift();
      }
      this.emit('raw.event', payload);

      const { type, properties } = payload;

      // Map to high-level events and track Liveness
      switch (type) {
        case 'server.connected':
        case 'server.heartbeat':
          // Just heartbeats, handled by lastServerHeartbeat update above
          break;

        case 'session.status':
          const { sessionID, status } = properties;
          const prevStatus = this.sessionStatuses.get(sessionID);
          this.sessionStatuses.set(sessionID, status.type);
          
          if (status.type === 'busy' || status.type === 'retry') {
             this.recordAIActivity(sessionID);
             // Start liveness monitoring when session becomes busy
             if (prevStatus !== 'busy' && status.type === 'busy') {
               this.startLivenessMonitoring(sessionID);
             }
          } else {
             // Stop liveness monitoring when session is no longer busy
             this.stopLivenessMonitoring(sessionID);
          }

          // Secondary model switching logic
          if (status.type === 'error' || status.type === 'retry') {
            const models = this.sessionModels.get(sessionID);
            if (models && models.secondary && JSON.stringify(models.current) !== JSON.stringify(models.secondary)) {
              models.current = models.secondary;
              this.emit('session.model_switched', {
                sessionID,
                model: models.secondary,
                reason: status.type
              });
              this.triggerAlternativeRetry(sessionID, status.type);
            }
          }
          
          this.emit('session.status', { sessionID, status: status.type, prevStatus, details: status });
          break;

        case 'message.part.updated':
          // { part: Part, delta?: string }
          if (properties.part && properties.part.sessionID) {
            this.recordAIActivity(properties.part.sessionID);
            
            // Handle subagent/task progress
            if (properties.part.type === 'tool' || properties.part.type === 'subtask') {
              const part = properties.part;
              const agent = part.metadata?.subagent_type || part.state?.agent || 'agent';
              const task = part.metadata?.description || part.state?.title || part.tool || 'working';
              const status = part.state?.status || 'running';

              this.emit('subagent.progress', {
                sessionID: part.sessionID,
                messageID: part.messageID,
                partID: part.id,
                agent,
                task,
                status
              });
            }
+           console.log(`[Octools] Emitting message.delta for session ${properties.part.sessionID}`);
            this.emit('message.delta', {
              sessionID: properties.part.sessionID,
              messageID: properties.part.messageID,
              partID: properties.part.id,
              delta: properties.delta,
              part: properties.part
            });
          }
          break;

        case 'message.updated':
           // { info: MessageInfo }
           if (properties.info) {
             if (properties.info.role === 'assistant') {
               this.recordAIActivity(properties.info.sessionID);
               if (properties.info.finish) {
                 this.emit('message.complete', {
                   sessionID: properties.info.sessionID,
                   messageID: properties.info.id,
                   message: properties.info
                 });
               }
             }
           }
           break;

        case 'question.asked':
          if (properties.sessionID) {
            this.recordAIActivity(properties.sessionID);
            this.emit('question', properties);
          }
          break;

        case 'permission.asked':
          if (properties.sessionID) {
             this.recordAIActivity(properties.sessionID);
             this.emit('permission', properties);
          }
          break;

        case 'session.error':
          if (properties.sessionID && properties.error) {
             const error = properties.error;
             // Check if it's an auth error (status 401 or specific name)
             const isAuthError = error.statusCode === 401 || error.name === 'ProviderAuthError' || error.name === 'AuthError';
             
             if (isAuthError) {
               this.emit('session.error.auth', {
                 sessionID: properties.sessionID,
                 error: new AuthError(error.message, error)
               });
             }
             
              this.emit('session.error', {
                sessionID: properties.sessionID,
                error: error,
                isAuthError
              });

               // Secondary model switching logic for errors
               if (properties.sessionID) {
                 const models = this.sessionModels.get(properties.sessionID);
                 if (models && models.secondary && JSON.stringify(models.current) !== JSON.stringify(models.secondary)) {
                   models.current = models.secondary;
                   this.emit('session.model_switched', {
                     sessionID: properties.sessionID,
                     model: models.secondary,
                     reason: 'error'
                   });
                   this.triggerAlternativeRetry(properties.sessionID, 'error');
                 }
               }
          }
          break;

        case 'session.diff':
          if (properties.sessionID && properties.diff) {
            this.emit('session.diff', {
              sessionID: properties.sessionID,
              diff: properties.diff
            });
          }
          break;

        case 'session.updated':
          if (properties.info) {
            this.emit('session.updated', {
              sessionID: properties.info.id,
              session: properties.info
            });
          }
          break;

        default:
          // Emit raw event for debugging or other types
          this.emit('event', payload);
          break;
      }

    } catch (e) {
      console.error('Failed to parse event', e);
    }
  }

  private recordAIActivity(sessionID: string) {
    this.lastAIActivity.set(sessionID, Date.now());
  }

  // --- API Methods ---

  private get headers() {
    const h: any = { 'Content-Type': 'application/json' };
    if (this.config.password) {
      const auth = Buffer.from(`opencode:${this.config.password}`).toString('base64');
      h['Authorization'] = `Basic ${auth}`;
    }
    return h;
  }

  public async createSession(options?: { 
    title?: string;
    agent?: string;
    directory?: string;
    model?: { providerID: string; modelID: string };
    secondaryModel?: { providerID: string; modelID: string };
  }): Promise<Session> {
    const res = await fetch(`${this.config.baseUrl}/session`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(options || {})
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new AuthError('Authentication failed: Unauthorized');
      }
      throw new Error(`Failed to create session: ${res.statusText}`);
    }
    const text = await res.text();
    const session = JSON.parse(text) as Session;
    
    // Store model config
    this.sessionModels.set(session.id, {
      primary: options?.model,
      secondary: options?.secondaryModel,
      current: options?.model
    });

    return session;
  }

  public async loadSession(sessionID: string): Promise<Session> {
    const res = await fetch(`${this.config.baseUrl}/session/${sessionID}`, {
      headers: this.headers
    });
    if (!res.ok) throw new Error(`Failed to load session: ${res.statusText}`);
    const text = await res.text();
    return JSON.parse(text) as Session;
  }

  public async updateSession(sessionID: string, updates: { title?: string }): Promise<Session> {
    const res = await fetch(`${this.config.baseUrl}/session/${sessionID}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify(updates)
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new AuthError('Authentication failed: Unauthorized');
      }
      throw new Error(`Failed to update session: ${res.statusText}`);
    }
    const text = await res.text();
    return JSON.parse(text) as Session;
  }

  public async listSessions(options?: { limit?: number; directory?: string; search?: string; start?: number }): Promise<Session[]> {
    const url = new URL(`${this.config.baseUrl}/session`);
    if (options?.limit) url.searchParams.set('limit', options.limit.toString());
    if (options?.directory) url.searchParams.set('directory', options.directory);
    if (options?.search) url.searchParams.set('search', options.search);
    if (options?.start) url.searchParams.set('start', options.start.toString());

    const res = await fetch(url.toString(), {
      headers: this.headers
    });
    if (!res.ok) throw new Error(`Failed to list sessions: ${res.statusText}`);
    const text = await res.text();
    return JSON.parse(text) as Session[];
  }

  public async getMessages(sessionID: string, options?: { limit?: number }): Promise<Message[]> {
     const url = new URL(`${this.config.baseUrl}/session/${sessionID}/message`);
     if (options?.limit) {
       url.searchParams.set('limit', options.limit.toString());
     }
     
     const res = await fetch(url.toString(), {
       headers: this.headers
     });
     
     if (!res.ok) throw new Error(`Failed to get messages: ${res.statusText}`);
     const text = await res.text();
     return JSON.parse(text) as Message[];
  }

  public async getDiffs(sessionID: string): Promise<any[]> {
    const res = await fetch(`${this.config.baseUrl}/session/${sessionID}/diff`, {
      headers: this.headers
    });
    if (!res.ok) throw new Error(`Failed to get diffs: ${res.statusText}`);
    return await res.json();
  }

  /**
   * Synchronizes a session by fetching its history and emitting synthetic events
   * to reconstruct the state. This is useful for clients connecting to an existing session.
   */
  public async syncSession(sessionID: string): Promise<void> {
    // 1. Fetch metadata, messages, and diffs in parallel for performance
    const [session, messages, diffs] = await Promise.all([
      this.loadSession(sessionID).catch(e => {
        console.warn(`[Octools] Could not fetch session metadata for ${sessionID}:`, e);
        return null;
      }),
      this.getMessages(sessionID).catch(e => {
        console.warn(`[Octools] Could not fetch messages for ${sessionID}:`, e);
        return [] as Message[];
      }),
      this.getDiffs(sessionID).catch(e => {
        console.warn(`[Octools] Could not fetch historical diffs for ${sessionID}:`, e);
        return [] as any[];
      })
    ]);

    // Store totals for sync completion event
    const totalMessages = messages.length;
    const totalDiffs = diffs.length;

    console.log(`[Octools] Sync session ${sessionID}: ${totalMessages} total messages, ${totalDiffs} total diffs`);

    // Apply rehydration limits: 12 hours OR 200 messages (whichever is smaller)
    const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000);
    
    // Sort messages by time (ensure chronological order)
    messages.sort((a, b) => a.info.time.created - b.info.time.created);
    
    // Filter by time, then limit to most recent 200
    const recentMessages = messages.filter(m => m.info.time.created >= twelveHoursAgo);
    const rehydratedMessages = recentMessages.slice(-200);
    
    // Apply same 200-limit to diffs (diffs don't have reliable timestamps)
    const rehydratedDiffs = diffs.slice(-200);

    console.log(`[Octools] Rehydration limits applied: ${rehydratedMessages.length}/${totalMessages} messages (${recentMessages.length} within 12h), ${rehydratedDiffs.length}/${totalDiffs} diffs`);

    // 2. Baseline state: Session metadata
    if (session) {
      // Update internal status trackers
      this.sessionStatuses.set(sessionID, 'idle'); // History is usually for inactive or catch-up
      this.sessionModels.set(sessionID, {
        primary: session.model,
        secondary: session.secondaryModel,
        current: session.model
      });

      this.emit('session.updated', {
        sessionID,
        session,
        historical: true
      });
    }

    // 3. Baseline state: Diffs (limited)
    for (const diff of rehydratedDiffs) {
      this.emit('session.diff', {
        sessionID,
        diff,
        historical: true
      });
    }

    // 4. Conversation Replay (limited)
    for (const msg of rehydratedMessages) {
      for (const part of msg.parts) {
        // Step 4.1: Handle subagent/task progress for tool/subtask parts
        if (part.type === 'tool' || part.type === 'subtask') {
          const agent = part.metadata?.subagent_type || part.state?.agent || 'agent';
          const task = part.metadata?.description || part.state?.title || part.tool || 'working';
          const status = part.state?.status || 'running';

          this.emit('subagent.progress', {
            sessionID,
            messageID: msg.info.id,
            partID: part.id,
            agent,
            task,
            status,
            historical: true
          });
        }

        // Step 4.2: Emit delta for the full content of the historical part
        // Text, Reasoning, and Tool inputs/outputs are all emitted here
        this.emit('message.delta', {
          sessionID,
          messageID: msg.info.id,
          partID: part.id,
          delta: part.text || '', 
          part: part,
          historical: true
        });
      }

      // Step 4.3: Signal message completion with full parts array
      if (msg.info.finish || msg.info.time.completed) {
        this.emit('message.complete', {
          sessionID,
          messageID: msg.info.id,
          message: msg.info,
          parts: msg.parts,  // Include full parts array to avoid frontend API calls
          historical: true
        });
      }
    }

    // 5. Emit sync completion event
    console.log(`[Octools] Emitting session.sync.complete for ${sessionID}`);
    this.emit('session.sync.complete', {
      sessionID,
      totalMessages,
      rehydratedMessages: rehydratedMessages.length,
      totalDiffs,
      rehydratedDiffs: rehydratedDiffs.length
    });
  }

  public async sendMessage(sessionID: string, text: string, options?: { 
    agent?: string; 
    model?: { providerID: string; modelID: string };
    system?: string;
  }): Promise<Message> {
    // Save last user prompt for alternative model retry
    this.lastUserPrompts.set(sessionID, { text, options });

    const models = this.sessionModels.get(sessionID);
    const activeModel = options?.model || models?.current;

    const body: any = { 
      parts: [{ type: 'text', text }]
    };
    if (options?.agent) body.agent = options.agent;
    if (activeModel) body.model = activeModel;
    if (options?.system) body.system = options.system;

    console.log(`[Octools] POST /session/${sessionID}/message body:`, JSON.stringify(body));

    const res = await fetch(`${this.config.baseUrl}/session/${sessionID}/message`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new AuthError('Authentication failed: Unauthorized');
      }
      const errorText = await res.text();
      console.error(`[Octools] Send message failed: ${res.status} ${res.statusText} - ${errorText}`);
      throw new Error(`Failed to send message: ${res.statusText} - ${errorText}`);
    }
    
    // API returns the created assistant message (initial state)
    console.log(`[Octools] Message sent, awaiting response body...`);
    const textRes = await res.text();
    console.log(`[Octools] Raw response received (${textRes.length} bytes)`);
    try {
      return JSON.parse(textRes) as Message;
    } catch (e: any) {
      console.error(`[Octools] Failed to parse response as JSON. Error: ${e.message}`);
      console.error(`[Octools] Raw content: "${textRes}"`);
      // If it's empty but the request was successful, return a dummy message
      if (!textRes) return { parts: [], info: { role: 'assistant', id: 'unknown' } } as any;
      throw new Error(`Invalid JSON response: ${textRes.substring(0, 100)}`);
    }
  }

  private async triggerAlternativeRetry(sessionID: string, reason: string) {
    const lastPrompt = this.lastUserPrompts.get(sessionID);
    if (!lastPrompt) return;

    const models = this.sessionModels.get(sessionID);
    if (!models || !models.current) return;

    const modelName = models.current.modelID || 'alternative model';
    
    this.emit('session.retrying_alternative', {
      sessionID,
      model: models.current,
      text: lastPrompt.text,
      reason
    });

    console.log(`[Octools] Automatically retrying last prompt with alternative model: ${modelName}`);
    
    try {
      // Abort first to stop the current stuck retry/generation
      console.log(`[Octools] Aborting session ${sessionID} before alternative retry`);
      await this.abortSession(sessionID).catch((e: any) => console.warn(`[Octools] Abort failed (might already be stopped):`, e.message));
      
      // Wait a bit for the session to settle
      await new Promise(resolve => setTimeout(resolve, 500));

      // Use sendMessage without the original model option to ensure it uses models.current
      const options = { ...lastPrompt.options };
      delete options.model;
      
      await this.sendMessage(sessionID, lastPrompt.text, options);
    } catch (e) {
      console.error(`[Octools] Failed to auto-retry with alternative model`, e);
    }
  }

  public async sendMessageAndWait(sessionID: string, text: string): Promise<Message> {
    // 1. Send the message
    await this.sendMessage(sessionID, text);

    // 2. Wait for status to become idle
    // We poll check status or wait for event?
    // We can use a one-time listener or a promise wrapper around the event emitter.
    
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const status = this.getSessionStatus(sessionID);
        if (status === 'idle') {
           cleanup();
           // Fetch the latest message
           this.getLatestAssistantMessage(sessionID).then(resolve).catch(reject);
        } else if (status === 'error') {
           cleanup();
           reject(new Error('Session entered error state'));
        }
      }, 200);

      const cleanup = () => {
        clearInterval(checkInterval);
        this.off('session.status', statusListener);
      };

      // Also listen for events to trigger immediate check (optimization)
      const statusListener = (event: any) => {
        if (event.sessionID === sessionID) {
           if (event.status === 'idle') {
             cleanup();
             this.getLatestAssistantMessage(sessionID).then(resolve).catch(reject);
           }
           if (event.status === 'error') {
             cleanup();
             reject(new Error('Session entered error state'));
           }
        }
      };
      
      this.on('session.status', statusListener);
    });
  }

  private async getLatestAssistantMessage(sessionID: string): Promise<Message> {
    // Fetch messages with limit 5 (should be enough to find the last assistant msg)
    const messages = await this.getMessages(sessionID, { limit: 5 });
    // Messages are returned oldest -> newest (based on my research of `session/index.ts` reversing them)
    // So we look at the end.
    
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].info.role === 'assistant') {
        return messages[i];
      }
    }
    throw new Error('No assistant message found after wait');
  }

  public async replyToQuestion(requestID: string, answers: any[]): Promise<void> {
    console.log(`[Octools] Replying to question ${requestID} with:`, JSON.stringify(answers));
    const res = await fetch(`${this.config.baseUrl}/question/${requestID}/reply`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ answers })
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[Octools] Reply failed: ${res.status} ${res.statusText} - ${errorText}`);
      throw new Error(`Failed to reply to question: ${res.statusText} - ${errorText}`);
    }
    console.log(`[Octools] Reply success`);
  }

  public async abortSession(sessionID: string): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/session/${sessionID}/abort`, {
      method: 'POST',
      headers: this.headers
    });
    if (!res.ok) throw new Error(`Failed to abort session: ${res.statusText}`);
  }

  public async grantPermission(requestID: string, approved: boolean): Promise<void> {
    const res = await fetch(`${this.config.baseUrl}/permission/${requestID}/reply`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ reply: approved ? 'allow' : 'deny' })
    });
    if (!res.ok) {
       throw new Error(`Failed to grant permission: ${res.statusText}`);
    }
  }

  // --- Monitoring ---

  public getSessionStatus(sessionID: string): SessionStatusType {
    return this.sessionStatuses.get(sessionID) || 'idle';
  }

  public isConnected(): boolean {
    return this.es?.readyState === 1; // 1 = OPEN
  }

  public isConnectionHealthy(thresholdMs: number = 35000): boolean {
    if (!this.isConnected()) return false;
    return (Date.now() - this.lastServerHeartbeat) < thresholdMs;
  }

  public isSessionResponsive(sessionID: string, thresholdMs: number = 10000): boolean {
    const status = this.getSessionStatus(sessionID);
    if (status !== 'busy' && status !== 'retry') return true; // Not busy, so responsiveness is N/A (or true)
    
    const lastActivity = this.lastAIActivity.get(sessionID) || 0;
    if (lastActivity === 0) return true; // No activity yet is considered responsive
    
    const timeSinceActivity = Date.now() - lastActivity;
    return timeSinceActivity < thresholdMs;
  }

  // --- Liveness Monitoring ---

  private startLivenessMonitoring(sessionID: string): void {
    // Clean up any existing timer
    this.stopLivenessMonitoring(sessionID);
    
    const interval = this.config.livenessCheckInterval || this.DEFAULT_LIVENESS_INTERVAL;
    const timeout = this.config.sessionTimeout || this.DEFAULT_SESSION_TIMEOUT;
    
    console.log(`[Octools] Starting liveness monitoring for session ${sessionID} (interval: ${interval}ms, timeout: ${timeout}ms)`);
    
    const timer = setInterval(() => {
      this.checkSessionLiveness(sessionID, timeout);
    }, interval);
    
    this.livenessTimers.set(sessionID, timer);
  }

  private stopLivenessMonitoring(sessionID: string): void {
    const timer = this.livenessTimers.get(sessionID);
    if (timer) {
      clearInterval(timer);
      this.livenessTimers.delete(sessionID);
      console.log(`[Octools] Stopped liveness monitoring for session ${sessionID}`);
    }
  }

  private checkSessionLiveness(sessionID: string, timeoutMs: number): void {
    const status = this.getSessionStatus(sessionID);
    
    // Only check liveness for busy sessions
    if (status !== 'busy') {
      this.stopLivenessMonitoring(sessionID);
      return;
    }
    
    const lastActivity = this.lastAIActivity.get(sessionID) || Date.now();
    const timeSinceActivity = Date.now() - lastActivity;
    const secondsSinceLastEvent = Math.floor(timeSinceActivity / 1000);
    const isStale = timeSinceActivity >= timeoutMs;
    
    // Emit liveness event
    this.emit('session.liveness', {
      sessionID,
      secondsSinceLastEvent,
      isStale
    });
    
    // Handle timeout
    if (isStale) {
      console.log(`[Octools] Session ${sessionID} timed out after ${secondsSinceLastEvent} seconds`);
      this.handleSessionTimeout(sessionID);
    }
  }

  private async handleSessionTimeout(sessionID: string): Promise<void> {
    // Stop monitoring during retry
    this.stopLivenessMonitoring(sessionID);
    
    // Track retry attempts
    const attempts = (this.sessionRetryAttempts.get(sessionID) || 0) + 1;
    this.sessionRetryAttempts.set(sessionID, attempts);
    
    // Emit retry start event
    this.emit('session.retry.start', {
      sessionID,
      reason: 'timeout',
      attemptNumber: attempts
    });
    
    try {
      // Abort current session
      console.log(`[Octools] Aborting stalled session ${sessionID}`);
      await this.abortSession(sessionID);
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Get the last user prompt
      const lastPrompt = this.lastUserPrompts.get(sessionID);
      if (!lastPrompt) {
        throw new Error('No last prompt found for retry');
      }
      
      // Resend the message
      console.log(`[Octools] Retrying message for session ${sessionID}`);
      await this.sendMessage(sessionID, lastPrompt.text, lastPrompt.options);
      
      // Success - reset retry counter
      this.sessionRetryAttempts.set(sessionID, 0);
      
      // Emit success event
      this.emit('session.retry.success', { sessionID });
      
    } catch (error: any) {
      console.error(`[Octools] Retry failed for session ${sessionID}: ${error.message}`);
      
      // Emit failure event
      this.emit('session.retry.failed', {
        sessionID,
        error: error.message
      });
      
      // Update session status
      this.sessionStatuses.set(sessionID, 'error');
    }
  }

  // --- Public Liveness Control Methods ---

  /**
   * Pause liveness monitoring for a session (e.g., when user is answering a question)
   * This stops the timer from firing and prevents automatic retries
   */
  public pauseLivenessMonitoring(sessionID: string): void {
    this.stopLivenessMonitoring(sessionID);
    console.log(`[Octools] Liveness monitoring paused for session ${sessionID}`);
  }

  /**
   * Resume liveness monitoring for a session (e.g., after user answers a question)
   * This restarts the timer and countdown
   */
  public resumeLivenessMonitoring(sessionID: string): void {
    const status = this.getSessionStatus(sessionID);
    if (status === 'busy') {
      // Reset the last activity time to now so countdown starts fresh
      this.recordAIActivity(sessionID);
      this.startLivenessMonitoring(sessionID);
      console.log(`[Octools] Liveness monitoring resumed for session ${sessionID}`);
    }
  }

  // --- Agent Management Methods ---

  /**
   * Get list of all available agents
   */
  public async getAgents(): Promise<AgentInfo[]> {
    const response = await fetch(`${this.config.baseUrl}/agent`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get agents: ${response.statusText}`);
    }

    return await response.json();
  }

  // --- Global Config Management Methods ---

  /**
   * Get global configuration
   */
  public async getGlobalConfig(): Promise<GlobalConfig> {
    const response = await fetch(`${this.config.baseUrl}/global/config`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get global config: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Update global configuration
   */
  public async updateGlobalConfig(config: Partial<GlobalConfig>): Promise<GlobalConfig> {
    const response = await fetch(`${this.config.baseUrl}/global/config`, {
      method: 'PATCH',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });

    if (!response.ok) {
      throw new Error(`Failed to update global config: ${response.statusText}`);
    }

    return await response.json();
  }

  // --- Provider/Model Management Methods ---

  /**
   * Get all providers and models
   */
  public async getProviders(): Promise<ProviderListResponse> {
    const response = await fetch(`${this.config.baseUrl}/provider`, {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to get providers: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get flat list of all models across all providers
   */
  public async getModels(): Promise<ModelInfo[]> {
    const providers = await this.getProviders();
    const models: ModelInfo[] = [];

    for (const provider of providers.all) {
      for (const model of Object.values(provider.models)) {
        models.push(model);
      }
    }

    return models;
  }

  // --- Model Priority Management Methods ---

  /**
   * Get model priority configuration
   */
  public async getModelPriority(): Promise<ModelPriorityConfig> {
    const config = await this.getGlobalConfig();
    return config.model_priority || { enabled: false, models: [] };
  }

  /**
   * Set model priority configuration
   */
  public async setModelPriority(priority: ModelPriorityConfig): Promise<void> {
    await this.updateGlobalConfig({
      model_priority: priority
    });
  }

  /**
   * Helper to get auth headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.password) {
      const auth = Buffer.from(`opencode:${this.config.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }
    return headers;
  }
}
