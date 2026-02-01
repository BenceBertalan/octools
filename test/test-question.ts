import { OctoolsClient } from '../src/index';

async function main() {
  console.log('Initializing OctoolsClient with event logging...\n');
  
  const client = new OctoolsClient({
    baseUrl: 'http://localhost:4096',
    autoConnect: true
  });

  // Log all events
  client.on('connected', () => {
    console.log('✅ SSE Connected\n');
  });

  client.on('session.status', (data) => {
    console.log('📊 [session.status]', JSON.stringify(data, null, 2));
  });

  client.on('message.new', (data) => {
    console.log('📝 [message.new]', JSON.stringify(data, null, 2));
  });

  client.on('message.delta', (data) => {
    if (data.delta) {
      process.stdout.write(data.delta);
    }
  });

  client.on('message.part', (data) => {
    console.log('\n🧩 [message.part]', JSON.stringify(data, null, 2));
  });

  client.on('message.complete', (data) => {
    console.log('\n✅ [message.complete]', JSON.stringify(data, null, 2));
  });

  client.on('question', (data) => {
    console.log('\n❓ [QUESTION RECEIVED]', JSON.stringify(data, null, 2));
  });

  client.on('permission', (data) => {
    console.log('\n🔒 [PERMISSION REQUESTED]', JSON.stringify(data, null, 2));
  });

  client.on('error', (error) => {
    console.error('\n❌ [ERROR]', error);
  });

  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    console.log('Creating session with Build agent...\n');
    
    const session = await client.createSession({
      agent: 'Build',
      directory: '/root'
    });
    
    console.log(`Session created: ${session.id}`);
    console.log(`Title: ${session.title}\n`);

    console.log('Sending message: "Ask me a question using the question tool"\n');
    console.log('='.repeat(60));
    
    const message = await client.sendMessageAndWait(
      session.id,
      'Ask me a question using the question tool'
    );

    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ Message completed: ${message.info.id}`);
    console.log(`Finish reason: ${message.info.finish}`);
    
    console.log('\n--- Final Message Parts ---');
    message.parts.forEach((part, idx) => {
      console.log(`${idx + 1}. [${part.type}] ${part.id}`);
      if (part.text) {
        console.log(`   Text: ${part.text.substring(0, 200)}${part.text.length > 200 ? '...' : ''}`);
      }
      if (part.tool) {
        console.log(`   Tool: ${part.tool}`);
      }
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Keep alive to see any late events
    console.log('\n\nWaiting 5 seconds for any remaining events...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    client.disconnect();
    process.exit(0);
  }
}

main();
