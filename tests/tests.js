// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

function createData(size) {
  var arr = new Uint8Array(size);
  for (var i = 0; i < arr.length; i++) {
    arr[i] = i % 256;
  }
  return arr.buffer;
}

exports.defineManualTests = function(rootEl, addButton) {
  var addr = '127.0.0.1';
  var port = 12345;
  var smallData = createData(256);

  function receiveErrorListener(info) {
    console.log('Client RecvError on socket: ' + info.socketId);
    console.log(info);
    chrome.sockets.tcp.disconnect(info.socketId);
    chrome.sockets.tcp.close(info.socketId);
  }

  function receiveListener(info) {
    console.log('Client Recv: success');
    console.log(info);
    if (info.data) {
      var message = String.fromCharCode.apply(null, new Uint8Array(info.data));
      console.log(message);
    }
    chrome.sockets.tcp.disconnect(info.socketId);
    chrome.sockets.tcp.close(info.socketId);

    if (info.uri) {
      window.resolveLocalFileSystemURL(info.uri, function(fe) {
        fe.file(function(file) {
          var reader = new FileReader();
          reader.onloadend = function(e) {
            console.log('Onload End');
            console.log(e);
            console.log('result is ' + this.result);
          };

          reader.readAsText(file);
        });
      }, console.log);
    }
  }

  function addReceiveListeners() {
    chrome.sockets.tcp.onReceiveError.addListener(receiveErrorListener);
    chrome.sockets.tcp.onReceive.addListener(receiveListener);
  }

  function removeReceiveListeners() {
    chrome.sockets.tcp.onReceiveError.removeListener(receiveErrorListener);
    chrome.sockets.tcp.onReceive.removeListener(receiveListener);
  }

  function connect() {
    chrome.sockets.tcp.create(function(createInfo) {
      chrome.sockets.tcp.connect(createInfo.socketId, addr, port, function(result) {
        if (result === 0) {
          console.log('connect: success');
        }
      });
    });
  }

  function connectAndPause() {
    chrome.sockets.tcp.create(function(createInfo) {
      console.log('create socket: ' + createInfo.socketId);
      chrome.sockets.tcp.connect(createInfo.socketId, addr, port, function(result) {
        if (result === 0) {
          console.log('connect: success');
          chrome.sockets.tcp.setPaused(createInfo.socketId, true, function() {
            console.log('paused');
          });
        }
      });
    });
  }

  function connectAndSend(data) {
    chrome.sockets.tcp.create(function(createInfo) {
      chrome.sockets.tcp.connect(createInfo.socketId, addr, port, function(result) {
        if (result === 0) {
          chrome.sockets.tcp.send(createInfo.socketId, data, function(result) {
            if (result.resultCode === 0) {
              console.log('connectAndSend: success');
              chrome.sockets.tcp.disconnect(createInfo.socketId);
              chrome.sockets.tcp.close(createInfo.socketId);
            }
          });
        }
      });
    });
  }

  function stringToArrayBuffer(string) {
    var buf = new ArrayBuffer(string.length);
    var bufView = new Uint8Array(buf);
    for (var i = 0, strLen = string.length; i < strLen; i++) {
      bufView[i] = string.charCodeAt(i);
    }
    return buf;
  }

  function redirectToFile(append) {
    var hostname = 'httpbin.org';
    var requestString = 'GET /get HTTP/1.1\r\nHOST: ' + hostname + '\r\n\r\n';
    var message = stringToArrayBuffer(requestString);

    var options = {
      uri: cordova.file.applicationStorageDirectory + 'Documents/redirectToFile.txt',
      append: append,
      numBytes: 15
    };

    console.log(options);

    chrome.sockets.tcp.create(function(createInfo) {

      chrome.sockets.tcp.pipeToFile(createInfo.socketId, options, function() {
        console.log('file redirection is done');
      });

      chrome.sockets.tcp.connect(createInfo.socketId, hostname, 80, function(result) {
        if (result === 0) {
          chrome.sockets.tcp.send(createInfo.socketId, message, function(result) {
            console.log('send result: ' + result);
          });
        }
      });
    });
  }

  function connectSecureAndSend() {
    var hostname = 'httpbin.org';
    var requestString = 'GET /get HTTP/1.1\r\nHOST: ' + hostname + '\r\n\r\n';
    var message = stringToArrayBuffer(requestString);

    chrome.sockets.tcp.create(function(createInfo) {
      // Set paused to true to prevent read consume TLS handshake data, native
      // readling loop will not pause/abort pending read when set paused after a
      // connection has established.
      chrome.sockets.tcp.setPaused(createInfo.socketId, true, function() {
        chrome.sockets.tcp.connect(createInfo.socketId, hostname, 443, function(result) {
          if (result === 0) {
            chrome.sockets.tcp.secure(createInfo.socketId, {tlsVersion: {min: 'ssl3', max: 'tls1.2'}}, function(result) {
              if (result !== 0) {
                console.log('secure connection failed: ' + result);
              }

              chrome.sockets.tcp.setPaused(createInfo.socketId, false, function() {
                // Test secure send multiple times to ensure that buffer in Android is manipulated correctly.
                for (var i = 0; i < 3; i++) {
                  (function(i) {
                    chrome.sockets.tcp.send(createInfo.socketId, message, function(result) {
                      if (result.resultCode === 0) {
                        console.log('connectSecureAndSend: success ' + i);
                      }
                    });
                  })(i);
                }

              });
            });
          }
        });
      });
    });
  }

  // This method should fail on iOS and Desktop.
  function simpleStartTLS() {

    var startTLSReceiver = function(info) {
      var message = String.fromCharCode.apply(null, new Uint8Array(info.data));
      if (message.indexOf('Ready to start TLS' > -1)) {
        chrome.sockets.tcp.secure(info.socketId, function(result) {
          console.log('secure result:' + result);
          chrome.sockets.tcp.onReceive.removeListener(startTLSReceiver);
        });
      }
    };

    chrome.sockets.tcp.onReceive.addListener(startTLSReceiver);

    var addr = 'smtp.gmail.com';
    var port = 25;
    var command = stringToArrayBuffer('HELO me.com\r\nSTARTTLS\r\n');

    chrome.sockets.tcp.create(function(createInfo) {
      chrome.sockets.tcp.connect(createInfo.socketId, addr, port, function(result) {
        chrome.sockets.tcp.send(createInfo.socketId, command, function(result) {
          if (result === 0) {
            console.log('send command success');
          }
        });
      });
    });

  }

  function send(data) {
    chrome.sockets.tcp.create(function(createInfo) {
      chrome.sockets.tcp.send(createInfo.socketId, data, function(result) {
        if (result.resultCode === 0) {
          console.log('send: success');
          chrome.sockets.tcp.close(createInfo.socketId);
        } else {
          console.log('send error: ' + result.resultCode);
        }
      });
    });
  }

  function disconnectAndSend(data) {
    chrome.sockets.tcp.create(function(createInfo) {
      chrome.sockets.tcp.disconnect(createInfo.socketId, function() {
        chrome.sockets.tcp.send(createInfo.socketId, data, function(result) {
          if (result.resultCode === 0) {
            console.log('send: success');
            chrome.sockets.tcp.close(createInfo.socketId);
          } else {
            console.log('send error: ' + result.resultCode);
          }
        });
      });
    });
  }

  function getSockets() {
    chrome.sockets.tcp.getSockets(function(socketsInfo) {
      if (!socketsInfo) return;
      for (var i = 0; i < socketsInfo.length; i++) {
        console.log(socketsInfo[i]);
      }
    });
  }

  function updateSocket() {
    chrome.sockets.tcp.create({}, function(createInfo) {
      updatedProperties = {
        persistent: true,
        name: 'testUpdate',
        bufferSize: 2048
      };

      chrome.sockets.tcp.update(createInfo.socketId, updatedProperties);

      chrome.sockets.tcp.getInfo(createInfo.socketId, function(socketInfo) {
        console.log(socketInfo);
      });

    });
  }

  function closeSockets() {
    chrome.sockets.tcp.getSockets(function(socketsInfo) {
      if (!socketsInfo) return;
      for (var i = 0; i < socketsInfo.length; i++) {
        console.log('closing socket: ' + socketsInfo[i].socketId);
        chrome.sockets.tcp.close(socketsInfo[i].socketId);
      }
    });
  }

  function initPage() {
    console.log('Run this in terminal:');
    console.log('while true; do');
    console.log('  (nc -lv 12345 | xxd) || break; echo;');
    console.log('done');

    addButton('add receive listeners', function() {
      addReceiveListeners();
    });

    addButton('remove receive listeners', function() {
      removeReceiveListeners();
    });

    addButton('TCP: connect', function() {
      connect();
    });

    addButton('TCP: connect & paused', function() {
      connectAndPause();
    });

    addButton('TCP: connect & send', function() {
      connectAndSend(smallData);
    });

    addButton('TCP: test redirect to file with append', function() {
      redirectToFile(true);
    });

    addButton('TCP: test redirect to file without append', function() {
      redirectToFile(false);
    });

    addButton('TCP: connect & secure & send', function() {
      connectSecureAndSend();
    });

    addButton('TCP: test startTLS', function() {
      simpleStartTLS();
    });

    addButton('TCP: send to unconnected', function() {
      send(smallData);
    });

    addButton('TCP: unconnected & send', function() {
      disconnectAndSend(smallData);
    });

    addButton('TCP: update socket', function() {
      updateSocket();
    });

    addButton('TCP: get sockets', function() {
      getSockets();
    });

    addButton('TCP: close sockets', function() {
      closeSockets();
    });

  }

  initPage();
};

