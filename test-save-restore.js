// Test script for admin save -> server -> student reload flow
const fetch = require('node-fetch');

async function testSaveRestoreFlow() {
    console.log('🧪 Testing Admin Save -> Server -> Student Reload Flow\n');

    // Test data
    const testStudentId = 'test-student-123';
    const testMapel = 'Matematika';
    const testRombel = 'XII IPA 1';

    // Step 1: Simulate admin save (send complete answers to server)
    console.log('1️⃣ Simulating Admin Save...');
    const saveData = {
        studentId: testStudentId,
        rombel: testRombel,
        mapel: testMapel,
        answers: ['A', 'B', 'C', null, 'D'], // Some answers filled
        currentIdx: 3,
        adminSaveRequest: true,
        updatedAt: Date.now()
    };

    try {
        const saveResponse = await fetch('http://localhost:3000/api/live-exam', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(saveData)
        });

        if (saveResponse.ok) {
            console.log('✅ Admin save successful - Data stored on server');
        } else {
            console.log('❌ Admin save failed:', saveResponse.status);
            return;
        }
    } catch (error) {
        console.log('❌ Admin save error:', error.message);
        return;
    }

    // Step 2: Simulate student reload (retrieve from server)
    console.log('\n2️⃣ Simulating Student Reload...');
    try {
        const reloadResponse = await fetch('http://localhost:3000/api/live-exams');
        const liveExams = await reloadResponse.json();

        const studentData = liveExams.find(e =>
            e.studentId === testStudentId &&
            e.rombel === testRombel &&
            e.mapel === testMapel
        );

        if (studentData) {
            console.log('✅ Student reload successful - Data retrieved from server:');
            console.log('   - Answers:', studentData.answers);
            console.log('   - Current Index:', studentData.currentIdx);
            console.log('   - Admin Save Request:', studentData.adminSaveRequest);

            // Verify data integrity
            if (JSON.stringify(studentData.answers) === JSON.stringify(saveData.answers) &&
                studentData.currentIdx === saveData.currentIdx) {
                console.log('✅ Data integrity verified - Student can resume from correct position');
            } else {
                console.log('❌ Data integrity failed - Answers or position mismatch');
            }
        } else {
            console.log('❌ Student reload failed - No data found on server');
        }
    } catch (error) {
        console.log('❌ Student reload error:', error.message);
    }

    console.log('\n🏁 Test completed');
}

testSaveRestoreFlow().catch(console.error);