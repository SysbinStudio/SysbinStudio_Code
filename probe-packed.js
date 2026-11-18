/* 在打包环境里探测：把 app 指向已打好包的 app.asar，
   验证真实产物能否打开传入的文件（含 asar 读取、python 解包目录定位）。 */
const path = require('path'), fs = require('fs');
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

const ASAR = path.resolve('dist/win-unpacked/resources/app.asar');
console.log('defaultApp =', process.defaultApp);
console.log('app.asar 存在 =', fs.existsSync(ASAR));

// 模拟 main.js 在打包态的行为：defaultApp 为 false
Object.defineProperty(process, 'defaultApp', { value: false, configurable: true });

app.whenReady().then(async () => {
  // 解包目录必须被kernel.py 找到
  const unpacked = ASAR.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
  const kernel = path.join(unpacked, 'kernel.py');
  const py= path.join(unpacked, 'python', 'python.exe');
  console.log('kernel.py 可读 =', fs.existsSync(kernel));
  console.log('内置python 存在 =', fs.existsSync(py));

  const asar = require('@electron/asar');
  const main = asar.extractFile(ASAR, 'main.js').toString('utf8');
  // 直接在打包态下跑一遍参数解析
  const sandbox = { __filename: path.join(ASAR,'main.js'), __dirname: path.dirname(ASAR) };
  const fn = new Function('process','require','__filename','__dirname',
    main.slice(main.indexOf('function targetsFromArgv'), main.indexOf('/* ══════════════════════ 窗口')));
  console.log('打包态 argv=["kernel.py"] 解析结果 =',
    JSON.stringify(fn(process, require, sandbox.__filename, sandbox.__dirname)([process.execPath,'kernel.py'])));
  console.log('打包态 argv=["src"] 解析结果 =',
    JSON.stringify(fn(process, require, sandbox.__filename, sandbox.__dirname)([process.execPath,'src'])));
  console.log('打包态 argv=[exe自身] 解析结果 =',
    JSON.stringify(fn(process, require, sandbox.__filename, sandbox.__dirname)([process.execPath, process.execPath])));
  app.exit(0);
});
