'use strict';

const electron      = require('electron'),
      path          = require('path'),
      app           = electron.app,
      dialog        = electron.dialog,
      BrowserWindow = electron.BrowserWindow,
      ipcMain       = electron.ipcMain;

let mainWindow,
    config = {};

if (process.env.NODE_ENV === 'development') {
  config     = require('../config');
  config.url = `http://localhost:${config.port}`;
} else {
  config.devtron = false;
  config.url     = `file://${__dirname}/index.html`;
}

function createWindow() {
  /**
   * Initial window options
   */
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 720,
  });


  global.appRoot = path.resolve(__dirname);
  global.botPath = path.join(global.appRoot, 'gofbot');
  if (process.env.NODE_ENV === 'development') {
    global.botPath = path.join(global.appRoot, 'dist/gofbot')
  }

  mainWindow.loadURL(config.url);

  if (process.env.NODE_ENV === 'development') {
    BrowserWindow.addDevToolsExtension(path.join(__dirname, '../node_modules/devtron'));

    let installExtension = require('electron-devtools-installer');

    installExtension.default(installExtension.VUEJS_DEVTOOLS)
      .then((name) => mainWindow.webContents.openDevTools())
      .catch((err) => console.log('An error occurred: ', err))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  });

  console.log('mainWindow opened')
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (botProcess != null) {
    killBot()
  }
  app.quit()
});

app.on('will-quit', () => {
  if (botProcess != null) {
    killBot()
  }
});



app.on('activate', () => {
  if (mainWindow === null) {
    createWindow()
  }
});

let botProcess = null;

ipcMain.on('start-bot', function (event, loginInfos) {
  console.log('start bot received, starting the bot...');
  let infos = startBot(global.botPath, loginInfos);

  botProcess = infos.process;

  botProcess.stderr.on('data', (data) => {
    if (data.indexOf("ERROR") > -1) {
      dialog.showMessageBox({
        type:    "error",
        title:   "Whoops",
        message: "Error in python bot",
        detail:  "" + data,
        buttons: ["Yes I read carefully error message"]
      });
    }
  });

  botProcess.on('exit', () => {
    event.sender.send('bot-killed')
  });


  event.sender.send('bot-started', infos.userInfos)
});


let killBot = () => {
  console.log('Killing bot...');

  try {
    process.kill(-botProcess.pid, 'SIGINT');
    process.kill(-botProcess.pid, 'SIGTERM');
  } catch (e) {
    try {
      process.kill(botProcess.pid, 'SIGTERM');
    } catch (e) {
    }
  }

  botProcess = null;
  try {
    mainWindow.webContents.send('bot-killed')
  } catch (err) {}
}


ipcMain.on('kill-bot', killBot);

const os   = require('os'),
      fs   = require('fs-extra');


function ensureConfigFilePresent() {

  let setting_path = path.join(botPath, '/configs/config.json');
  try {
    //test to see if settings exist
    fs.openSync(setting_path, 'r+');
  } catch (err) {
    fs.renameSync(path.join(botPath, '/configs/config.json.example'), setting_path);
  }

}

function ensureUserdataFilePresent() {
  let user_path = path.join(botPath, '/web/config/userdata.js');
  try {
    fs.openSync(user_path, 'r+');
  } catch (err) {
    fs.renameSync(path.join(botPath, '/web/config/userdata.js.example'), user_path);
  }
}


const startBot = function (botPath, options) {
  // Rename config.json if needed
  ensureConfigFilePresent();


  // Load user config
  let data     = fs.readFileSync(path.join(botPath, '/configs/config.json'));
  let settings = JSON.parse(data);

  // activate web_socket
  settings.websocket_server = true;
  settings.websocket        = {
    "start_embedded_server": true,
    "server_url":            "0.0.0.0:7894",
    "remote_control":        true
  };

  // Load settings
  settings.auth_service = options.auth;
  if (settings.auth_service == 'google') {
    settings.password = options.options.google_password;
    settings.username = options.options.google_username;
  } else {
    settings.password = options.options.ptc_password;
    settings.username = options.options.ptc_username;
  }
  settings.gmapkey = options.options.google_maps_api;
  if (!!options.options.walk_speed) {
    settings.walk = parseFloat(options.options.walk_speed);
  }

  settings.location = options.location;

  let titleWorker = false;
  for (let i = 0; i < settings.tasks.length; i++) {
    if (settings.tasks[i].type == "UpdateLiveStats") {
      titleWorker = true;
    }
  }
  if (!titleWorker) {
    settings.tasks.unshift({
      "type":   "UpdateLiveStats",
      "config": {
        "min_interval":   1,
        "enabled":        true,
        "stats":          [
          "login",
          "uptime",
          "km_walked",
          "level_stats",
          "xp_earned",
          "xp_per_hour"
        ],
        "terminal_log":   true,
        "terminal_title": false
      }
    });
  }

  // force enabling of update live stat and force terminal title to false
  for (let i = 0; i < settings.tasks.length; i++) {
    if (settings.tasks[i].type == "UpdateLiveStats") {
      settings.tasks[i].config.enabled = true;
      settings.tasks[i].config.terminal_title = false;
    }
  }


  // Save user config
  fs.writeFileSync(path.join(botPath, '/configs/config.json'), JSON.stringify(settings, null, 4), 'utf-8');

  // Rename userdata.js if needed
  ensureUserdataFilePresent();


  let userdata_code = [
    'var userInfo = {',
    `    users: ["${settings.username}"],`,
    `    zoom: 16,`,
    `    userZoom: true,`,
    `    userFollow: true,`,
    `    imageExt: ".png",`,
    `    gMapsAPIKey: "${settings.gmapkey}",`,
    `    actionsEnabled: false`,
    `};`,
    '',
    `var dataUpdates = {`,
    `    updateTrainer: 1000,`,
    `    addCatchable: 1000,`,
    `    addInventory: 5000`,
    `};`
  ];

  // Write userdata for map
  fs.writeFileSync(path.join(botPath, '/web/config/userdata.js'), userdata_code.join('\n'), 'utf-8');


  let cmdLine = [
    './pokecli.py',
  ];

  let pythonCmd = 'python';
  if (os.platform() == 'win32') {
    pythonCmd = path.join(appRoot, 'pywin', 'python.exe');
  }

  // Create python bot process
  let subpy = require('child_process').spawn(pythonCmd, cmdLine, {
    cwd:      botPath,
    detached: true
  });

  return {
    userInfos: {
      users:          [settings.username],
      zoom:           16,
      userZoom:       true,
      userFollow:     true,
      botPath:        true,
      imageExt:       ".png",
      gMapsAPIKey:    settings.gmapkey,
      actionsEnabled: false,
      strokeOn:       true,
    },
    process:   subpy
  }
};


