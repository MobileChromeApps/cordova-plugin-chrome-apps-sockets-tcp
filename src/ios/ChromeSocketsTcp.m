// Copyright (c) 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#import "ChromeSocketsTcp.h"
#import "GCDAsyncSocket.h"

#ifndef CHROME_SOCKETS_TCP_VERBOSE_LOGGING
#define CHROME_SOCKETS_TCP_VERBOSE_LOGGING 0
#endif

#if CHROME_SOCKETS_TCP_VERBOSE_LOGGING
#define VERBOSE_LOG NSLog
#else
#define VERBOSE_LOG(args...) do {} while (false)
#endif

#if CHROME_SOCKETS_TCP_VERBOSE_LOGGING
static NSString* stringFromData(NSData* data) {
    NSUInteger len = [data length];
    if (len > 200) {
        len = 200;
    }
    char* buf = (char*)malloc(len + 1);
    memcpy(buf, [data bytes], len);
    buf[len] = 0;
    NSString* ret = [NSString stringWithUTF8String:buf];
    free(buf);
    return ret;
}
#endif  // CHROME_SOCKETS_TCP_VERBOSE_LOGGING

#pragma mark ChromeSocketsTcpSocket interface

@interface ChromeSocketsTcpSocket : NSObject {
    @public
    __weak ChromeSocketsTcp* _plugin;

    NSUInteger _socketId;
    NSNumber* _persistent;
    NSString* _name;
    NSNumber* _bufferSize;

    // pipeToFile options
    NSNumber* _append;
    NSString* _uri;
    NSFileHandle* _uriFileHandle;
    NSInteger _numBytes;
    id _pipeToFileCompleteCallback;
    long _bytesReadNotSend;
    NSTimeInterval _lastProgressTimestamp;

    NSUInteger _readTag;
    NSUInteger _receivedTag;

    NSNumber* _paused;
    NSMutableArray* _pausedBuffers;

    GCDAsyncSocket* _socket;

    NSMutableArray* _sendCallbacks;

    id _connectCallback;
    id _disconnectCallback;
    id _secureCallback;
}

@end

#pragma mark ChromeSocketsTcp interface

@interface ChromeSocketsTcp() {
    NSMutableDictionary* _sockets;
    NSUInteger _nextSocketId;
    NSString* _receiveEventsCallbackId;

    @public
    NSInteger _pendingReceive;
}

- (void)create:(CDVInvokedUrlCommand*)command;
- (void)update:(CDVInvokedUrlCommand*)command;
- (void)setPaused:(CDVInvokedUrlCommand*)command;
// - (void)setKeepAlive:(CDVInvokedUrlCommand*)command;
// - (void)setNoDelay:(CDVInvokedUrlCommand*)command;
- (void)connect:(CDVInvokedUrlCommand*)command;
- (void)disconnect:(CDVInvokedUrlCommand*)command;
- (void)secure:(CDVInvokedUrlCommand*)command;
- (void)send:(CDVInvokedUrlCommand*)command;
- (void)close:(CDVInvokedUrlCommand*)command;
- (void)getInfo:(CDVInvokedUrlCommand*)command;
- (void)getSockets:(CDVInvokedUrlCommand*)command;
- (void)pipeToFile:(CDVInvokedUrlCommand*)command;
- (void)registerReceiveEvents:(CDVInvokedUrlCommand*)command;
- (void)readyToRead:(CDVInvokedUrlCommand*)command;
- (void)fireReceiveEventsWithSocketId:(NSUInteger)theSocketId data:(NSData*)theData;
- (void)fireReceiveEventsWithInfo:(NSDictionary*)theInfo waitReadyToRead:(BOOL)waitReadyToRead;
- (void)fireReceiveErrorEventsWithSocketId:(NSUInteger)theSocketId errorCode:(NSUInteger)theErrorCode message:(NSString*)theMessage;
@end

@implementation ChromeSocketsTcpSocket

NSTimeInterval const PIPE_TO_FILE_PROGRESS_INTERVAL = 0.1;

