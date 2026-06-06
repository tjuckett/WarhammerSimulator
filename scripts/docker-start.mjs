import { spawn } from 'node:child_process';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

if (process.env.SKIP_DB_MIGRATIONS === '1') {
  console.log('Skipping database migrations because SKIP_DB_MIGRATIONS=1.');
} else if (!process.env.DATABASE_URL) {
  console.log('Skipping database migrations because DATABASE_URL is not set.');
} else {
  console.log('Applying pending database migrations...');
  await run('npm', ['--workspace', '@warhammer-simulator/web', 'run', 'db:migrate:deploy']);
}

await run('node', ['apps/web/server.js']);
