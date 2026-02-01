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
  SessionErrorEvent
} from './types';

export class OctoolsClient extends EventEmitter {
  private config: ClientConfig;
  private es: EventSource | null = null;
  private lastServerHeartbeat: number = 0;
  private lastAIActivity: Map<string, number> = new Map();
  private sessionStatuses: Map<string, SessionStatusType> = new Map();

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
      const payload: BusEvent = JSON.parse(event.data);
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
    return res.json() as Promise<Session>;
  }

  public async loadSession(sessionID: string): Promise<Session> {
    const res = await fetch(`${this.config.baseUrl}/session/${sessionID}`, {
      headers: this.headers
    });
    if (!res.ok) throw new Error(`Failed to load session: ${res.statusText}`);
    return res.json() as Promise<Session>;
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
     return res.json() as Promise<Message[]>;
  }

  public async sendMessage(sessionID: string, text: string, options?: { 
    agent?: string; 
    model?: { providerID: string; modelID: string } 
  }): Promise<Message> {
    const res = await fetch(`${this.config.baseUrl}/session/${sessionID}/message`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ 
        parts: [{ type: 'text', text }],
        agent: options?.agent,
        model: options?.model
      })
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new AuthError('Authentication failed: Unauthorized');
      }
      const errorText = await res.text();
      throw new Error(`Failed to send message: ${res.statusText} - ${errorText}`);
    }
    
    // API returns the created assistant message (initial state)
    // Note: The OpenCode API seems to return a stream of JSON or a JSON object.
    // Based on `server/routes/session.ts`: `stream.write(JSON.stringify(msg))`
    // It likely returns one JSON object and then closes, or maybe streams more.
    // We'll parse it as JSON.
    return res.json() as Promise<Message>;
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
    const res = await fetch(`${this.config.baseUrl}/question/${requestID}/reply`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ answers })
    });
    if (!res.ok) throw new Error(`Failed to reply to question: ${res.statusText}`);
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
    // If we never saw activity but it's busy, maybe it just started? 
    // We should initialize lastActivity when status becomes busy.
    
    return (Date.now() - lastActivity) < thresholdMs;
  }
}