- (ChromeSocketsTcpSocket*)initWithId:(NSUInteger)theSocketId plugin:(ChromeSocketsTcp*)thePlugin properties:(NSDictionary*)theProperties
{
    self = [super init];
    if (self) {
        _socketId = theSocketId;
        _plugin = thePlugin;
        _paused = [NSNumber numberWithBool:NO];
        _socket = [[GCDAsyncSocket alloc] initWithDelegate:self delegateQueue:dispatch_get_main_queue()];
        [self resetSocket];
        [self setProperties:theProperties];
    }
    return self;
}

- (ChromeSocketsTcpSocket*)initAcceptedSocketWithId:(NSUInteger)theSocketId plugin:(ChromeSocketsTcp*)thePlugin socket:(GCDAsyncSocket*)theSocket
{
    self = [super init];
    if (self) {
        _socketId = theSocketId;
        _plugin = thePlugin;
        _socket = theSocket;
        [_socket setDelegate:self];
        _paused = [NSNumber numberWithBool:YES];
        [self resetSocket];
        [self setProperties:nil];
    }
    return self;
}

- (void)resetSocket
{
    _readTag = 0;
    _receivedTag = 0;
    _pausedBuffers = [NSMutableArray array];
    _sendCallbacks = [NSMutableArray array];
    _connectCallback = nil;
    _disconnectCallback = nil;
    _secureCallback = nil;
    [self resetPipeToFileProperties];
}

- (void)resetPipeToFileProperties
{
    if (_uriFileHandle) {
        [_uriFileHandle closeFile];
        _uriFileHandle = nil;
        _uri = nil;
    }
    _append = nil;
    _pipeToFileCompleteCallback = nil;
    _numBytes = 0;
    _bytesReadNotSend = 0;
}

- (NSDictionary*)getInfo
{
    NSString* localAddress = [_socket localHost];
    NSNumber* localPort = [NSNumber numberWithUnsignedInt:[_socket localPort]];
    NSString* peerAddress = [_socket connectedHost];
    NSNumber* peerPort = [NSNumber numberWithUnsignedInt:[_socket connectedPort]];

    NSMutableDictionary* socketInfo = [@{
        @"socketId": [NSNumber numberWithUnsignedInteger:_socketId],
        @"persistent": _persistent,
        @"name": _name,
        @"bufferSize": _bufferSize,
        @"connected": [NSNumber numberWithBool:[_socket isConnected]],
        @"paused": _paused,
    } mutableCopy];

   if (localAddress) {
        socketInfo[@"localAddress"] = localAddress;
        socketInfo[@"localPort"] = localPort;
    }

    if (peerAddress) {
        socketInfo[@"peerAddress"] = peerAddress;
        socketInfo[@"peerPort"] = peerPort;
    }


    return [socketInfo copy];
}

- (void)setProperties:(NSDictionary*)theProperties
{
    NSNumber* persistent = theProperties[@"persistent"];
    NSString* name = theProperties[@"name"];
    NSNumber* bufferSize = theProperties[@"bufferSize"];

    if (persistent)
        _persistent = persistent;

    if (name)
        _name = name;

    if (bufferSize && _bufferSize == 0 && ![_paused boolValue]) // read delegate method won't be called when _bufferSize == 0
        [_socket readDataWithTimeout:-1 buffer:nil bufferOffset:0 maxLength:[bufferSize unsignedIntegerValue] tag:++_readTag];

    if (bufferSize)
        _bufferSize = bufferSize;

   // Set undefined properties to default value
    if (_persistent == nil)
        _persistent = [NSNumber numberWithBool:NO];

    if (_name == nil)
        _name = @"";

    if (_bufferSize == nil)
        _bufferSize = [NSNumber numberWithUnsignedInteger:4096];
}

- (BOOL)setPipeToFileProperties:(NSDictionary*)theProperties
{
    NSNumber* append = theProperties[@"append"];
    NSNumber* numBytes = theProperties[@"numBytes"];
    NSString* uri = theProperties[@"uri"];

    [self resetPipeToFileProperties];

    if (append) {
        _append = append;
    } else {
        _append = [NSNumber numberWithBool:NO];
    }

    if (numBytes && [numBytes integerValue] > 0) {
        _numBytes = [numBytes integerValue];
    } else {
        return NO;
    }

    if (uri && uri.length > 0) {
        NSString* filePath = [[NSURL URLWithString:uri] path];

        if(![NSFileManager.defaultManager fileExistsAtPath:filePath]) {
            [[NSFileManager defaultManager] createFileAtPath:filePath contents:nil attributes:nil];
        }

        _uriFileHandle = [NSFileHandle fileHandleForWritingAtPath:filePath];

        if (append.boolValue) {
            [_uriFileHandle seekToEndOfFile];
        }

        if (_uriFileHandle) {
            _uri = uri;
        } else {
            return NO;
        }
    } else {
        return NO;
    }

    _lastProgressTimestamp = [[NSDate date] timeIntervalSince1970];
    return YES;
}

