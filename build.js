const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('📦 Starting fast build process...');

// Check if we are in cPanel or a restricted environment
const isCpanel = process.env.HOME && (process.env.HOME.includes('lazemees') || process.env.HOME.includes('passenger') || process.env.HOME.includes('cpanel'));

// Also check if Vite is missing (which happens on production cPanel npm installs)
let hasVite = true;
try {
  require.resolve('vite');
} catch (e) {
  hasVite = false;
}

if (isCpanel || !hasVite) {
  console.log('\n=============================================================');
  console.log('⚠️  DETECTED CPANEL / RESTRICTED SHARED HOSTING ENVIRONMENT');
  console.log('=============================================================');
  console.log('🌟 Skipping resource-intensive compilation on your hosting!');
  console.log('💡 Your React client & Node server are already fully pre-compiled');
  console.log('   into the "dist/" directory.');
  console.log('🚀 All you need to do is upload the files and RESTART the app.');
  console.log('=============================================================\n');
  process.exit(0);
}

try {
  const args = process.argv.slice(2);
  const clientExists = fs.existsSync(path.join(process.cwd(), 'dist', 'index.html'));
  const forceClient = args.includes('--client') || args.includes('--all') || process.env.BUILD_CLIENT === 'true' || !clientExists;

  if (forceClient) {
    console.log('⚡ Building Client UI with Vite...');
    execSync('npx vite build', { stdio: 'inherit' });
  } else {
    console.log('⚡ Client UI already pre-compiled (skipping slow Vite build).');
  }

  console.log('⚡ Bundling Server with esbuild (instant 0.2s)...');
  execSync('npx esbuild server.ts --bundle --platform=node --format=cjs --external:vite --sourcemap --outfile=dist/server.cjs', { stdio: 'inherit' });

  // Only create cpanel-deploy.zip if explicitly requested or in AI Studio environment
  const isAiStudio = !!process.env.AIS_DEV_SERVER_PORT || !!process.env.GEMINI_API_KEY || process.env.CREATE_ZIP === 'true';

  if (isAiStudio) {
    try {
      console.log('🎁 Packaging pre-compiled assets into cpanel-deploy.zip...');
      const AdmZip = require('adm-zip');
      const zip = new AdmZip();

      const tempZipPath = path.join(process.cwd(), 'cpanel-deploy.zip');
      const finalZipPath = path.join(process.cwd(), 'dist', 'cpanel-deploy.zip');

      if (fs.existsSync(finalZipPath)) {
        try { fs.unlinkSync(finalZipPath); } catch (e) {}
      }
      
      if (fs.existsSync('dist')) {
        zip.addLocalFolder('dist', 'dist');
      }

      const filesToAdd = [
        'app.js', 'index.js', 'package.json', '.env.example', 'setup.js',
        'menu.js', 'menu.bat', 'manager.bat', 'install.bat', 'start.bat',
        'stop.bat', 'install.sh', 'install-windows-service.bat',
        'uninstall-windows-service.bat', 'run-hidden.vbs',
        'windows-service-install.js', 'windows-service-uninstall.js',
        'service-runner.js'
      ];

      for (const f of filesToAdd) {
        if (fs.existsSync(f)) zip.addLocalFile(f);
      }

      zip.writeZip(tempZipPath);
      if (fs.existsSync('dist')) {
        fs.renameSync(tempZipPath, finalZipPath);
      }
      console.log('✅ cpanel-deploy.zip created successfully in dist directory.');
    } catch (zipErr) {
      console.log('⚠️ Zip creation skipped:', zipErr.message);
    }
  }

  console.log('✅ Build completed successfully in turbo mode!');
} catch (error) {
  console.error('❌ Build error:', error.message);
  process.exit(1);
}
