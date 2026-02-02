#!/usr/bin/env node
/**
 * Test script for Notes feature
 * Tests both API endpoints and data structure
 */

const http = require('http');

async function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8081,
            path: path,
            method: method,
            headers: data ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(JSON.stringify(data))
            } : {}
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    resolve(body);
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

async function runTests() {
    console.log('🧪 Testing Notes Feature\n');
    
    let testsPassed = 0;
    let testsFailed = 0;
    
    try {
        // Test 1: Get empty notes
        console.log('Test 1: Get global notes (should be empty)');
        const emptyNotes = await request('GET', '/api/notes');
        if (Array.isArray(emptyNotes) && emptyNotes.length === 0) {
            console.log('✅ PASS: Empty notes array returned\n');
            testsPassed++;
        } else {
            console.log('❌ FAIL: Expected empty array\n');
            testsFailed++;
        }
        
        // Test 2: Create global note
        console.log('Test 2: Create global note');
        const newNote = await request('POST', '/api/notes', {
            title: 'Test Global Note',
            content: '<p>This is a <strong>global</strong> note</p>'
        });
        
        if (newNote.id && newNote.title === 'Test Global Note' && !newNote.sessionID) {
            console.log('✅ PASS: Global note created');
            console.log(`   ID: ${newNote.id}`);
            console.log(`   Title: ${newNote.title}\n`);
            testsPassed++;
        } else {
            console.log('❌ FAIL: Note creation failed\n');
            testsFailed++;
            return;
        }
        
        const noteID = newNote.id;
        
        // Test 3: Create session-specific note
        console.log('Test 3: Create session-specific note');
        const sessionNote = await request('POST', '/api/notes', {
            title: 'Test Session Note',
            content: '<p>Session-specific content</p>',
            sessionID: 'test-session-123'
        });
        
        if (sessionNote.id && sessionNote.sessionID === 'test-session-123') {
            console.log('✅ PASS: Session note created');
            console.log(`   ID: ${sessionNote.id}`);
            console.log(`   SessionID: ${sessionNote.sessionID}\n`);
            testsPassed++;
        } else {
            console.log('❌ FAIL: Session note creation failed\n');
            testsFailed++;
        }
        
        const sessionNoteID = sessionNote.id;
        
        // Test 4: Get all global notes
        console.log('Test 4: Get global notes');
        const globalNotes = await request('GET', '/api/notes');
        if (Array.isArray(globalNotes) && globalNotes.length === 1) {
            console.log('✅ PASS: Retrieved 1 global note');
            console.log(`   Note: ${globalNotes[0].title}\n`);
            testsPassed++;
        } else {
            console.log('❌ FAIL: Expected 1 global note\n');
            testsFailed++;
        }
        
        // Test 5: Get session notes
        console.log('Test 5: Get session-specific notes');
        const sessionNotes = await request('GET', '/api/notes?sessionID=test-session-123');
        if (Array.isArray(sessionNotes) && sessionNotes.length === 1) {
            console.log('✅ PASS: Retrieved 1 session note');
            console.log(`   Note: ${sessionNotes[0].title}\n`);
            testsPassed++;
        } else {
            console.log('❌ FAIL: Expected 1 session note\n');
            testsFailed++;
        }
        
        // Test 6: Update note
        console.log('Test 6: Update note title');
        await request('PATCH', `/api/notes/${noteID}`, {
            title: 'Updated Global Note'
        });
        
        const updatedNotes = await request('GET', '/api/notes');
        if (updatedNotes[0].title === 'Updated Global Note') {
            console.log('✅ PASS: Note updated successfully');
            console.log(`   New title: ${updatedNotes[0].title}\n`);
            testsPassed++;
        } else {
            console.log('❌ FAIL: Note update failed\n');
            testsFailed++;
        }
        
        // Test 7: Update note content
        console.log('Test 7: Update note content');
        await request('PATCH', `/api/notes/${noteID}`, {
            content: '<p>Updated content with <code>code</code></p>'
        });
        
        const contentUpdated = await request('GET', '/api/notes');
        if (contentUpdated[0].content.includes('Updated content')) {
            console.log('✅ PASS: Content updated successfully\n');
            testsPassed++;
        } else {
            console.log('❌ FAIL: Content update failed\n');
            testsFailed++;
        }
        
        // Test 8: Check timestamp updates
        console.log('Test 8: Verify updated timestamp changed');
        const originalTime = newNote.updated;
        await new Promise(resolve => setTimeout(resolve, 100));
        await request('PATCH', `/api/notes/${noteID}`, { title: 'Final Title' });
        const timestampCheck = await request('GET', '/api/notes');
        
        if (timestampCheck[0].updated > originalTime) {
            console.log('✅ PASS: Updated timestamp changed');
            console.log(`   Original: ${originalTime}`);
            console.log(`   Updated: ${timestampCheck[0].updated}\n`);
            testsPassed++;
        } else {
            console.log('❌ FAIL: Timestamp not updated\n');
            testsFailed++;
        }
        
        // Test 9: Delete session note
        console.log('Test 9: Delete session note');
        await request('DELETE', `/api/notes/${sessionNoteID}`);
        const afterSessionDelete = await request('GET', '/api/notes?sessionID=test-session-123');
        
        if (Array.isArray(afterSessionDelete) && afterSessionDelete.length === 0) {
            console.log('✅ PASS: Session note deleted\n');
            testsPassed++;
        } else {
            console.log('❌ FAIL: Session note still exists\n');
            testsFailed++;
        }
        
        // Test 10: Delete global note
        console.log('Test 10: Delete global note');
        await request('DELETE', `/api/notes/${noteID}`);
        const afterDelete = await request('GET', '/api/notes');
        
        if (Array.isArray(afterDelete) && afterDelete.length === 0) {
            console.log('✅ PASS: Global note deleted\n');
            testsPassed++;
        } else {
            console.log('❌ FAIL: Global note still exists\n');
            testsFailed++;
        }
        
        // Test 11: Create note without title
        console.log('Test 11: Create note with default title');
        const noTitleNote = await request('POST', '/api/notes', {
            content: '<p>Content without title</p>'
        });
        
        if (noTitleNote.title === 'Untitled Note') {
            console.log('✅ PASS: Default title applied');
            console.log(`   Title: ${noTitleNote.title}\n`);
            testsPassed++;
            await request('DELETE', `/api/notes/${noTitleNote.id}`);
        } else {
            console.log('❌ FAIL: Default title not applied\n');
            testsFailed++;
        }
        
        // Test 12: Create note with empty content
        console.log('Test 12: Create note with empty content');
        const emptyContentNote = await request('POST', '/api/notes', {
            title: 'Empty Content',
            content: ''
        });
        
        if (emptyContentNote.id && emptyContentNote.content === '') {
            console.log('✅ PASS: Empty content allowed\n');
            testsPassed++;
            await request('DELETE', `/api/notes/${emptyContentNote.id}`);
        } else {
            console.log('❌ FAIL: Empty content handling issue\n');
            testsFailed++;
        }
        
    } catch (error) {
        console.error('❌ TEST ERROR:', error.message);
        testsFailed++;
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 Test Results:');
    console.log(`   ✅ Passed: ${testsPassed}`);
    console.log(`   ❌ Failed: ${testsFailed}`);
    console.log(`   Total:  ${testsPassed + testsFailed}`);
    console.log('='.repeat(50));
    
    if (testsFailed === 0) {
        console.log('\n🎉 All tests passed!\n');
        process.exit(0);
    } else {
        console.log(`\n⚠️  ${testsFailed} test(s) failed!\n`);
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