- (void)resumeReadIfNotReading
{
    if (_readTag == _receivedTag && _plugin->_pendingReceive == 0 && [_socket isConnected] && ![_paused boolValue]) {
        [_socket readDataWithTimeout:-1 buffer:nil bufferOffset:0 maxLength:[_bufferSize unsignedIntegerValue] tag:++_readTag];
    }
}

- (void)setPaused:(NSNumber*)paused
{
    if (![_paused isEqualToNumber:paused]) {
        _paused = paused;
        if (![_paused boolValue]) {
            for (NSData* data in _pausedBuffers) {
                [self sendReceivedData:data];
            }
            [_pausedBuffers removeAllObjects];
            [self resumeReadIfNotReading];
        }
    }
}

- (void)sendReceivedData:(NSData*)data
{
    if (_uriFileHandle) {

        NSUInteger bytesRead = 0;

        // extra data that need to send to the webveiw
        NSData* extraData = nil;

        if (_numBytes >= [data length]) {
            [_uriFileHandle writeData:data];
            bytesRead = data.length;
        } else {
            NSData* writeData = [data subdataWithRange:NSMakeRange(0, _numBytes)];
            extraData = [data subdataWithRange:NSMakeRange(_numBytes, data.length - _numBytes)];
            [_uriFileHandle writeData:writeData];
            bytesRead = writeData.length;
        }

        _numBytes -= bytesRead;

        NSTimeInterval timestamp = [[NSDate date] timeIntervalSince1970];

        _bytesReadNotSend += bytesRead;
        if (_numBytes == 0 || timestamp - _lastProgressTimestamp > PIPE_TO_FILE_PROGRESS_INTERVAL) {
            NSDictionary *info = @{
                @"socketId": [NSNumber numberWithUnsignedInteger:_socketId],
                @"uri": _uri,
                @"bytesRead": [NSNumber numberWithUnsignedInteger:_bytesReadNotSend],
            };

            [_plugin fireReceiveEventsWithInfo:info waitReadyToRead:NO];
            _bytesReadNotSend = 0;
            _lastProgressTimestamp = timestamp;
        }

        if (_numBytes == 0) {
            void (^callback)() = _pipeToFileCompleteCallback;
            [self resetPipeToFileProperties];
            assert(callback != nil);
            callback();
        }

        if (extraData) {
            [_plugin fireReceiveEventsWithSocketId:_socketId data:extraData];
        } else {
            [self resumeReadIfNotReading];
        }

    } else {
        [_plugin fireReceiveEventsWithSocketId:_socketId data:data];
    }
}

- (void)socket:(GCDAsyncSocket *)sock didConnectToHost:(NSString *)host port:(UInt16)port
{
    VERBOSE_LOG(@"socket:didConnectToHost socketId: %u", _socketId);

    void (^callback)(BOOL, NSError*) = _connectCallback;
    assert(callback != nil);
    _connectCallback = nil;

    callback(YES, nil);

    if (![_paused boolValue])
        [_socket readDataWithTimeout:-1 buffer:nil bufferOffset:0 maxLength:[_bufferSize unsignedIntegerValue] tag:++_readTag];
}

- (void)socket:(GCDAsyncSocket *)sock didReadData:(NSData *)data withTag:(long)tag
{
    VERBOSE_LOG(@"socket:didReadDataWithTag socketId: %u", _socketId);

    _receivedTag = tag;

    if ([_paused boolValue]) {
        [_pausedBuffers addObject:data];
    } else {
        [self sendReceivedData:data];
    }
}

