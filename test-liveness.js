#!/usr/bin/env node

const { OctoolsClient } = require('./dist/index.js');

async function testLiveness() {
  console.log('Starting liveness test...');
  
  // Create client with short timeout for testing
  const client = new OctoolsClient({
    baseUrl: 'http://localhost:4096',
    autoConnect: true,
    livenessCheckInterval: 1000,  // Check every second
    sessionTimeout: 10000          // Timeout after 10 seconds
  });

  // Listen for liveness events
  client.on('session.liveness', (data) => {
    console.log(`[LIVENESS] Session ${data.sessionID}: ${data.secondsSinceLastEvent}s since last event (stale: ${data.isStale})`);
  });

  client.on('session.retry.start', (data) => {
    console.log(`[RETRY START] Session ${data.sessionID}: Starting retry due to ${data.reason} (attempt ${data.attemptNumber})`);
  });

  client.on('session.retry.success', (data) => {
    console.log(`[RETRY SUCCESS] Session ${data.sessionID}: Retry succeeded!`);
  });

  client.on('session.retry.failed', (data) => {
    console.log(`[RETRY FAILED] Session ${data.sessionID}: Retry failed - ${data.error}`);
  });

  client.on('session.status', (data) => {
    console.log(`[STATUS] Session ${data.sessionID}: ${data.status}`);
  });

  client.on('message.delta', (data) => {
    process.stdout.write('.');  // Show activity
  });

  try {
    // Wait for connection
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create a test session
    console.log('Creating test session...');
    const session = await client.createSession({
      title: 'Liveness Test Session'
    });
    console.log(`Session created: ${session.id}`);

    // Send a message that might take time
    console.log('Sending test message...');
    const message = await client.sendMessage(
      session.id, 
      'Count slowly from 1 to 5, pausing for 3 seconds between each number.'
    );
    console.log(`Message sent, waiting for response...`);

    // Wait to observe liveness monitoring
    await new Promise(resolve => setTimeout(resolve, 30000));

    console.log('Test completed!');
    process.exit(0);

  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

testLiveness();