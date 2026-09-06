#!/usr/bin/env node
/**
 * Test script to verify live-exam endpoints
 * Run this while the server is running
 */

const testData = {
    studentId: 'student123',
    studentName: 'Test Student',
    rombel: 'X IPA 1',
    mapel: 'Matematika',
    currentIdx: 5,
    currentQuestionNumber: 6,
    answeredCount: 5,
    totalQuestions: 50,
    percentage: 12,
    questionType: 'single',
    startTime: Date.now(),
    timeRemaining: 1500,
    updatedAt: new Date().toISOString(),
    isActive: true
};

async function test() {
    const baseUrl = 'http://localhost:3000';
    
    console.log('\n📝 TEST: POST /api/live-exam');
    console.log('─'.repeat(50));
    console.log('Posting exam data:', JSON.stringify(testData, null, 2));
    
    try {
        const postRes = await fetch(baseUrl + '/api/live-exam', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });
        
        if (postRes.ok) {
            const postBody = await postRes.json();
            console.log('✅ POST success:', postBody);
        } else {
            const errorText = await postRes.text();
            console.error('❌ POST failed:', postRes.status, errorText);
        }
    } catch (err) {
        console.error('❌ POST error:', err.message);
    }
    
    // Wait a bit then fetch
    console.log('\n⏳ Waiting 1 second...\n');
    await new Promise(r => setTimeout(r, 1000));
    
    console.log('📊 TEST: GET /api/live-exams');
    console.log('─'.repeat(50));
    
    try {
        const getRes = await fetch(baseUrl + '/api/live-exams');
        if (getRes.ok) {
            const data = await getRes.json();
            console.log('✅ GET success, returned', data.length, 'exams');
            if (data.length > 0) {
                console.log('First exam:', JSON.stringify(data[0], null, 2));
            }
        } else {
            console.error('❌ GET failed:', getRes.status);
        }
    } catch (err) {
        console.error('❌ GET error:', err.message);
    }
}

test().then(() => {
    console.log('\n✏️ Test completed\n');
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
