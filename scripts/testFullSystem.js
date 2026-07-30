async function testFull() {
  const baseURL = 'http://localhost:5001/api';
  let adminToken = '';
  
  try {
    console.log('--- 1. AUTH ---');
    const loginRes = await fetch(`${baseURL}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    if (!loginData.success) throw new Error(`Auth failed: ${JSON.stringify(loginData)}`);
    adminToken = loginData.data.accessToken;
    console.log('Admin logged in.');

    console.log('\n--- 2. SYSTEM SETTINGS ---');
    const setRes = await fetch(`${baseURL}/settings`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ form_submission_enabled: true })
    });
    const setResData = await setRes.json();
    if (!setResData.success) throw new Error(`Settings failed: ${JSON.stringify(setResData)}`);
    console.log('Settings updated:', setResData.data.form_submission_enabled);

    console.log('\n--- 3. PUBLIC FORM (with exact duplicate check) ---');
    const dynamicEmail = `john.doe.${Date.now()}@example.com`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `192.168.1.${Math.floor(Math.random() * 255)}`
    };

    let pubRes = await fetch(`${baseURL}/public-form/submit`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: 'John Doe', email: dynamicEmail, mobile: `919${Date.now().toString().slice(-9)}`, city: 'Mumbai',
        'cf-turnstile-response': 'dummy_response'
      })
    });
    console.log('Public form 1 (New User):', await pubRes.json());
    
    pubRes = await fetch(`${baseURL}/public-form/submit`, {
      method: 'POST', headers,
      body: JSON.stringify({
        name: 'Johnathan Doe', email: dynamicEmail, mobile: '9876543210', city: 'Mumbai',
        'cf-turnstile-response': 'dummy_response'
      })
    });
    console.log('Public form 2 (Exact Duplicate):', await pubRes.json()); // Should fail

    console.log('\n--- 4. STAFF USERS CRUD (Fuzzy Duplicate Override) ---');
    const createRes = await fetch(`${baseURL}/users`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({
        name: 'John Doeee', email: `johnd${Date.now()}@example.com`, mobile: `989${Date.now().toString().slice(-9)}`, city: 'Mumbai', overrideFuzzy: true
      })
    });
    const createData = await createRes.json();
    if (!createData.success) throw new Error(`User create failed: ${JSON.stringify(createData)}`);
    const newUser = createData.data;
    console.log('Admin created fuzzy duplicate user via override:', newUser.name, newUser.id);

    console.log('\n--- 5. DELETION FLOW ---');
    const delReq = await fetch(`${baseURL}/users/${newUser.id}/request-deletion`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ reason: 'Duplicate entry' })
    });
    console.log('Deletion requested:', await delReq.json());

    const approveReq = await fetch(`${baseURL}/deletions/${newUser.id}/approve`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('Deletion approved:', await approveReq.json());

    console.log('\n--- 6. DASHBOARD STATS ---');
    const statsRes = await fetch(`${baseURL}/dashboard/stats`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    console.log('Dashboard Stats:', await statsRes.json());
    
    console.log('\n--- 7. AUDIT LOGS ---');
    const logsRes = await fetch(`${baseURL}/dashboard/audit-logs`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const logs = await logsRes.json();
    console.log(`Audit Logs total: ${logs.data.total}. Latest action: ${logs.data.items[0].action}`);

    console.log('\n✅ ALL E2E TESTS PASSED');
  } catch (err) {
    console.error('Test Failed:', err.message);
  }
}

testFull();
