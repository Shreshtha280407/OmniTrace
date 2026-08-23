"use client";

import { Billboard, OrbitControls, Text } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

import { nodeColor, nodeRadius, stepLayout, type GraphData, type GraphNode } from "./model";

/**
 * The relationship explorer canvas.
 *
 * Restraint rules, in order of importance:
 *  - The camera is user-driven. OrbitControls with damping, a reset control,
 *    and no autorotate — a graph that drifts on its own is unusable for
 *    reading structure.
 *  - The simulation runs for a bounded settling period after load and then
 *    stops. Perpetual physics makes a graph feel alive and makes it impossible
 *    to point at something.
 *  - Edge particles travel only along an explicitly selected path, never
 *    across every edge at all times.
 *  - Labels appear for the selected node, the hovered node, and nodes above a
 *    relevance threshold — not for all 200 at once.
 */

export interface GraphCanvasProps {
  graph: GraphData;
  selectedId: string | null;
  hoveredId: string | null;
  /** Ids passing the current filters; others render dimmed, not removed, so
   *  the filter reads as a focus rather than a data change. */
  visibleIds: Set<string>;
  /** Ordered node ids forming the highlighted query path, if any. */
  pathIds: string[] | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onFocusSubgraph: (id: string) => void;
  resetSignal: number;
}