- (void)socket:(GCDAsyncSocket *)sock didWriteDataWithTag:(long)tag
{
    assert([_sendCallbacks count] != 0);
    void (^callback)() = _sendCallbacks[0];
    assert(callback != nil);
    [_sendCallbacks removeObjectAtIndex:0];

    callback();

    [_socket readDataWithTimeout:-1 buffer:nil bufferOffset:0 maxLength:[_bufferSize unsignedIntegerValue] tag:-1];
}

- (void)socketDidDisconnect:(GCDAsyncSocket *)sock withError:(NSError *)err
{
    if (_disconnectCallback) {
        void (^callback)() = _disconnectCallback;
        assert(_disconnectCallback != nil);
        _disconnectCallback = nil;
        callback();
    } else if (_connectCallback) {
        void(^callback)(BOOL, NSError*) = _connectCallback;
        callback(NO, err);
        _connectCallback = nil;
    } else if (err) {
        [_plugin fireReceiveErrorEventsWithSocketId:_socketId errorCode:[err code] message:[err localizedDescription]];
    }

    [self resetSocket];
}

- (void)socketDidSecure:(GCDAsyncSocket *)sock
{
    VERBOSE_LOG(@"socketDidSecure socketId: %u", _socketId);

    assert(_secureCallback != nil);
    void (^callback)() = _secureCallback;
    _secureCallback = nil;
    callback();
}

@end

@implementation ChromeSocketsTcp

- (void)pluginInitialize
{
    _sockets = [NSMutableDictionary dictionary];
    _nextSocketId = 1;
    _receiveEventsCallbackId = nil;
    _pendingReceive = 0;
}

- (void)onReset
{
    for (NSNumber* socketId in _sockets) {
        [self closeSocketWithId:socketId callbackId:nil];
    }
}

- (NSDictionary*)buildErrorInfoWithErrorCode:(NSInteger)theErrorCode message:(NSString*)message
{
    return @{
        @"resultCode": [NSNumber numberWithInteger:theErrorCode],
        @"message": message,
    };
}

- (void)create:(CDVInvokedUrlCommand*)command
{
    NSDictionary* properties = [command argumentAtIndex:0];

    ChromeSocketsTcpSocket* socket = [[ChromeSocketsTcpSocket alloc] initWithId:_nextSocketId++ plugin:self properties:properties];

    _sockets[[NSNumber numberWithUnsignedInteger:socket->_socketId]] = socket;

    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsInt:(int)socket->_socketId] callbackId:command.callbackId];
}

- (void)update:(CDVInvokedUrlCommand*)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    NSDictionary* properties = [command argumentAtIndex:1];

    ChromeSocketsTcpSocket *socket = _sockets[socketId];

    if (socket == nil)
        return;

    [socket setProperties:properties];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
}

- (void)setPaused:(CDVInvokedUrlCommand*)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    NSNumber* paused = [command argumentAtIndex:1];

    ChromeSocketsTcpSocket* socket = _sockets[socketId];

    if (socket == nil)
        return;

    [socket setPaused:paused];
    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
}

- (void)connect:(CDVInvokedUrlCommand*)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    NSString* peerAddress = [command argumentAtIndex:1];

    NSUInteger peerPort = [[command argumentAtIndex:2] unsignedIntegerValue];

    ChromeSocketsTcpSocket* socket = _sockets[socketId];

    if (socket == nil) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:[self buildErrorInfoWithErrorCode:ENOTSOCK message:@"Invalid Argument"]] callbackId:command.callbackId];
        return;
    }

    id<CDVCommandDelegate> commandDelegate = self.commandDelegate;
    socket->_connectCallback = [^(BOOL success, NSError* error) {
        if (success) {
            [commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
        } else {
            [commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:[self buildErrorInfoWithErrorCode:[error code] message:[error localizedDescription]]] callbackId:command.callbackId];
        }
    } copy];

    NSError* err = nil;
    BOOL success = [socket->_socket connectToHost:peerAddress onPort:peerPort withTimeout:2 error:&err];

    if (!success) {
        void(^callback)(BOOL, NSError*) = socket->_connectCallback;
        callback(NO, err);
        socket->_connectCallback = nil;
    }
}

