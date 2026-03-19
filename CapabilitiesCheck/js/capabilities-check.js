/**
 * Standalone browser capability checks (no external packages).
 * Rewritten from scratch; SDP strings follow standard WebRTC offer/answer patterns.
 */
(function () {
  const tbody = document.getElementById('tbody');
  const runBtn = document.getElementById('runBtn');
  const exportBtn = document.getElementById('exportBtn');
  const statusEl = document.getElementById('status');
  const summaryEl = document.getElementById('summary');

  /** @type {null | { timestamp: string; results: { section: string; label: string; passed: boolean; note: string; ms: number }[] }} */
  let lastReport = null;

  function setStatus(t) {
    statusEl.textContent = t;
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error(label || 'timeout'));
        }, ms);
      })
    ]);
  }

  async function testPeerConnection() {
    return !!window.RTCPeerConnection;
  }

  async function testGetUserMedia() {
    return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function');
  }

  async function testEnumerateDevicesAPI() {
    return !!(
      navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function'
    );
  }

  async function testEnumerateDevicesNonEmpty() {
    if (!(await testEnumerateDevicesAPI())) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.length > 0;
  }

  async function testMicrophoneEnumerated() {
    if (!(await testEnumerateDevicesAPI())) return false;
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.some(function (d) {
      return d.kind === 'audioinput';
    });
  }

  async function testMicrophoneCapture() {
    if (!(await testGetUserMedia())) return false;
    try {
      const stream = await withTimeout(
        navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
        8000,
        'getUserMedia timeout'
      );
      var ok = stream.getAudioTracks().length > 0;
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      return ok;
    } catch (e) {
      return false;
    }
  }

  async function testAudioContext() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  async function testRTCDataChannel() {
    if (!window.RTCPeerConnection) return false;
    var pc = new RTCPeerConnection();
    try {
      var ch = pc.createDataChannel('capabilities-check');
      var ok = ch instanceof RTCDataChannel;
      pc.close();
      return ok;
    } catch (e) {
      try {
        pc.close();
      } catch (_) {}
      return false;
    }
  }

  async function testPeerConnectionGetStats() {
    if (!window.RTCPeerConnection) return false;
    var pc = new RTCPeerConnection();
    try {
      if (typeof pc.getStats !== 'function') {
        pc.close();
        return false;
      }
      var report = await pc.getStats();
      pc.close();
      return report instanceof RTCStatsReport;
    } catch (e) {
      try {
        pc.close();
      } catch (_) {}
      return false;
    }
  }

  async function testRtpReceiverGetStats() {
    if (!window.RTCPeerConnection || !window.RTCRtpReceiver) return false;
    var pc = new RTCPeerConnection();
    try {
      var tr = pc.addTransceiver('video', { direction: 'recvonly' });
      var ok = typeof tr.receiver.getStats === 'function';
      pc.close();
      return ok;
    } catch (e) {
      try {
        pc.close();
      } catch (_) {}
      return false;
    }
  }

  async function decodingInfoSupported(config) {
    if (!navigator.mediaCapabilities || typeof navigator.mediaCapabilities.decodingInfo !== 'function') {
      return false;
    }
    try {
      var info = await navigator.mediaCapabilities.decodingInfo(config);
      return !!(info && info.supported);
    } catch (e) {
      return false;
    }
  }

  async function testH264() {
    var types = [
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="avc1.4D401E"',
      'video/mp4; codecs="avc1.64001E"'
    ];
    for (var i = 0; i < types.length; i++) {
      var ok = await decodingInfoSupported({
        type: 'media-source',
        video: {
          contentType: types[i],
          width: 1280,
          height: 720,
          bitrate: 4000000,
          framerate: 30
        }
      });
      if (ok) return true;
    }
    try {
      var caps = RTCRtpReceiver.getCapabilities('video');
      return caps.codecs.some(function (c) {
        return c.mimeType.toLowerCase() === 'video/h264';
      });
    } catch (e) {
      return false;
    }
  }

  async function testH265() {
    var hevcTypes = [
      'video/mp4; codecs="hev1.1.6.L93.B0"',
      'video/mp4; codecs="hvc1.1.6.L93.B0"',
      'video/mp4; codecs="hev1.2.4.L153.B0"',
      'video/mp4; codecs="hvc1.2.4.L153.B0"'
    ];
    for (var i = 0; i < hevcTypes.length; i++) {
      var ok = await decodingInfoSupported({
        type: 'media-source',
        video: {
          contentType: hevcTypes[i],
          width: 1920,
          height: 1080,
          bitrate: 8000000,
          framerate: 30
        }
      });
      if (ok) return true;
    }
    try {
      var caps = RTCRtpReceiver.getCapabilities('video');
      return caps.codecs.some(function (c) {
        var m = c.mimeType.toLowerCase();
        return m === 'video/hevc' || m === 'video/h265' || m.indexOf('hev') >= 0;
      });
    } catch (e) {
      return false;
    }
  }

  async function testAV1() {
    var types = [
      'video/mp4; codecs="av01.0.08M.08"',
      'video/webm; codecs="av01.0.08M.08"',
      'video/mp4; codecs="av01.0.05M.08"'
    ];
    for (var i = 0; i < types.length; i++) {
      var ok = await decodingInfoSupported({
        type: 'media-source',
        video: {
          contentType: types[i],
          width: 1920,
          height: 1080,
          bitrate: 5000000,
          framerate: 30
        }
      });
      if (ok) return true;
    }
    try {
      var caps = RTCRtpReceiver.getCapabilities('video');
      return caps.codecs.some(function (c) {
        return c.mimeType.toLowerCase().indexOf('av1') >= 0;
      });
    } catch (e) {
      return false;
    }
  }

  async function testBasicOpus() {
    try {
      if (!RTCRtpReceiver || typeof RTCRtpReceiver.getCapabilities !== 'function') return false;
      var caps = RTCRtpReceiver.getCapabilities('audio');
      return caps.codecs.some(function (c) {
        return c.mimeType.toLowerCase() === 'audio/opus';
      });
    } catch (e) {
      return false;
    }
  }

  async function testGenericFrameDescriptor() {
    if (!window.RTCPeerConnection) return false;
    var sdp =
      'v=0\r\n' +
      'o=- 0 3 IN IP4 127.0.0.1\r\n' +
      's=-\r\n' +
      't=0 0\r\n' +
      'a=fingerprint:sha-256 A7:24:72:CA:6E:02:55:39:BA:66:DF:6E:CC:4C:D8:B0:1A:BF:1A:56:65:7D:F4:03:AD:7E:77:43:2A:29:EC:93\r\n' +
      'm=video 9 UDP/TLS/RTP/SAVPF 100\r\n' +
      'c=IN IP4 0.0.0.0\r\n' +
      'a=rtcp-mux\r\n' +
      'a=sendonly\r\n' +
      'a=mid:video\r\n' +
      'a=rtpmap:100 VP8/90000\r\n' +
      'a=setup:actpass\r\n' +
      'a=ice-ufrag:ETEn\r\n' +
      'a=ice-pwd:OtSK0WpNtpUjkY4+86js7Z/l\r\n' +
      'a=extmap:1 http://www.webrtc.org/experiments/rtp-hdrext/generic-frame-descriptor-00\r\n';
    var pc = new RTCPeerConnection();
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
      var answer = await pc.createAnswer();
      var ok =
        answer.sdp &&
        answer.sdp.indexOf('generic-frame-descriptor-00') !== -1;
      pc.close();
      return ok;
    } catch (e) {
      try {
        pc.close();
      } catch (_) {}
      return false;
    }
  }

  async function testFlexfec() {
    try {
      if (RTCRtpReceiver && RTCRtpReceiver.getCapabilities) {
        var vcaps = RTCRtpReceiver.getCapabilities('video');
        var flex = vcaps.codecs.filter(function (c) {
          return c.mimeType.toLowerCase().indexOf('flexfec') !== -1;
        });
        if (flex.length > 0) return true;
      }
    } catch (e) {}

    if (!window.RTCPeerConnection) return false;
    var sdp =
      'v=0\r\n' +
      'o=- 8403615332048243445 2 IN IP4 127.0.0.1\r\n' +
      's=-\r\n' +
      't=0 0\r\n' +
      'a=group:BUNDLE 0\r\n' +
      'm=video 9 UDP/TLS/RTP/SAVPF 102 122\r\n' +
      'c=IN IP4 0.0.0.0\r\n' +
      'a=rtcp:9 IN IP4 0.0.0.0\r\n' +
      'a=ice-ufrag:IZeV\r\n' +
      'a=ice-pwd:uaZhQD4rYM/Tta2qWBT1Bbt4\r\n' +
      'a=ice-options:trickle\r\n' +
      'a=fingerprint:sha-256 D8:6C:3D:FA:23:E2:2C:63:11:2D:D0:86:BE:C4:D0:65:F9:42:F7:1C:06:04:27:E6:1C:2C:74:01:8D:50:67:23\r\n' +
      'a=setup:actpass\r\n' +
      'a=mid:0\r\n' +
      'a=sendrecv\r\n' +
      'a=msid:stream track\r\n' +
      'a=rtcp-mux\r\n' +
      'a=rtcp-rsize\r\n' +
      'a=rtpmap:102 VP8/90000\r\n' +
      'a=rtpmap:122 flexfec-03/90000\r\n' +
      'a=fmtp:122 repair-window=10000000\r\n' +
      'a=ssrc-group:FEC-FR 1224551896 1953032773\r\n' +
      'a=ssrc:1224551896 cname:x\r\n' +
      'a=ssrc:1953032773 cname:x\r\n';
    var pc = new RTCPeerConnection();
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: sdp });
      var answer = await pc.createAnswer();
      var ok = answer.sdp && answer.sdp.toUpperCase().indexOf('FLEXFEC-03') !== -1;
      pc.close();
      return ok;
    } catch (e) {
      try {
        pc.close();
      } catch (_) {}
      return false;
    }
  }

  async function testPointerLock() {
    return typeof Element !== 'undefined' && 'requestPointerLock' in Element.prototype;
  }

  async function testFullscreen() {
    return typeof Element !== 'undefined' && 'requestFullscreen' in Element.prototype;
  }

  function startCanvasAnim(canvas, ctx) {
    var n = 0;
    return window.setInterval(function () {
      n++;
      ctx.fillStyle = n % 2 ? '#e02020' : '#20e020';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }, 40);
  }

  async function testVideoFrameCallback() {
    if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return false;
    var canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    var ctx = canvas.getContext('2d');
    if (!ctx) return false;
    var intervalId = startCanvasAnim(canvas, ctx);
    var stream;
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    try {
      stream = canvas.captureStream(20);
      video.srcObject = stream;
      await video.play();
      var frames = 0;
      await withTimeout(
        new Promise(function (resolve, reject) {
          function onFrame() {
            frames++;
            if (frames >= 6) {
              resolve();
              return;
            }
            video.requestVideoFrameCallback(onFrame);
          }
          video.requestVideoFrameCallback(onFrame);
        }),
        3000,
        'RVFC timeout'
      );
      clearInterval(intervalId);
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      video.srcObject = null;
      return true;
    } catch (e) {
      clearInterval(intervalId);
      if (stream) stream.getTracks().forEach(function (t) {
        t.stop();
      });
      video.srcObject = null;
      return false;
    }
  }

  async function testMediaPlaybackFrames() {
    var canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    var intervalId = startCanvasAnim(canvas, ctx);
    var stream;
    var video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    var framesData = [];
    try {
      stream = canvas.captureStream(20);
      video.srcObject = stream;
      await video.play();
      await withTimeout(
        new Promise(function (resolve, reject) {
          function onFrame() {
            ctx.drawImage(video, 0, 0);
            framesData.push(new Uint8ClampedArray(ctx.getImageData(0, 0, 64, 64).data));
            if (framesData.length >= 10) {
              resolve();
              return;
            }
            if ('requestVideoFrameCallback' in video) {
              video.requestVideoFrameCallback(onFrame);
            } else {
              requestAnimationFrame(onFrame);
            }
          }
          if ('requestVideoFrameCallback' in video) {
            video.requestVideoFrameCallback(onFrame);
          } else {
            requestAnimationFrame(onFrame);
          }
        }),
        3500,
        'media playback timeout'
      );
      clearInterval(intervalId);
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      video.srcObject = null;
      var different = 0;
      for (var i = 1; i < framesData.length; i++) {
        var a = framesData[i];
        var b = framesData[i - 1];
        var diffPx = 0;
        for (var j = 0; j < a.length; j += 4) {
          if (
            Math.abs(a[j] - b[j]) > 8 ||
            Math.abs(a[j + 1] - b[j + 1]) > 8 ||
            Math.abs(a[j + 2] - b[j + 2]) > 8
          ) {
            diffPx++;
          }
        }
        if (diffPx > 50) different++;
      }
      return different >= 2;
    } catch (e) {
      clearInterval(intervalId);
      if (stream) stream.getTracks().forEach(function (t) {
        t.stop();
      });
      video.srcObject = null;
      return false;
    }
  }

  async function testWebWorker() {
    return typeof Worker !== 'undefined';
  }

  async function testWebSocket() {
    return typeof WebSocket !== 'undefined';
  }

  async function testGamepadAPI() {
    return !!(navigator.getGamepads || navigator.webkitGetGamepads);
  }

  async function testWindowOpen() {
    return typeof window.open === 'function';
  }

  async function testDevicePixelRatio() {
    return typeof window.devicePixelRatio === 'number' && window.devicePixelRatio > 0;
  }

  async function testHighFrameRateDecoding() {
    if (!navigator.mediaCapabilities || typeof navigator.mediaCapabilities.decodingInfo !== 'function') {
      return false;
    }
    var rates = [120, 144, 165, 240];
    var types = [
      'video/mp4; codecs="avc1.42E01E"',
      'video/mp4; codecs="avc1.4D401E"'
    ];
    for (var ri = 0; ri < rates.length; ri++) {
      for (var ti = 0; ti < types.length; ti++) {
        try {
          var info = await navigator.mediaCapabilities.decodingInfo({
            type: 'media-source',
            video: {
              contentType: types[ti],
              width: 1920,
              height: 1080,
              framerate: rates[ri],
              bitrate: 12000000
            }
          });
          if (info && info.supported) return true;
        } catch (e) {}
      }
    }
    return false;
  }

  async function testPointerRawUpdate() {
    if (typeof PointerEvent === 'undefined') return false;
    try {
      var ev = new PointerEvent('pointerrawupdate', {
        pointerId: 1,
        bubbles: true,
        cancelable: true
      });
      return ev.type === 'pointerrawupdate';
    } catch (e) {
      return false;
    }
  }

  async function testKeyboardEvents() {
    if (typeof KeyboardEvent === 'undefined') return false;
    var types = ['keydown', 'keyup', 'keypress'];
    for (var i = 0; i < types.length; i++) {
      try {
        var ev = new KeyboardEvent(types[i], {
          key: 'a',
          code: 'KeyA',
          bubbles: true,
          cancelable: true
        });
        if (ev.type !== types[i] || ev.key !== 'a') return false;
      } catch (e) {
        return false;
      }
    }
    var el = document.createElement('div');
    try {
      for (var j = 0; j < types.length; j++) {
        var noop = function () {};
        el.addEventListener(types[j], noop);
        el.removeEventListener(types[j], noop);
      }
    } catch (e) {
      return false;
    }
    return true;
  }

  async function testTouchEvents() {
    return typeof TouchEvent !== 'undefined';
  }

  async function testPWA() {
    var sw = 'serviceWorker' in navigator;
    var manifest =
      !!document.querySelector('link[rel="manifest"]') ||
      'getInstalledRelatedApps' in navigator;
    var cachesOk = 'caches' in window;
    return sw && manifest && cachesOk;
  }

  async function testClipboardAPI() {
    return !!(navigator.clipboard && window.isSecureContext);
  }

  async function testPushNotifications() {
    return !!(
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      window.isSecureContext
    );
  }

  async function testBrowserStorage() {
    var ls = false;
    var ss = false;
    try {
      localStorage.setItem('_cc', '1');
      ls = localStorage.getItem('_cc') === '1';
      localStorage.removeItem('_cc');
    } catch (e) {}
    try {
      sessionStorage.setItem('_cc', '1');
      ss = sessionStorage.getItem('_cc') === '1';
      sessionStorage.removeItem('_cc');
    } catch (e) {}
    var idb = 'indexedDB' in window;
    var cookieOk = false;
    try {
      var key = '_cc_' + Date.now();
      document.cookie = key + '=1;SameSite=Strict;path=/';
      cookieOk = document.cookie.indexOf(key) !== -1;
      document.cookie = key + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/';
    } catch (e) {}
    return ls && ss && idb && cookieOk;
  }

  async function testWebGL2() {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl2');
    return !!gl;
  }

  async function testWebXRPresent() {
    return !!navigator.xr;
  }

  async function testWebXRVR() {
    if (!navigator.xr || typeof navigator.xr.isSessionSupported !== 'function') return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch (e) {
      return false;
    }
  }

  async function testWebXRAR() {
    if (!navigator.xr || typeof navigator.xr.isSessionSupported !== 'function') return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch (e) {
      return false;
    }
  }

  /** WebGL 2.0: makeXRCompatible() for XR compositing (WebXR). */
  async function testWebGL2MakeXRCompatible() {
    var canvas = document.createElement('canvas');
    var gl = canvas.getContext('webgl2');
    if (!gl) return false;
    return typeof gl.makeXRCompatible === 'function';
  }

  /** XRWebGLLayer — WebGL-backed XR layer (WebXR Device API). */
  async function testXRWebGLLayerConstructor() {
    return typeof XRWebGLLayer === 'function';
  }

  /** XRWebGLLayer.fixedFoveation — optional fixed foveation where the UA exposes it */
  async function testXRWebGLLayerFixedFoveationAPI() {
    if (typeof XRWebGLLayer === 'undefined') return false;
    try {
      if ('fixedFoveation' in XRWebGLLayer.prototype) return true;
      var d = Object.getOwnPropertyDescriptor(XRWebGLLayer.prototype, 'fixedFoveation');
      return !!(d && (d.get || d.set));
    } catch (e) {
      return false;
    }
  }

  /** XRRigidTransform — rigid transforms for XR spaces (WebXR). */
  async function testXRRigidTransform() {
    return typeof XRRigidTransform === 'function';
  }

  async function testXRReferenceSpaceGetOffsetReferenceSpace() {
    if (typeof XRReferenceSpace === 'undefined') return false;
    return typeof XRReferenceSpace.prototype.getOffsetReferenceSpace === 'function';
  }

  async function testXRSessionRequestSession() {
    return !!(
      navigator.xr && typeof navigator.xr.requestSession === 'function'
    );
  }

  async function testXRSessionUpdateRenderState() {
    if (typeof XRSession === 'undefined') return false;
    return typeof XRSession.prototype.updateRenderState === 'function';
  }

  async function testXRSessionRequestReferenceSpace() {
    if (typeof XRSession === 'undefined') return false;
    return typeof XRSession.prototype.requestReferenceSpace === 'function';
  }

  async function testXRSessionRequestAnimationFrame() {
    if (typeof XRSession === 'undefined') return false;
    return typeof XRSession.prototype.requestAnimationFrame === 'function';
  }

  /** XRSession.updateTargetFrameRate — optional UA extension (WebXR). */
  async function testXRSessionUpdateTargetFrameRate() {
    if (typeof XRSession === 'undefined') return false;
    return typeof XRSession.prototype.updateTargetFrameRate === 'function';
  }

  async function testXRSessionEnd() {
    if (typeof XRSession === 'undefined') return false;
    return typeof XRSession.prototype.end === 'function';
  }

  async function testXRFrameGetViewerPose() {
    if (typeof XRFrame === 'undefined') return false;
    return typeof XRFrame.prototype.getViewerPose === 'function';
  }

  /** WebXR Hand Input Module: XRFrame.getJointPose (session feature hand-tracking). */
  async function testXRHandTrackingAPI() {
    if (typeof XRFrame === 'undefined') return false;
    return typeof XRFrame.prototype.getJointPose === 'function';
  }

  /** WebXR Body Tracking: XRFrame.body / XRBody (session feature body-tracking). */
  async function testXRBodyTrackingAPI() {
    if (typeof XRBody !== 'undefined') return true;
    if (typeof XRFrame === 'undefined') return false;
    try {
      if ('body' in XRFrame.prototype) return true;
      var d = Object.getOwnPropertyDescriptor(XRFrame.prototype, 'body');
      return !!(d && typeof d.get === 'function');
    } catch (e) {
      return false;
    }
  }

  /** HTMLCanvasElement.captureStream — Media Capture from DOM Elements. */
  async function testCanvasCaptureStream() {
    var canvas = document.createElement('canvas');
    return typeof canvas.captureStream === 'function';
  }

  async function testWebGPUNavigator() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  async function testWebGPUAdapter() {
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return false;
    try {
      var adapter = await navigator.gpu.requestAdapter();
      return adapter != null;
    } catch (e) {
      return false;
    }
  }

  async function testWebGPUDevice() {
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return false;
    try {
      var adapter = await navigator.gpu.requestAdapter();
      if (!adapter || typeof adapter.requestDevice !== 'function') return false;
      var device = await adapter.requestDevice();
      if (device && typeof device.destroy === 'function') {
        device.destroy();
      }
      return !!device;
    } catch (e) {
      return false;
    }
  }

  async function testWebGPUXRCompatibleAdapter() {
    if (!navigator.gpu || typeof navigator.gpu.requestAdapter !== 'function') return false;
    try {
      var adapter = await navigator.gpu.requestAdapter({ xrCompatible: true });
      return adapter != null;
    } catch (e) {
      return false;
    }
  }

  /**
   * WebXR / WebGPU integration: XRGPUBinding with session feature descriptor webgpu (spec).
   * Some UAs may expose XRWebGPUBinding instead.
   */
  async function testWebXRWebGPUBindingType() {
    return (
      (typeof XRGPUBinding !== 'undefined' && typeof XRGPUBinding === 'function') ||
      (typeof XRWebGPUBinding !== 'undefined' && typeof XRWebGPUBinding === 'function')
    );
  }

  /**
   * @type {{ section: string; label: string; fn: () => Promise<boolean>; note?: string }[]}
   */
  var TESTS = [
    { section: 'WebRTC / streaming', label: 'RTCPeerConnection API', fn: testPeerConnection },
    { section: 'WebRTC / streaming', label: 'getUserMedia() support', fn: testGetUserMedia },
    {
      section: 'WebRTC / streaming',
      label: 'Device enumeration API (enumerateDevices)',
      fn: testEnumerateDevicesAPI
    },
    {
      section: 'WebRTC / streaming',
      label: 'Device enumeration returns devices',
      fn: testEnumerateDevicesNonEmpty
    },
    {
      section: 'WebRTC / streaming',
      label: 'Microphone listed in enumerateDevices',
      fn: testMicrophoneEnumerated
    },
    {
      section: 'WebRTC / streaming',
      label: 'Microphone capture (getUserMedia audio)',
      fn: testMicrophoneCapture,
      note: 'Fails if permission denied or no mic'
    },
    { section: 'WebRTC / streaming', label: 'AudioContext support', fn: testAudioContext },
    { section: 'WebRTC / streaming', label: 'RTCDataChannel support', fn: testRTCDataChannel },
    {
      section: 'WebRTC / streaming',
      label: 'RTCPeerConnection.getStats support',
      fn: testPeerConnectionGetStats
    },
    {
      section: 'WebRTC / streaming',
      label: 'RTCRtpReceiver.getStats support',
      fn: testRtpReceiverGetStats
    },
    { section: 'Codecs', label: 'H.264 decode / WebRTC (baseline-oriented check)', fn: testH264 },
    { section: 'Codecs', label: 'H.265 / HEVC decode (MediaCapabilities or WebRTC codec list)', fn: testH265 },
    { section: 'Codecs', label: 'AV1 decode / WebRTC (MediaCapabilities or codec list)', fn: testAV1 },
    { section: 'Codecs', label: 'Opus (stereo) in WebRTC audio codecs', fn: testBasicOpus },
    {
      section: 'WebRTC / streaming',
      label: 'Generic Frame Descriptor (SDP answer)',
      fn: testGenericFrameDescriptor
    },
    { section: 'WebRTC / streaming', label: 'FlexFEC-03 (capabilities or SDP answer)', fn: testFlexfec },
    { section: 'Graphics / XR', label: 'WebGL 2.0 context', fn: testWebGL2 },
    { section: 'Graphics / XR', label: 'WebXR device API (navigator.xr)', fn: testWebXRPresent },
    { section: 'Graphics / XR', label: 'WebXR immersive-vr session supported', fn: testWebXRVR },
    { section: 'Graphics / XR', label: 'WebXR immersive-ar session supported', fn: testWebXRAR },
    {
      section: 'WebXR application APIs',
      label: 'WebGL2RenderingContext.makeXRCompatible',
      fn: testWebGL2MakeXRCompatible,
      note: 'Aligns WebGL with the active XR device (WebXR).'
    },
    {
      section: 'WebXR application APIs',
      label: 'XRWebGLLayer constructor',
      fn: testXRWebGLLayerConstructor
    },
    {
      section: 'WebXR application APIs',
      label: 'XRWebGLLayer.fixedFoveation (where implemented)',
      fn: testXRWebGLLayerFixedFoveationAPI,
      note: 'Optional; not all UAs expose this on XRWebGLLayer.'
    },
    {
      section: 'WebXR application APIs',
      label: 'XRRigidTransform',
      fn: testXRRigidTransform,
      note: 'Used with getOffsetReferenceSpace for spatial offsets.'
    },
    {
      section: 'WebXR application APIs',
      label: 'XRReferenceSpace.getOffsetReferenceSpace',
      fn: testXRReferenceSpaceGetOffsetReferenceSpace
    },
    {
      section: 'WebXR application APIs',
      label: 'XRSystem.requestSession',
      fn: testXRSessionRequestSession,
      note: 'Feature descriptors (e.g. local-floor, hand-tracking, body-tracking) are negotiated here; not invoked in this page.'
    },
    {
      section: 'WebXR application APIs',
      label: 'XRSession.updateRenderState (baseLayer)',
      fn: testXRSessionUpdateRenderState
    },
    {
      section: 'WebXR application APIs',
      label: 'XRSession.requestReferenceSpace',
      fn: testXRSessionRequestReferenceSpace,
      note: 'Common types include viewer, local, local-floor, unbounded (UA-dependent).'
    },
    {
      section: 'WebXR application APIs',
      label: 'XRSession.requestAnimationFrame',
      fn: testXRSessionRequestAnimationFrame
    },
    {
      section: 'WebXR application APIs',
      label: 'XRSession.updateTargetFrameRate',
      fn: testXRSessionUpdateTargetFrameRate,
      note: 'Optional; availability is UA- and device-specific.'
    },
    {
      section: 'WebXR application APIs',
      label: 'XRSession.end',
      fn: testXRSessionEnd
    },
    {
      section: 'WebXR application APIs',
      label: 'XRFrame.getViewerPose',
      fn: testXRFrameGetViewerPose
    },
    {
      section: 'WebXR application APIs',
      label: 'Hand tracking API (XRFrame.getJointPose)',
      fn: testXRHandTrackingAPI,
      note: 'Requires optional session feature hand-tracking; hardware may still omit poses.'
    },
    {
      section: 'WebXR application APIs',
      label: 'Body tracking API (XRFrame.body / XRBody)',
      fn: testXRBodyTrackingAPI,
      note: 'Requires optional session feature body-tracking; hardware may still omit data.'
    },
    {
      section: 'WebXR application APIs',
      label: 'HTMLCanvasElement.captureStream',
      fn: testCanvasCaptureStream,
      note: 'Media Capture from DOM Elements; pairs with MediaStream APIs.'
    },
    { section: 'Graphics / XR', label: 'WebGPU (navigator.gpu)', fn: testWebGPUNavigator },
    { section: 'Graphics / XR', label: 'WebGPU adapter (requestAdapter)', fn: testWebGPUAdapter },
    {
      section: 'Graphics / XR',
      label: 'WebGPU device (requestDevice)',
      fn: testWebGPUDevice,
      note: 'Creates then destroys a device'
    },
    {
      section: 'Graphics / XR',
      label: 'WebGPU xrCompatible adapter (requestAdapter({ xrCompatible: true }))',
      fn: testWebGPUXRCompatibleAdapter,
      note: 'Needed for WebXR WebGPU sessions'
    },
    {
      section: 'Graphics / XR',
      label: 'WebXR–WebGPU binding (XRGPUBinding / XRWebGPUBinding)',
      fn: testWebXRWebGPUBindingType,
      note: 'Session feature descriptor webgpu; no session started on this page.'
    },
    { section: 'Input / display', label: 'Pointer Lock API', fn: testPointerLock },
    { section: 'Input / display', label: 'Fullscreen API', fn: testFullscreen },
    { section: 'Media / video', label: 'HTMLVideoElement.requestVideoFrameCallback', fn: testVideoFrameCallback },
    {
      section: 'Media / video',
      label: 'Media playback (changing frames from canvas stream)',
      fn: testMediaPlaybackFrames
    },
    { section: 'Runtime', label: 'Web Worker support', fn: testWebWorker },
    { section: 'Runtime', label: 'WebSocket support', fn: testWebSocket },
    { section: 'Input / display', label: 'Gamepad API', fn: testGamepadAPI },
    { section: 'Runtime', label: 'window.open() available', fn: testWindowOpen },
    { section: 'Input / display', label: 'devicePixelRatio', fn: testDevicePixelRatio },
    {
      section: 'Media / video',
      label: 'High frame rate decode (≥120fps via MediaCapabilities)',
      fn: testHighFrameRateDecoding
    },
    { section: 'Input / display', label: 'PointerEvent pointerrawupdate', fn: testPointerRawUpdate },
    { section: 'Input / display', label: 'Keyboard events', fn: testKeyboardEvents },
    { section: 'Input / display', label: 'TouchEvent constructor', fn: testTouchEvents },
    {
      section: 'Runtime',
      label: 'PWA surface (SW + manifest link + Cache Storage)',
      fn: testPWA,
      note: 'Usually false on plain static pages without manifest'
    },
    {
      section: 'Runtime',
      label: 'Clipboard API (secure context)',
      fn: testClipboardAPI,
      note: 'Requires HTTPS'
    },
    {
      section: 'Runtime',
      label: 'Push API surface (SW + PushManager + Notification)',
      fn: testPushNotifications,
      note: 'Requires HTTPS; does not subscribe'
    },
    { section: 'Runtime', label: 'Browser storage (local, session, IndexedDB, cookies)', fn: testBrowserStorage }
  ];

  function renderSectionRow(section) {
    var tr = document.createElement('tr');
    tr.className = 'section';
    tr.innerHTML =
      '<td colspan="3">' +
      section.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
      '</td>';
    tbody.appendChild(tr);
  }

  function renderResultRow(label, passed, note, durationMs) {
    var tr = document.createElement('tr');
    var nameTd = document.createElement('td');
    nameTd.textContent = label;
    var resTd = document.createElement('td');
    var span = document.createElement('span');
    span.className = passed ? 'pass' : 'fail';
    span.textContent = passed ? 'PASS' : 'FAIL';
    resTd.appendChild(span);
    if (durationMs != null) {
      var small = document.createElement('small');
      small.style.color = '#666';
      small.style.marginLeft = '0.35rem';
      small.textContent = Math.round(durationMs) + 'ms';
      resTd.appendChild(small);
    }
    var noteTd = document.createElement('td');
    noteTd.className = 'note';
    noteTd.textContent = note || '';
    tr.appendChild(nameTd);
    tr.appendChild(resTd);
    tr.appendChild(noteTd);
    tbody.appendChild(tr);
  }

  async function runAll() {
    tbody.innerHTML = '';
    summaryEl.hidden = true;
    exportBtn.disabled = true;
    runBtn.disabled = true;
    setStatus('Running…');

    var results = [];
    var lastSection = null;
    var passedCount = 0;

    for (var i = 0; i < TESTS.length; i++) {
      var t = TESTS[i];
      if (t.section !== lastSection) {
        renderSectionRow(t.section);
        lastSection = t.section;
      }
      var t0 = performance.now();
      var ok = false;
      try {
        ok = await t.fn();
      } catch (e) {
        ok = false;
      }
      var ms = performance.now() - t0;
      if (ok) passedCount++;
      var note = t.note || '';
      if (!ok && t.fn === testMicrophoneCapture) {
        note = note || 'Permission denied, timeout, or no hardware';
      }
      renderResultRow(t.label, ok, note, ms);
      results.push({
        section: t.section,
        label: t.label,
        passed: ok,
        note: note,
        ms: Math.round(ms * 100) / 100
      });
    }

    lastReport = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
      results: results
    };

    var total = TESTS.length;
    summaryEl.hidden = false;
    summaryEl.textContent =
      'Summary: ' + passedCount + ' / ' + total + ' passed (' + Math.round((passedCount / total) * 1000) / 10 + '%).';
    setStatus('Done');
    runBtn.disabled = false;
    exportBtn.disabled = false;
  }

  function downloadJson() {
    if (!lastReport) return;
    var blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'capabilities-check-' + lastReport.timestamp.replace(/[:.]/g, '-') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  runBtn.addEventListener('click', function () {
    runAll();
  });
  exportBtn.addEventListener('click', downloadJson);
})();
