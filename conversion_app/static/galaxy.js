/**
 * Binary Orbits - 3D Spiral Galaxy Canvas Background
 * Inspired by React Bits "Binary Orbits" (Aurora / Cosmic Theme)
 * Pure WebGL with additive particle blending and interactive 3D parallax
 */

(function () {
  'use strict';

  // Configuration matching the user's React Bits setup
  const CONFIG = {
    particleCount: 45000,   // High-density stellar cloud
    arms: 3,                // 3 spiral arms
    armColor: [0.48, 0.30, 1.0],      // #7B4DFF (Vibrant Violet / Purple)
    armOuterColor: [0.65, 0.45, 1.0], // #A873FF (Soft Lavender)
    coreColor: [1.0, 0.76, 0.93],     // #FFC2EE (Luminous Pinkish-White Nucleus)
    ambientColor: [0.04, 0.04, 0.06], // #0A0A0A (Deep Void Background)
    starBaseSize: 1.8,      // Base particle size
    rotationSpeed: 0.0006,  // Galactic orbital drift speed
    tiltX: 1.05,            // ~60 degrees 3D oblique viewing angle
    mouseSensitivity: 0.25, // Gentle interactive parallax
    sparkleRate: 0.5        // Twinkle factor
  };

  let canvas, gl, program, buffer;
  let animationFrameId = null;
  let startTime = performance.now();
  let mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
  let width = 0, height = 0;

  // Vertex Shader
  const VS_SOURCE = `
    attribute vec3 a_position;
    attribute vec3 a_color;
    attribute float a_size;
    attribute float a_seed;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_mouse;
    uniform float u_tiltX;
    uniform float u_rotSpeed;

    varying vec3 v_color;
    varying float v_alpha;

    void main() {
      // Base galaxy rotation
      float angle = u_time * u_rotSpeed;
      float cosA = cos(angle);
      float sinA = sin(angle);

      // Rotate around galactic Y-axis in 3D
      float rx = a_position.x * cosA - a_position.z * sinA;
      float rz = a_position.x * sinA + a_position.z * cosA;
      float ry = a_position.y;

      // Apply 3D perspective pitch (tilt around X axis) + mouse parallax
      float pitch = u_tiltX + u_mouse.y * 0.25;
      float cosP = cos(pitch);
      float sinP = sin(pitch);

      float px = rx + u_mouse.x * 0.15;
      float py = ry * cosP - rz * sinP;
      float pz = ry * sinP + rz * cosP;

      // Perspective projection
      float camDist = 2.4;
      float zPersp = pz + camDist;
      if (zPersp < 0.1) zPersp = 0.1;

      float aspect = u_resolution.x / u_resolution.y;
      gl_Position = vec4(px / (zPersp * aspect), py / zPersp, 0.0, 1.0);

      // Twinkle & depth sizing
      float sparkle = 0.75 + 0.25 * sin(u_time * 2.5 + a_seed * 100.0);
      gl_PointSize = clamp(a_size * (2.2 / zPersp) * sparkle, 0.8, 6.0);

      v_color = a_color;
      // Slight depth fading for distant particles
      v_alpha = clamp((1.8 / zPersp) * sparkle, 0.25, 1.0);
    }
  `;

  // Fragment Shader (Soft Glowing Particles with Additive Blending)
  const FS_SOURCE = `
    precision mediump float;
    varying vec3 v_color;
    varying float v_alpha;

    void main() {
      // Circular soft particle glow
      vec2 coord = gl_PointCoord - vec2(0.5);
      float dist = length(coord);
      if (dist > 0.5) {
        discard;
      }

      // Soft gaussian-like falloff
      float glow = exp(-dist * dist * 12.0) + (0.5 - dist) * 0.4;
      gl_FragColor = vec4(v_color * glow, v_alpha * glow);
    }
  `;

  function init() {
    canvas = document.getElementById('galaxy-bg');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'galaxy-bg';
      document.body.prepend(canvas);
    }

    gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: false }) ||
         canvas.getContext('experimental-webgl', { alpha: true, antialias: true, depth: false });

    if (!gl) {
      console.warn('WebGL not supported, falling back to 2D galaxy');
      initCanvas2DFallback();
      return;
    }

    program = createProgram(gl, VS_SOURCE, FS_SOURCE);
    if (!program) return;

    setupParticles();
    resize();
    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('mousemove', onMouseMove, { passive: true });

    render();
  }

  function createShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function createProgram(gl, vsSource, fsSource) {
    const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);

    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(prog));
      return null;
    }
    return prog;
  }

  function setupParticles() {
    const count = CONFIG.particleCount;
    // Each particle: [x, y, z, r, g, b, size, seed] = 8 floats
    const data = new Float32Array(count * 8);

    for (let i = 0; i < count; i++) {
      const idx = i * 8;

      // Assign to one of the spiral arms
      const armIndex = i % CONFIG.arms;
      const armAngle = (armIndex / CONFIG.arms) * Math.PI * 2;

      // Non-linear radius: power distribution gives high core density
      const distPercent = Math.pow(Math.random(), 1.6);
      const radius = 0.05 + distPercent * 1.35;

      // Logarithmic spiral curve
      const spiralCurl = 3.6;
      const angle = armAngle + radius * spiralCurl;

      // Scatter/jitter away from the central arm line
      const spread = 0.12 * Math.pow(radius, 0.65);
      const scatterAngle = Math.random() * Math.PI * 2;
      const scatterDist = Math.pow(Math.random(), 2.0) * spread;

      const x = Math.cos(angle) * radius + Math.cos(scatterAngle) * scatterDist;
      const z = Math.sin(angle) * radius + Math.sin(scatterAngle) * scatterDist;
      // Disk vertical thickness (thicker at core, flatter at rim)
      const y = (Math.random() - 0.5) * (0.16 * (1.1 - radius * 0.6));

      // Color interpolation: Pink-White Core -> Electric Purple/Lavender Arms
      const coreMix = Math.max(0, 1.0 - (radius / 0.5));
      const r = lerp(CONFIG.armColor[0], CONFIG.coreColor[0], coreMix);
      const g = lerp(CONFIG.armColor[1], CONFIG.coreColor[1], coreMix);
      const b = lerp(CONFIG.armColor[2], CONFIG.coreColor[2], coreMix);

      // Subtle cyan highlights on a small percentage of outer stars
      let finalR = r, finalG = g, finalB = b;
      if (Math.random() < 0.08 && radius > 0.4) {
        finalR = 0.15; finalG = 0.75; finalB = 0.95; // Cyan highlight matching app accent
      }

      const size = (0.7 + Math.random() * 1.8) * CONFIG.starBaseSize;
      const seed = Math.random();

      data[idx + 0] = x;
      data[idx + 1] = y;
      data[idx + 2] = z;
      data[idx + 3] = finalR;
      data[idx + 4] = finalG;
      data[idx + 5] = finalB;
      data[idx + 6] = size;
      data[idx + 7] = seed;
    }

    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    // Attributes
    const FSIZE = Float32Array.BYTES_PER_ELEMENT;
    const aPos = gl.getAttribLocation(program, 'a_position');
    const aCol = gl.getAttribLocation(program, 'a_color');
    const aSize = gl.getAttribLocation(program, 'a_size');
    const aSeed = gl.getAttribLocation(program, 'a_seed');

    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, FSIZE * 8, 0);
    gl.enableVertexAttribArray(aPos);

    gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, FSIZE * 8, FSIZE * 3);
    gl.enableVertexAttribArray(aCol);

    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, FSIZE * 8, FSIZE * 6);
    gl.enableVertexAttribArray(aSize);

    gl.vertexAttribPointer(aSeed, 1, gl.FLOAT, false, FSIZE * 8, FSIZE * 7);
    gl.enableVertexAttribArray(aSeed);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);

    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }

  function onMouseMove(e) {
    // Normalize mouse coords (-1 to 1)
    const normX = (e.clientX / window.innerWidth) * 2 - 1;
    const normY = (e.clientY / window.innerHeight) * 2 - 1;
    mouse.targetX = normX * CONFIG.mouseSensitivity;
    mouse.targetY = normY * CONFIG.mouseSensitivity;
  }

  function render() {
    // Smooth lerp mouse parallax
    mouse.x += (mouse.targetX - mouse.x) * 0.05;
    mouse.y += (mouse.targetY - mouse.y) * 0.05;

    const time = (performance.now() - startTime) * 0.001;

    gl.useProgram(program);

    // Enable additive particle blending (gives the luminous cosmic glow)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(0.0, 0.0, 0.0, 0.0); // Transparent canvas over CSS background
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Uniforms
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), time);
    gl.uniform2f(gl.getUniformLocation(program, 'u_mouse'), mouse.x, mouse.y);
    gl.uniform1f(gl.getUniformLocation(program, 'u_tiltX'), CONFIG.tiltX);
    gl.uniform1f(gl.getUniformLocation(program, 'u_rotSpeed'), CONFIG.rotationSpeed);

    gl.drawArrays(gl.POINTS, 0, CONFIG.particleCount);

    animationFrameId = requestAnimationFrame(render);
  }

  // 2D Canvas Fallback in case WebGL is completely disabled
  function initCanvas2DFallback() {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const count = 1800;
    const stars = [];
    for (let i = 0; i < count; i++) {
      const arm = i % 3;
      const r = Math.pow(Math.random(), 1.5) * 350;
      const angle = (arm / 3) * Math.PI * 2 + r * 0.012 + (Math.random() - 0.5) * 0.35;
      stars.push({
        r,
        baseAngle: angle,
        size: Math.random() * 2 + 0.8,
        color: r < 70 ? 'rgba(255, 210, 240, 0.9)' : 'rgba(140, 95, 255, 0.75)'
      });
    }

    function draw2D() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const t = performance.now() * 0.0004;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1.0, 0.45); // 3D Tilt perspective

      for (let s of stars) {
        const curA = s.baseAngle + t;
        const x = Math.cos(curA) * s.r;
        const y = Math.sin(curA) * s.r;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(x, y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      requestAnimationFrame(draw2D);
    }
    draw2D();
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
