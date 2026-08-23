"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

import { documentTexture, glowTexture, imageRegionTexture, videoFrameTexture } from "./textures";

/**
 * The hero scene: fragments of evidence orbiting a semantic event they all
 * belong to, converging into it as the page scrolls.
 *
 * Composition rules this scene holds to:
 *  - Sparse. Eight objects, not a particle field. Each one stands for a real
 *    thing in the data model, and you can count them.
 *  - Relationship lines are drawn between fragment and event, but they only
 *    gain intensity as both endpoints resolve toward the centre. An edge is a
 *    claim about the world; a dim edge is an unresolved one.
 *  - Nothing spins for decoration. Rotation is slow orbital drift; the only
 *    fast motion is the scroll-driven convergence, which communicates the
 *    product's actual thesis.
 */

// Deterministic layout — a fixed scene composes better than a random one, and
// it means the hero looks identical on every load and in every screenshot.
const FRAGMENTS: {
  kind: "video" | "document" | "image" | "node";
  /** Scattered position, before convergence. */
  from: [number, number, number];
  /** Position at full convergence, tight around the event. */
  to: [number, number, number];
  rotation: [number, number, number];
  scale: number;
  /** Orbital drift speed and phase. */
  drift: number;
  phase: number;
  color: string;
}[] = [
  {
    kind: "video",
    from: [-3.55, 0.92, -0.6],
    to: [-1.28, 0.34, 0.18],
    rotation: [0.06, 0.42, -0.035],
    scale: 1,
    drift: 0.16,
    phase: 0.0,
    color: "#4C9BE8",
  },
  {
    kind: "document",
    from: [3.15, -0.38, -1.5],
    to: [1.18, -0.18, 0.05],
    rotation: [-0.04, -0.5, 0.05],
    scale: 0.94,
    drift: 0.13,
    phase: 1.9,
    color: "#D98E6A",
  },
  {
    kind: "image",
    from: [1.65, 1.72, -2.55],
    to: [0.62, 0.86, -0.42],
    rotation: [0.11, -0.3, -0.07],
    scale: 0.72,
    drift: 0.19,
    phase: 3.4,
    color: "#9488DD",
  },
  { kind: "node", from: [-2.15, -1.52, 0.55], to: [-0.72, -0.62, 0.34], rotation: [0, 0, 0], scale: 0.1, drift: 0.24, phase: 0.8, color: "#19D6C4" },
  { kind: "node", from: [2.32, 1.28, 0.92], to: [0.82, 0.5, 0.4], rotation: [0, 0, 0], scale: 0.075, drift: 0.21, phase: 2.6, color: "#19D6C4" },
  { kind: "node", from: [-1.05, 2.05, -1.35], to: [-0.34, 0.78, -0.2], rotation: [0, 0, 0], scale: 0.062, drift: 0.27, phase: 4.4, color: "#4C9BE8" },
  { kind: "node", from: [0.38, -2.12, -0.85], to: [0.14, -0.84, -0.16], rotation: [0, 0, 0], scale: 0.07, drift: 0.23, phase: 5.5, color: "#D98E6A" },
];

/** The audio ribbon is built separately — it is geometry, not a plane. */
const RIBBON = {
  from: new THREE.Vector3(-1.15, -2.05, 0.42),
  to: new THREE.Vector3(-0.42, -1.02, 0.3),
};

export interface ConstellationProps {
  /** 0 at the top of the hero, 1 when the hero has fully scrolled past. */
  scrollProgress: React.MutableRefObject<number>;
  /** Normalised pointer, -1..1 on both axes. */
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  reducedMotion: boolean;
}