exports.defineAutoTests = function() {
  'use strict';

  require('cordova-plugin-chrome-apps-test-framework.jasmine_helpers').addJasmineHelpers();

  // constants
  var bindAddr = '0.0.0.0';
  var connectAddr = '127.0.0.1';
  var serverPort = Math.floor(Math.random() * (65535-1024)) + 1024; // random in 1024 -> 65535
  var smallData = createData(300);
  var bigData = createData(256 * 1024 + 1); // +1 to not be a multiple of buffer size.

  // Socket management -- Make sure we clean up sockets after each test, even upon failure
  var clientSockets = [];
  var serverSockets = [];

  function createSocket(properties, callback) {
    if (typeof properties == 'function') {
      callback = properties;
      properties = {};
    }
    chrome.sockets.tcp.create(properties, function(clientCreateInfo) {
      expect(clientCreateInfo).toBeTruthy();
      expect(clientCreateInfo.socketId).toBeDefined();
      clientSockets.push(clientCreateInfo);
      chrome.sockets.tcpServer.create(properties, function(serverCreateInfo) {
        expect(serverCreateInfo).toBeTruthy();
        expect(serverCreateInfo.socketId).toBeDefined();
        serverSockets.push(serverCreateInfo);
        callback();
      });
    });
  }

  function createSockets(count, callback) {
    if (!count)
      return setTimeout(callback, 0);
    createSocket(createSockets.bind(null, count-1, callback));
  }

  beforeEach(function() {
    var customMatchers = {
      toBeValidTcpReadResultEqualTo: function(util, customEqualityTesters) {
        return {
          compare: function(actual, expected) {
            if (!actual) return { message:'c', pass: false };
            return customMatchers.toBeArrayBuffer(util, customEqualityTesters).compare(actual.data, expected);
          }
        };
      },
      toBeArrayBuffer: function(util, customEqualityTesters) {
        return {
          compare: function(actual, expected) {
            if (Object.prototype.toString.call(expected).slice(8, -1) !== "ArrayBuffer")
              throw new Error("toBeValidTcpReadResultEqualTo expects an ArrayBuffer");
            if (!actual) return { message:'a', pass: false };
            if (Object.prototype.toString.call(actual).slice(8, -1) !== "ArrayBuffer") return { message:'b', pass: false };

            var sent = new Uint8Array(expected);
            var recv = new Uint8Array(actual);
            if (recv.length !== sent.length) {
              return {
                pass: false,
                message: "expected len: " + expected.byteLength + " got len: " + actual.byteLength
              };
            }

            for (var i = 0; i < recv.length; i++) {
              if (recv[i] !== sent[i]) {
                result.pass = false;
                return { pass: false, message: "bytes differed at index " + i }
              }
            }
            return {pass:true};
          }
        };
      }
    };

    jasmine.addMatchers(customMatchers);
  });

  beforeEach(function(done) {
    createSockets(1, done);
  });

  afterEach(function() {
    clientSockets.forEach(function(createInfo) {
      chrome.sockets.tcp.disconnect(createInfo.socketId);
      chrome.sockets.tcp.close(createInfo.socketId);
    });
    clientSockets = [];

    serverSockets.forEach(function(createInfo) {
      chrome.sockets.tcpServer.disconnect(createInfo.socketId);
      chrome.sockets.tcpServer.close(createInfo.socketId);
    });
    serverSockets = [];
  });

  it('should contain definitions', function() {
    expect(chrome.sockets.tcp.create).toBeDefined();
    expect(chrome.sockets.tcp.update).toBeDefined();
    expect(chrome.sockets.tcp.setPaused).toBeDefined();
    expect(chrome.sockets.tcp.setKeepAlive).toBeDefined();
    expect(chrome.sockets.tcp.setNoDelay).toBeDefined();
    expect(chrome.sockets.tcp.connect).toBeDefined();
    expect(chrome.sockets.tcp.disconnect).toBeDefined();
    expect(chrome.sockets.tcp.secure).toBeDefined();
    expect(chrome.sockets.tcp.send).toBeDefined();
    expect(chrome.sockets.tcp.close).toBeDefined();
    expect(chrome.sockets.tcp.getInfo).toBeDefined();
    expect(chrome.sockets.tcp.getSockets).toBeDefined();

    expect(chrome.sockets.tcpServer.create).toBeDefined();
    expect(chrome.sockets.tcpServer.update).toBeDefined();
    expect(chrome.sockets.tcpServer.setPaused).toBeDefined();
    expect(chrome.sockets.tcpServer.listen).toBeDefined();
    expect(chrome.sockets.tcpServer.disconnect).toBeDefined();
    expect(chrome.sockets.tcpServer.close).toBeDefined();
    expect(chrome.sockets.tcpServer.getInfo).toBeDefined();
    expect(chrome.sockets.tcpServer.getSockets).toBeDefined();
  });

  describe('TCP and TCPServer', function() {
    afterEach(function() {
      chrome.sockets.tcpServer.onAccept.listeners.length = 0;
      chrome.sockets.tcp.onReceive.listeners.length = 0;
    });

    it('port is available (sanity test)', function(done) {
      chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
        expect(listenResult).toEqual(0);
        done();
      });
    });

    it('TCP connect to TCPServer', function(done) {
      chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
        expect(listenResult).toEqual(0);
        chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
          expect(connectResult).toEqual(0);
          done();
        });
      });
    });

    it('TCP getInfo works', function(done) {
      chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
        expect(listenResult).toEqual(0);
        chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcp.getInfo(clientSockets[0].socketId, function(socketInfo) {
            expect(socketInfo.socketId).toBeTruthy();
            expect(socketInfo.connected).toBe(true);
            expect(socketInfo.paused).toBe(false);
            expect(socketInfo.localAddress).toBeTruthy();
            expect(socketInfo.localPort).toBeTruthy();
            expect(socketInfo.peerAddress).toBeTruthy();
            expect(socketInfo.peerPort).toBeTruthy();
            done();
          });
        });
      });
    });

    it('TCPServer getInfo works', function(done) {
      chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
        expect(listenResult).toEqual(0);
        chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcpServer.getInfo(serverSockets[0].socketId, function(socketInfo) {
            expect(socketInfo.socketId).toBeTruthy();
            expect(socketInfo.paused).toBe(false);
            expect(socketInfo.localAddress).toBeTruthy();
            expect(socketInfo.localPort).toBeTruthy();
            done();
          });
        });
      });
    });

    it('update TCP socket', function(done) {
      var updatedProperties = {
        persistent: true,
        name: 'testUpdate',
        bufferSize: 2048
      };

      chrome.sockets.tcp.update(clientSockets[0].socketId, updatedProperties, function() {
        chrome.sockets.tcp.getInfo(clientSockets[0].socketId, function(socketInfo) {
          expect(socketInfo.persistent).toEqual(updatedProperties.persistent);
          expect(socketInfo.bufferSize).toEqual(updatedProperties.bufferSize);
          expect(socketInfo.name).toEqual(updatedProperties.name);
          done();
        });
      });
    });

    it('update TCPServer socket', function(done) {
      var updatedProperties = {
        persistent: true,
        name: 'testUpdate'
      };

      chrome.sockets.tcpServer.update(serverSockets[0].socketId, updatedProperties, function() {
        chrome.sockets.tcpServer.getInfo(serverSockets[0].socketId, function(socketInfo) {
          expect(socketInfo.persistent).toEqual(updatedProperties.persistent);
          expect(socketInfo.name).toEqual(updatedProperties.name);
          done();
        });
      });
    });

    it('TCP connect write', function(done) {
      var acceptListener = function(info) {
        expect(info.socketId).toEqual(serverSockets[0].socketId);
        expect(info.clientSocketId).toBeTruthy();
        chrome.sockets.tcp.setPaused(info.clientSocketId, false, function() {
          chrome.sockets.tcpServer.onAccept.removeListener(acceptListener);
        });
      };
      chrome.sockets.tcpServer.onAccept.addListener(acceptListener);

      var recvListener = function(info) {
        expect(info.socketId).not.toEqual(clientSockets[0].socketId);
        expect(info).toBeValidTcpReadResultEqualTo(smallData);
        chrome.sockets.tcp.onReceive.removeListener(recvListener);
        done();
      };
      chrome.sockets.tcp.onReceive.addListener(recvListener);

      chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
        expect(listenResult).toEqual(0);
        chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcp.send(clientSockets[0].socketId, smallData, function(result) {
            expect(result.resultCode).toEqual(0);
            expect(result.bytesSent).toEqual(smallData.byteLength);
          });
        });
      });
    });

    it('TCP connect write big', function(done) {
      var acceptListener = function(info) {
        expect(info.socketId).toEqual(serverSockets[0].socketId);
        expect(info.clientSocketId).toBeTruthy();
        chrome.sockets.tcp.setPaused(info.clientSocketId, false, function() {
          chrome.sockets.tcpServer.onAccept.removeListener(acceptListener);
        });
      };
      chrome.sockets.tcpServer.onAccept.addListener(acceptListener);

      var amountReceived = 0;

      var recvListener = function(info) {
        expect(info.socketId).not.toEqual(clientSockets[0].socketId);
        expect(info.data).toBeArrayBuffer(bigData.slice(amountReceived, amountReceived + info.data.byteLength));
        amountReceived += info.data.byteLength;
        if (amountReceived == bigData.byteLength) {
          done();
        }
      };
      chrome.sockets.tcp.onReceive.addListener(recvListener);

      chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
        expect(listenResult).toEqual(0);
        chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcp.send(clientSockets[0].socketId, bigData, function(result) {
            expect(result.resultCode).toEqual(0);
            expect(result.bytesSent).toEqual(bigData.byteLength);
          });
        });
      });
    }, 4000);

    it('TCPServer connect write', function(done) {
      var acceptListener = function(info) {
        expect(info.socketId).toEqual(serverSockets[0].socketId);
        expect(info.clientSocketId).toBeTruthy();
        chrome.sockets.tcp.send(info.clientSocketId, smallData, function(result) {
          expect(result.resultCode).toEqual(0);
          expect(result.bytesSent).toEqual(smallData.byteLength);
          chrome.sockets.tcpServer.onAccept.removeListener(acceptListener);
        });
      };
      chrome.sockets.tcpServer.onAccept.addListener(acceptListener);

      var recvListener = function(info) {
        expect(info.socketId).toEqual(clientSockets[0].socketId);
        expect(info).toBeValidTcpReadResultEqualTo(smallData);
        chrome.sockets.tcp.onReceive.removeListener(recvListener);
        done();
      };
      chrome.sockets.tcp.onReceive.addListener(recvListener);

      chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
        expect(listenResult).toEqual(0);
        chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
          expect(connectResult).toEqual(0);
        });
      });
    });

    describeExcludeChrome('fail on desktop', function() {

      it('TCP file redirect partial data', function(done) {
        var acceptListener = function(info) {
          expect(info.socketId).toEqual(serverSockets[0].socketId);
          expect(info.clientSocketId).toBeTruthy();
          chrome.sockets.tcp.send(info.clientSocketId, smallData, function(result) {
            expect(result.resultCode).toEqual(0);
            expect(result.bytesSent).toEqual(smallData.byteLength);
            chrome.sockets.tcpServer.onAccept.removeListener(acceptListener);
          });
        };

        chrome.sockets.tcpServer.onAccept.addListener(acceptListener);

        var pipeOptions = {
          uri: cordova.file.applicationStorageDirectory + 'Documents/redirectToFilePartial.txt',
          append: false,
          numBytes: 128
        };

        var callCounter = 0;
        var recvListener = function(info) {
          callCounter++;
          if (callCounter === 1) {
            expect(info.socketId).toEqual(clientSockets[0].socketId);
            expect(info.uri).toBeDefined();
            expect(info.bytesRead).toEqual(pipeOptions.numBytes);
          } else {
            window.resolveLocalFileSystemURL(pipeOptions.uri, function(fe) {
              fe.file(function(file) {
                var reader = new FileReader();
                reader.onloadend = function() {
                  var allData = new Uint8Array(info.data.byteLength + pipeOptions.numBytes);
                  allData.set(new Uint8Array(this.result), 0);
                  allData.set(new Uint8Array(info.data), pipeOptions.numBytes);
                  expect(allData.buffer).toBeArrayBuffer(smallData);
                  chrome.sockets.tcp.onReceive.removeListener(recvListener);
                  done();
                };
                reader.readAsArrayBuffer(file);
              });
            }, null);
          }
        };
        chrome.sockets.tcp.onReceive.addListener(recvListener);

        chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
          expect(listenResult).toEqual(0);
          chrome.sockets.tcp.pipeToFile(clientSockets[0].socketId, pipeOptions, function() {});
          chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
            expect(connectResult).toEqual(0);
          });
        });
      });


      it('TCP file redirect all data', function(done) {
        var acceptListener = function(info) {
          expect(info.socketId).toEqual(serverSockets[0].socketId);
          expect(info.clientSocketId).toBeTruthy();
          chrome.sockets.tcp.send(info.clientSocketId, smallData, function(result) {
            expect(result.resultCode).toEqual(0);
            expect(result.bytesSent).toEqual(smallData.byteLength);
            chrome.sockets.tcpServer.onAccept.removeListener(acceptListener);
          });
        };

        chrome.sockets.tcpServer.onAccept.addListener(acceptListener);

        var recvListener = function(info) {
          expect(info.socketId).toEqual(clientSockets[0].socketId);
          expect(info.uri).toBeDefined();
          chrome.sockets.tcp.onReceive.removeListener(recvListener);
        };
        chrome.sockets.tcp.onReceive.addListener(recvListener);

        chrome.sockets.tcpServer.listen(serverSockets[0].socketId, bindAddr, serverPort, function(listenResult) {
          expect(listenResult).toEqual(0);

          var pipeOptions = {
            uri: cordova.file.applicationStorageDirectory + 'Documents/redirectToFileAll.txt',
            append: false,
            numBytes: smallData.byteLength
          };

          chrome.sockets.tcp.pipeToFile(clientSockets[0].socketId, pipeOptions, function() {
            window.resolveLocalFileSystemURL(pipeOptions.uri, function(fe) {
              fe.file(function(file) {
                var reader = new FileReader();
                reader.onloadend = function() {
                  expect(this.result.byteLength).toBe(smallData.byteLength);
                  expect(this.result).toBeArrayBuffer(smallData);
                  done();
                };
                reader.readAsArrayBuffer(file);
              });
            }, null);
          });

          chrome.sockets.tcp.connect(clientSockets[0].socketId, connectAddr, serverPort, function(connectResult) {
            expect(connectResult).toEqual(0);
          });
        });
      });
    });

    it('TCP secure get https website', function(done) {
      var hostname = 'ajax.googleapis.com';
      var port = 443;
      var requestString = 'GET /ajax/libs/jquery/2.1.3/jquery.min.js HTTP/1.1\r\nHOST: ' + hostname + '\r\n\r\n';
      var request = new ArrayBuffer(requestString.length);
      var reqView = new Uint8Array(request);
      for (var i = 0, strLen = requestString.length; i < strLen; i++) {
        reqView[i] = requestString.charCodeAt(i);
      }

      var amountReceived = 0;
      var timeoutId = setTimeout(function() {
        console.warn('jquery only got: ' + amountReceived + ' of 84320 bytes');
      }, 7000);

      var recvListener = function(info) {
        expect(info.socketId).toEqual(clientSockets[0].socketId);
        amountReceived += info.data.byteLength;
        // 84320 is size of body, but will be more from headers.
        if (amountReceived > 84320) {
          clearTimeout(timeoutId);
          done();
        }
      };
      chrome.sockets.tcp.onReceive.addListener(recvListener);

      chrome.sockets.tcp.setPaused(clientSockets[0].socketId, true, function() {
        chrome.sockets.tcp.connect(clientSockets[0].socketId, hostname, port, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcp.secure(clientSockets[0].socketId, function(secureResult) {
            expect(secureResult).toEqual(0);
            chrome.sockets.tcp.send(clientSockets[0].socketId, request, function(sendResult) {
              expect(sendResult.resultCode).toEqual(0);
              expect(sendResult.bytesSent).toEqual(requestString.length);
              chrome.sockets.tcp.setPaused(clientSockets[0].socketId, false);
            });
          });
        });
      });
    }, 7000);

    it('TCP secure get https website three times', function(done) {
      var hostname = 'httpbin.org';
      var port = 443;
      var requestString = 'GET /get HTTP/1.1\r\nHOST: ' + hostname + '\r\n\r\n';
      var request = new ArrayBuffer(requestString.length);
      var reqView = new Uint8Array(request);
      var recvCounter = 0;
      for (var i = 0, strLen = requestString.length; i < strLen; i++) {
        reqView[i] = requestString.charCodeAt(i);
      }

      var recvListener = function(info) {
        recvCounter++;
        expect(info.socketId).toEqual(clientSockets[0].socketId);
        expect(info.data.byteLength).toBeGreaterThan(0);
        if (recvCounter == 3) {
          chrome.sockets.tcp.onReceive.removeListener(recvListener);
          done();
        }
      };
      chrome.sockets.tcp.onReceive.addListener(recvListener);

      chrome.sockets.tcp.setPaused(clientSockets[0].socketId, true, function() {
        chrome.sockets.tcp.connect(clientSockets[0].socketId, hostname, port, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcp.secure(clientSockets[0].socketId, function(secureResult) {
            expect(secureResult).toEqual(0);
            for (var i = 0; i < 3; i++) {
              chrome.sockets.tcp.send(clientSockets[0].socketId, request, function(sendResult) {
                expect(sendResult.resultCode).toEqual(0);
                expect(sendResult.bytesSent).toEqual(requestString.length);
                chrome.sockets.tcp.setPaused(clientSockets[0].socketId, false);
              });
            }
          });
        });
      });
    }, 5000);

    it('TLS version control', function(done) {
      var hostname = 'www.howsmyssl.com';
      var port = 443;
      var requestString = 'GET /a/check HTTP/1.1\r\nHOST: ' + hostname + '\r\n\r\n';
      var request = new ArrayBuffer(requestString.length);
      var reqView = new Uint8Array(request);
      for (var i = 0, strLen = requestString.length; i < strLen; i++) {
        reqView[i] = requestString.charCodeAt(i);
      }

      var decoder = new TextDecoder();
      var response = '';

      var checkResponse = function() {
        var parts = response.split('\r\n\r\n');
        if (parts.length < 2) {
          return;  // We haven't hit the end of the headers yet.
        }
        try {
          var a = JSON.parse(parts[1]);
          expect(a.tls_version).toEqual('TLS 1.2');
          done();
        } catch (e) {
          // Probably the response is just incomplete.
        }
      };

      var recvListener = function(info) {
        expect(info.socketId).toEqual(clientSockets[0].socketId);
        response += decoder.decode(info.data);
        checkResponse();
      };
      chrome.sockets.tcp.onReceive.addListener(recvListener);

      chrome.sockets.tcp.setPaused(clientSockets[0].socketId, true, function() {
        chrome.sockets.tcp.connect(clientSockets[0].socketId, hostname, port, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcp.secure(clientSockets[0].socketId, {tlsVersion: {min: 'tls1.2', max: 'tls1.2'}}, function(secureResult) {
            expect(secureResult).toEqual(0);
            chrome.sockets.tcp.send(clientSockets[0].socketId, request, function(sendResult) {
              expect(sendResult.resultCode).toEqual(0);
              expect(sendResult.bytesSent).toEqual(requestString.length);
              chrome.sockets.tcp.setPaused(clientSockets[0].socketId, false);
            });
          });
        });
      });
    }, 7000);

    it('TLS failure detection', function(done) {
      var hostname = 'google.com';
      var port = 80;  // Not a TLS server!
      chrome.sockets.tcp.setPaused(clientSockets[0].socketId, true, function() {
        chrome.sockets.tcp.connect(clientSockets[0].socketId, hostname, port, function(connectResult) {
          expect(connectResult).toEqual(0);
          chrome.sockets.tcp.secure(clientSockets[0].socketId, function(secureResult) {
            expect(secureResult).not.toEqual(0);
            done();
          });
        });
      });
    }, 7000);
  });
};