- (void)disconnectSocketWithId:(NSNumber*)socketId callbackId:(NSString*)theCallbackId close:(BOOL)close
{
     ChromeSocketsTcpSocket* socket = _sockets[socketId];

    if (socket == nil)
        return;

    id<CDVCommandDelegate> commandDelegate = self.commandDelegate;
    socket->_disconnectCallback = [^(){
        if (theCallbackId)
            [commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:theCallbackId];
        if (close)
            [_sockets removeObjectForKey:socketId];
    } copy];

    if ([socket->_socket isDisconnected]) {
        void (^callback)() = socket->_disconnectCallback;
        socket->_disconnectCallback = nil;
        callback();
    } else {
        [socket->_socket disconnect];
    }
}


- (void)disconnect:(CDVInvokedUrlCommand*)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    [self disconnectSocketWithId:socketId callbackId:command.callbackId close:NO];
}

- (NSNumber*)getSecureVersion:(NSString*)versionString
{
    if ([versionString isEqualToString:@"ssl3"]) {
        return [NSNumber numberWithInt:kSSLProtocol3];
    } else if ([versionString isEqualToString:@"tls1"]) {
        return [NSNumber numberWithInt:kTLSProtocol1];
    } else if ([versionString isEqualToString:@"tls1.1"]) {
        return [NSNumber numberWithInt:kTLSProtocol11];
    } else if ([versionString isEqualToString:@"tls1.2"]) {
        return [NSNumber numberWithInt:kTLSProtocol12];
    } else {
        return nil;
    }
}

- (void)secure:(CDVInvokedUrlCommand *)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    NSDictionary* options = [command argumentAtIndex:1];

    ChromeSocketsTcpSocket* socket = _sockets[socketId];

    if (socket == nil) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:[self buildErrorInfoWithErrorCode:ENOTSOCK message:@"Invalid Argument"]] callbackId:command.callbackId];
        return;
    }

    id<CDVCommandDelegate> commandDelegate = self.commandDelegate;
    socket->_secureCallback = [^() {
        [commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
    } copy];

    NSMutableDictionary* settings = [NSMutableDictionary dictionaryWithCapacity:2];

    NSDictionary* tlsVersion = options[@"tlsVersion"];
    if (tlsVersion) {
        NSNumber* minVersion = [self getSecureVersion:tlsVersion[@"min"]];
        NSNumber* maxVersion = [self getSecureVersion:tlsVersion[@"max"]];

        if (minVersion) {
            settings[GCDAsyncSocketSSLProtocolVersionMin] = minVersion;
        }

        if (maxVersion) {
            settings[GCDAsyncSocketSSLProtocolVersionMax] = maxVersion;
        }
    }

    [socket->_socket startTLS:settings];
}

- (void)send:(CDVInvokedUrlCommand*)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    NSData* data = [command argumentAtIndex:1];

    ChromeSocketsTcpSocket* socket = _sockets[socketId];

    if (socket == nil) {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:[self buildErrorInfoWithErrorCode:ENOTSOCK message:@"Invalid Argument"]] callbackId:command.callbackId];
        return;
    }

    if ([socket->_socket isConnected]) {
        id<CDVCommandDelegate> commandDelegate = self.commandDelegate;
        [socket->_sendCallbacks addObject:[^() {
            VERBOSE_LOG(@"ACK %@.%@ Write", socketId, command.callbackId);
            [commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsInt:(int)[data length]] callbackId:command.callbackId];
        } copy]];

        [socket->_socket writeData:data withTimeout:-1 tag:-1];

    } else {
        [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:[self buildErrorInfoWithErrorCode:ENOTCONN message:@"Socket Not Connected"]] callbackId:command.callbackId];
    }
}

- (void)closeSocketWithId:(NSNumber*)socketId callbackId:(NSString*)theCallbackId
{
    [self disconnectSocketWithId:socketId callbackId:theCallbackId close:YES];
}

- (void)close:(CDVInvokedUrlCommand*)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    [self closeSocketWithId:socketId callbackId:command.callbackId];
}

- (void)getInfo:(CDVInvokedUrlCommand*)command
{
    NSNumber* socketId = [command argumentAtIndex:0];

    ChromeSocketsTcpSocket* socket = _sockets[socketId];

    if (socket == nil)
        return;

    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsDictionary:[socket getInfo]] callbackId:command.callbackId];
}

