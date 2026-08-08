"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/* Zola's presence on the landing page (MOO-500). Real sphere geometry —
 * a Fibonacci point cloud plus a wireframe shell, additively blended so
 * depth reads as light rather than as a painted gradient. `speaking` widens
 * the breath while her answer streams (Glow Means Live). */
export function LandingOrb({
  speaking = false,
  className,
}: {
  speaking?: boolean;
  className?: string;
}) {
  return (
    <div className={className ?? "relative h-full w-full"}>
      {/* Halo: the bloom pass a postprocessing chain would give us, at a
          fraction of the cost. Sits behind the geometry. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 [background:radial-gradient(circle_at_center,color-mix(in_srgb,var(--hud-cyan)_30%,transparent)_0%,color-mix(in_srgb,var(--hud-cyan)_16%,transparent)_38%,transparent_66%)]"
      />
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 3.4], fov: 45 }}
        gl={{ alpha: true, antialias: true }}
      >
        <Sphere speaking={speaking} />
      </Canvas>
    </div>
  );
}

const POINTS = 2600;

function Sphere({ speaking }: { speaking: boolean }) {
  const points = useRef<THREE.Points>(null);
  const shell = useRef<THREE.LineSegments>(null);
  const breath = useRef(0);

  // Fibonacci sphere: even coverage, no clustering at the poles.
  const positions = useMemo(() => {
    const arr = new Float32Array(POINTS * 3);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < POINTS; i++) {
      const y = 1 - (i / (POINTS - 1)) * 2;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = golden * i;
      arr[i * 3] = Math.cos(theta) * r;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = Math.sin(theta) * r;
    }
    return arr;
  }, []);

  const sprite = useMemo(() => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(
        size / 2,
        size / 2,
        0,
        size / 2,
        size / 2,
        size / 2
      );
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useFrame((state, delta) => {
    // Static, fully-formed sphere when the visitor asked for less motion.
    if (reduced) return;
    const t = state.clock.elapsedTime;
    const target = speaking ? 1 : 0;
    breath.current += (target - breath.current) * 0.05;
    const pulse =
      1 + Math.sin(t * (speaking ? 2.4 : 0.8)) * (0.012 + breath.current * 0.03);
    if (points.current) {
      points.current.rotation.y += delta * 0.14;
      points.current.rotation.x = Math.sin(t * 0.16) * 0.14;
      points.current.scale.setScalar(pulse);
      const mat = points.current.material as THREE.PointsMaterial;
      mat.opacity = 0.88 + breath.current * 0.12;
    }
    if (shell.current) {
      shell.current.rotation.y -= delta * 0.06;
      shell.current.scale.setScalar(pulse * 1.02);
    }
  });

  return (
    <group>
      <points ref={points}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.042}
          map={sprite}
          color="#8af0ff"
          transparent
          opacity={0.88}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
      <lineSegments ref={shell}>
        <edgesGeometry args={[new THREE.IcosahedronGeometry(1, 3)]} />
        <lineBasicMaterial
          color="#35e0ff"
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
