require('dotenv').config({ path: '.env' });
const settingsService = require('./src/modules/settings/settings.service');

async function testMsg91InboundApi() {
  let authKey = process.env.MSG91_AUTH_KEY || '';
  try {
    const settings = await settingsService.getSettings();
    if (settings.msg91_auth_key) authKey = settings.msg91_auth_key;
  } catch (e) {}

  console.log("Using AuthKey length:", authKey.length);
  if (!authKey) {
    console.error("No MSG91 Auth Key found!");
    process.exit(1);
  }

  const sampleId = "10638241"; // ID from user prompt
  const sampleRaw = "inbounds/2026-09-01/raw-mail-178824597816.txt";

  const endpoints = [
    `https://control.msg91.com/api/v5/email/inbound/${sampleId}`,
    `https://control.msg91.com/api/v5/email/inbound/details?id=${sampleId}`,
    `https://control.msg91.com/api/v5/email/inbound/raw?id=${sampleId}`,
    `https://control.msg91.com/api/v5/email/inbound/raw?file=${encodeURIComponent(sampleRaw)}`,
    `https://control.msg91.com/api/v5/email/inbound?id=${sampleId}`,
    `https://control.msg91.com/api/v5/email/raw?path=${encodeURIComponent(sampleRaw)}`,
    `https://control.msg91.com/api/v5/email/inbound/download?id=${sampleId}`
  ];

  for (const url of endpoints) {
    try {
      console.log(`\nTesting URL: ${url}`);
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'authkey': authKey,
          'Accept': 'application/json, text/plain, */*'
        }
      });
      console.log(`Status: ${resp.status} ${resp.statusText}`);
      const text = await resp.text();
      console.log(`Response (first 300 chars):`, text.substring(0, 300));
    } catch (err) {
      console.error(`Error fetching ${url}:`, err.message);
    }
  }

  process.exit(0);
}

testMsg91InboundApi();