- (void)getSockets:(CDVInvokedUrlCommand*)command
{
    NSArray* sockets = [_sockets allValues];
    NSMutableArray* socketsInfo = [NSMutableArray arrayWithCapacity:[sockets count]];

    for (ChromeSocketsTcpSocket* socket in sockets) {
        [socketsInfo addObject:[socket getInfo]];
    }

    [self.commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsArray:socketsInfo] callbackId:command.callbackId];
}

- (void)pipeToFile:(CDVInvokedUrlCommand *)command
{
    NSNumber* socketId = [command argumentAtIndex:0];
    NSDictionary* options = [command argumentAtIndex:1];

    ChromeSocketsTcpSocket* socket = _sockets[socketId];

    if (socket == nil)
        return;

    if ([socket setPipeToFileProperties:options]) {
        id<CDVCommandDelegate> commandDelegate = self.commandDelegate;
        socket->_pipeToFileCompleteCallback = [^() {
            [commandDelegate sendPluginResult:[CDVPluginResult resultWithStatus:CDVCommandStatus_OK] callbackId:command.callbackId];
        } copy];
    } else {
        [self fireReceiveErrorEventsWithSocketId:socket->_socketId errorCode:-1000 message:@"Failed to start pipeToFile"];
    }
}

- (void)registerReceiveEvents:(CDVInvokedUrlCommand*)command
{
    VERBOSE_LOG(@"registerReceiveEvents: ");
    _receiveEventsCallbackId = command.callbackId;
}

- (void)fireReceiveEventsWithSocketId:(NSUInteger)theSocketId data:(NSData*)theData
{
    NSArray* multipart = @[
        @{@"socketId":[NSNumber numberWithUnsignedInteger:theSocketId]},
        theData,
    ];
    [self fireReceiveEventsWithMultiPart:multipart waitReadyToRead:YES];
}

- (void)fireReceiveEventsWithInfo:(NSDictionary*)theInfo waitReadyToRead:(BOOL)waitReadyToRead
{
    [self fireReceiveEventsWithMultiPart:@[theInfo] waitReadyToRead:waitReadyToRead];
}

- (void)fireReceiveEventsWithMultiPart:(NSArray*)theMultiPart waitReadyToRead:(BOOL)waitReadyToRead
{
    assert(_receiveEventsCallbackId != nil);
    CDVPluginResult* result = [CDVPluginResult resultWithStatus:CDVCommandStatus_OK messageAsMultipart:theMultiPart];
    [result setKeepCallbackAsBool:YES];
    if (waitReadyToRead) {
        _pendingReceive++;
    }
    [self.commandDelegate sendPluginResult:result callbackId:_receiveEventsCallbackId];
}

- (void)fireReceiveErrorEventsWithSocketId:(NSUInteger)theSocketId errorCode:(NSUInteger)theErrorCode message:(NSString*)theMessage
{
    assert(_receiveEventsCallbackId != nil);

    NSDictionary* info = @{
        @"socketId": [NSNumber numberWithUnsignedInteger:theSocketId],
        @"resultCode": [NSNumber numberWithUnsignedInteger:theErrorCode],
        @"message": theMessage,
    };

    CDVPluginResult *result = [CDVPluginResult resultWithStatus:CDVCommandStatus_ERROR messageAsDictionary:info];
    [result setKeepCallbackAsBool:YES];

    [self.commandDelegate sendPluginResult:result callbackId:_receiveEventsCallbackId];
}

- (NSUInteger)registerAcceptedSocket:(GCDAsyncSocket*)theSocket
{
    ChromeSocketsTcpSocket* socket = [[ChromeSocketsTcpSocket alloc] initAcceptedSocketWithId:_nextSocketId++ plugin:self socket:theSocket];
    _sockets[[NSNumber numberWithUnsignedInteger:socket->_socketId]] = socket;

    [socket setPaused:[NSNumber numberWithBool:YES]];

    return socket->_socketId;
}

- (void)readyToRead:(CDVInvokedUrlCommand*)command
{
    _pendingReceive--;
    if (_pendingReceive == 0) {
        for (ChromeSocketsTcpSocket* socket in [_sockets allValues]) {
            [socket resumeReadIfNotReading];
        }
    }
}

@end
