import { OctoolsClient } from '../src/index';

async function main() {
  const sessionID = 'ses_3e66e0096ffepuR2RKU8uZy0wu';
  
  console.log(`Fetching session: ${sessionID}\n`);
  
  const client = new OctoolsClient({
    baseUrl: 'http://localhost:4096',
    autoConnect: true
  });

  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  try {
    // Load the session
    console.log('Loading session...');
    const session = await client.loadSession(sessionID);
    console.log('\n📋 Session Info:');
    console.log(JSON.stringify(session, null, 2));
    
    // Get session status
    console.log('\n📊 Session Status:');
    const status = client.getSessionStatus(sessionID);
    console.log(JSON.stringify(status, null, 2));
    
    // Get full message history
    console.log('\n💬 Message History:');
    const messages = await client.getMessages(sessionID);
    console.log(`Found ${messages.length} messages\n`);
    
    messages.forEach((msg, idx) => {
      console.log(`\n--- Message ${idx + 1} (${msg.info.role}) ---`);
      console.log(`ID: ${msg.info.id}`);
      console.log(`Created: ${new Date(msg.info.time.created).toISOString()}`);
      if (msg.info.time.completed) {
        console.log(`Completed: ${new Date(msg.info.time.completed).toISOString()}`);
      }
      if (msg.info.finish) {
        console.log(`Finish reason: ${msg.info.finish}`);
      }
      if (msg.info.error) {
        console.log(`Error: ${JSON.stringify(msg.info.error)}`);
      }
      
      console.log(`\nParts (${msg.parts.length}):`);
      msg.parts.forEach((part, pidx) => {
        console.log(`  ${pidx + 1}. [${part.type}]${part.id ? ` ${part.id}` : ''}`);
        if (part.text) {
          // Show full text for this session
          console.log(`     ${part.text.replace(/\n/g, '\n     ')}`);
        }
        if (part.tool) {
          console.log(`     Tool: ${part.tool}`);
          if (part.state) {
            console.log(`     State: ${JSON.stringify(part.state, null, 2).replace(/\n/g, '\n     ')}`);
          }
        }
      });
    });
    
    console.log('\n\n✅ Done!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.disconnect();
    process.exit(0);
  }
}

main();
