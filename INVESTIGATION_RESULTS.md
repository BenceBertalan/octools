# OpenCode Agent Configuration Investigation Results

## Question 1: Can agent prompts be edited?

**✅ YES - Agent prompts CAN be customized!**

### Evidence from `/root/opencode_repo/packages/opencode/src/agent/agent.ts`:

**Lines 202-228** show that agent configurations can be overridden via config:

```typescript
for (const [key, value] of Object.entries(cfg.agent ?? {})) {
  // ... 
  item.prompt = value.prompt ?? item.prompt           // Line 217 - Custom prompts!
  item.temperature = value.temperature ?? item.temperature
  item.topP = value.top_p ?? item.topP
  if (value.model) item.model = Provider.parseModel(value.model)
  // ...
}
```

### How It Works:

1. **Native agents** (build, plan, explore, etc.) have default prompts defined in the code
2. **User can override** any agent's prompt through configuration
3. **Custom agents** can be created with custom prompts
4. The agent's prompt is used as part of the system prompt sent to the LLM

---

## Question 2: How does the `system` field work in messages?

**✅ The `system` field IS used by OpenCode!**

### Evidence from `/root/opencode_repo/packages/opencode/src/session/llm.ts` (lines 67-80):

```typescript
const system = []
system.push(
  [
    // use agent prompt otherwise provider prompt
    ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
    // any custom prompt passed into this call
    ...input.system,
    // any custom prompt from last user message
    ...(input.user.system ? [input.user.system] : []),
  ]
  .filter((x) => x)
  .join("\n"),
)
```

### System Prompt Assembly Order:

1. **Agent's custom prompt** (if configured)
   - OR Provider's default prompt (if no agent prompt)
2. **Environment/instruction prompts** (from AGENTS.md, etc.)
3. **Per-message system prompt** (`input.user.system`)

All these are joined together and sent as the system prompt to the LLM!

---

## Our Implementation Issues

### Issue #1: Wrong Field Name ❌

**We're using:** `prompt` field  
**Should use:** `system` field

### Issue #2: Wrong API Layer ❌

We're trying to:
- Store agent overrides in server memory
- Send custom prompts per-message

**We SHOULD instead:**
- Use OpenCode's config system to override agent settings
- Pass per-message system prompts using the `system` field

---

## The Correct Approach

### Option A: Per-Agent Configuration (Persistent)

Use OpenCode's `/global/config` endpoint to set agent overrides:

```json
{
  "agent": {
    "default": {
      "prompt": "You are a helpful coding assistant...",
      "model": "openai/gpt-4o",
      "temperature": 0.7,
      "top_p": 0.9
    }
  }
}
```

This will persist across sessions and be used for all messages with that agent.

### Option B: Per-Message System Prompts (Temporary)

Send the `system` field with each message:

```json
{
  "parts": [{"type": "text", "text": "User's message"}],
  "agent": "default",
  "model": {"providerID": "openai", "modelID": "gpt-4o"},
  "system": "For this specific message, act as..."
}
```

This overrides the system prompt for just that one message.

---

## What We Need to Fix

1. **Client & Server Code**
   - Change `prompt` → `system` in message payloads
   - Update TypeScript types

2. **Agent Settings Modal**
   - Should use OpenCode's `/global/config` endpoint instead of our in-memory storage
   - Settings should persist in OpenCode's config, not our server

3. **API Endpoints**
   - Check if `/global/config` endpoint exists in OpenCode
   - If not, we can still use in-memory storage but send `system` field correctly

---

## Testing Notes

- Native agents already have prompts (explore, compaction, title, summary)
- User overrides in config take precedence
- Per-message `system` field adds additional context on top of agent prompt
- All system prompts are concatenated and sent to the LLM

---

## Conclusion

✅ Agent prompts ARE editable  
✅ The `system` field DOES work  
❌ We're using the wrong field name (`prompt` instead of `system`)  
❌ We should integrate with OpenCode's config system instead of our own storage

The good news: Our UI and workflow are correct, we just need to fix the field name and potentially the storage mechanism!
