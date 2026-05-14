'use strict';

const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const ROOT = process.cwd();
const PORT = 8888;
const NEXTRON = path.join(ROOT, 'node_modules', 'nextron');
const NM = path.join(ROOT, 'node_modules');

const cyan = s => `\x1b[36m[nextron]\x1b[0m ${s}`;
const log = msg => console.log(cyan(msg));
const logErr = msg => console.log(`\x1b[36m[nextron]\x1b[0m \x1b[31m${msg}\x1b[0m`);

const isWin = process.platform === 'win32';
function bin(name) {
  return path.join(ROOT, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);
}

function run(cmd, args, opts = {}) {
  return spawn(cmd, args, { stdio: 'inherit', shell: isWin, cwd: ROOT, ...opts });
}

function buildWebpackConfig(target, entryFile, outputName) {
  const webpack = require(path.join(NM, 'webpack'));
  const babelLoader = require.resolve('babel-loader', { paths: [NM] });
  const babelConfig = path.join(NEXTRON, 'babel.js');
  const pkg = require(path.join(ROOT, 'package.json'));
  const externals = Object.keys(pkg.dependencies || {});

  return {
    mode: 'development',
    devtool: 'inline-source-map',
    target,
    entry: { [outputName]: entryFile },
    output: {
      filename: '[name].js',
      path: path.join(ROOT, 'app'),
      library: { type: 'umd' },
    },
    externals,
    module: {
      rules: [{
        test: /\.(js|ts)x?$/,
        use: { loader: babelLoader, options: { cacheDirectory: true, extends: babelConfig } },
        exclude: [/node_modules/, path.join(ROOT, 'renderer')],
      }],
    },
    resolve: { extensions: ['.ts', '.js', '.json'], modules: ['node_modules'] },
    plugins: [
      new webpack.EnvironmentPlugin({ NODE_ENV: 'development' }),
    ],
    stats: 'errors-only',
    node: { __dirname: false, __filename: false },
  };
}

function compileOnce(config) {
  const webpack = require(path.join(NM, 'webpack'));
  return new Promise((resolve, reject) => {
    webpack(config).run((err, stats) => {
      if (err) return reject(err);
      if (stats?.hasErrors()) console.error(stats.toString('errors-only'));
      resolve();
    });
  });
}

function ensureRendererNodeModules() {
  const rendererNM = path.join(ROOT, 'renderer', 'node_modules');
  if (!fs.existsSync(rendererNM)) {
    try {
      // Junction (not symlink) — no admin required on Windows
      fs.symlinkSync(NM, rendererNM, 'junction');
      log('Created renderer/node_modules junction → root node_modules');
    } catch (e) {
      logErr(`Could not create node_modules junction: ${e.message}`);
    }
  }
}

async function main() {
  const procs = [];
  const exit = () => { procs.forEach(p => { try { p.kill(); } catch {} }); process.exit(0); };
  process.on('SIGINT', exit);
  process.on('SIGTERM', exit);

  // 0. Ensure Turbopack can resolve `next` from renderer/
  ensureRendererNodeModules();

  // 1. Compile Electron main + preload
  const preloadPath = path.join(ROOT, 'main', 'preload.ts');
  const mainPath = path.join(ROOT, 'main', 'main.ts');

  log('Compiling Electron main process...');
  if (fs.existsSync(preloadPath)) {
    await compileOnce(buildWebpackConfig('electron-preload', preloadPath, 'preload'));
  }
  await compileOnce(buildWebpackConfig('electron-main', mainPath, 'main'));
  log('Main process compiled.');

  // 2. Start Next.js dev server from within renderer/ so Turbopack can resolve
  //    the `next` package by walking up to the root node_modules.
  const RENDERER = path.join(ROOT, 'renderer');
  log(`Starting renderer: next dev -p ${PORT} (cwd: renderer/)`);
  const renderer = run(bin('next'), ['dev', '-p', String(PORT)], { cwd: RENDERER });
  procs.push(renderer);
  renderer.on('close', () => { logErr('Renderer exited'); exit(); });

  // 3. Start Electron (it has its own retry loop for the dev server)
  log('Starting Electron...');
  const electron = run(bin('electron'), ['.', String(PORT), '--remote-debugging-port=5858', '--inspect=9292'], { detached: true });
  electron.unref();
}

main().catch(e => { console.error(e); process.exit(1); });