export default function GraphCanvas(props: GraphCanvasProps) {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <Canvas
      camera={{ position: [0, 0, 14], fov: 45, near: 0.1, far: 120 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
      onPointerMissed={() => props.onSelect(null)}
    >
      <Scene {...props} reducedMotion={reducedMotion} />
    </Canvas>
  );
}

function Scene({
  graph,
  selectedId,
  hoveredId,
  visibleIds,
  pathIds,
  onSelect,
  onHover,
  onFocusSubgraph,
  resetSignal,
  reducedMotion,
}: GraphCanvasProps & { reducedMotion: boolean }) {
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const { camera } = useThree();

  // Settling budget: the layout runs for a short while after the graph changes
  // and then freezes. Re-armed whenever the node set changes.
  const settleFramesRef = useRef(0);
  useEffect(() => {
    settleFramesRef.current = reducedMotion ? 0 : 90;
  }, [graph, reducedMotion]);

  // Progressive edge draw on load — edges reveal in confidence order so the
  // strongest structure appears first.
  const drawProgress = useRef(0);
  useEffect(() => {
    drawProgress.current = reducedMotion ? 1 : 0;
  }, [graph, reducedMotion]);

  useEffect(() => {
    if (resetSignal === 0) return;
    controlsRef.current?.reset();
  }, [resetSignal]);

  const neighbourIds = useMemo(() => {
    const focus = hoveredId ?? selectedId;
    if (!focus) return null;
    const set = new Set<string>([focus]);
    graph.neighbours.get(focus)?.forEach((id) => set.add(id));
    return set;
  }, [graph, hoveredId, selectedId]);

  const pathSet = useMemo(() => (pathIds ? new Set(pathIds) : null), [pathIds]);

  const edgeGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(graph.edges.length * 6), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(graph.edges.length * 6), 3));
    return geometry;
  }, [graph.edges.length]);

  // Edges sorted by confidence so the progressive draw is meaningful.
  const edgeOrder = useMemo(
    () => graph.edges.map((_, i) => i).sort((a, b) => graph.edges[b].confidence - graph.edges[a].confidence),
    [graph.edges],
  );
  const edgeRank = useMemo(() => {
    const rank = new Map<number, number>();
    edgeOrder.forEach((edgeIndex, position) => rank.set(edgeIndex, position));
    return rank;
  }, [edgeOrder]);

  const scratch = useMemo(() => ({ color: new THREE.Color(), a: new THREE.Vector3(), b: new THREE.Vector3() }), []);

  useFrame((_, delta) => {
    if (settleFramesRef.current > 0) {
      stepLayout(graph);
      settleFramesRef.current -= 1;
    }
    if (drawProgress.current < 1) {
      drawProgress.current = Math.min(1, drawProgress.current + delta * 1.1);
    }

    const positions = edgeGeometry.getAttribute("position") as THREE.BufferAttribute;
    const colors = edgeGeometry.getAttribute("color") as THREE.BufferAttribute;
    const revealCount = Math.ceil(drawProgress.current * graph.edges.length);

    graph.edges.forEach((edge, i) => {
      const from = graph.nodesById.get(edge.from);
      const to = graph.nodesById.get(edge.to);
      if (!from || !to) return;

      const revealed = (edgeRank.get(i) ?? 0) < revealCount;
      if (!revealed) {
        // Degenerate segment: present in the buffer, invisible on screen.
        positions.setXYZ(i * 2, from.x, from.y, from.z);
        positions.setXYZ(i * 2 + 1, from.x, from.y, from.z);
        colors.setXYZ(i * 2, 0, 0, 0);
        colors.setXYZ(i * 2 + 1, 0, 0, 0);
        return;
      }

      positions.setXYZ(i * 2, from.x, from.y, from.z);
      positions.setXYZ(i * 2 + 1, to.x, to.y, to.z);

      const filtered = visibleIds.has(edge.from) && visibleIds.has(edge.to);
      const onPath = pathSet ? pathSet.has(edge.from) && pathSet.has(edge.to) : false;
      const nearFocus = neighbourIds ? neighbourIds.has(edge.from) && neighbourIds.has(edge.to) : true;

      let intensity = filtered ? 1 : 0.12;
      if (neighbourIds && !nearFocus) intensity *= 0.22;
      if (pathSet && !onPath) intensity *= 0.3;
      // Confirmed edges carry more weight; tentative ones stay visibly weaker.
      intensity *= edge.status === "confirmed" ? 0.55 + edge.confidence * 0.45 : 0.28;

      scratch.color.set(onPath ? "#A5F5EA" : edge.status === "confirmed" ? "#19D6C4" : "#7A6DC9");
      scratch.color.multiplyScalar(intensity);
      colors.setXYZ(i * 2, scratch.color.r, scratch.color.g, scratch.color.b);
      colors.setXYZ(i * 2 + 1, scratch.color.r, scratch.color.g, scratch.color.b);
    });

    positions.needsUpdate = true;
    colors.needsUpdate = true;
  });

  const handleDoubleClick = useCallback(
    (node: GraphNode) => {
      onFocusSubgraph(node.id);
      // Frame the local subgraph without teleporting: the controls target
      // moves, the camera keeps its offset.
      const controls = controlsRef.current;
      if (controls) {
        const offset = camera.position.clone().sub(controls.target);
        controls.target.set(node.x, node.y, node.z);
        camera.position.copy(controls.target).add(offset.setLength(Math.max(5, offset.length() * 0.6)));
        controls.update();
      }
    },
    [camera, onFocusSubgraph],
  );

  return (
    <>
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 8, 10]} intensity={0.9} color="#DCE6F5" />
      <directionalLight position={[-8, -4, -6]} intensity={0.35} color="#4C9BE8" />
      <fog attach="fog" args={["#090B0F", 18, 46]} />

      <OrbitControls
        ref={controlsRef}
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.55}
        zoomSpeed={0.7}
        panSpeed={0.6}
        minDistance={2.5}
        maxDistance={40}
        // No autorotate, and no unbounded polar angle — the graph must stay
        // readable, not become a ride.
        makeDefault
      />

      <lineSegments geometry={edgeGeometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors transparent opacity={0.95} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>

      {pathSet && <PathParticles graph={graph} pathIds={pathIds!} reducedMotion={reducedMotion} />}

      {graph.nodes.map((node) => (
        <NodeMesh
          key={node.id}
          node={node}
          selected={selectedId === node.id}
          hovered={hoveredId === node.id}
          dimmed={!visibleIds.has(node.id) || Boolean(neighbourIds && !neighbourIds.has(node.id))}
          onPath={pathSet?.has(node.id) ?? false}
          showLabel={
            selectedId === node.id ||
            hoveredId === node.id ||
            node.kind === "event" ||
            (node.score !== null && node.score > 0.88)
          }
          onSelect={onSelect}
          onHover={onHover}
          onDoubleClick={handleDoubleClick}
        />
      ))}
    </>
  );
}

