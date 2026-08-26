"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useWebGLSupport } from "@/hooks/useWebGLSupport";

/**
 * Ambient page background.
 *
 * A single full-screen fragment shader: layered value noise drifting slowly
 * through the two brand hues over the graphite ground. No geometry, no
 * objects, no outlines — the previous hero scene failed precisely because it
 * drew *things* (wireframe spheres, floating diamonds), and drawn things on a
 * marketing page read as decoration. A field has no silhouette to recognise,
 * so it reads as light rather than as a model.
 *
 * It is deliberately near-invisible. The amplitude is low enough that on a
 * bright screen it registers as depth rather than as colour; anything stronger
 * competes with the type, which is the one thing on this page that has to win.
 *
 * Costs nothing when it cannot or should not run: no WebGL falls back to a
 * static CSS wash, and reduced-motion freezes the field at a fixed time rather
 * than removing it, so the composition is unchanged for people who just do not
 * want movement.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2  uAspect;
  uniform vec3  uSignal;
  uniform vec3  uUv;

  // Cheap value noise — smooth, no texture fetch, no derivatives.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Four octaves is enough for a soft cloud at this amplitude; more detail is
  // invisible once the result is multiplied down this far.
  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      total += noise(p) * amplitude;
      p *= 2.02;
      amplitude *= 0.5;
    }
    return total;
  }

  void main() {
    vec2 p = (vUv - 0.5) * uAspect;

    float t = uTime * 0.012;
    // Two fields drifting on different vectors so the motion never reads as a
    // single texture sliding across the screen.
    float a = fbm(p * 1.7 + vec2(t, t * 0.6));
    float b = fbm(p * 2.3 - vec2(t * 0.8, t * 1.3) + 4.0);

    float field = smoothstep(0.25, 0.95, a * 0.65 + b * 0.45);

    // Weighted toward the top of the page, where the hero sits, and gone well
    // before the footer so sections below keep a flat ground.
    float falloff = smoothstep(1.05, 0.05, vUv.y);

    vec3 color = mix(uUv, uSignal, smoothstep(0.2, 0.9, b));
    float intensity = field * falloff * 0.16;

    gl_FragColor = vec4(color * intensity, intensity);
  }
`;

function Field({ frozen }: { frozen: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: frozen ? 120.0 : 0.0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uSignal: { value: new THREE.Color("#19D6C4") },
      uUv: { value: new THREE.Color("#7A6DC9") },
    }),
    [frozen],
  );

  useFrame((state, delta) => {
    if (frozen || !material.current) return;
    material.current.uniforms.uTime.value += delta;
    const { width, height } = state.size;
    material.current.uniforms.uAspect.value.set(Math.max(1, width / height), 1);
  });

  return (
    <mesh frustumCulled={false}>
      {/* A plane in clip space: the vertex shader ignores the camera entirely,
          so there is nothing to position or resize. */}
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={material}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

export function AmbientBackground() {
  const webgl = useWebGLSupport();
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 bg-ink-950" aria-hidden>
      {/* Painted underneath in every case: it is the whole background when
          WebGL is unavailable, and it deepens the field when it is. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(90% 55% at 50% -10%, rgba(25,214,196,0.07), transparent 60%), radial-gradient(60% 40% at 85% 5%, rgba(122,109,201,0.06), transparent 65%)",
        }}
      />

      {webgl === true && (
        <Canvas
          gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
          // The field is low-frequency; rendering it at retina density costs
          // fill rate for detail that is below the noise floor anyway.
          dpr={1}
          className="absolute inset-0"
        >
          <Field frozen={reducedMotion} />
        </Canvas>
      )}

      {/* Settles the field into the page: sections below the fold sit on flat
          ground rather than on a gradient that never resolves. */}
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-ink-950 to-transparent" />
    </div>
  );
}
