(function () {
  const canvas = document.getElementById('canvas');
  const btnVR = document.getElementById('btnVR');
  const btnAR = document.getElementById('btnAR');
  const btnExit = document.getElementById('btnExit');
  const statusEl = document.getElementById('status');
  /** @type {HTMLSelectElement | null} */
  const tessellationSelect = document.getElementById('tessellationSelect');
  /** @type {HTMLSelectElement | null} */
  const sourceSelect = document.getElementById('sourceSelect');
  /** @type {HTMLInputElement | null} */
  const layerDepthCheck = document.getElementById('layerDepthCheck');

  let gl = null;
  /** @type {{ program: WebGLProgram; texture: WebGLTexture; vao: WebGLVertexArrayObject; indexBuffer: WebGLBuffer; indexCount: number; positionLocation: number; texCoordLocation: number; debugColorLocation: number; textureUniformLocation: WebGLUniformLocation | null; isTextureAllocated: boolean; positionBuffer?: WebGLBuffer; uvBuffer?: WebGLBuffer } | null} */
  let glResources = null;
  let enableTexSubImage2D = false; // Match SessionImpl default (options.enableTexSubImage2D || false)
  /** @type {HTMLVideoElement | null} */
  let videoElement = null;
  /** @type {HTMLCanvasElement | null} - static image source (canvas drawn once) when source is "static" */
  let staticImageSource = null;
  let xrSession = null;
  let baseLayer = null;
  let refSpace = null;

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
  }

  /**
   * Reset WebGL state to defaults before rendering (matches Renderer.resetWebGLState).
   */
  function resetWebGLState() {
    gl.useProgram(null);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  /**
   * Clear the framebuffer (matches Renderer.clear when depth buffer is used).
   * @param {boolean} [useDepth=true] - If true, enable depth test and clear depth (use false for 2D canvas which has no depth buffer).
   */
  function clear(useDepth) {
    gl.clearColor(0, 0, 0, 0);
    if (useDepth) {
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.clearDepth(1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    } else {
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  /**
   * Create shader and link program.
   * Simple pass-through vertex shader and textured full-screen quad fragment shader.
   */
  function createProgram(gl) {
    const vs = `#version 300 es
      in vec2 a_position;
      in vec2 a_texCoord;
      out vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;
    const fs = `#version 300 es
      precision mediump float;
      in vec2 v_texCoord;
      uniform sampler2D u_texture;
      out vec4 fragColor;
      void main() {
        vec4 color = vec4(texture(u_texture, v_texCoord).rgb, 1.0);
        if(dot(color.xyz, color.xyz) < 0.0001) {
          fragColor = vec4(0.0, 0.0, 0.0, 0.0);
        } else {
          fragColor = color;
        }
      }
    `;
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vs);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error('VS: ' + gl.getShaderInfoLog(vertexShader));
    }
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fs);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw new Error('FS: ' + gl.getShaderInfoLog(fragmentShader));
    }
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Link: ' + gl.getProgramInfoLog(program));
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  }

  /**
   * Update the video texture with new pixel data (matches Renderer.updateImage exactly).
   * Called from requestVideoFrameCallback only, not from render().
   * Same texImage2D vs texSubImage2D logic as Renderer (enableTexSubImage2D defaults false).
   * @param pixelSource - The source of pixel data (HTMLVideoElement, HTMLCanvasElement, HTMLImageElement)
   */
  function updateImage(pixelSource) {
    const res = glResources;
    if (!res || !gl) return;

    // Reset WebGL state to defaults.
    resetWebGLState();

    // Bind the video texture to GL state.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.texture);

    if (!res.isTextureAllocated || !enableTexSubImage2D) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGB,
        gl.RGB,
        gl.UNSIGNED_BYTE,
        pixelSource
      );
      res.isTextureAllocated = true;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGB, gl.UNSIGNED_BYTE, pixelSource);
    }
  }

  // Match PlaneGeometry.ts constants and helpers
  const kBorderOffset = 0.5;
  const kMinTessellation = 4;
  const kPerEyeWidth = 2048;
  const kPerEyeHeight = 1792;
  /** Static image size (match video 4096x4032). */
  const kStaticImageWidth = 4096;
  const kStaticImageHeight = 4032;

  /** Current total vertex count (set by tessellation dropdown). */
  let currentTotalVerts = 200000;

  /**
   * Get grid dimensions from totalVerts, keeping aspect ratio (kPerEyeWidth / kPerEyeHeight).
   * totalVertices = (gridCols+2)*(gridRows+2).
   */
  function gridFromTotalVerts(totalVerts) {
    const aspect = kPerEyeWidth / kPerEyeHeight;
    let cols = Math.floor(Math.sqrt(totalVerts * aspect));
    cols = Math.max(cols, kMinTessellation + 2);
    let rows = Math.floor(totalVerts / cols);
    rows = Math.max(rows, kMinTessellation + 2);
    const gridCols = Math.max(kMinTessellation, cols - 2);
    const gridRows = Math.max(kMinTessellation, rows - 2);
    return { gridCols, gridRows };
  }

  function getTessellationGrid() {
    return gridFromTotalVerts(currentTotalVerts);
  }


  function computePlaneUV(x, y, gridCols, gridRows, borderOffset) {
    let u = x / (gridCols - 1);
    if (x === -1) u = -borderOffset;
    if (x === gridCols) u = 1.0 + borderOffset;
    let v = y / (gridRows - 1);
    if (y === -1) v = -borderOffset;
    if (y === gridRows) v = 1.0 + borderOffset;
    return { u, v };
  }

  function buildPlaneIndices(gridCols, gridRows) {
    const indices = [];
    const cols = gridCols + 2;
    const rows = gridRows + 2;
    for (let y = 0; y < rows - 1; y++) {
      const isOddRow = y % 2 === 1;
      let firstColumn = true;
      if (isOddRow) {
        for (let x = 0; x < cols; x++) {
          if (y === 0 || !firstColumn) indices.push(y * cols + x);
          indices.push((y + 1) * cols + x);
          firstColumn = false;
        }
      } else {
        for (let x = cols - 1; x >= 0; x--) {
          if (y === 0 || !firstColumn) indices.push(y * cols + x);
          indices.push((y + 1) * cols + x);
          firstColumn = false;
        }
      }
    }
    return new Uint32Array(indices);
  }

  /**
   * Build plane VAO and buffers for current getTessellationGrid(). Returns buffers and sizes for logging.
   * @returns {{ vao: WebGLVertexArrayObject; indexBuffer: WebGLBuffer; positionBuffer: WebGLBuffer; uvBuffer: WebGLBuffer; indexCount: number; positionBufferBytes: number; uvBufferBytes: number; totalVertices: number }}
   */
  function buildPlaneGeometry(gl, program, positionLocation, texCoordLocation, debugColorLocation) {
    const grid = getTessellationGrid();
    const gridCols = grid.gridCols;
    const gridRows = grid.gridRows;
    const totalVertices = (gridCols + 2) * (gridRows + 2);
    const positionStride = 2;
    const positions = new Float32Array(totalVertices * positionStride);
    const uvs = new Float32Array(totalVertices * 2);
    let posIdx = 0;
    let uvIdx = 0;
    const epsilon = 0.000001;
    const halfTexelWidth = 0.5 / gridCols;
    const halfTexelHeight = 0.5 / gridRows;

    for (let y = -1; y <= gridRows; y++) {
      for (let x = -1; x <= gridCols; x++) {
        const { u, v } = computePlaneUV(x, y, gridCols, gridRows, kBorderOffset);
        positions[posIdx++] = u * 2.0 - 1.0;
        positions[posIdx++] = -1.0 * (v * 2.0 - 1.0);
        let processedU = u;
        let processedV = v;
        if (x === -1) processedU = 0.0 + epsilon + halfTexelWidth;
        if (x === gridCols) processedU = 1.0 - epsilon - halfTexelWidth;
        if (x === 0) processedU = processedU + epsilon + halfTexelWidth;
        if (x === gridCols - 1) processedU = processedU - epsilon - halfTexelWidth;
        if (y === -1) processedV = 0.0 + epsilon + halfTexelHeight;
        if (y === gridRows) processedV = 1.0 - epsilon - halfTexelHeight;
        if (y === 0) processedV = processedV + epsilon + halfTexelHeight;
        if (y === gridRows - 1) processedV = processedV - epsilon - halfTexelHeight;
        uvs[uvIdx++] = processedU;
        uvs[uvIdx++] = processedV;
      }
    }

    const indices = buildPlaneIndices(gridCols, gridRows);
    const indexCount = indices.length;
    const positionBufferBytes = positions.byteLength;
    const uvBufferBytes = uvs.byteLength;

    const debugColors = new Float32Array(totalVertices * 3);
    debugColors.fill(0);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, positionStride, gl.FLOAT, false, 0, 0);

    const uvBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    if (debugColorLocation >= 0) {
      const debugColorBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, debugColorBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, debugColors, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(debugColorLocation);
      gl.vertexAttribPointer(debugColorLocation, 3, gl.FLOAT, false, 0, 0);
    }

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return {
      vao,
      indexBuffer,
      positionBuffer,
      uvBuffer,
      indexCount,
      positionBufferBytes,
      uvBufferBytes,
      totalVertices
    };
  }

  function logBufferSizes(totalVertices, positionBufferBytes, uvBufferBytes) {
    const totalBytes = positionBufferBytes + uvBufferBytes;
    console.log(
      'PassThrough geometry: vertices=' + totalVertices +
      ', position buffer=' + positionBufferBytes + ' B' +
      ', UV buffer=' + uvBufferBytes + ' B' +
      ', total vertex buffers=' + totalBytes + ' B'
    );
    if (!xrSession) {
      setStatus(
        'Tessellation: ' + totalVertices + ' verts — position+UV buffers: ' + totalBytes + ' B'
      );
    }
  }

  /**
   * Rebuild plane geometry for current totalVerts (from dropdown). Updates glResources and logs buffer sizes.
   */
  function rebuildPlaneGeometry() {
    if (!gl || !glResources) return;
    const res = glResources;
    if (res.vao) gl.deleteVertexArray(res.vao);
    if (res.indexBuffer) gl.deleteBuffer(res.indexBuffer);
    if (res.positionBuffer) gl.deleteBuffer(res.positionBuffer);
    if (res.uvBuffer) gl.deleteBuffer(res.uvBuffer);

    const geo = buildPlaneGeometry(
      gl, res.program,
      res.positionLocation, res.texCoordLocation, res.debugColorLocation
    );
    res.vao = geo.vao;
    res.indexBuffer = geo.indexBuffer;
    res.positionBuffer = geo.positionBuffer;
    res.uvBuffer = geo.uvBuffer;
    res.indexCount = geo.indexCount;

    logBufferSizes(geo.totalVertices, geo.positionBufferBytes, geo.uvBufferBytes);
  }

  /**
   * Initialize WebGL resources (matches Renderer.initializeWebGL flow and texture params).
   */
  function initializeWebGL(gl, program, imageSource) {
    resetWebGLState();

    // Create texture (same parameter order as Renderer; no pixel data until updateVideoTexture)
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Texture allocated on first updateVideoTexture(pixelSource) call

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    const debugColorLocation = gl.getAttribLocation(program, 'a_debugColor');
    const textureUniformLocation = gl.getUniformLocation(program, 'u_texture');

    if (positionLocation === -1) throw new Error('Position attribute not found in shader program');
    if (texCoordLocation === -1) throw new Error('Texture coordinate attribute not found in shader program');

    const geo = buildPlaneGeometry(gl, program, positionLocation, texCoordLocation, debugColorLocation);
    logBufferSizes(geo.totalVertices, geo.positionBufferBytes, geo.uvBufferBytes);

    // Set program and texture unit (matches Renderer after geometry setup)
    gl.useProgram(program);
    gl.uniform1i(textureUniformLocation, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.useProgram(null);

    return {
      program,
      texture,
      vao: geo.vao,
      indexBuffer: geo.indexBuffer,
      positionBuffer: geo.positionBuffer,
      uvBuffer: geo.uvBuffer,
      indexCount: geo.indexCount,
      positionLocation,
      texCoordLocation,
      textureUniformLocation,
      debugColorLocation,
      isTextureAllocated: false
    };
  }

  /**
   * Render a frame. Same code path for 2D and VR; only viewports and useDepth differ at call site.
   * @param viewports - Array of viewports (one per eye: 2 for VR or 2D stereo)
   * @param useDepth - true to clear and use depth buffer (VR); false for 2D canvas
   */
  function render(viewports, useDepth) {
    const res = glResources;
    if (!res) return;

    resetWebGLState();
    gl.useProgram(res.program);
    clear(useDepth);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.texture);

    for (let i = 0; i < viewports.length; i++) {
      const vp = viewports[i];
      if (!vp) {
        throw new Error('Expected ' + viewports.length + ' viewports, but viewport ' + i + ' is null.');
      }
      gl.viewport(vp.x, vp.y, vp.width, vp.height);
      gl.bindVertexArray(res.vao);
      gl.drawElements(gl.TRIANGLE_STRIP, res.indexCount, gl.UNSIGNED_INT, 0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  }

  function onResize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (gl && !xrSession) {
        gl.viewport(0, 0, w, h);
      }
    }
  }

  /** Fake stereo viewports for 2D: left and right half of canvas, same draw count as VR. */
  function get2DStereoViewports(w, h) {
    const half = Math.floor(w / 2);
    return [
      { x: 0, y: 0, width: half, height: h },
      { x: half, y: 0, width: w - half, height: h }
    ];
  }

  let rafId = null;
  function render2D() {
    if (xrSession) return;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (w === 0 || h === 0) {
      rafId = requestAnimationFrame(render2D);
      return;
    }
    const viewports = get2DStereoViewports(w, h);
    render(viewports, false);
    rafId = requestAnimationFrame(render2D);
  }

  /** Whether XRWebGLLayer was created with a depth buffer (must match clear/render depth usage). */
  function isWebGLLayerDepthEnabled() {
    return layerDepthCheck ? layerDepthCheck.checked : true;
  }

  /**
   * Create XR base layer with current depth checkbox setting.
   * @returns {XRWebGLLayer}
   */
  function createXRWebGLLayer() {
    const depth = isWebGLLayerDepthEnabled();
    return new XRWebGLLayer(xrSession, gl, {
      alpha: true,
      antialias: true,
      depth: depth,
      stencil: false
    });
  }

  /**
   * Replace base layer (e.g. after toggling depth). Only valid while xrSession is active.
   */
  function replaceXRBaseLayer() {
    if (!xrSession || !gl) return;
    baseLayer = createXRWebGLLayer();
    xrSession.updateRenderState({ baseLayer });
  }

  function onXRFrame(time, frame) {
    if (!xrSession || !baseLayer || !refSpace) return;
    const pose = frame.getViewerPose(refSpace);
    if (!pose) return;

    const viewports = [];
    for (let i = 0; i < pose.views.length; i++) {
      viewports.push(baseLayer.getViewport(pose.views[i]));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, baseLayer.framebuffer);
    render(viewports, isWebGLLayerDepthEnabled());
    xrSession.requestAnimationFrame(onXRFrame);
  }

  async function enterXR(mode) {
    if (!navigator.xr) {
      setStatus('WebXR not available');
      return;
    }
    const sessionMode = mode === 'vr' ? 'immersive-vr' : 'immersive-ar';
    const supported = await navigator.xr.isSessionSupported(sessionMode);
    if (!supported) {
      setStatus(sessionMode + ' not supported');
      return;
    }
    try {
      xrSession = await navigator.xr.requestSession(sessionMode, {
        optionalFeatures: ['local-floor']
      });
    } catch (e) {
      setStatus('Session request failed: ' + (e.message || e));
      return;
    }

    baseLayer = createXRWebGLLayer();
    xrSession.updateRenderState({ baseLayer });
    refSpace = await xrSession.requestReferenceSpace('local-floor');
    xrSession.addEventListener('end', exitXR);

    btnVR.style.display = 'none';
    btnAR.style.display = 'none';
    btnExit.style.display = 'block';
    setStatus('XR: ' + sessionMode);
    cancelAnimationFrame(rafId);
    rafId = null;
    xrSession.requestAnimationFrame(onXRFrame);
  }

  function exitXR() {
    if (!xrSession) return;
    xrSession.removeEventListener('end', exitXR);
    xrSession.end();
    xrSession = null;
    baseLayer = null;
    refSpace = null;
    btnVR.style.display = 'block';
    btnAR.style.display = 'block';
    btnExit.style.display = 'none';
    onResize();
    setStatus('2D mode');
    render2D();
  }

  async function init() {
    canvas.width = canvas.clientWidth || window.innerWidth;
    canvas.height = canvas.clientHeight || window.innerHeight;
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = Math.max(canvas.clientWidth || 0, 640);
      canvas.height = Math.max(canvas.clientHeight || 0, 480);
    }
    gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
      xrCompatible: true
    });
    if (!gl) {
      setStatus('WebGL2 not available');
      return;
    }

    const program = createProgram(gl);

    // Create video element (matches SessionImpl: hidden video for stream/texture source)
    videoElement = document.createElement('video');
    videoElement.setAttribute('playsinline', '');
    videoElement.muted = true;
    videoElement.loop = true;
    videoElement.style.display = 'none';
    document.body.appendChild(videoElement);

    const videoUrl = new URL('Sintel_stream_4096x4032.mp4', window.location.href).href;
    videoElement.src = videoUrl;

    await new Promise((resolve, reject) => {
      videoElement.oncanplay = resolve;
      videoElement.onerror = () => reject(new Error('Failed to load video'));
    });
    videoElement.play().catch(function (e) {
      setStatus('Video play failed: ' + (e.message || e));
    });
    // Wait until video has valid dimensions
    await new Promise(function waitDims(resolve) {
      function check() {
        if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
          resolve();
          return;
        }
        requestAnimationFrame(check);
      }
      check();
    });

    if (tessellationSelect) {
      currentTotalVerts = parseInt(tessellationSelect.value, 10) || 200000;
      tessellationSelect.addEventListener('change', function () {
        currentTotalVerts = parseInt(tessellationSelect.value, 10) || 200000;
        rebuildPlaneGeometry();
      });
    }

    glResources = initializeWebGL(gl, program, null);

    // Static image source: load dice.png and draw onto canvas resized to video size (4096x4032).
    staticImageSource = document.createElement('canvas');
    staticImageSource.width = kStaticImageWidth;
    staticImageSource.height = kStaticImageHeight;
    const staticCtx = staticImageSource.getContext('2d');
    const diceImg = new Image();
    diceImg.crossOrigin = 'anonymous';
    await new Promise((resolve, reject) => {
      diceImg.onload = resolve;
      diceImg.onerror = () => reject(new Error('Failed to load dice.png'));
      diceImg.src = new URL('dice.png', window.location.href).href;
    });
    if (staticCtx) {
      staticCtx.drawImage(diceImg, 0, 0, kStaticImageWidth, kStaticImageHeight);
    }

    // Start the video frame callback (SessionImpl pattern: texture updated only from requestVideoFrameCallback).
    const updateVideoTexture = function (now, metadata) {
      try {
        if (!glResources) return;
        const source = sourceSelect && sourceSelect.value === 'static' ? 'static' : 'video';
        if (source === 'video' && videoElement) {
          updateImage(videoElement);
          videoElement.requestVideoFrameCallback(updateVideoTexture);
        } else if (source === 'static' && staticImageSource) {
          updateImage(staticImageSource);
        }
      } catch (err) {
        setStatus('Texture callback error: ' + (err.message || err));
        if (videoElement) videoElement.requestVideoFrameCallback(updateVideoTexture);
      }
    };
    videoElement.requestVideoFrameCallback(updateVideoTexture);

    if (sourceSelect) {
      sourceSelect.addEventListener('change', function () {
        if (sourceSelect.value === 'video' && videoElement) {
          videoElement.requestVideoFrameCallback(updateVideoTexture);
        } else if (sourceSelect.value === 'static' && staticImageSource && glResources) {
          updateImage(staticImageSource);
        }
      });
    }

    if (layerDepthCheck) {
      layerDepthCheck.addEventListener('change', function () {
        if (xrSession) {
          replaceXRBaseLayer();
        }
      });
    }

    onResize();
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    btnVR.onclick = () => enterXR('vr');
    btnAR.onclick = () => enterXR('ar');
    btnExit.onclick = exitXR;

    window.addEventListener('resize', onResize);

    setStatus('2D mode — Enter VR or AR');
    render2D();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
