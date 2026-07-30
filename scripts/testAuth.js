async function testAuth() {
  const baseURL = 'https://apicrm.cursiveletters.in/api/auth';
  try {
    console.log('1. Testing Login...');
    let res = await fetch(`${baseURL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' })
    });
    let text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Non-JSON response: ${text}`);
    }
    if (!data.success) throw new Error(JSON.stringify(data.error));
    
    const { accessToken, refreshToken, user } = data.data;
    console.log('Login successful. Received tokens.');

    console.log('2. Testing /me...');
    res = await fetch(`${baseURL}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    data = await res.json();
    if (!data.success) throw new Error(JSON.stringify(data.error));
    console.log('/me successful. User:', data.data.name);

    console.log('3. Testing /refresh...');
    res = await fetch(`${baseURL}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    data = await res.json();
    if (!data.success) throw new Error(JSON.stringify(data.error));
    const newAccessToken = data.data.accessToken;
    console.log('/refresh successful. Received new access token.');

    console.log('4. Testing /logout...');
    res = await fetch(`${baseURL}/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${newAccessToken}` }
    });
    data = await res.json();
    if (!data.success) throw new Error(JSON.stringify(data.error));
    console.log('/logout successful.');

    console.log('5. Testing /me again (should fail)...');
    res = await fetch(`${baseURL}/me`, {
      headers: { Authorization: `Bearer ${newAccessToken}` }
    });
    data = await res.json();
    if (data.success) {
      console.error('/me should have failed!');
    } else {
      console.log('Expected error caught:', data.error.code);
    }
  } catch (err) {
    console.error('Test failed:', err.message);
  }
}

testAuth();
