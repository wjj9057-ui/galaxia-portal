// postfx.js — 后处理链:RenderPass → UnrealBloom → 自定义(暗角+颗粒+色散) → OutputPass
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 自定义最终调色 Shader:暗角 + 胶片颗粒 + 轻微 RGB 色散
const FinalGradeShader = {
  name: 'FinalGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.05 },
    uAberration: { value: 0.0016 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float dist = length(centered);

      // RGB 色散:沿径向微量偏移采样
      float ab = uAberration * (0.4 + dist * 2.2);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + centered * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - centered * ab).b;

      // 暗角
      float vig = smoothstep(0.92, 0.32, dist * (1.0 + uVignette));
      col *= mix(1.0, vig, uVignette);

      // 胶片颗粒(时间抖动)
      float g = hash(uv * uResolution * 0.35 + fract(uTime) * 100.0) - 0.5;
      col += g * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export function createPostFX(renderer, scene, camera, quality) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  // Bloom 分辨率按质量档缩放
  const bloomScale = quality.bloomScale;
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(size.x * bloomScale, size.y * bloomScale),
    0.9,   // strength
    0.55,  // radius
    0.32   // threshold
  );
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(FinalGradeShader);
  gradePass.uniforms.uResolution.value.set(size.x, size.y);
  composer.addPass(gradePass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return {
    composer,
    bloomPass,
    gradePass,

    setSize(w, h) {
      composer.setSize(w, h);
      bloomPass.resolution.set(w * bloomScale, h * bloomScale);
      gradePass.uniforms.uResolution.value.set(w, h);
    },

    update(elapsed) {
      gradePass.uniforms.uTime.value = elapsed;
    },

    // 直达各参数的 setter
    setBloom({ strength, radius, threshold }) {
      if (strength !== undefined) bloomPass.strength = strength;
      if (radius !== undefined) bloomPass.radius = radius;
      if (threshold !== undefined) bloomPass.threshold = threshold;
    },
    setGrade({ vignette, grain, aberration }) {
      if (vignette !== undefined) gradePass.uniforms.uVignette.value = vignette;
      if (grain !== undefined) gradePass.uniforms.uGrain.value = grain;
      if (aberration !== undefined) gradePass.uniforms.uAberration.value = aberration;
    },
  };
}