function NodeMesh({
  node,
  selected,
  hovered,
  dimmed,
  onPath,
  showLabel,
  onSelect,
  onHover,
  onDoubleClick,
}: {
  node: GraphNode;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
  onPath: boolean;
  showLabel: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onDoubleClick: (node: GraphNode) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const radius = nodeRadius(node);
  const color = nodeColor(node);
  // Halo is reserved for selection and query matches — nothing else earns one.
  const haloed = selected || node.seed || onPath;

  useFrame(() => {
    group.current?.position.set(node.x, node.y, node.z);
  });

  const opacity = dimmed ? 0.18 : 1;

  return (
    <group ref={group}>
      <mesh
        onClick={(event) => {
          event.stopPropagation();
          onSelect(node.id);
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          onDoubleClick(node);
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          onHover(node.id);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          onHover(null);
          document.body.style.cursor = "";
        }}
        scale={hovered ? 1.25 : 1}
      >
        {node.kind === "event" ? (
          <icosahedronGeometry args={[radius, 1]} />
        ) : node.kind === "source" ? (
          <boxGeometry args={[radius * 1.5, radius * 1.5, radius * 1.5]} />
        ) : node.kind === "segment" ? (
          <torusGeometry args={[radius, radius * 0.32, 10, 22]} />
        ) : (
          <sphereGeometry args={[radius, 18, 18]} />
        )}
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={dimmed ? 0.1 : selected ? 1.1 : 0.5}
          roughness={0.38}
          metalness={0.15}
          transparent
          opacity={opacity}
        />
      </mesh>

      {haloed && !dimmed && (
        <mesh>
          <sphereGeometry args={[radius * 2.1, 16, 16]} />
          <meshBasicMaterial
            color={onPath ? "#A5F5EA" : color}
            transparent
            opacity={selected ? 0.2 : 0.1}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}

      {showLabel && !dimmed && (
        <Billboard position={[0, radius + 0.28, 0]}>
          <Text
            fontSize={node.kind === "event" ? 0.22 : 0.15}
            color={selected ? "#E8ECF2" : "#8B96A8"}
            anchorX="center"
            anchorY="bottom"
            maxWidth={3.2}
            outlineWidth={0.012}
            outlineColor="#06070A"
          >
            {truncate(node.label, node.kind === "event" ? 54 : 38)}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

/**
 * Particles travelling the selected path.
 *
 * Only rendered when a path is explicitly active — this is the mechanism that
 * explains retrieval, not ambient decoration.
 */
function PathParticles({
  graph,
  pathIds,
  reducedMotion,
}: {
  graph: GraphData;
  pathIds: string[];
  reducedMotion: boolean;
}) {
  const points = useRef<THREE.Points>(null);
  const segments = useMemo(() => {
    const result: [GraphNode, GraphNode][] = [];
    for (let i = 0; i < pathIds.length - 1; i += 1) {
      const a = graph.nodesById.get(pathIds[i]);
      const b = graph.nodesById.get(pathIds[i + 1]);
      if (a && b) result.push([a, b]);
    }
    return result;
  }, [graph, pathIds]);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, segments.length) * 3), 3));
    return g;
  }, [segments.length]);

  useFrame((state) => {
    if (segments.length === 0) return;
    const t = reducedMotion ? 0.5 : (state.clock.elapsedTime * 0.35) % 1;
    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    segments.forEach(([a, b], i) => {
      positions.setXYZ(
        i,
        THREE.MathUtils.lerp(a.x, b.x, t),
        THREE.MathUtils.lerp(a.y, b.y, t),
        THREE.MathUtils.lerp(a.z, b.z, t),
      );
    });
    positions.needsUpdate = true;
  });

  if (segments.length === 0) return null;

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        size={0.16}
        color="#A5F5EA"
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
