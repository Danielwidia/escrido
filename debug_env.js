require('dotenv').config();

console.log('=== SERVER DEBUG TEST ===');
console.log('VERCEL_TOKEN present:', !!process.env.VERCEL_TOKEN);
console.log('VERCEL_PROJECT_ID present:', !!process.env.VERCEL_PROJECT_ID);
console.log('VERCEL_TOKEN length:', process.env.VERCEL_TOKEN ? process.env.VERCEL_TOKEN.length : 0);
console.log('VERCEL_PROJECT_ID value:', process.env.VERCEL_PROJECT_ID);

if (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) {
  console.log('✅ Environment variables loaded successfully');
} else {
  console.log('❌ Environment variables NOT loaded');
}

process.exit(0);