export function EvidenceConstellation({ scrollProgress, pointer, reducedMotion }: ConstellationProps) {
  const group = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const textures = useMemo(
    () => ({
      video: videoFrameTexture(),
      document: documentTexture(),
      image: imageRegionTexture(),
      glow: glowTexture(),
    }),
    [],
  );

  // Dispose the canvas textures when the hero unmounts — they are 512px
  // canvases held on the GPU and nothing else will free them.
  useMemo(() => {
    return () => Object.values(textures).forEach((t) => t.dispose());
  }, [textures]);

  const fragmentRefs = useRef<(THREE.Object3D | null)[]>([]);
  const ribbonRef = useRef<THREE.Mesh>(null);
  const eventRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const cameraTarget = useRef(new THREE.Vector3());

  // ── relationship lines ───────────────────────────────────────────────
  // One segment per fragment→event edge, plus two fragment↔fragment edges
  // (the cross-modal ones), coloured per-vertex so intensity can be animated
  // without touching material state.
  const { lineGeometry, edgePairs } = useMemo(() => {
    const pairs: [number, number][] = [
      ...FRAGMENTS.map((_, i) => [i, -1] as [number, number]), // -1 = the event
      [0, 1], // video ↔ document: EXPLAINS
      [2, 0], // image ↔ video: VISUALLY_MATCHES
    ];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(pairs.length * 6), 3));
    return { lineGeometry: geometry, edgePairs: pairs };
  }, []);

  const ribbonGeometry = useMemo(() => buildWaveformRibbon(), []);

  const scratch = useMemo(
    () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), color: new THREE.Color() }),
    [],
  );

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    // Convergence eases out so the cluster settles rather than snapping.
    const raw = THREE.MathUtils.clamp(scrollProgress.current, 0, 1);
    const converge = reducedMotion ? 0.42 : easeOutCubic(raw);

    // ── fragments ────────────────────────────────────────────────────
    FRAGMENTS.forEach((fragment, i) => {
      const object = fragmentRefs.current[i];
      if (!object) return;

      const drift = reducedMotion ? 0 : Math.sin(t * fragment.drift + fragment.phase);
      const driftZ = reducedMotion ? 0 : Math.cos(t * fragment.drift * 0.8 + fragment.phase);
      // Orbital drift shrinks as things converge — order emerging from scatter.
      const driftScale = (1 - converge) * 0.16;

      object.position.set(
        THREE.MathUtils.lerp(fragment.from[0], fragment.to[0], converge) + drift * driftScale,
        THREE.MathUtils.lerp(fragment.from[1], fragment.to[1], converge) + driftZ * driftScale * 0.7,
        THREE.MathUtils.lerp(fragment.from[2], fragment.to[2], converge),
      );

      // Planes turn to face the viewer as they resolve into the cluster.
      object.rotation.set(
        THREE.MathUtils.lerp(fragment.rotation[0], 0, converge) + drift * 0.012 * (1 - converge),
        THREE.MathUtils.lerp(fragment.rotation[1], 0, converge) + driftZ * 0.02 * (1 - converge),
        THREE.MathUtils.lerp(fragment.rotation[2], 0, converge),
      );
    });

    // ── audio ribbon ─────────────────────────────────────────────────
    if (ribbonRef.current) {
      ribbonRef.current.position.lerpVectors(RIBBON.from, RIBBON.to, converge);
      ribbonRef.current.rotation.z = reducedMotion ? 0 : Math.sin(t * 0.14) * 0.03 * (1 - converge);
      // Amplitude breathes very slightly — audio is the one live-feeling thing.
      const amplitude = 1 + (reducedMotion ? 0 : Math.sin(t * 0.9) * 0.06);
      ribbonRef.current.scale.set(1, amplitude, 1);
    }

    // ── the semantic event ───────────────────────────────────────────
    if (eventRef.current) {
      eventRef.current.rotation.y += delta * (reducedMotion ? 0 : 0.08);
      eventRef.current.rotation.x = Math.sin(t * 0.11) * 0.06;
      // It gains presence as evidence arrives — the event is *assembled*.
      const s = 0.82 + converge * 0.38;
      eventRef.current.scale.setScalar(s);
    }

    // ── relationship lines ───────────────────────────────────────────
    if (linesRef.current) {
      const positions = lineGeometry.getAttribute("position") as THREE.BufferAttribute;
      const colors = lineGeometry.getAttribute("color") as THREE.BufferAttribute;

      edgePairs.forEach(([from, to], edge) => {
        const fromObj = fragmentRefs.current[from];
        if (!fromObj) return;
        scratch.a.copy(fromObj.position);
        if (to === -1) scratch.b.set(0, 0, 0);
        else {
          const toObj = fragmentRefs.current[to];
          if (!toObj) return;
          scratch.b.copy(toObj.position);
        }

        positions.setXYZ(edge * 2, scratch.a.x, scratch.a.y, scratch.a.z);
        positions.setXYZ(edge * 2 + 1, scratch.b.x, scratch.b.y, scratch.b.z);

        // Intensity is a function of resolution, not time: an edge brightens
        // as its endpoints come into focus around the event.
        const distance = scratch.a.distanceTo(scratch.b);
        const proximity = THREE.MathUtils.clamp(1 - (distance - 0.9) / 3.2, 0, 1);
        const intensity = Math.pow(proximity, 1.5) * (0.22 + converge * 0.78);

        // Cross-modal edges take the ultraviolet; event edges take teal.
        const isCrossModal = to !== -1;
        scratch.color.set(isCrossModal ? "#7A6DC9" : "#19D6C4").multiplyScalar(intensity);
        colors.setXYZ(edge * 2, scratch.color.r, scratch.color.g, scratch.color.b);
        colors.setXYZ(edge * 2 + 1, scratch.color.r, scratch.color.g, scratch.color.b);
      });

      positions.needsUpdate = true;
      colors.needsUpdate = true;
    }

    // ── camera ───────────────────────────────────────────────────────
    // Inertial parallax from the pointer, plus a dolly that carries the
    // camera through the cluster as it forms.
    const parallaxX = reducedMotion ? 0 : pointer.current.x * 0.42;
    const parallaxY = reducedMotion ? 0 : pointer.current.y * 0.26;
    cameraTarget.current.set(parallaxX, parallaxY + 0.08, 5.6 - converge * 4.15);
    // Critically-damped-ish follow, frame-rate independent.
    const damping = 1 - Math.pow(0.0016, delta);
    camera.position.lerp(cameraTarget.current, damping);
    camera.lookAt(0, 0, 0);
  });

  return (
    <group ref={group}>
      {/* Key light from upper left, cool fill from below right — physically
          plausible rather than a uniform ambient wash. */}
      <ambientLight intensity={0.28} />
      <directionalLight position={[-4, 5, 6]} intensity={1.5} color="#DCE6F5" />
      <directionalLight position={[5, -3, 2]} intensity={0.4} color="#4C9BE8" />
      <pointLight position={[0, 0, 0]} intensity={2.4} distance={5} color="#19D6C4" />

      {/* Depth falloff stands in for depth of field — far fragments dissolve
          into the ground colour instead of staying crisp. */}
      <fog attach="fog" args={["#06070A", 4.5, 13]} />

      {/* ── the semantic event ────────────────────────────────────── */}
      <group ref={eventRef}>
        <mesh>
          <icosahedronGeometry args={[0.4, 1]} />
          <meshStandardMaterial
            color="#0A5C55"
            emissive="#19D6C4"
            emissiveIntensity={0.55}
            roughness={0.35}
            metalness={0.1}
            transparent
            opacity={0.5}
          />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.IcosahedronGeometry(0.4, 1)]} />
          <lineBasicMaterial color="#5EEBDC" transparent opacity={0.55} />
        </lineSegments>
        <mesh>
          <sphereGeometry args={[0.12, 24, 24]} />
          <meshBasicMaterial color="#A5F5EA" />
        </mesh>
        <sprite scale={[2.6, 2.6, 1]}>
          <spriteMaterial
            map={textures.glow}
            color="#19D6C4"
            transparent
            opacity={0.34}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </sprite>
      </group>

      {/* ── relationship lines ────────────────────────────────────── */}
      <lineSegments ref={linesRef} geometry={lineGeometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>

      {/* ── fragments ─────────────────────────────────────────────── */}
      {FRAGMENTS.map((fragment, i) => (
        <group
          key={i}
          ref={(el) => {
            fragmentRefs.current[i] = el;
          }}
        >
          {fragment.kind === "video" && (
            <FramePlane texture={textures.video} width={1.78} height={1.0} accent="#4C9BE8" />
          )}
          {fragment.kind === "document" && (
            <FramePlane texture={textures.document} width={0.86} height={1.15} accent="#D98E6A" />
          )}
          {fragment.kind === "image" && (
            <FramePlane texture={textures.image} width={1.12} height={0.84} accent="#9488DD" />
          )}
          {fragment.kind === "node" && (
            <mesh scale={fragment.scale}>
              <octahedronGeometry args={[1, 0]} />
              <meshStandardMaterial
                color={fragment.color}
                emissive={fragment.color}
                emissiveIntensity={0.85}
                roughness={0.3}
                metalness={0.2}
              />
            </mesh>
          )}
        </group>
      ))}

      {/* ── audio waveform ribbon ─────────────────────────────────── */}
      <mesh ref={ribbonRef} geometry={ribbonGeometry}>
        <meshBasicMaterial
          color="#19D6C4"
          transparent
          opacity={0.62}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/** An evidence plane: the content, a hairline bezel, and a thin accent edge on
 *  one side so the object reads as a *card of evidence* rather than a poster. */
function FramePlane({
  texture,
  width,
  height,
  accent,
}: {
  texture: THREE.Texture;
  width: number;
  height: number;
  accent: string;
}) {
  return (
    <group>
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial map={texture} toneMapped={false} transparent opacity={0.94} />
      </mesh>
      {/* Bezel */}
      <lineSegments position={[0, 0, 0.001]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(width, height)]} />
        <lineBasicMaterial color="#3D4658" transparent opacity={0.85} />
      </lineSegments>
      {/* Accent edge — the modality tell. */}
      <mesh position={[-width / 2 - 0.012, 0, 0.002]}>
        <planeGeometry args={[0.018, height]} />
        <meshBasicMaterial color={accent} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * A waveform silhouette built as a triangle strip: for each sample, a vertex
 * above and below the axis. Deterministic sample values so the shape is a
 * designed profile — speech with pauses — rather than noise.
 */
function buildWaveformRibbon(): THREE.BufferGeometry {
  const samples = 112;
  const length = 1.9;
  const positions: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i < samples; i += 1) {
    const u = i / (samples - 1);
    const x = (u - 0.5) * length;

    // Two speech bursts separated by a pause, with syllabic modulation on top.
    const burstA = Math.exp(-Math.pow((u - 0.27) / 0.19, 2));
    const burstB = Math.exp(-Math.pow((u - 0.72) / 0.15, 2));
    const syllables = 0.55 + 0.45 * Math.abs(Math.sin(u * Math.PI * 13));
    const micro = 0.85 + 0.15 * Math.sin(u * Math.PI * 47);
    const amplitude = (burstA + burstB * 0.82) * syllables * micro * 0.14 + 0.004;

    positions.push(x, amplitude, 0);
    positions.push(x, -amplitude, 0);

    if (i < samples - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}
