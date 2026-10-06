// Requires running local Supabase Docker stack supabase_auth_post-umbrella.
// Runs actual Edge Function and optionally Vite; forwards arguments to the project's Playwright CLI.
import { spawn, execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const config = JSON.parse(execFileSync('docker', ['inspect', 'supabase_auth_post-umbrella'], {encoding:'utf8'}))[0].Config.Env;
const values = Object.fromEntries(config.map(x => [x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
const secret = values.GOTRUE_JWT_SECRET;
if (!secret) throw new Error('Local JWT secret unavailable');
const jwt = role => { const h = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'); const p = Buffer.from(JSON.stringify({role,iss:'supabase',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'); return `${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`; };
const env = {...process.env, SUPABASE_URL:'http://localhost:54321',VITE_SUPABASE_URL:'http://localhost:54321', SUPABASE_ANON_KEY:jwt('anon'),VITE_SUPABASE_ANON_KEY:jwt('anon'), SUPABASE_SERVICE_ROLE_KEY:jwt('service_role'), INVITE_USER_ENDPOINT:'http://127.0.0.1:8000/invite-user', VITE_SUPABASE_PROXY_URL:'http://127.0.0.1:8000/proxy',SITE_URL:'http://127.0.0.1:5173'};
const children=[];
const failures=[];
const start=(cmd,args) => { const child=spawn(cmd,args,{env,stdio:['ignore','pipe','pipe']}); children.push(child); child.on('error', error => failures.push(error)); child.on('exit', code => { if (code && !child.killed) failures.push(new Error(`${cmd} exited ${code}`)); }); child.stdout.on('data',()=>{}); child.stderr.on('data',b=>{const s=b.toString(); if (!s.includes('eyJ')) process.stderr.write(s)}); return child; };
const ready=async(url)=> { for(let i=0;i<120;i++){if(failures.length) throw failures[0]; try{await fetch(url);return}catch{} await new Promise(r=>setTimeout(r,500))} throw new Error(`Environment not ready: ${url}`); };
try {
  start('deno',['run','--no-lock','--allow-env','--allow-net','supabase/functions/invite-user/index.ts']);
  await ready(env.INVITE_USER_ENDPOINT);
  if(process.argv.includes('--ui')) { start(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort']); await ready('http://127.0.0.1:5173'); }
  const args=process.argv.slice(2).filter(x=>x!=='--ui');
  // Invoke the configured repository command. Windows npm wrappers can be broken
  // independently of npm itself, so use its adjacent CLI when available.
  const npmCli = process.platform === 'win32'
    ? execFileSync('where.exe', ['npm'], { encoding: 'utf8' }).trim().split(/\r?\n/)
        .map(path => join(dirname(path), 'npm-cli.js')).find(path => existsSync(path))
    : undefined;
  const child = npmCli
    ? spawn(process.execPath, [npmCli, 'run', 'test:e2e', '--', ...args], { env, stdio: 'inherit' })
    : spawn('npm', ['run', 'test:e2e', '--', ...args], { env, stdio: 'inherit', shell: process.platform === 'win32' });
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
  process.exitCode=code??1;
} finally {
  await Promise.all(children.reverse().map(child => new Promise(resolve => {
    if (child.exitCode !== null || !child.pid) { resolve(); return; }
    child.once('exit', resolve);
    child.kill();
  })));
}
