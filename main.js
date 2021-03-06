'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const express = require('express');
const WebSocket = require('ws');
const assert = require('assert');

const captchaViewServerPort = 8456;
const captchaHarvestServerPort = 8457;

let captchaWindows = {};

const createCaptchaWindow = (pageUrl, sitekey, captchaId, autoClick) => {
  let captchaWindow = new BrowserWindow({
    width: 320,
    height: 92,
    show: true,
    frame: true,
    resizeable: false
  });

  captchaWindow.once('closed', () => {
    // Captcha has failed if we haven't responded by now
    ipcMain.emit(`failed-captcha-${captchaId}`);

    captchaWindow = null;
  });

  captchaWindow.once('ready-to-show', () => {
    captchaWindow.show();
  });

  captchaWindow.webContents.session.setProxy({
    proxyRules: `http://127.0.0.1:${captchaViewServerPort}`,
    pacScript: '',
    proxyBypassRules: '.google.com, .gstatic.com'
  }, () => {
    captchaWindow.loadURL(`${pageUrl}?sitekey=${sitekey}&captchaId=${captchaId}&autoClick=${autoClick}`);
  });

  captchaWindows[captchaId] = captchaWindow;
};

const startCaptchaViewServer = () => {
  const expressApp = express();

  expressApp.get('/', (req, res) => {
    res.sendFile('./captcha.html', {
      root: __dirname
    });
  });

  expressApp.listen(captchaViewServerPort);
};

const startCaptchaHarvestServer = () => {
  const wss = new WebSocket.Server({
    port: captchaHarvestServerPort
  });

  const handleCaptchaRequest = (ws, data) => {
    const pageUrl = data['pageUrl'];
    const sitekey = data['sitekey'];
    const captchaId = data['captchaId'];
    const autoClick = data['autoClick'];

    assert.notEqual(pageUrl, undefined);
    assert.notEqual(sitekey, undefined);
    assert.notEqual(captchaId, undefined);

    createCaptchaWindow(pageUrl, sitekey, captchaId, autoClick);

    // Make sure we don't respond twice
    let hasResponsed = false;

    ipcMain.once(`failed-captcha-${captchaId}`, () => {
      if (hasResponsed) {
        return;
      }

      const response = {
        type: 'Error',
        data: 'Captcha Window Closed'
      };
      ws.send(JSON.stringify(response));
      hasResponsed = true;
    });

    ipcMain.once(`submit-captcha-${captchaId}`, (event, arg) => {
      if (hasResponsed) {
        return;
      }

      captchaWindows[captchaId].close();

      const response = {
        type: 'CaptchaResponse',
        data: {
          value: arg.value,
          createdAt: arg.createdAt
        }
      };
      ws.send(JSON.stringify(response));
      hasResponsed = true;
    });
  };

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        const messageType = parsedMessage['type'];
        const messageData = parsedMessage['data'];

        switch (messageType) {
          case 'CaptchaRequest':
            handleCaptchaRequest(ws, messageData);
            break;
        }
      } catch (e) {
        console.log(e);
        
        const response = {
          type: 'Error',
          data: 'Invalid Message Format'
        };
        ws.send(JSON.stringify(response));
      }
    });
  });
};

try {
  app.on('ready', () => {
    startCaptchaViewServer();
    startCaptchaHarvestServer();
  });

  app.on('window-all-closed', () => {
    // TODO: Do something here?
  });
} catch (e) {
  throw e;
}
