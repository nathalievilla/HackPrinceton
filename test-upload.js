const fs = require('fs');
const http = require('http');

// Create form data manually (no external deps)
const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(7);
const filename = 'test_trial.csv';
const fileContent = fs.readFileSync(filename);

const body = 
  `--${boundary}\r\n` +
  `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
  `Content-Type: text/csv\r\n\r\n` +
  fileContent +
  `\r\n--${boundary}--\r\n`;

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/upload',
  method: 'POST',
  headers: {
    'Content-Type': `multipart/form-data; boundary=${boundary}`,
    'Content-Length': Buffer.byteLength(body)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      console.log('✓ Upload successful!');
      console.log('  Job ID:', result.job_id);
      console.log('  Status:', result.status);
      console.log('\n📊 Poll the job status with:');
      console.log(`  curl http://localhost:3000/jobs/${result.job_id}`);
      console.log('\n📈 Get results when complete with:');
      console.log(`  curl http://localhost:3000/results/${result.job_id}`);
    } catch (e) {
      console.error('Failed to parse response:', data);
    }
  });
});

req.on('error', (err) => {
  console.error('✗ Upload failed:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
