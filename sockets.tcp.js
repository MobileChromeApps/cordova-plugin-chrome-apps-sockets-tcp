// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
var Event = require('cordova-plugin-chrome-apps-common.events');
var platform = cordova.require('cordova/platform');
var exec = cordova.require('cordova/exec'),
    ERROR_CODES = {
        SOCKET_CLOSED_BY_SERVER: {
            ANDROID: [-100],
            IOS: [7],
            STANDARDISED: 1
        },
        CONNECTION_TIMED_OUT: {
            ANDROID: [-118, -2],
            IOS: [57],
            STANDARDISED: 2
        }
    },
    OS = platform.id === 'android' ? 'ANDROID' : 'IOS';

exports.create = function(properties, callback) {
    if (typeof properties == 'function') {
        callback = properties;
        properties = {};
    }
    var win = callback && function(socketId) {
        var createInfo = {
            socketId: socketId
        };
        callback(createInfo);
    };
    exec(win, null, 'ChromeSocketsTcp', 'create', [properties]);
};

exports.update = function(socketId, properties, callback) {
    exec(callback, null, 'ChromeSocketsTcp', 'update', [socketId, properties]);
};

exports.setPaused = function(socketId, paused, callback) {
    exec(callback, null, 'ChromeSocketsTcp', 'setPaused', [socketId, paused]);
};

exports.setKeepAlive = function(socketId, enabled, delay, callback) {
    if (typeof delay == 'function') {
        callback = delay;
        delay = 0;
    }
    if (platform.id == 'android') {
        var win = callback && function() {
            callback(0);
        };
        var fail = callback && function(error) {
            exports.onReceiveError.fire(error);
        };
        exec(win, fail, 'ChromeSocketsTcp', 'setKeepAlive', [socketId, enabled, delay]);
    } else {
        console.warn('chrome.sockets.tcp.setKeepAlive not implemented yet, issue #391');
    }
};

exports.setNoDelay = function(socketId, noDelay, callback) {
    if (platform.id == 'android') {
        var win = callback && function() {
            callback(0);
        };
        var fail = callback && function(error) {
            exports.onReceiveError.fire(error);
        };
        exec(win, fail, 'ChromeSocketsTcp', 'setNoDelay', [socketId, noDelay]);
    } else {
        console.warn('chrome.sockets.tcp.setNoDelay not implemented yet, issue #391');
    }
};

exports.connect = function(socketId, peerAddress, peerPort, callback) {
    var win = callback && function() {
        callback(0);
    };
    var fail = callback && function(error) {
        exports.onReceiveError.fire(error);
    };
    exec(win, fail, 'ChromeSocketsTcp', 'connect', [socketId, peerAddress, peerPort]);
};

exports.disconnect = function(socketId, callback) {
    exec(callback, null, 'ChromeSocketsTcp', 'disconnect', [socketId]);
};

exports.secure = function(socketId, options, callback) {
    if (typeof options == 'function') {
        callback = options;
        options = {};
    }
    var win = callback && function() {
        callback(0);
    };
    var fail = callback && function(error) {
        exports.onReceiveError.fire(error);
    };
    exec(win, fail, 'ChromeSocketsTcp', 'secure', [socketId, options]);
};

exports.send = function(socketId, data, callback) {
    var type = Object.prototype.toString.call(data).slice(8, -1);
    if (type != 'ArrayBuffer') {
        throw new Error('chrome.sockets.tcp.send - data is not an Array Buffer! (Got: ' + type + ')');
    }
    var win = callback && function(bytesSent) {
        var sendInfo = {
            bytesSent: bytesSent,
            resultCode: 0
        };
        callback(sendInfo);
    };
    var fail = callback && function(error) {
        var sendInfo = {
            bytesSent: 0,
            resultCode: error.resultCode
        };
         exports.onReceiveError.fire(error, sendInfo);
    };
    if (data.byteLength == 0) {
      win(0);
    } else {
      exec(win, fail, 'ChromeSocketsTcp', 'send', [socketId, data]);
    }
};

exports.close = function(socketId, callback) {
    exec(callback, null, 'ChromeSocketsTcp', 'close', [socketId]);
};

exports.getInfo = function(socketId, callback) {
    var win = callback && function(result) {
        result.persistent = !!result.persistent;
        result.paused = !!result.paused;
        callback(result);
    };
    exec(win, null, 'ChromeSocketsTcp', 'getInfo', [socketId]);
};

exports.getSockets = function(callback) {
    var win = callback && function(results) {
        for (var result in results) {
            result.persistent = !!result.persistent;
            result.paused = !!result.paused;
        }
        callback(results);
    };
    exec(win, null, 'ChromeSocketsTcp', 'getSockets', []);
};

exports.pipeToFile = function(socketId, options, callback) {
    exec(callback, null, 'ChromeSocketsTcp', 'pipeToFile', [socketId, options]);
};

exports.onReceive = new Event('onReceive');
exports.onReceiveError = new Event('onReceiveError');

function registerReceiveEvents() {

    var win = function(info, data) {
        if (data) { // Binary data has to be a top level argument.
            info.data = data;
        }
        exports.onReceive.fire(info);

        if (data) { // Only exec readyToRead when not redirect to file

            // readyToRead signals the plugin to read the next tcp packet. exec
            // it after fire() will allow all API calls in the onReceive
            // listener exec before next read, such as, pause the socket.
            exec(null, null, 'ChromeSocketsTcp', 'readyToRead', []);
        }
    };

    // TODO: speical callback for android, DELETE when multipart result for
    // android is avaliable
    if (platform.id == 'android') {
        win = (function() {
            var recvInfo;
            var call = 0;
            return function(info) {
                if (call === 0) {
                    recvInfo = info;
                    if (!recvInfo.uri) {
                        call++;

                        // uri implies only one callback becasue redirect to
                        // file is enabled, and binary data is not included in
                        // the receiveInfo.
                        return;
                    }
                } else {
                    recvInfo.data = info;
                    call = 0;
                }
                exports.onReceive.fire(recvInfo);
                if (recvInfo.data) { // Only exec readyToRead when not redirect to file

                    // readyToRead signals the plugin to read the next tcp
                    // packet. exec it after fire() will allow all API calls in
                    // the onReceive listener exec before next read, such as,
                    // pause the socket.
                    exec(null, null, 'ChromeSocketsTcp', 'readyToRead', [recvInfo.socketId]);
                }
            };
        })();
    }

    function getStandardiseErrorCode(errorCode) {
        var matchedError = Object.keys(ERROR_CODES).find(function (type) {
                return ERROR_CODES[type][OS].includes(errorCode);
            });

        return matchedError ? ERROR_CODES[matchedError].STANDARDISED : errorCode;
    }

    var fail = function (info) {
        info.resultCode = getStandardiseErrorCode(info.resultCode);

        exports.onReceiveError.fire(info);
    };

    exec(win, fail, 'ChromeSocketsTcp', 'registerReceiveEvents', []);
}

require('cordova-plugin-chrome-apps-common.helpers').runAtStartUp(registerReceiveEvents);
