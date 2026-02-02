#!/usr/bin/env node

const { OctoolsClient } = require('./dist/index.js');

async function testWebappLiveness() {
  console.log('Testing webapp liveness feature...');
  console.log('Make sure to open http://localhost:8081 and watch the message header');
  console.log('');
  
  const client = new OctoolsClient({
    baseUrl: 'http://localhost:4096',
    autoConnect: true,
    livenessCheckInterval: 1000,
    sessionTimeout: 30000
  });

  // Track all events
  client.on('session.status', (data) => {
    console.log(`[SESSION STATUS] Session ${data.sessionID}: ${data.prevStatus} -> ${data.status}`);
  });

  client.on('session.liveness', (data) => {
    console.log(`[LIVENESS] ${data.secondsSinceLastEvent}s since last event`);
  });

  client.on('session.retry.start', (data) => {
    console.log(`[RETRY START] Retrying due to: ${data.reason}`);
  });

  client.on('message.delta', () => {
    // Just show we're getting activity
    process.stdout.write('.');
  });

  client.on('message', (data) => {
    console.log('\n[MESSAGE COMPLETE]');
  });

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create session
    const session = await client.createSession({
      title: 'Liveness Test - Watch Timer'
    });
    console.log(`\nSession created: ${session.id}`);
    console.log('Go to http://localhost:8081 and select this session');
    console.log('');

    // Wait a moment for user to open the session
    console.log('Waiting 3 seconds for you to open the session...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Send a message
    console.log('\nSending message that will take time to process...');
    console.log('You should see a timer appear on the message in the webapp!');
    
    const response = await client.sendMessage(
      session.id,
      'Count from 1 to 15 slowly, taking about a second between each number.'
    );
    
    console.log('\nMessage complete!');
    console.log('The timer should have disappeared from the webapp.');
    
  } catch (error) {
    console.error('Test failed:', error);
  }

  process.exit(0);
}

testWebappLiveness();