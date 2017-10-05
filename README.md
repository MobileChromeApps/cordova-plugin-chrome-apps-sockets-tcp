# chrome.sockets.tcp Plugin

This plugin provides TCP client sockets for Android and iOS.

## Status

Beta on Android and iOS.

## Reference

The API reference is [here](https://developer.chrome.com/apps/sockets_tcp).

# Release Notes

## 1.3.9 (Sep 12, 2017)
* Fix connect() not firing when failed on iOS
* Fix write not triggering reading bytes on iOS

## 1.3.7 (Jan 31, 2017)
* Fix disconnect() sometimes not disconnecting on iOS

## 1.3.6 (Aug 12, 2016)
* Fix connect() being run on UI thread (Android)

## 1.3.5 (Aug 10, 2016)
* Better TLS handling in Android implementation

## 1.3.4 (May 29, 2015)
* Fix writes being silently truncated when sending large ArrayBuffers
* Fix a case of busy-waiting (yikes!)
* Increase socket read buffer size from 4k -> 32k to match write buffer size

## 1.3.3 (April 30, 2015)
- Renamed plugin to pubilsh to NPM

## 1.3.2 (Mar 17, 2015)
* ios: Fix warning about unsigned -> int

## 1.3.1 (Jan 27, 2015)
* Fix ssl handshake infinite loop & return error when address is unresolvable
* `chrome.sockets.pipeToFile`: send receive events at most 10 times per sec

## 1.3.0 (Nov 26, 2014)
* Added mobile-only `chrome.sockets.tcp.pipeToFile` API
* android sockets.tcp: send an error when receive EOF

## 1.2.0 (November 17, 2014)
* Remove unnecessary headers for chrome.sockets.* - ios
* Fix possible blocks leak memory
* sockets.tcp - redirect to file for iOS & Android
* Fixed chrome.sockets.udp socket close with error problem
* chrome.sockets: open selector in selector thread
* Fix auto tests & resumeRead accidentally read paused or unconnected sockets on iOS
* Improve chrome.sockets.tcp throughput for iOS & Android
* Fix setPaused for iOS
* Add setKeepAlive and setNoDelay for Android
* Don't modify interest set when key is invalid (fix #388)

## 1.1.0 (October 24, 2014)
* Add `chrome.sockets.secure.tcp` and refactor `chrome.sockets.*`

## 1.0.1 (October 23, 2014)
* Fix a NullPointerException on Android
* Fix the dependency on iosSocketsCommon so that it works with the Cordova plugin registry.

## 1.0.0 (October 21, 2014)
* Initial release
