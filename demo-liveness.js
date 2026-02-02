#!/usr/bin/env node

const { OctoolsClient } = require('./dist/index.js');

async function demoLiveness() {
  console.log('====================================');
  console.log('   LIVENESS TIMER DEMO');
  console.log('====================================\n');
  console.log('Instructions:');
  console.log('1. Open http://localhost:8081 in your browser');
  console.log('2. Watch for the session "Liveness Timer Demo"');
  console.log('3. Look at the assistant message header');
  console.log('4. You\'ll see a timer badge counting seconds!\n');
  console.log('Timer colors:');
  console.log('  🟢 Green = 0-10 seconds (fresh)');
  console.log('  🟡 Yellow = 10-20 seconds (getting stale)');
  console.log('  🔴 Red = 20+ seconds (approaching timeout)\n');
  console.log('====================================\n');
  
  const client = new OctoolsClient({
    baseUrl: 'http://localhost:4096',
    autoConnect: true,
    livenessCheckInterval: 1000,
    sessionTimeout: 30000
  });

  // Show liveness updates in console too
  client.on('session.liveness', (data) => {
    const indicator = data.secondsSinceLastEvent < 10 ? '🟢' : 
                     data.secondsSinceLastEvent < 20 ? '🟡' : '🔴';
    console.log(`${indicator} Liveness: ${data.secondsSinceLastEvent}s since last event`);
  });

  try {
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create session with clear title
    const session = await client.createSession({
      title: 'Liveness Timer Demo'
    });
    
    console.log(`\n✅ Session created: "${session.title}"`);
    console.log('📱 Go to http://localhost:8081 and click on this session!\n');
    
    // Wait for user to open it
    console.log('⏳ Waiting 5 seconds for you to open the session...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Send a slow message
    console.log('\n🚀 Sending a slow message...');
    console.log('👀 WATCH THE MESSAGE HEADER IN THE WEBAPP NOW!\n');
    
    await client.sendMessage(
      session.id,
      'Please count from 1 to 20 slowly. Take about 1 second between each number. This is to demonstrate the liveness timer feature.'
    );
    
    console.log('\n✅ Message complete!');
    console.log('📝 The timer should have disappeared now.\n');
    
  } catch (error) {
    console.error('❌ Demo failed:', error);
  }

  process.exit(0);
}

demoLiveness();