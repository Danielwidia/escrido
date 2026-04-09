#!/usr/bin/env node

/**
 * setup-vercel-env.js
 * 
 * Setup environment variables ke Vercel secara otomatis
 * Jalankan dengan: node setup-vercel-env.js
 * 
 * Diperlukan:
 * - VERCEL_TOKEN (dari https://vercel.com/account/tokens)
 * - VERCEL_ORG_ID (dari vercel.com atau `vercel whoami`)
 * - VERCEL_PROJECT_ID (dari `.vercel/project.json` atau setup terlebih dahulu)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_ORG_ID = process.env.VERCEL_ORG_ID;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_HEADERS = {
    'Authorization': `Bearer ${VERCEL_TOKEN}`,
    'Content-Type': 'application/json'
};

// Environment variables yang ingin di-setup
const ENV_VARS_CONFIG = [
    { key: 'GOOGLE_API_KEY', prompt: 'Google Gemini API Key (dari https://aistudio.google.com/app/apikey):', target: ['production', 'preview', 'development'] },
    { key: 'SUPABASE_URL', prompt: 'Supabase URL (atau kosongkan untuk skip):', target: ['production', 'preview', 'development'], optional: true },
    { key: 'SUPABASE_KEY', prompt: 'Supabase Key (atau kosongkan untuk skip):', target: ['production', 'preview', 'development'], optional: true },
    { key: 'ANTHROPIC_API_KEY', prompt: 'Anthropic API Key (atau kosongkan untuk skip):', target: ['production', 'preview', 'development'], optional: true },
];

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function verifyVercelSetup() {
    if (!VERCEL_TOKEN) {
        console.error('\n❌ ERROR: VERCEL_TOKEN tidak ditemukan di .env\n');
        console.error('Langkah setup:');
        console.error('1. Kunjungi https://vercel.com/account/tokens');
        console.error('2. Create new token (copy token)');
        console.error('3. Tambah ke .env: VERCEL_TOKEN=xxxxxxxxxxxx\n');
        process.exit(1);
    }

    if (!VERCEL_ORG_ID || !VERCEL_PROJECT_ID) {
        console.warn('⚠️  VERCEL_ORG_ID atau VERCEL_PROJECT_ID tidak ada.\n');
        console.log('Cara mendapatkan:');
        console.log('1. Jalankan: vercel link');
        console.log('2. Atau cek file .vercel/project.json\n');
        
        const orgId = await question('Masukkan VERCEL_ORG_ID: ');
        const projId = await question('Masukkan VERCEL_PROJECT_ID: ');
        
        if (!orgId || !projId) {
            console.error('❌ ORG ID dan PROJECT ID diperlukan');
            process.exit(1);
        }

        // Save to .env
        let envContent = fs.readFileSync('.env', 'utf8') || '';
        if (!envContent.includes('VERCEL_ORG_ID')) {
            envContent += `\nVERCEL_ORG_ID=${orgId}`;
        } else {
            envContent = envContent.replace(/VERCEL_ORG_ID=.*/, `VERCEL_ORG_ID=${orgId}`);
        }
        if (!envContent.includes('VERCEL_PROJECT_ID')) {
            envContent += `\nVERCEL_PROJECT_ID=${projId}`;
        } else {
            envContent = envContent.replace(/VERCEL_PROJECT_ID=.*/, `VERCEL_PROJECT_ID=${projId}`);
        }
        fs.writeFileSync('.env', envContent);
        
        console.log('\n✅ VERCEL_ORG_ID dan VERCEL_PROJECT_ID disimpan ke .env');
        process.env.VERCEL_ORG_ID = orgId;
        process.env.VERCEL_PROJECT_ID = projId;
    }
}

async function setEnvironmentVariable(key, value, targets) {
    console.log(`\n⏳ Setting ${key}...`);
    
    for (const target of targets) {
        try {
            const url = `${VERCEL_API_BASE}/v9/projects/${VERCEL_PROJECT_ID}/env`;
            const response = await fetch(url, {
                method: 'POST',
                headers: VERCEL_HEADERS,
                body: JSON.stringify({
                    key: key,
                    value: value,
                    target: target,
                    type: 'encrypted'
                })
            });

            if (!response.ok) {
                const error = await response.json();
                
                // Jika sudah exist, coba update
                if (error.code === 'ENV_KEY_ALREADY_EXISTS') {
                    console.log(`  ℹ️  ${key} sudah ada untuk ${target}, mencoba update...`);
                    
                    // Get existing env var ID dulu
                    const getRes = await fetch(`${url}?target=${target}`, { headers: VERCEL_HEADERS });
                    if (!getRes.ok) throw new Error(`Failed to get env vars: ${getRes.statusText}`);
                    
                    const data = await getRes.json();
                    const existingEnv = data.envs.find(e => e.key === key);
                    
                    if (existingEnv) {
                        const updateRes = await fetch(`${url}/${existingEnv.id}`, {
                            method: 'PATCH',
                            headers: VERCEL_HEADERS,
                            body: JSON.stringify({ value: value })
                        });
                        
                        if (!updateRes.ok) throw new Error(`Failed to update: ${updateRes.statusText}`);
                    }
                } else {
                    throw new Error(error.message || `HTTP ${response.status}`);
                }
            }
            
            console.log(`  ✅ ${key} set untuk ${target}`);
        } catch (err) {
            console.error(`  ❌ Gagal set ${key} untuk ${target}: ${err.message}`);
            throw err;
        }
    }
}

async function main() {
    console.log('\n🚀 Setup Vercel Environment Variables\n');
    console.log('=' .repeat(50));

    await verifyVercelSetup();

    for (const envConfig of ENV_VARS_CONFIG) {
        let value = process.env[envConfig.key];

        if (!value) {
            value = await question(`\n${envConfig.prompt} `);
        }

        if (!value) {
            if (envConfig.optional) {
                console.log(`⏭️  Skip (optional)`);
                continue;
            } else {
                console.error(`\n❌ ${envConfig.key} diperlukan!`);
                process.exit(1);
            }
        }

        // Save to .env jika belum ada
        if (!process.env[envConfig.key]) {
            let envContent = fs.readFileSync('.env', 'utf8') || '';
            if (!envContent.includes(envConfig.key)) {
                envContent += `\n${envConfig.key}=${value}`;
            } else {
                envContent = envContent.replace(new RegExp(`${envConfig.key}=.*`), `${envConfig.key}=${value}`);
            }
            fs.writeFileSync('.env', envContent);
            console.log(`✅ ${envConfig.key} disimpan ke .env`);
        }

        // Setup di Vercel
        await setEnvironmentVariable(envConfig.key, value, envConfig.target);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ Semua environment variables berhasil di-setup!\n');
    console.log('Next steps:');
    console.log('1. Vercel akan auto-redeploy dengan env vars baru');
    console.log('2. Check deployment status: vercel deployments');
    console.log('3. Atau deploy manual: git push (jika GitHub connected)\n');

    rl.close();
}

main().catch(err => {
    console.error(`\n❌ ERROR: ${err.message}\n`);
    rl.close();
    process.exit(1);
});
