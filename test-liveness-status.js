#!/usr/bin/env node

const { OctoolsClient } = require('./dist/client');

async function testLivenessStatus() {
    console.log('Testing liveness timer in status bar...\n');
    
    const client = new OctoolsClient({
        baseUrl: 'http://localhost:4096',
        autoConnect: true,
        livenessCheckInterval: 1000,
        sessionTimeout: 30000
    });
    
    await client.connect();
    
    // Create a test session
    const session = await client.createSession('Test Liveness Status', {
        modelID: 'claude-3-5-sonnet-latest',
        providerID: 'anthropic'
    });
    
    console.log(`✅ Session created: ${session.id}`);
    console.log(`📍 View in browser: http://localhost:8081/#/session/${session.id}`);
    console.log('\n👁️  Check the browser to see:');
    console.log('   1. Timer should appear BELOW the session status');
    console.log('   2. Timer shows "⏱ Processing: Xs"');
    console.log('   3. Color changes: green→yellow→red\n');
    
    // Add liveness listener
    client.on('session.liveness', (data) => {
        console.log(`⏱ Liveness update: ${data.secondsSinceLastEvent}s`);
    });
    
    // Send a message that takes time
    console.log('Sending a message that will take some time...\n');
    await client.sendMessage(session.id, 'Count slowly from 1 to 5, taking about 2 seconds between each number.');
    
    console.log('\n✅ Message complete! Timer should be hidden now.');
    console.log('Check the browser to verify timer disappeared.');
    
    await client.disconnect();
}

testLivenessStatus().catch(console.error);