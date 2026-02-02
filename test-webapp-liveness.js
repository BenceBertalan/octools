#!/usr/bin/env node

const { OctoolsClient } = require('./dist/index.js');

async function testWebappLiveness() {
  console.log('Testing webapp liveness feature...');
  
  const client = new OctoolsClient({
    baseUrl: 'http://localhost:4096',
    autoConnect: true,
    livenessCheckInterval: 1000,
    sessionTimeout: 30000
  });

  // Track events
  client.on('session.liveness', (data) => {
    console.log(`[LIVENESS] ${data.secondsSinceLastEvent}s since last event`);
  });

  client.on('message.delta', (data) => {
    process.stdout.write('.');
  });

  client.on('message', (data) => {
    console.log('\n[MESSAGE COMPLETE]');
  });

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create session
    const session = await client.createSession({
      title: 'Webapp Liveness Test'
    });
    console.log(`Created session: ${session.id}`);
    console.log('Open http://localhost:8081 and select this session to see the timer');
    console.log('');

    // Send a message that will process slowly
    console.log('Sending message that will process slowly...');
    const response = await client.sendMessage(
      session.id,
      'Please list the numbers from 1 to 10, but think about each number for a moment before saying it. Take your time.'
    );
    
    console.log('\nResponse complete!');
    console.log('Check the webapp - you should have seen a timer during the response.');
    
  } catch (error) {
    console.error('Test failed:', error);
  }

  process.exit(0);
}

testWebappLiveness();