import { OctoolsClient } from '../src';

async function main() {
  console.log('Initializing OctoolsClient...');
  const client = new OctoolsClient({
    baseUrl: 'http://localhost:4096',
    autoConnect: true
  });

  client.on('connected', () => console.log('✅ Connected to SSE'));
  client.on('error', (err) => console.error('❌ Error:', err));
  
  client.on('session.status', (data) => {
    console.log(`ℹ️ Status changed: ${data.prevStatus} -> ${data.status}`);
  });

  client.on('message.delta', (data) => {
    process.stdout.write(data.delta || '');
  });

  client.on('message.complete', (data) => {
    console.log('\n✅ Message complete:', data.message.id);
  });

  // Wait for connection
  await new Promise(r => setTimeout(r, 1000));

  console.log('Creating session...');
  const session = await client.createSession({ title: 'Octools Test' });
  console.log('Session created:', session.id);

  console.log('Sending message "Count to 5"...');
  
  // Test Liveness before sending
  console.log('Connection healthy?', client.isConnectionHealthy());
  console.log('Session responsive?', client.isSessionResponsive(session.id));

  const response = await client.sendMessageAndWait(session.id, 'Count to 5');
  
  console.log('\n--- Final Response ---');
  // Reconstruct text from parts (simple version)
  const text = response.parts
    .filter(p => p.type === 'text')
    .map(p => p.text)
    .join('');
  console.log(text);
  
  console.log('Getting message history...');
  const history = await client.getMessages(session.id);
  console.log(`History length: ${history.length} messages`);

  client.disconnect();
}

main().catch(console.error);
